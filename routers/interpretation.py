#!/usr/bin/env python3
"""
MAD Training Studio — Interpretation router
Routes: transcribe, generate-speech, get-key-terms, analyze-interpretation,
        yt-test, search-videos, analyze-video-terms, curated-videos,
        analyze-video-structure, save-glossary,
        OPI (voices/start-call/next-turn/save-intro/prefetch-next/end-call),
        CI  (new-session/get-segment/submit-turn/end-session)
"""

import os, json, re, tempfile, urllib.request, base64, uuid, random, math
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from shared import (
    ask_claude, extract_json, save_session, claude, whisper,
    STUDIO_ROOT, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID,
)

import numpy as np

try:
    import librosa
    HAS_LIBROSA = True
except Exception:
    HAS_LIBROSA = False

router = APIRouter()

# ── Audio Analysis Helpers ────────────────────────────────────────────────────

def _load_audio(path: str, target_sr: int = 16000) -> tuple:
    """Load audio file using PyAV (av), resample to target_sr, return (y, sr)."""
    try:
        import av as pyav
        container = pyav.open(path)
        stream = container.streams.audio[0]
        samples = []
        for frame in container.decode(stream):
            arr = frame.to_ndarray().astype(np.float32)
            if arr.ndim > 1:
                arr = arr.mean(axis=0)
            samples.append(arr)
        audio = np.concatenate(samples)
        # Normalize to [-1, 1] based on bit depth
        if audio.max() > 1.0:
            audio = audio / 32768.0
        sr = stream.sample_rate
        if sr != target_sr:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            sr = target_sr
        return audio, sr
    except Exception as e:
        raise RuntimeError(f"Audio load failed: {e}")


def _extract_wpm_from_segments(segments) -> tuple:
    """Return (wpm, word_count, speech_duration_sec) from whisper segments."""
    # Convert generator to list if needed
    if hasattr(segments, '__iter__') and not hasattr(segments, '__len__'):
        segments = list(segments)
    if not segments:
        return 0, 0, 0.0
    words = []
    for seg in segments:
        text = getattr(seg, "text", seg.get("text", "")) if isinstance(seg, dict) else getattr(seg, "text", "")
        words.extend(re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", text))
    word_count = len(words)
    starts = [getattr(s, "start", s.get("start", 0)) if isinstance(s, dict) else getattr(s, "start", 0) for s in segments]
    ends = [getattr(s, "end", s.get("end", 0)) if isinstance(s, dict) else getattr(s, "end", 0) for s in segments]
    if not starts or not ends:
        return 0, 0, 0.0
    speech_duration = max(ends) - min(starts)
    if speech_duration <= 0:
        speech_duration = 1.0
    wpm = int(word_count / (speech_duration / 60))
    return wpm, word_count, speech_duration


def _extract_pauses_from_segments(segments, min_gap: float = 0.5) -> list:
    """Extract pauses (gaps between segments) from whisper segments."""
    pauses = []
    # Convert generator to list if needed
    if hasattr(segments, '__iter__') and not hasattr(segments, '__len__'):
        segments = list(segments)
    if not segments or len(segments) < 2:
        return pauses
    for i in range(1, len(segments)):
        prev_end = getattr(segments[i - 1], "end", segments[i - 1].get("end", 0)) if isinstance(segments[i - 1], dict) else getattr(segments[i - 1], "end", 0)
        curr_start = getattr(segments[i], "start", segments[i].get("start", 0)) if isinstance(segments[i], dict) else getattr(segments[i], "start", 0)
        gap = curr_start - prev_end
        if gap >= min_gap:
            pauses.append({"start": round(prev_end, 2), "end": round(curr_start, 2), "duration": round(gap, 2)})
    return pauses


def _extract_pauses_from_energy(audio: np.ndarray, sr: int, threshold_db: float = -40, min_dur: float = 0.3) -> list:
    """Extract pauses from audio energy envelope (silence detection)."""
    hop = int(sr * 0.01)  # 10ms hop
    frames = librosa.util.frame(audio, frame_length=hop, hop_length=hop)
    energy = librosa.feature.rms(y=audio, frame_length=hop, hop_length=hop)[0]
    # Convert to dB relative to max
    max_e = energy.max() if energy.max() > 0 else 1e-10
    db = 20 * np.log10(energy / max_e + 1e-10)
    is_silent = db < threshold_db
    pauses = []
    in_pause = False
    start_frame = 0
    for i, silent in enumerate(is_silent):
        if silent and not in_pause:
            in_pause = True
            start_frame = i
        elif not silent and in_pause:
            in_pause = False
            dur = (i - start_frame) * 0.01
            if dur >= min_dur:
                pauses.append({"start": round(start_frame * 0.01, 2), "end": round(i * 0.01, 2), "duration": round(dur, 2)})
    if in_pause:
        dur = (len(is_silent) - start_frame) * 0.01
        if dur >= min_dur:
            pauses.append({"start": round(start_frame * 0.01, 2), "end": round(len(is_silent) * 0.01, 2), "duration": round(dur, 2)})
    return pauses


def _extract_pitch_contour(audio_path: str, sr: int = 16000) -> np.ndarray:
    """Extract a simplified pitch contour using librosa."""
    y, sr = _load_audio(audio_path, target_sr=sr)
    # Use librosa piptrack for pitch extraction
    pitches, magnitudes = librosa.piptrack(y=y, sr=sr, n_fft=2048, hop_length=512)
    # Take the pitch with highest magnitude at each frame
    pitch_contour = []
    for t in range(pitches.shape[1]):
        mag = magnitudes[:, t]
        if mag.max() > 0:
            idx = mag.argmax()
            pitch = pitches[idx, t]
            if pitch > 0:
                pitch_contour.append(pitch)
            else:
                pitch_contour.append(np.nan)
        else:
            pitch_contour.append(np.nan)
    contour = np.array(pitch_contour, dtype=np.float32)
    # Interpolate NaNs
    nan_mask = np.isnan(contour)
    if nan_mask.any() and not nan_mask.all():
        indices = np.arange(len(contour))
        contour[nan_mask] = np.interp(indices[nan_mask], indices[~nan_mask], contour[~nan_mask])
    # Smooth with median filter
    contour = librosa.util.normalize(contour) if not np.allclose(contour, 0) else contour
    return contour


def _compare_pitch_contours(user_pitch: np.ndarray, source_pitch: np.ndarray) -> float:
    """Compare two pitch contours and return similarity score (0-100)."""
    # Normalize lengths
    min_len = min(len(user_pitch), len(source_pitch))
    if min_len < 10:
        return 50.0
    u = user_pitch[:min_len]
    s = source_pitch[:min_len]
    # Normalize
    u = (u - np.mean(u)) / (np.std(u) + 1e-10)
    s = (s - np.mean(s)) / (np.std(s) + 1e-10)
    # Pearson correlation
    corr = np.corrcoef(u, s)[0, 1]
    if np.isnan(corr):
        return 50.0
    # Map correlation to 0-100 score
    score = (corr + 1) / 2 * 100  # -1 -> 0, +1 -> 100
    return max(0.0, min(100.0, score))


def _compare_word_sequences(user_words: list, source_words: list) -> float:
    """Simple phonemic overlap: compare word sequences using longest common subsequence ratio."""
    if not source_words:
        return 0.0
    if not user_words:
        return 0.0
    # Normalize to lowercase
    u = [w.lower() for w in user_words]
    s = [w.lower() for w in source_words]
    # LCS length
    m, n = len(u), len(s)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if u[i - 1] == s[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    lcs_len = dp[m][n]
    # Score: LCS / max(len(u), len(s))
    score = lcs_len / max(m, n) * 100
    return score


def _compute_wpm_score(user_wpm: int, source_wpm: int) -> float:
    """WPM match score: ±10% tolerance = good (100), linear decay beyond."""
    if source_wpm <= 0:
        return 50.0
    diff_pct = abs(user_wpm - source_wpm) / source_wpm * 100
    if diff_pct <= 10:
        return 100.0
    score = max(0.0, 100.0 - (diff_pct - 10) * 5)
    return score


def _compute_pause_score(user_pauses: list, source_pauses: list) -> float:
    """Pause pattern similarity: compare total pause count and total pause duration."""
    if not source_pauses:
        return 50.0 if not user_pauses else 30.0
    if not user_pauses:
        return 0.0
    user_count = len(user_pauses)
    source_count = len(source_pauses)
    user_total_dur = sum(p["duration"] for p in user_pauses)
    source_total_dur = sum(p["duration"] for p in source_pauses)
    count_diff = abs(user_count - source_count) / max(source_count, 1)
    dur_diff = abs(user_total_dur - source_total_dur) / max(source_total_dur, 1)
    # Score: penalize deviation in count and duration
    score = 100 - (count_diff * 30 + dur_diff * 40)
    return max(0.0, min(100.0, score))


def _get_source_wpm_from_video(video_id: str) -> int | None:
    """Try to get WPM from YouTube captions using existing measure_wpm_from_captions logic."""
    try:
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        duration_sec = info.get("duration", 0) or 0
        if duration_sec <= 0:
            return None
        auto = info.get("automatic_captions") or {}
        manual = info.get("subtitles") or {}
        caps = manual.get("en") or auto.get("en") or []
        if not caps:
            return None
        cap_url = next((c["url"] for c in caps if c.get("ext") == "json3"), None)
        if not cap_url:
            cap_url = caps[0].get("url", "") if caps else None
        if not cap_url:
            return None
        with urllib.request.urlopen(cap_url, timeout=7) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
        try:
            data = json.loads(raw)
            events = data.get("events", [])
            texts = []
            for ev in events:
                for seg in (ev.get("segs") or []):
                    t = (seg.get("utf8") or "").strip()
                    if t and t != "\n":
                        texts.append(t)
            full_text = " ".join(texts)
        except Exception:
            full_text = re.sub(r"<[^>]+>", " ", raw)
            full_text = re.sub(r"\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*", "", full_text)
        words = re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", full_text)
        if len(words) < 30:
            return None
        wpm = int(len(words) / (duration_sec / 60))
        return wpm
    except Exception:
        return None


def _get_source_pauses_from_captions(video_id: str) -> list:
    """Extract pauses from YouTube caption timestamps."""
    try:
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        auto = info.get("automatic_captions") or {}
        manual = info.get("subtitles") or {}
        caps = manual.get("en") or auto.get("en") or []
        if not caps:
            return []
        cap_url = next((c["url"] for c in caps if c.get("ext") == "json3"), None)
        if not cap_url:
            cap_url = caps[0].get("url", "") if caps else None
        if not cap_url:
            return []
        with urllib.request.urlopen(cap_url, timeout=7) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
        data = json.loads(raw)
        events = data.get("events", [])
        timed_lines = []
        for ev in events:
            t_sec = ev.get("tStartMs", 0) / 1000
            text = "".join(s.get("utf8", "") for s in (ev.get("segs") or [])).strip()
            if text and text != "\n":
                timed_lines.append({"t": t_sec, "text": text})
        pauses = []
        for i in range(1, len(timed_lines)):
            gap = timed_lines[i]["t"] - timed_lines[i - 1]["t"]
            if gap >= 0.5:
                pauses.append({"start": round(timed_lines[i - 1]["t"], 2), "end": round(timed_lines[i]["t"], 2), "duration": round(gap, 2)})
        return pauses
    except Exception:
        return []


def _get_source_text_from_captions(video_id: str) -> str:
    """Fetch full transcript text from YouTube captions."""
    try:
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        auto = info.get("automatic_captions") or {}
        manual = info.get("subtitles") or {}
        caps = manual.get("en") or auto.get("en") or []
        if not caps:
            return ""
        cap_url = next((c["url"] for c in caps if c.get("ext") == "json3"), None)
        if not cap_url:
            cap_url = caps[0].get("url", "") if caps else None
        if not cap_url:
            return ""
        with urllib.request.urlopen(cap_url, timeout=7) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
        try:
            data = json.loads(raw)
            events = data.get("events", [])
            texts = []
            for ev in events:
                for seg in (ev.get("segs") or []):
                    t = (seg.get("utf8") or "").strip()
                    if t and t != "\n":
                        texts.append(t)
            return " ".join(texts)
        except Exception:
            return re.sub(r"<[^>]+>", " ", raw)
    except Exception:
        return ""


def _download_source_audio(video_id: str) -> str | None:
    """Download YouTube audio to cache, return path or None."""
    cache_dir = Path(tempfile.gettempdir()) / "training_studio_audio_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"{video_id}.webm"
    if cached.exists() and cached.stat().st_size > 10000:
        return str(cached)
    try:
        import yt_dlp
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "bestaudio/best",
            "outtmpl": str(cache_dir / f"{video_id}.%(ext)s"),
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={video_id}"])
        # Find the downloaded file
        for ext in ("webm", "m4a", "mp4", "ogg"):
            f = cache_dir / f"{video_id}.{ext}"
            if f.exists() and f.stat().st_size > 10000:
                return str(f)
        return None
    except Exception:
        return None


def _evaluate_shadowing_acoustic(user_audio_path: str, source_audio_path: str | None, source_text: str, source_wpm: int | None, source_video_id: str | None) -> dict:
    """
    Evaluate shadowing performance using acoustic metrics.
    Returns dict with wpm_score, pause_score, phonemic_score, intonation_score, overall_score.
    """
    # If source_text is a placeholder, try to get real captions
    if source_text.startswith("[Shadowing") and source_video_id:
        caption_text = _get_source_text_from_captions(source_video_id)
        if caption_text:
            source_text = caption_text

    # Transcribe user audio with timestamps
    user_segs_gen, _ = whisper.transcribe(user_audio_path, beam_size=1)
    user_segs = list(user_segs_gen)  # convert generator to list for multiple iterations
    user_words = []
    for seg in user_segs:
        user_words.extend(re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", seg.text))

    # ── WPM ──
    user_wpm, user_word_count, user_dur = _extract_wpm_from_segments(user_segs)
    if not source_wpm and source_video_id:
        source_wpm = _get_source_wpm_from_video(source_video_id)
    if not source_wpm:
        # Estimate from source_text word count and typical speech duration (assume ~130 wpm if no other info)
        source_words = re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", source_text)
        estimated_dur = max(len(source_words) / 130 * 60, user_dur)
        source_wpm = int(len(source_words) / (estimated_dur / 60)) if estimated_dur > 0 else 130
    wpm_score = _compute_wpm_score(user_wpm, source_wpm)

    # ── Pauses ──
    user_pauses = _extract_pauses_from_segments(user_segs, min_gap=0.5)
    # Also add energy-based pauses for richer detection
    try:
        y, sr = _load_audio(user_audio_path)
        energy_pauses = _extract_pauses_from_energy(y, sr, threshold_db=-40, min_dur=0.3)
        # Merge: keep unique pauses by start time
        seen = {p["start"] for p in user_pauses}
        for p in energy_pauses:
            if p["start"] not in seen:
                user_pauses.append(p)
        user_pauses.sort(key=lambda x: x["start"])
    except Exception:
        pass
    source_pauses = []
    if source_video_id:
        source_pauses = _get_source_pauses_from_captions(source_video_id)
    if not source_pauses and source_text:
        # Rough heuristic: estimate pauses from punctuation in source text
        # (1 pause per ~20 words or at sentence boundaries)
        source_words_list = re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", source_text)
        est_pause_count = max(1, len(source_words_list) // 20)
        est_total_pause = est_pause_count * 1.0  # ~1 sec per pause heuristic
        source_pauses = [{"start": 0, "end": 0, "duration": est_total_pause / est_pause_count} for _ in range(est_pause_count)]
    pause_score = _compute_pause_score(user_pauses, source_pauses)

    # ── Phonemic overlap ──
    source_words = re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", source_text)
    phonemic_score = _compare_word_sequences(user_words, source_words)

    # ── Intonation ──
    intonation_score = 50.0
    if HAS_LIBROSA:
        try:
            user_pitch = _extract_pitch_contour(user_audio_path)
            if source_audio_path:
                source_pitch = _extract_pitch_contour(source_audio_path)
                intonation_score = _compare_pitch_contours(user_pitch, source_pitch)
            else:
                # No source audio: score based on natural pitch variance
                if len(user_pitch) > 10:
                    std = np.std(user_pitch)
                    # Natural speech has some variance; too flat (<0.1) or too erratic (>1.0) are bad
                    if std < 0.1:
                        intonation_score = 30.0
                    elif std < 0.3:
                        intonation_score = 60.0
                    elif std < 0.6:
                        intonation_score = 85.0
                    else:
                        intonation_score = 70.0
        except Exception:
            intonation_score = 50.0

    # ── Overall ──
    overall_score = round(
        wpm_score * 0.25 + pause_score * 0.25 + phonemic_score * 0.25 + intonation_score * 0.25,
        1,
    )

    return {
        "wpm_score": round(wpm_score, 1),
        "pause_score": round(pause_score, 1),
        "phonemic_score": round(phonemic_score, 1),
        "intonation_score": round(intonation_score, 1),
        "overall_score": overall_score,
        "user_wpm": user_wpm,
        "source_wpm": source_wpm,
        "user_pauses": user_pauses,
        "source_pauses": source_pauses,
        "user_word_count": user_word_count,
        "source_word_count": len(source_words),
    }


# ── Transcription ─────────────────────────────────────────────────────────────

@router.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = Form("auto")):
    try:
        data = await audio.read()
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(data); tmp = f.name
        lang = None if language == "auto" else language
        segs, _ = whisper.transcribe(tmp, language=lang, beam_size=1)
        text = " ".join(s.text for s in segs).strip()
        os.unlink(tmp)
        return JSONResponse({"transcript": text})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# ── Speech Generation ─────────────────────────────────────────────────────────

@router.post("/api/generate-speech")
async def generate_speech(
    topic: str       = Form("general news"),
    language: str    = Form("English"),
    mode: str        = Form("consecutive"),
    specialization: str = Form("general"),
    duration_sec: int   = Form(60)
):
    try:
        from elevenlabs import ElevenLabs

        word_count = int(duration_sec * 2.2)  # ~130 wpm
        if mode == "consecutive":
            instructions = f"Speak in {int(duration_sec/3)}-second natural segments, pausing between each."
        elif mode == "shadowing":
            instructions = "Clear, moderately paced broadcast speech. Ideal for repetition practice."
        elif mode == "opi":
            instructions = "Simulate a realistic phone call scenario as a caller with a request or problem."
        else:
            instructions = "Continuous natural speech without pauses."

        speech_text = ask_claude(f"""Generate a {word_count}-word spoken passage for interpretation practice.
Language: {language}
Specialization: {specialization}
Mode instructions: {instructions}
Style: Natural spoken language, NOT written. No stage directions. Just the speech text itself.""", 600)

        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        speech_text_clean = _clean_for_tts(speech_text)
        is_arabic = bool(re.search(r'[؀-ۿݐ-ݿࢠ-ࣿ]', speech_text_clean))
        audio_chunks = client.text_to_speech.convert(
            voice_id=ELEVENLABS_VOICE_ID,
            text=speech_text_clean,
            model_id="eleven_turbo_v2_5" if is_arabic else "eleven_turbo_v2"
        )
        audio_bytes = b"".join(audio_chunks)

        import base64
        return JSONResponse({
            "text": speech_text,
            "audio_b64": base64.b64encode(audio_bytes).decode(),
            "mime": "audio/mpeg"
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# ── Interpretation Analysis ───────────────────────────────────────────────────

@router.post("/api/get-key-terms")
async def get_key_terms(
    topic:      str = Form(...),
    field:      str = Form("general"),
    language:   str = Form("English → Arabic"),
    difficulty: str = Form("moderate"),
    count:      int = Form(15)
):
    try:
        src = "English" if language.startswith("English") else "Arabic"
        tgt = "Arabic"  if language.startswith("English") else "English"
        prompt = f"""Generate {count} bilingual key terms for a {difficulty}-level {field} interpretation practice session on the topic: "{topic}".
Source language: {src} | Target language: {tgt}

Return JSON array only:
[{{"source": "term in {src}", "target": "الترجمة بالعربي أو English term", "note": "brief usage context (max 6 words)"}}]

Prioritise terms that: appear frequently in {field} {topic} contexts, are commonly mistranslated, and match {difficulty} register."""
        raw  = ask_claude(prompt, 900)
        m    = re.search(r'\[.*\]', raw, re.DOTALL)
        if m:
            return JSONResponse(json.loads(m.group()))
        return JSONResponse([])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/api/analyze-interpretation")
async def analyze_interpretation(
    source_text:   str = Form(...),
    rendition_text:str = Form(...),
    mode:          str = Form("consecutive"),
    specialization:str = Form("general"),
    direction:     str = Form("English → Arabic"),
    topic:         str = Form(""),
    difficulty:    str = Form("moderate"),
    user_audio:    UploadFile = File(None),
    source_video_id: str = Form(""),
    source_wpm:    str = Form(""),
    verbatim:      str = Form("0"),
):
    try:
        is_shadowing = mode == "shadowing"

        # ── Shadowing acoustic evaluation ─────────────────────────────
        if is_shadowing and user_audio:
            try:
                # Save user audio to temp file
                user_audio_data = await user_audio.read()
                with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                    f.write(user_audio_data)
                    user_audio_path = f.name

                # Get source audio if video_id provided
                source_audio_path = None
                if source_video_id:
                    source_audio_path = _download_source_audio(source_video_id)

                # Parse source_wpm
                source_wpm_val = None
                try:
                    source_wpm_val = int(float(source_wpm)) if source_wpm.strip() else None
                except (ValueError, TypeError):
                    source_wpm_val = None

                # Run acoustic evaluation
                acoustic = _evaluate_shadowing_acoustic(
                    user_audio_path=user_audio_path,
                    source_audio_path=source_audio_path,
                    source_text=source_text,
                    source_wpm=source_wpm_val,
                    source_video_id=source_video_id if source_video_id else None,
                )

                # Cleanup temp file
                try:
                    os.unlink(user_audio_path)
                except Exception:
                    pass

                # Build grade from overall score
                overall = acoustic["overall_score"]
                if overall >= 90:
                    grade = "A"
                elif overall >= 80:
                    grade = "B"
                elif overall >= 70:
                    grade = "C"
                elif overall >= 60:
                    grade = "D"
                else:
                    grade = "F"

                # Build coaching summary based on scores
                strengths = []
                coaching_tips = []
                if acoustic["wpm_score"] >= 80:
                    strengths.append(f"Pacing matches source well (~{acoustic['user_wpm']} WPM vs ~{acoustic['source_wpm']} WPM)")
                else:
                    coaching_tips.append(f"Work on pacing: your WPM was {acoustic['user_wpm']} vs source {acoustic['source_wpm']}. Aim for ±10% of the source speed.")
                if acoustic["phonemic_score"] >= 80:
                    strengths.append("Good word sequence alignment with source")
                else:
                    coaching_tips.append("Practice listening more carefully to catch every word in the source")
                if acoustic["pause_score"] >= 80:
                    strengths.append("Pause patterns mirror the source naturally")
                else:
                    coaching_tips.append("Pay attention to where the speaker pauses — shadowing includes matching breath and phrase breaks")
                if acoustic["intonation_score"] >= 80:
                    strengths.append("Intonation contour closely matches the source")
                else:
                    coaching_tips.append("Record yourself and compare pitch variation to the source — shadowing is about acoustic fidelity, not just words")

                if not strengths:
                    strengths.append("Attempted shadowing practice")
                if not coaching_tips:
                    coaching_tips.append("Continue daily shadowing with varied source material to build acoustic muscle memory")

                # Return acoustic result with backward-compatible fields
                result = {
                    "overall_score": acoustic["overall_score"],
                    "accuracy": round(acoustic["wpm_score"], 1),
                    "completeness": round(acoustic["phonemic_score"], 1),
                    "terminology": round(acoustic["intonation_score"], 1),
                    "fluency": round(acoustic["pause_score"], 1),
                    "register_preservation": None,
                    "professional_protocol": None,
                    "grade": grade,
                    "ideal_interpretation": "Shadowing: match the source speaker's acoustic delivery — WPM, pauses, intonation, and word sequence.",
                    "omissions": [],
                    "additions": [],
                    "term_errors": [],
                    "tone_analysis": {
                        "register": "natural",
                        "emotion_match": "natural",
                        "pace_assessment": "appropriate" if acoustic["wpm_score"] >= 80 else ("too fast" if acoustic["user_wpm"] > acoustic["source_wpm"] * 1.1 else "too slow"),
                        "confidence": "high" if overall >= 80 else ("medium" if overall >= 60 else "low"),
                        "tone_notes": f"WPM: {acoustic['user_wpm']} vs {acoustic['source_wpm']} | Pauses: {len(acoustic['user_pauses'])} vs {len(acoustic['source_pauses'])} | Words: {acoustic['user_word_count']} vs {acoustic['source_word_count']}"
                    },
                    "strengths": strengths,
                    "coaching_tips": coaching_tips,
                    "next_drill": "Shadow a 60-second news broadcast segment, focusing on matching the speaker's pause rhythm exactly.",
                    "summary": f"Acoustic shadowing analysis: overall {acoustic['overall_score']}/100. WPM match {acoustic['wpm_score']:.0f}, pause match {acoustic['pause_score']:.0f}, phonemic overlap {acoustic['phonemic_score']:.0f}, intonation similarity {acoustic['intonation_score']:.0f}.",
                    # New acoustic fields (for frontend v2)
                    "wpm_score": acoustic["wpm_score"],
                    "pause_score": acoustic["pause_score"],
                    "phonemic_score": acoustic["phonemic_score"],
                    "intonation_score": acoustic["intonation_score"],
                    "user_wpm": acoustic["user_wpm"],
                    "source_wpm": acoustic["source_wpm"],
                    "evaluation_method": "acoustic",
                }

                save_session("interp", {"mode": mode, "specialization": specialization, "direction": direction,
                                        "source": source_text[:300], "rendition": rendition_text[:300], "scores": result})
                return JSONResponse(result)
            except Exception as e:
                # Audio analysis failed — fall through to text-based fallback
                print(f"[Shadowing] Acoustic evaluation failed: {e}. Falling back to text-based LLM.")

        # ── Text-based LLM evaluation (fallback for shadowing or default for other modes) ──
        if is_shadowing:
            prompt = f"""You are a professional broadcast voice coach assessing a SHADOWING practice.

SHADOWING MODE — evaluate delivery only. No source comparison.
TOPIC/FIELD: {specialization} {("— " + topic) if topic else ""}
DIFFICULTY: {difficulty}

STUDENT RECORDING:
{rendition_text}

Return JSON only:
{{
  "overall_score": <0-100>,
  "accuracy": null,
  "completeness": null,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "ideal_interpretation": "How the passage should sound — restate it with perfect register and natural spoken flow",
  "omissions": [],
  "additions": [],
  "term_errors": [],
  "tone_analysis": {{
    "register": "formal|informal|mixed",
    "emotion_match": "natural|over-emotional|flat|uncertain",
    "pace_assessment": "too fast|appropriate|too slow",
    "confidence": "high|medium|low",
    "tone_notes": "one specific observation about delivery quality"
  }},
  "strengths": ["specific delivery strength"],
  "coaching_tips": ["actionable technique to improve immediately"],
  "next_drill": "one concrete exercise for today",
  "summary": "2-sentence assessment in voice of senior broadcast coach"
}}"""
        else:
            is_verbatim = verbatim.strip() in ("1", "true", "True")
            if is_verbatim:
                prompt = f"""You are a certified evaluator for LEGAL VERBATIM INTERPRETATION — strict accuracy mode for legal interpreting with exact wording requirements. Assess this session with extreme rigor; even minor deviations from the source register or wording are penalized.

MODE: {mode.upper()} | FIELD: {specialization.upper()} | DIRECTION: {direction} | LEVEL: {difficulty.upper()}
{("TOPIC: " + topic) if topic else ""}

SOURCE SPEECH:
{source_text}

INTERPRETER'S RENDITION:
{rendition_text}

LEGAL VERBATIM SCORING RUBRIC (0-100 each):
• accuracy (30%): Exact meaning AND wording preserved — no paraphrasing, no summarization, no embellishments. Every factual and legal element preserved with maximal fidelity.
• completeness (25%): ALL elements of the source present — numbers, dates, names, clauses, legal formulae. ZERO omissions tolerated. Classify each omission as Strategic (deliberate, for clarity — still heavily penalized) or Unintentional (missed content — full penalty).
• terminology (15%): Correct legal terminology reproduced exactly. Every term must match the source's legal precision and convention.
• fluency (5%): Delivery must be clear but NOT at the expense of accuracy. Hesitations are acceptable if they preserve exact wording; false starts that change meaning are penalized severely.
• professional_protocol (10%): Strict impartiality, no editorializing, no cultural mediation, no softening of legal language. The interpreter is a transparent conduit.
• register_preservation (25%): Strict adherence to the legal register of the source — formal, precise, and authoritative. No drift into casual, simplified, or explanatory language. Exact register reproduction is paramount.

overall_score = 0.30×accuracy + 0.25×completeness + 0.15×terminology + 0.05×fluency + 0.10×professional_protocol + 0.25×register_preservation

Assess professionally. Return JSON only:
{{
  "overall_score": <0-100>,
  "accuracy": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "ideal_interpretation": "Full professional-grade verbatim rendition of the source — what a Band 8+ interpreter would say, preserving exact wording and legal register",
  "omissions": [{{"type": "strategic|unintentional", "description": "key idea omitted"}}],
  "additions": ["inappropriate addition"],
  "term_errors": [{{"wrong": "...", "correct": "..."}}],
  "tone_analysis": {{
    "register": "formal|informal|mixed",
    "emotion_match": "natural|over-emotional|flat|uncertain",
    "pace_assessment": "too fast|appropriate|too slow",
    "confidence": "high|medium|low",
    "tone_notes": "one specific observation about tone and delivery"
  }},
  "strengths": ["specific strength"],
  "coaching_tips": ["actionable technique to improve immediately"],
  "next_drill": "one concrete exercise for today",
  "summary": "2-sentence professional assessment in the voice of a senior trainer"
}}"""
            else:
                prompt = f"""You are an expert interpretation trainer and broadcast coach.

MODE: {mode.upper()} | FIELD: {specialization.upper()} | DIRECTION: {direction} | LEVEL: {difficulty.upper()}
{("TOPIC: " + topic) if topic else ""}

SOURCE SPEECH:
{source_text}

INTERPRETER'S RENDITION:
{rendition_text}

SCORING RUBRIC (0-100 each):
• accuracy (25%): Exact meaning preserved — no distortions, embellishments, or additions.
• completeness (20%): ALL elements of source present. Classify each omission as Strategic (deliberate, for clarity — less penalty) or Unintentional (missed content — full penalty).
• terminology (15%): Correct domain-specific terms.
• fluency (15%): Natural pace and delivery.
• register_preservation (10%): Maintained appropriate register for the setting (formal for CI/legal, conversational for escort, written-register for sight).
• professional_protocol (15%): Role boundaries, impartiality, no editorializing.

overall_score = 0.25×accuracy + 0.20×completeness + 0.15×terminology + 0.15×fluency + 0.10×register_preservation + 0.15×professional_protocol

Assess professionally. Return JSON only:
{{
  "overall_score": <0-100>,
  "accuracy": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "register_preservation": <0-100>,
  "professional_protocol": <0-100>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "ideal_interpretation": "Full professional-grade rendition of the source — what a Band 8+ interpreter would say, in the target language",
  "omissions": [{{"type": "strategic|unintentional", "description": "key idea omitted"}}],
  "additions": ["inappropriate addition"],
  "term_errors": [{{"wrong": "...", "correct": "..."}}],
  "tone_analysis": {{
    "register": "formal|informal|mixed",
    "emotion_match": "natural|over-emotional|flat|uncertain",
    "pace_assessment": "too fast|appropriate|too slow",
    "confidence": "high|medium|low",
    "tone_notes": "one specific observation about tone and delivery"
  }},
  "strengths": ["specific strength"],
  "coaching_tips": ["actionable technique to improve immediately"],
  "next_drill": "one concrete exercise for today",
  "summary": "2-sentence professional assessment in the voice of a senior trainer"
}}"""

        result = extract_json(ask_claude(prompt, 900))

        save_session("interp", {"mode": mode, "specialization": specialization, "direction": direction,
                                "source": source_text[:300], "rendition": rendition_text[:300], "scores": result})
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# ── Misc / utility ────────────────────────────────────────────────────────────

@router.get("/api/yt-test")
async def yt_test():
    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({'quiet': True, 'extract_flat': True}) as ydl:
            info = ydl.extract_info('ytsearch1:cardiac arrest NHS', download=False)
            e = (info.get('entries') or [{}])[0]
            return JSONResponse({"ok": True, "id": e.get('id'), "title": e.get('title')})
    except Exception as ex:
        return JSONResponse({"ok": False, "error": str(ex)})


# ── Curated seed videos ────────────────────────────────────────────────────────
# Known-good videos with verified built-in silence gaps for consecutive/OPI.
# These are injected as Tier 0 — always appear first regardless of search results.
# Structure: {mode: {field: [{id, title, channel, level, dur_sec, has_pauses}]}}
CURATED_SEEDS = {
    "consecutive": {
        "medical": [
            # Beginner
            {"id": "OiiuAwnokQY", "title": "Consecutive Interpreting Practice (EN): Cat Bite",
             "channel": "KGH Interpretation", "level": "Beginner", "dur_sec": 300,
             "why": "Purpose-built with 5-8s silence gaps after each segment. Perfect for beginners.",
             "has_pauses": True},
            {"id": "HAJ9mMySPX8", "title": "Free Consecutive Interpretation Practice: Anesthesia",
             "channel": "Interprepedia", "level": "Beginner", "why": "Anesthesia consultation roleplay with built-in interpreter pauses.",
             "dur_sec": 360, "has_pauses": True},
            {"id": "kENtzH8QyfA", "title": "Consecutive Interpreting Practice (EN): I Think I Have Coronavirus!",
             "channel": "KGH Interpretation", "level": "Beginner",
             "why": "Medical history taking with natural pause windows. COVID symptoms scenario.",
             "dur_sec": 300, "has_pauses": True},
            # Intermediate
            {"id": "1_qoZgKW_sw", "title": "Interpreting Training: Consecutive Practice — Occupational Health",
             "channel": "KGH Interpretation", "level": "Intermediate",
             "why": "Occupational health consultation. Longer segments, denser medical content.",
             "dur_sec": 480, "has_pauses": True},
            {"id": "UjOQLKY_KQo", "title": "Consecutive Interpreting Practice: School Call",
             "channel": "Language Life Polyglot", "level": "Beginner",
             "why": "Community interpreting school scenario. Accessible language, clear pauses.",
             "dur_sec": 300, "has_pauses": True},
        ],
        "general": [
            {"id": "IPuddPLGKgw", "title": "Easy Consecutive Interpreting Practice — Taking Up a New Sport",
             "channel": "KGH Interpretation", "level": "Beginner",
             "why": "Everyday topic with built-in pauses. Ideal starting point.",
             "dur_sec": 240, "has_pauses": True},
            {"id": "UuebgikyKRs", "title": "Consecutive Interpreting Practice",
             "channel": "KGH Interpretation", "level": "Beginner",
             "why": "General consecutive practice with silence windows.",
             "dur_sec": 300, "has_pauses": True},
            {"id": "CiVMAsPT-8I", "title": "Consecutive/Simultaneous Practice — Is Amazon Too Big To Fail?",
             "channel": "KGH Interpretation", "level": "Advanced",
             "why": "Dense business/economic content. High cognitive load. Advanced level.",
             "dur_sec": 600, "has_pauses": True},
        ],
        "legal": [
            {"id": "1_qoZgKW_sw", "title": "Interpreting Training: Consecutive Practice — Occupational Health",
             "channel": "KGH Interpretation", "level": "Intermediate",
             "why": "Workplace health scenario with legal/regulatory context.",
             "dur_sec": 480, "has_pauses": True},
        ],
    },
    "opi": {
        "medical": [
            {"id": "OiiuAwnokQY", "title": "Consecutive Interpreting Practice (EN): Cat Bite",
             "channel": "KGH Interpretation", "level": "Beginner",
             "why": "Triadic medical call format. Ideal OPI training structure.",
             "dur_sec": 300, "has_pauses": True},
            {"id": "kENtzH8QyfA", "title": "Consecutive Interpreting Practice (EN): I Think I Have Coronavirus!",
             "channel": "KGH Interpretation", "level": "Beginner",
             "why": "Simulated phone triage call. Natural OPI pacing.",
             "dur_sec": 300, "has_pauses": True},
        ],
        "general": [
            {"id": "UjOQLKY_KQo", "title": "Consecutive Interpreting Practice: School Call",
             "channel": "Language Life Polyglot", "level": "Beginner",
             "why": "Community phone interpreting scenario — school administration call.",
             "dur_sec": 300, "has_pauses": True},
        ],
    }
}

# Level sort order for curated seeds
_LEVEL_ORDER = {"Beginner": 0, "Intermediate": 1, "Advanced": 2, "Expert": 3}

_DIFFICULTY_TO_LEVEL = {
    "foundation": "Beginner", "beginner": "Beginner", "intermediate": "Intermediate",
    "advanced": "Advanced", "expert": "Expert",
}

def get_curated_seeds(mode: str, field: str, pace: str = "slow", difficulty: str = "") -> list:
    """Return curated seeds for mode+field, ordered/filtered by difficulty (falls back to pace)."""
    pool = []
    mode_seeds = CURATED_SEEDS.get(mode, {})
    # Field-specific first, then general
    for f in [field, "general"]:
        for seed in mode_seeds.get(f, []):
            if seed["id"] not in {s["id"] for s in pool}:
                pool.append(seed)

    target_level = _DIFFICULTY_TO_LEVEL.get((difficulty or "").lower())
    if target_level:
        # Prioritise exact difficulty matches to the front, rest ordered by distance from target
        order = list(_LEVEL_ORDER.keys())
        target_idx = order.index(target_level)
        pool.sort(key=lambda s: abs(_LEVEL_ORDER.get(s.get("level", "Intermediate"), 1) - target_idx))
    else:
        # Sort: beginner first for slow/moderate pace, advanced first for fast/expert
        reverse = pace in ("fast", "expert")
        pool.sort(key=lambda s: _LEVEL_ORDER.get(s.get("level", "Intermediate"), 1), reverse=reverse)
    # Build result format matching resolve_fast output
    results = []
    for s in pool:
        vid_id = s["id"]
        results.append({
            "known_id":     vid_id,
            "title":        s["title"],
            "speaker":      s["channel"],
            "context":      s["why"],
            "why":          s["why"],
            "difficulty":   s["level"],
            "duration_sec": s.get("dur_sec", 0),
            "duration_est": f"{s.get('dur_sec', 0) // 60} min" if s.get("dur_sec") else "",
            "thumbnail":    f"https://img.youtube.com/vi/{vid_id}/mqdefault.jpg",
            "video_type":   "opi_call_simulation" if mode == "opi" else "lecture",
            "wpm_est":      "",
            "wpm_number":   0,
            "wpm_verified": False,
            "has_natural_pauses": s.get("has_pauses", False),
            "_is_seed":     True,   # flag so frontend can badge these
        })
    return results


# ── Dedicated interpretation practice channels ─────────────────────────────────
# Purpose-built consecutive/OPI practice with built-in pauses
PRACTICE_CHANNELS = {
    "consecutive": {
        "_base": [
            # KGH Interpretation — dual-certified medical interpreter educator
            "KGH Interpretation consecutive interpreting practice",
            "KellyGrzechHenriquez consecutive interpreting practice",
            # Interprepedia — field-specific practice recordings
            "Interprepedia consecutive interpretation practice",
            "Interprepedia interpretation practice free",
            # General dedicated search terms
            "consecutive interpreting practice speech pauses English",
            "consecutive interpretation practice recording beginner",
            "interpretation practice speech pause render English",
        ],
        "medical": [
            "Interprepedia medical interpreting consecutive practice",
            "KGH Interpretation medical consecutive practice",
            "consecutive interpreting practice medical speech English",
            "medical interpretation practice consecutive speech pause",
            "free consecutive interpretation practice medical English",
        ],
        "legal": [
            "Interprepedia legal interpreting consecutive practice",
            "consecutive interpreting practice legal court speech",
            "legal interpretation practice consecutive recording English",
        ],
        "opi": [
            "consecutive interpreting practice OPI phone call",
            "KGH Interpretation phone interpreting practice",
            "medical phone interpreting consecutive practice recording",
        ],
        "diplomatic": [
            "consecutive interpreting practice conference speech diplomatic",
            "UN speech interpretation practice consecutive English",
            "diplomatic consecutive interpreting practice recording",
        ],
        "humanitarian": [
            "consecutive interpreting practice humanitarian speech English",
            "NGO speech interpretation practice consecutive recording",
        ],
    },
    "opi": {
        "_base": [
            "KGH Interpretation OPI phone interpreting practice",
            "Interprepedia OPI phone interpreting practice simulation",
            "over-the-phone interpreting practice call simulation",
            "OPI phone interpreter training call scenario recording",
            "medical phone interpreter call practice simulation English",
            "community interpreter telephone role play practice session",
        ],
        "medical": [
            "medical OPI phone interpreter call simulation practice",
            "KGH Interpretation medical phone interpreting practice",
            "Interprepedia medical phone interpreter simulation",
            "healthcare interpreter telephone call training scenario",
        ],
        "legal": [
            "legal OPI phone interpreter call simulation practice",
            "court interpreter telephone scenario training recording",
        ],
    }
}

# Also keep for backward compat
TIERED_QUERIES = PRACTICE_CHANNELS

# ── WPM ranges per pace ────────────────────────────────────────────────────────
PACE_WPM = {
    "slow":     (60,  119),
    "moderate": (120, 154),
    "fast":     (155, 184),
    "expert":   (185, 320),
}

def measure_wpm_from_captions(video_id: str, duration_sec: int) -> int | None:
    """Return actual WPM by counting words in YouTube auto-captions."""
    if duration_sec <= 0:
        return None
    try:
        import yt_dlp
        opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(
                f'https://www.youtube.com/watch?v={video_id}', download=False)

        # Prefer manual → auto captions, English
        auto  = info.get('automatic_captions') or {}
        manual = info.get('subtitles') or {}
        caps  = manual.get('en') or auto.get('en') or []
        if not caps:
            return None

        cap_url = next((c['url'] for c in caps if c.get('ext') == 'json3'), None)
        if not cap_url:
            cap_url = caps[0].get('url', '') if caps else None
        if not cap_url:
            return None

        with urllib.request.urlopen(cap_url, timeout=7) as resp:
            raw = resp.read().decode('utf-8', errors='ignore')

        # json3 format: {"events":[{"segs":[{"utf8":"text"}]},...]}
        try:
            data   = json.loads(raw)
            events = data.get('events', [])
            texts  = []
            for ev in events:
                for seg in (ev.get('segs') or []):
                    t = (seg.get('utf8') or '').strip()
                    if t and t != '\n':
                        texts.append(t)
            full_text = ' '.join(texts)
        except Exception:
            # Fallback: strip VTT tags
            full_text = re.sub(r'<[^>]+>', ' ', raw)
            full_text = re.sub(r'\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*', '', full_text)

        words = re.findall(r"[a-zA-Z؀-ۿ]+(?:[''][a-zA-Z]+)?", full_text)
        if len(words) < 30:
            return None

        wpm = int(len(words) / (duration_sec / 60))
        return wpm
    except Exception:
        return None


def yt_search_strict(query: str, min_sec: int, max_sec: int) -> dict | None:
    """Search YouTube, return first result within strict duration window."""
    try:
        import yt_dlp
        opts = {'quiet': True, 'no_warnings': True, 'extract_flat': True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f'ytsearch6:{query}', download=False)
        for e in (info.get('entries') or []):
            vid_id = e.get('id')
            dur    = e.get('duration') or 0
            if not vid_id:
                continue
            # Accept if duration unknown, or within window
            if dur == 0 or (min_sec <= dur <= max_sec):
                return {
                    'id':       vid_id,
                    'title':    e.get('title', ''),
                    'uploader': e.get('uploader') or e.get('channel', ''),
                    'duration': dur,
                    'thumbnail': f"https://img.youtube.com/vi/{vid_id}/mqdefault.jpg"
                }
    except Exception:
        pass
    return None


# Keywords that indicate a video is ABOUT interpreting, not source material
_META_PATTERNS = re.compile(
    r'\b(how to interpret|interpreter tips|interpretation lesson|how interpreters|'
    r'learn to interpret|interpreter training guide|interpretation technique|'
    r'become an interpreter|consecutive interpreting tips|note.taking tips|'
    r'simultaneous interpreting course|interpretation 101|interpreter skills)\b',
    re.IGNORECASE
)

def resolve_fast(suggestion: dict, min_sec: int, max_sec: int) -> dict | None:
    """Find real YouTube ID for a suggestion. Duration-filter only — no WPM (too slow for search)."""
    query = suggestion.get('search_query') or suggestion.get('title') or ''
    real  = yt_search_strict(query, min_sec, max_sec)
    if not real:
        return None

    # Reject meta/tutorial content by title
    combined = (real.get('title', '') + ' ' + real.get('uploader', '')).lower()
    if _META_PATTERNS.search(combined):
        return None

    dur_sec = real['duration']

    # Try quick WPM measurement from captions (fast timeout)
    wpm = None
    if dur_sec > 0:
        try:
            wpm = measure_wpm_from_captions(real['id'], dur_sec)
        except Exception:
            pass

    # Parse Claude's WPM estimate as fallback number
    wpm_str = suggestion.get('wpm_est', '')
    import re as _re
    wpm_claude = None
    m = _re.search(r'(\d+)', str(wpm_str))
    if m: wpm_claude = int(m.group(1))

    out = dict(suggestion)
    out['known_id']      = real['id']
    out['thumbnail']     = real['thumbnail']
    out['title']         = real['title'] or suggestion.get('title', '')
    out['speaker']       = real['uploader'] or suggestion.get('speaker', '')
    out['duration_sec']  = dur_sec
    out['duration_est']  = f"{dur_sec // 60} min" if dur_sec else suggestion.get('duration_est', '')
    out['wpm_actual']    = wpm                         # measured (int or None)
    out['wpm_number']    = wpm or wpm_claude or 0      # numeric for sort
    out['wpm_est']       = f"{wpm} wpm (measured)" if wpm else (wpm_str or '')
    out['wpm_verified']  = wpm is not None
    return out


@router.post("/api/search-videos")
async def search_videos(
    mode:           str = Form("shadowing"),
    field:          str = Form("general"),
    field_type:     str = Form(""),
    topic:          str = Form(""),
    language:       str = Form("English → Arabic"),
    duration:       int = Form(5),
    pace:           str = Form("moderate"),
    difficulty:     str = Form("intermediate"),
    source_dialect: str = Form(""),
    target_dialect: str = Form(""),
    num_speakers:   int = Form(2)
):
    try:
        pace_desc = {
            "slow":     "slow and deliberate under 120 wpm — educational, documentary, explainer style",
            "moderate": "natural 120–150 wpm — structured speech, news, talks",
            "fast":     "brisk 150–180 wpm — news anchors, business presentations",
            "expert":   "180+ wpm — live conference, rapid debate, high-density lecture"
        }.get(pace, "natural pace")

        wpm_min, wpm_max = PACE_WPM.get(pace, (0, 9999))
        subject = f"{field} ({field_type})" if field_type.strip() else field
        topic_line = f"- Specific Topic: {topic}" if topic.strip() else f"- Topic: any within {subject}"

        dialect_bits = [d for d in (source_dialect.strip(), target_dialect.strip()) if d]
        dialect_line = f"- Accent / Dialect: {', '.join(dialect_bits)}" if dialect_bits else ""

        difficulty_desc = {
            "foundation":   "Foundation — clear accent, plain register, no interruptions",
            "beginner":     "Beginner — simple vocabulary, slower delivery, short sentences",
            "intermediate": "Intermediate — standard professional register, moderate complexity",
            "advanced":     "Advanced — dense terminology, complex syntax, fast register shifts",
            "expert":       "Expert — highly technical/specialized, native-speed, idiomatic",
        }.get(difficulty, "Intermediate")

        speakers_line = (
            "- Speakers: single speaker, monologue/lecture style" if num_speakers <= 1
            else f"- Speakers: {num_speakers} distinct speakers (interview, panel, dialogue, or multi-party exchange)"
        )

        mode_rules = {
            "shadowing":    "Real broadcast speech, documentaries, or lectures where the speaker talks naturally about a topic.",
            "consecutive":  """Authentic conference speeches, UN/EU addresses, parliamentary debates, press conferences, or TED-style talks.
These must have natural paragraph breaks where an interpreter would pause to render.
Prioritise: UN General Assembly speeches, WHO briefings, EU Parliament addresses, WEF Davos speeches, presidential/ministerial press conferences.
Search queries like: 'UN General Assembly speech English', 'WHO press conference briefing', 'EU Parliament debate speech', 'press conference official statement'""",
            "simultaneous": "Live speeches, summit addresses, TED talks — continuous monologue with no pre-scripted pauses.",
            "opi":          """Phone interpreter training simulations and real-scenario phone calls.
These are ACTUAL practice calls simulating: medical interpreter calls, legal phone interpreting, social-service interpreter calls, emergency calls.
Target YouTube channels and searches: 'OPI training call simulation', 'medical phone interpreter role play', 'legal interpreter phone call practice',
'over-the-phone interpreting scenario', 'phone interpreting simulation training', 'interpreter phone call medical scenario',
'community interpreting telephone role play', 'ALTA OPI practice', 'phone interpreter training session'""",
        }
        source_rule = mode_rules.get(mode, "Authentic real-world speech.")

        # Claude suggests 10 candidates — WPM check happens on video open, not here
        prompt = f"""You are a professional interpretation trainer selecting authentic source material.

RULE: Only suggest videos that are SOURCE MATERIAL — real speeches, calls, or broadcasts that an interpreter would interpret.
NEVER suggest tutorials about interpretation, how-to guides, or tip videos.

MODE: {mode} — {source_rule}

Suggest 10 real YouTube videos:
- Field: {subject}
{topic_line}
- Language: {language}
{dialect_line}
- Duration: {duration} minutes (accept {max(1,duration-2)}–{duration+3} min range)
- Pace: {pace} ({wpm_min}–{wpm_max} wpm) — {pace_desc}
- Difficulty: {difficulty_desc}
{speakers_line}

Return ONLY a JSON array:
[{{
  "title": "exact YouTube title",
  "speaker": "speaker or channel",
  "context": "one sentence what it's about",
  "why": "why suitable for {mode} at {pace} pace",
  "search_query": "specific YouTube search query",
  "video_type": "conference_speech|press_conference|un_address|medical_briefing|legal_proceeding|news_broadcast|lecture|documentary|interview|parliamentary_debate|opi_call_simulation",
  "difficulty": "Beginner|Moderate|Advanced|Expert",
  "wpm_est": "e.g. 130 wpm"
}}]"""

        raw = ask_claude(prompt, 1400)
        m   = re.search(r'\[.*\]', raw, re.DOTALL)
        suggestions = json.loads(m.group()) if m else []

        # ── Tier 0a: Curated seeds — verified videos with built-in pauses ──
        # These are injected FIRST for consecutive/OPI and guaranteed to appear.
        curated = []
        if mode in ('consecutive', 'opi'):
            curated = get_curated_seeds(mode, field, pace, difficulty)

        # ── Tier 0b: Priority channel search queries ───────────────────────
        tier0_suggestions = []
        tier_pool = TIERED_QUERIES.get(mode, {})
        tier_queries = tier_pool.get(field, []) + tier_pool.get('_base', [])
        if not tier_queries and mode == 'consecutive':
            tier_queries = TIERED_QUERIES['consecutive']['_base']
        if not tier_queries and mode == 'opi':
            tier_queries = TIERED_QUERIES['opi']['_base']

        for q in tier_queries[:6]:
            q_full = f"{q} {field_type}".strip() if field_type.strip() else q
            tier0_suggestions.append({
                'title': q,
                'search_query': q_full,
                'context': f'Purpose-built {mode} practice material',
                'why': f'Specifically designed for {mode} interpretation training',
                'video_type': 'opi_call_simulation' if mode == 'opi' else 'lecture',
                'difficulty': _DIFFICULTY_TO_LEVEL.get(difficulty.lower(), 'Beginner' if pace == 'slow' else ('Intermediate' if pace == 'moderate' else 'Advanced')),
                'wpm_est': '',
            })

        # Order: curated seeds → tier0 channel queries → Claude suggestions
        all_suggestions = tier0_suggestions + suggestions

        # Duration window: accept user target ±40% (wider = more results)
        dur_min_sec = max(30, int(duration * 60 * 0.4))
        dur_max_sec = int(duration * 60 * 1.8)

        # Parallel YouTube resolution — no WPM, just fast ID + duration check
        results = []
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(resolve_fast, s, dur_min_sec, dur_max_sec): s
                       for s in all_suggestions}
            for fut in as_completed(futures, timeout=35):
                try:
                    r = fut.result()
                    if r:
                        results.append(r)
                except Exception:
                    pass

        # If still short, relax duration window and retry remaining suggestions
        found_ids = {r['known_id'] for r in results}
        if len(results) < 4:
            for s in suggestions:
                if len(results) >= 8:
                    break
                real = yt_search_strict(s.get('search_query', ''), 30, duration * 60 * 3)
                if real and real['id'] not in found_ids:
                    s.update({'known_id': real['id'], 'thumbnail': real['thumbnail'],
                              'title': real['title'], 'speaker': real['uploader'],
                              'duration_est': f"{real['duration']//60} min"})
                    results.append(s)
                    found_ids.add(real['id'])

        # Merge: curated seeds at front, deduplicate by known_id
        seen_ids = {r['known_id'] for r in curated}
        deduped_results = [r for r in results if r.get('known_id') not in seen_ids]
        final = (curated + deduped_results)[:8]
        return JSONResponse(final)
    except Exception as e:
        # Provide a user-friendly error message that the frontend can display
        err_msg = str(e)
        if "yt_dlp" in err_msg or "No module named" in err_msg:
            err_msg = "Video search is temporarily unavailable. Please try loading a custom YouTube URL instead."
        elif "Claude" in err_msg or "anthropic" in err_msg:
            err_msg = "AI search is temporarily unavailable. Please try loading a custom YouTube URL instead."
        return JSONResponse({
            "error": err_msg,
            "user_message": "We couldn't search for videos right now. Try pasting a YouTube URL directly above.",
            "suggestion": "custom_url"
        }, status_code=500)


@router.post("/api/analyze-video-terms")
async def analyze_video_terms(
    video_id:   str = Form(...),
    title:      str = Form(""),
    field:      str = Form("general"),
    language:   str = Form("English → Arabic"),
    difficulty: str = Form("moderate")
):
    async def generate():
        import asyncio
        try:
            # ── Step 1: fetch rich video metadata via yt_dlp ─────────
            meta_text = f"Title: {title}\nField: {field}"
            try:
                import yt_dlp
                ydl_opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(
                        f'https://www.youtube.com/watch?v={video_id}', download=False)
                    desc     = (info.get('description') or '')[:1000]
                    tags     = ', '.join((info.get('tags') or [])[:20])
                    chapters = ', '.join(c.get('title','') for c in (info.get('chapters') or [])[:10])
                    real_title = info.get('title') or title
                    meta_text = (
                        f"Title: {real_title}\n"
                        f"Description: {desc}\n"
                        + (f"Tags: {tags}\n" if tags else "")
                        + (f"Chapters: {chapters}\n" if chapters else "")
                        + f"Field: {field}"
                    )
            except Exception:
                pass  # fall back to title only

            src = "English" if language.startswith("English") else "Arabic"
            tgt = "Arabic"  if language.startswith("English") else "English"

            prompt = f"""You are an expert interpretation trainer. Analyze this YouTube video and extract exactly 15 key terms an interpreter must know to interpret it from {src} to {tgt}.

VIDEO INFO:
{meta_text}
DIFFICULTY: {difficulty}

Rules:
- Prioritise technical jargon, acronyms, proper nouns, and phrases hard to translate on the spot
- Base terms on the ACTUAL video content, not generic field terms
- Return ONLY a JSON array, one object per line (so I can parse incrementally):
[
{{"source": "term in {src}", "target": "الترجمة أو English term", "note": "brief context ≤6 words"}},
...
]"""

            # ── Step 2: stream via Anthropic API, emit each term as SSE ──
            buffer = ""
            with claude.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=1200,
                messages=[{"role": "user", "content": prompt}]
            ) as stream:
                for chunk in stream.text_stream:
                    buffer += chunk
                    # emit each complete JSON object immediately
                    while True:
                        m = re.search(r'\{[^{}]+\}', buffer)
                        if not m:
                            break
                        try:
                            term = json.loads(m.group())
                            if 'source' in term and 'target' in term:
                                yield f"data: {json.dumps(term, ensure_ascii=False)}\n\n"
                                await asyncio.sleep(0.04)
                        except Exception:
                            pass
                        buffer = buffer[m.end():]

            yield "data: __done__\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


def analyze_silence_profile(timed_lines: list) -> dict:
    """
    Detect natural silence gaps in a video using caption timestamps.
    Returns whether the video has built-in pauses (natural pause mode)
    or requires auto-pause after N speech seconds.
    """
    if len(timed_lines) < 5:
        return {'pause_mode': 'auto', 'has_natural_pauses': False,
                'silence_gaps': [], 'avg_speech_sec': 30, 'gap_count': 0}

    MIN_SILENCE    = 2.0   # seconds — gaps shorter than this are breath pauses, not interpretation gaps
    IDEAL_SILENCE  = 3.0   # 3+ seconds = genuine interpreter pause (was 4.0 — too strict for practice videos)
    MIN_GAPS_NEEDED = 2    # 2+ qualifying gaps = natural pause mode (was 3 — excluded short practice videos)

    gaps = []
    for i in range(1, len(timed_lines)):
        prev = timed_lines[i - 1]
        curr = timed_lines[i]
        # Estimate end of previous caption: start + min(gap, 3s)
        prev_end = prev['t'] + min(curr['t'] - prev['t'], 3.0)
        gap_dur  = curr['t'] - prev_end
        if gap_dur >= MIN_SILENCE:
            gaps.append({
                'start':    round(prev_end, 2),
                'end':      round(curr['t'], 2),
                'duration': round(gap_dur, 2),
            })

    significant = [g for g in gaps if g['duration'] >= IDEAL_SILENCE]
    has_natural  = len(significant) >= MIN_GAPS_NEEDED

    # Average speech duration between significant gaps
    speech_durations = []
    if len(significant) >= 2:
        for i in range(1, len(significant)):
            d = significant[i]['start'] - significant[i-1]['end']
            if 3 <= d <= 90:
                speech_durations.append(d)
    avg_speech = round(sum(speech_durations) / len(speech_durations)) if speech_durations else 25

    return {
        'pause_mode':           'natural' if has_natural else 'auto',
        'has_natural_pauses':   has_natural,
        'silence_gaps':         significant[:25],   # [{start, end, duration}] — duration tells frontend how long user has to render
        'all_gaps_count':       len(gaps),
        'significant_gap_count': len(significant),
        'avg_speech_sec':       avg_speech,         # used as fallback speech counter threshold
        'gap_count':            len(significant),
    }


@router.get("/api/curated-videos")
async def curated_videos(mode: str = "consecutive", field: str = "medical", pace: str = "slow", difficulty: str = ""):
    """Return pinned curated seed videos for consecutive/OPI — no search needed."""
    seeds = get_curated_seeds(mode, field, pace, difficulty)
    return JSONResponse(seeds)


@router.post("/api/analyze-video-structure")
async def analyze_video_structure(
    video_id: str = Form(...),
    mode:     str = Form("consecutive"),
    field:    str = Form("general"),
    title:    str = Form("")
):
    """Deep analysis: video type, suitability, pause points, segments."""
    try:
        import yt_dlp

        # ── Fetch metadata + captions ────────────────────────────────
        opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)

        real_title   = info.get('title', title)
        desc         = (info.get('description') or '')[:600]
        tags         = ', '.join((info.get('tags') or [])[:15])
        duration_sec = info.get('duration', 0) or 0

        # ── Get timestamped captions ─────────────────────────────────
        auto_caps  = info.get('automatic_captions') or {}
        manual_caps = info.get('subtitles') or {}
        caps = manual_caps.get('en') or auto_caps.get('en') or []
        cap_url = next((c['url'] for c in caps if c.get('ext') == 'json3'), None)

        timed_lines = []   # [{t: seconds, text: "..."}]
        word_count  = 0

        if cap_url:
            try:
                with urllib.request.urlopen(cap_url, timeout=8) as r:
                    cap_data = json.loads(r.read())
                prev_text = ''
                for ev in cap_data.get('events', []):
                    t_sec = ev.get('tStartMs', 0) / 1000
                    text  = ''.join(s.get('utf8', '') for s in (ev.get('segs') or [])).strip()
                    if text and text != '\n' and text != prev_text:
                        timed_lines.append({'t': round(t_sec, 1), 'text': text})
                        word_count += len(re.findall(r'\b[a-zA-Z؀-ۿ]+\b', text))
                        prev_text = text
            except Exception:
                pass

        # Build transcript sample for Claude (first ~4 min worth)
        sample_lines = [l for l in timed_lines if l['t'] <= 240][:120]
        transcript_sample = '\n'.join(f"[{l['t']}s] {l['text']}" for l in sample_lines)

        wpm_actual = round(word_count / (duration_sec / 60)) if duration_sec > 0 and word_count > 50 else None

        # ── Claude deep analysis ──────────────────────────────────────
        # Compute difficulty metrics from captions
        avg_sent_len = 0
        if timed_lines:
            all_words  = re.findall(r'\b[a-zA-Z]+\b', ' '.join(l['text'] for l in timed_lines))
            # Rough sentence count via punctuation
            sent_count = max(1, len(re.findall(r'[.!?]', ' '.join(l['text'] for l in timed_lines))))
            avg_sent_len = round(len(all_words) / sent_count)

        prompt = f"""You are a senior interpretation trainer conducting a full AI analysis of a YouTube video.

VIDEO: {real_title}
CHANNEL: {info.get('uploader', '')}
DURATION: {duration_sec // 60}m {duration_sec % 60}s
DESCRIPTION: {desc}
TAGS: {tags}
MODE: {mode} | FIELD: {field}
MEASURED WPM: {wpm_actual or 'not available'}
AVG SENTENCE LENGTH: {avg_sent_len or 'not available'} words

TIMESTAMPED TRANSCRIPT (first ~4 min, format [seconds] text):
{transcript_sample or '[No captions — base analysis on title/description/tags]'}

Perform ALL of these analyses:

━━ 1. VIDEO TYPE ━━
Classify as one of: opi_call_simulation | conference_speech | press_conference | un_address | medical_briefing | legal_proceeding | news_broadcast | lecture | documentary | interview | parliamentary_debate | other
Is this AUTHENTIC SOURCE MATERIAL (real speech to interpret) or META CONTENT (about interpreting/tutorial)?

━━ 2. DIFFICULTY CLASSIFICATION ━━
Classify overall difficulty for an interpreter:
- Beginner: slow pace (<120 wpm), common vocabulary, simple sentences, familiar topics, clear diction
- Intermediate: moderate pace (120–150 wpm), some field jargon, structured paragraphs, moderate density
- Advanced: fast pace (150–180 wpm), technical register, complex syntax, high information density
- Expert/Professional: 180+ wpm OR very dense specialized jargon, simultaneous cognitive demand, real conference standard

Score each dimension 1–10:
- pace_score: based on WPM (10=very fast/expert)
- vocabulary_score: technical/specialized vocabulary density (10=highly specialized)
- density_score: information density and cognitive load (10=maximum density)
- clarity_score: speech clarity and diction quality (10=very clear, easy to follow)

━━ 3. SUITABILITY for {mode} (0–100) ━━
Rate how well this video serves as {mode} practice source material.

━━ 4. PAUSE POINTS (consecutive/OPI) ━━
Identify 8–15 timestamps where an interpreter should stop to render their interpretation.
Base on: topic transitions, paragraph ends, natural breath pauses, question/answer breaks.

━━ 5. SEGMENTS ━━
Divide first {min(duration_sec, 600)}s into 4–8 self-contained practice segments (30–90s each).

Return JSON ONLY — no other text:
{{
  "video_type": "...",
  "is_authentic_source": true,
  "authenticity_note": "one sentence",
  "difficulty": "Beginner|Intermediate|Advanced|Expert",
  "difficulty_scores": {{
    "pace_score": 5,
    "vocabulary_score": 6,
    "density_score": 5,
    "clarity_score": 8,
    "overall": 6
  }},
  "difficulty_reason": "one sentence explaining the classification",
  "suitability_score": 85,
  "suitability_reason": "one sentence",
  "wpm_actual": {wpm_actual or 'null'},
  "quality_flags": ["natural_pauses", "field_vocabulary", "authentic_register"],
  "pause_points": [
    {{"time_sec": 45.0, "label": "end of introduction", "duration_before": 45}}
  ],
  "segments": [
    {{"start": 0, "end": 48, "topic": "opening statement", "difficulty": "Intermediate", "wpm_est": 130}}
  ]
}}"""

        result = extract_json(ask_claude(prompt, 1400))
        result['video_id']          = video_id
        result['title']             = real_title
        result['duration_sec']      = duration_sec
        result['has_captions']      = bool(cap_url)
        result['timed_lines_count'] = len(timed_lines)
        # Speech start: first caption that has real content (skip music/silence markers)
        speech_start = next(
            (l['t'] for l in timed_lines if len(l['text'].split()) >= 3), 0.0
        )
        result['speech_start_sec']  = speech_start
        # Silence profile — used by frontend to choose natural vs auto-pause mode
        silence_profile             = analyze_silence_profile(timed_lines)
        result.update(silence_profile)
        # Return caption events for frontend source-text extraction (first 10 min)
        result['caption_events']    = [l for l in timed_lines if l['t'] <= 600]
        return JSONResponse(result)

    except Exception as e:
        return JSONResponse({'error': str(e), 'video_id': video_id}, status_code=500)


@router.post("/api/save-glossary")
async def save_glossary(
    terms:    str = Form(...),
    topic:    str = Form("session"),
    field:    str = Form("general"),
    language: str = Form("English → Arabic")
):
    try:
        new_terms = json.loads(terms)
        glossary_path = STUDIO_ROOT / "glossary.json"

        # Load existing
        if glossary_path.exists():
            existing = json.loads(glossary_path.read_text(encoding="utf-8"))
        else:
            existing = []

        # Add new entry with metadata
        entry = {
            "saved_at": datetime.now().isoformat(timespec="seconds"),
            "topic":    topic,
            "field":    field,
            "language": language,
            "terms":    new_terms
        }
        existing.append(entry)
        glossary_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

        return JSONResponse({"ok": True, "total_entries": len(existing), "path": str(glossary_path)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── OPI Call Simulation ───────────────────────────────────────────────────────

# In-memory session store — keyed by 8-char session ID
opi_sessions: dict = {}

# ── Verified voice IDs from this ElevenLabs account ──────────────────────────
# Provider voices — authoritative / professional
VOICE_JARVIS   = ELEVENLABS_VOICE_ID       # Jarvis  — Custom AI assistant voice
VOICE_DANIEL   = "onwK4e9ZLuTAKqWW03F9"  # Daniel  — Steady Broadcaster
VOICE_MATILDA  = "XrExE9yKIg1WjnnlVkGX"  # Matilda — Knowledgeable, Professional
VOICE_SARAH    = "EXAVITQu4vr4xnSDxMaL"  # Sarah   — Mature, Reassuring
VOICE_BRIAN    = "nPczCjzI2devNBz1zQrb"  # Brian   — Deep, Resonant

# Caller voices — natural / varied / relatable
VOICE_ADAM     = "pNInz6obpgDQGcFmaJgB"  # Adam    — Dominant, Firm
VOICE_ERIC     = "cjVigY5qzO86Huf0OWal"  # Eric    — Smooth, Trustworthy
VOICE_CHARLIE  = "IKne3meq5aSn9XLyUdCD"  # Charlie — Deep, Confident
VOICE_RIVER    = "SAz9YHcvj6GT2YYXdXww"  # River   — Relaxed, Neutral
VOICE_WILL     = "bIHbv24MWmeRgasZH58o"  # Will    — Relaxed Optimist

# Field-specific voice pairs (provider, caller) — used ONLY as a fallback when
# the generated scenario doesn't carry usable gender info. These are intentionally
# mixed-gender per field so that whichever default is picked still sounds natural;
# the *real* selection now happens in pick_call_voice() below, matched to each
# character's actual generated gender (this is what fixes "male voice or a female
# role" — a static field→voice map can never know who Claude decided to write).
OPI_VOICE_PAIRS = {
    "medical":       (VOICE_SARAH,   VOICE_ADAM),
    "legal":         (VOICE_DANIEL,  VOICE_ERIC),
    "social":        (VOICE_SARAH,   VOICE_WILL),
    "immigration":   (VOICE_DANIEL,  VOICE_CHARLIE),
    "mental_health": (VOICE_MATILDA, VOICE_RIVER),
    "pharmacy":      (VOICE_MATILDA, VOICE_ADAM),
    "diplomatic":    (VOICE_BRIAN,   VOICE_ERIC),
    "business":      (VOICE_DANIEL,  VOICE_WILL),
    "academic":      (VOICE_MATILDA, VOICE_BRIAN),
    "security":      (VOICE_ADAM,    VOICE_CHARLIE),
    "media":         (VOICE_SARAH,   VOICE_RIVER),
}

# Voices grouped by perceived gender — ElevenLabs premade voices work fine across
# languages (incl. Arabic) on the multilingual models, so gender is the only axis
# that matters for matching a generated character.
FEMALE_VOICES = [VOICE_SARAH, VOICE_MATILDA]
MALE_VOICES   = [VOICE_DANIEL, VOICE_BRIAN, VOICE_ADAM, VOICE_ERIC, VOICE_CHARLIE, VOICE_WILL]

def get_voice_pair(field: str) -> tuple:
    """Return (provider_voice_id, caller_voice_id) for the given field — fallback only."""
    return OPI_VOICE_PAIRS.get(field, (VOICE_DANIEL, VOICE_ADAM))

def pick_call_voice(gender: str, role: str, field: str, name: str = "") -> str:
    """
    Pick a voice that actually matches the character's generated gender — this is
    the fix for "male voice for a female role". The scenario prompt now asks Claude
    for explicit provider_gender/caller_gender; we honor that first and only fall
    back to the old static field-pairing when gender info is missing/unclear.

    `name` is used to deterministically vary the pick within the matching pool, so
    repeated calls in the same field don't always sound identical.
    """
    g = (gender or "").strip().lower()
    if g.startswith("f"):
        pool = FEMALE_VOICES
    elif g.startswith("m"):
        pool = MALE_VOICES
    else:
        dp, dc = get_voice_pair(field)
        return dp if role == "provider" else dc
    idx = (sum(ord(c) for c in name) % len(pool)) if name else 0
    return pool[idx]

def _get_account_voices() -> list:
    """Return the known voice list (used by the /api/opi/voices endpoint)."""
    return [(v_id, name) for name, v_id in [
        ("Daniel",  VOICE_DANIEL),  ("Matilda", VOICE_MATILDA),
        ("Sarah",   VOICE_SARAH),   ("Brian",   VOICE_BRIAN),
        ("Adam",    VOICE_ADAM),    ("Eric",    VOICE_ERIC),
        ("Charlie", VOICE_CHARLIE), ("River",   VOICE_RIVER),
        ("Will",    VOICE_WILL),
    ]]


# Characters that ElevenLabs will sometimes read aloud literally — "#" becomes
# "hashtag", "*" becomes "asterisk", "_" / stray markdown becomes garbled noise,
# etc. Dialogue text should never contain these (it's spoken language, not
# written), but LLM output occasionally slips in stray formatting — strip it
# before it ever reaches the TTS engine. Arabic punctuation (، ؛ ؟) and normal
# sentence punctuation are intentionally preserved — only "spelled-out symbol"
# characters are removed. NOTE: square brackets are deliberately EXCLUDED here —
# eleven_v3 uses inline "[laughs]"/"[sighs]"-style Audio Tags to produce natural
# human reactions, and stripping the brackets would destroy that feature.
_TTS_SYMBOL_RE = re.compile(r'[#*_~`^$%@+=\{\}|\\<>•▪►]')

# Recognized inline "Audio Tag" syntax that eleven_v3 understands and voices —
# short bracketed reaction/delivery cues like [laughs], [sighs], [clears throat],
# [hesitates], [crying], [coughs], [whispers]. Matched loosely (any short
# alphabetic phrase in brackets) so the LLM has room to vary the wording.
_AUDIO_TAG_RE = re.compile(r'\[[a-zA-Z][a-zA-Z \-]{1,30}\]')

def _clean_for_tts(text: str) -> str:
    """Strip symbol/markdown characters that get read aloud literally, collapse
    whitespace — keeps spoken lines natural instead of "hashtag this asterisk that".
    Square-bracket Audio Tags are preserved (see _TTS_SYMBOL_RE note)."""
    t = _TTS_SYMBOL_RE.sub(' ', text)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def _strip_audio_tags(text: str) -> str:
    """Remove [audio tag] cues (and any stray brackets) entirely — for TTS models
    that DON'T understand eleven_v3's Audio Tag syntax, which would otherwise read
    "[laughs]" aloud as the literal words "bracket laughs bracket"."""
    t = _AUDIO_TAG_RE.sub(' ', text)
    t = t.replace('[', ' ').replace(']', ' ')
    return _clean_for_tts(t)


# Dropped into dialogue-generation prompts so the LLM occasionally writes in the
# small human imperfections that make a simulated call feel like a real phone
# conversation — a cough, a sigh, a stammered word, a nervous laugh, someone's
# voice catching. eleven_v3 renders these bracketed cues as actual sounds/delivery
# changes (not narration); _strip_audio_tags() cleans them out for models that
# can't. Capped at "at most one, and usually none" so it reads as texture, not gimmick.
_HUMANIZE_NOTE = (
    " Make this sound like a real, unscripted person on a real phone call — not an "
    "actor reading lines. If, and only if, the moment genuinely calls for it, you may "
    "weave ONE brief inline reaction cue in square brackets directly into the line — "
    "for example [sighs], [clears throat], [pauses], [hesitates], [stammers], "
    "[laughs softly], [coughs], [voice breaking], [tearful], [exhales]. Most lines "
    "should carry NONE — use this rarely, only where a real person would actually "
    "react that way (frustration, relief, nerves, a held-back emotion), never as a "
    "tic or habit, and never stack more than one per line."
)


def _tts(text: str, voice_id: str, stability: float = 0.5) -> bytes:
    """
    Text → speech via ElevenLabs, returns raw audio bytes.

    Tries the requested voice, then falls back through a small chain of known-good
    voice IDs. This matters because the field-specific OPI_VOICE_PAIRS reference
    ElevenLabs "premade" voice IDs that may not be enabled/available on every
    account tier — without a fallback chain, one bad voice ID kills the entire
    call (start-call raises → 500 → frontend gets no pre_turns → "nothing in the call").

    Model strategy — "humanized" speech:
    eleven_v3 is the only ElevenLabs model that understands inline Audio Tags
    ("[sighs]", "[laughs]", "[clears throat]", "[hesitates]", "[crying]"...) and
    it speaks 70+ languages, Arabic included, with the same expressive range —
    that's what lets both simulated speakers cough, laugh, sigh, stumble over
    words, etc. instead of sounding like a flat narration loop. We try it first
    with the tags intact. If it isn't available on this account/voice (it's a
    newer model and may not be enabled everywhere), we fall back to the previous
    language-appropriate model — but with the bracket cues stripped out first, so
    a model that can't *act* on "[laughs]" doesn't *narrate* it instead.
    """
    from elevenlabs import ElevenLabs
    from elevenlabs.types import VoiceSettings
    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

    is_arabic = bool(re.search(r'[؀-ۿݐ-ݿࢠ-ࣿ]', text))
    # Stability is bumped for Arabic — higher stability means calmer, more
    # deliberate, less "rushed" delivery (eleven_turbo_v2 is English-only and
    # mispronounces Arabic; eleven_turbo_v2_5 / eleven_v3 are multilingual).
    voice_stability = max(stability, 0.7) if is_arabic else stability
    fallback_model = "eleven_turbo_v2_5" if is_arabic else "eleven_turbo_v2"

    expressive_body = _clean_for_tts(text)     # strips junk symbols, KEEPS [audio tags]
    plain_body      = _strip_audio_tags(text)  # removes [audio tags] entirely

    chain = [voice_id]
    for fallback in (ELEVENLABS_VOICE_ID, VOICE_ADAM, VOICE_SARAH):
        if fallback and fallback not in chain:
            chain.append(fallback)

    def _convert(vid, mid, body):
        return client.text_to_speech.convert(
            voice_id=vid,
            text=body,
            model_id=mid,
            voice_settings=VoiceSettings(stability=voice_stability, similarity_boost=0.75)
        )

    last_err = None
    for i, vid in enumerate(chain):
        try:
            print(f"[TTS] {'trying' if i==0 else 'fallback ->'} voice={vid} model=eleven_v3 (expressive, tags-on) text={expressive_body[:60]!r}")
            result = b"".join(_convert(vid, "eleven_v3", expressive_body))
            print(f"[TTS] OK — voice={vid} model=eleven_v3 {len(result)} bytes")
            return result
        except Exception as e:
            last_err = e
            print(f"[TTS] FAILED voice={vid} model=eleven_v3: {e}")

        try:
            print(f"[TTS] retry -> voice={vid} model={fallback_model} (tags stripped) text={plain_body[:60]!r}")
            result = b"".join(_convert(vid, fallback_model, plain_body))
            print(f"[TTS] OK (fallback model) — voice={vid} model={fallback_model} {len(result)} bytes")
            return result
        except Exception as e2:
            last_err = e2
            print(f"[TTS] FAILED voice={vid} model={fallback_model}: {e2}")
            # Last resort if even the language-appropriate fallback is unavailable.
            if fallback_model != "eleven_turbo_v2":
                try:
                    print(f"[TTS] retry -> voice={vid} model=eleven_turbo_v2 (last resort)")
                    result = b"".join(_convert(vid, "eleven_turbo_v2", plain_body))
                    print(f"[TTS] OK (last-resort model) — voice={vid} {len(result)} bytes")
                    return result
                except Exception as e3:
                    last_err = e3
                    print(f"[TTS] FAILED voice={vid} model=eleven_turbo_v2: {e3}")

    print(f"[TTS] All {len(chain)} voices failed on every model — raising last error")
    raise last_err


@router.get("/api/opi/voices")
async def opi_voices():
    """Return available ElevenLabs voices for this account."""
    voices = _get_account_voices()
    return JSONResponse({"voices": [{"id": vid, "name": name} for vid, name in voices]})


@router.post("/api/opi/start-call")
async def opi_start_call(
    field:        str = Form("medical"),
    language:     str = Form("English → Arabic"),
    difficulty:   str = Form("foundation"),
    duration_min: str = Form("5"),
    video:        str = Form("false"),
):
    """
    Generate a new OPI/VRI call scenario. OPI and VRI are the same triadic
    phone/video-call protocol — VRI is OPI with a visual channel added, so this
    single endpoint serves both. `video` toggles VRI mode: the scenario gains
    visual/non-verbal detail (gestures, visible environment, items shown on
    camera) and the end-of-call evaluation adds visual-cue-reading feedback.
    Returns: session_id, scenario info, provider's opening line as audio.
    """
    src = language.split("→")[0].strip() if "→" in language else "English"
    tgt = language.split("→")[1].strip() if "→" in language else "Arabic"
    try:
        duration_min = int(float(duration_min))
    except (ValueError, TypeError):
        duration_min = 5

    is_video = str(video).strip().lower() in ("true", "1", "yes", "on")
    print(f"[START-CALL] field={field} lang={language} diff={difficulty} dur={duration_min} video={is_video}")

    sid = str(uuid.uuid4())[:8]
    try:
        return await _opi_build_call(sid, field, src, tgt, language, difficulty, duration_min, is_video)
    except Exception as e:
        import traceback
        print(f"[START-CALL] FAILED — {type(e).__name__}: {e}")
        traceback.print_exc()
        opi_sessions.pop(sid, None)
        # Return 200 with an explicit error so the frontend can show a real message
        # instead of silently rendering an empty call (the old failure mode: a 500
        # here meant opiData had no pre_turns, and the active-call screen just sat
        # there with nothing to play).
        return JSONResponse({
            "error": f"{type(e).__name__}: {e}",
            "session_id": None,
            "scenario": {}, "pre_turns": [],
        })


async def _opi_build_call(sid, field, src, tgt, language, difficulty, duration_min, is_video=False):
    # Real Arabic OPI calls: callers speak in their regional dialect (Levantine,
    # Egyptian, Iraqi, Gulf, Maghrebi, Sudanese...), while the professional
    # standard is for the interpreter to render into Modern Standard Arabic
    # (Fusha/MSA) — the neutral register every Arabic speaker understands,
    # regardless of the caller's home dialect. We bake that into the scenario
    # itself when the language pair involves Arabic, so the simulation reflects
    # real practice (and the evaluator can grade register/dialect handling).
    is_arabic_pair = "arab" in src.lower() or "arab" in tgt.lower()
    dialect_note = (
        '"caller_dialect": "the caller\'s natural regional Arabic dialect '
        '(e.g. Levantine, Egyptian, Iraqi, Gulf, Maghrebi, Sudanese — pick one '
        'that fits the caller_name/setting)",\n  '
        if is_arabic_pair else ""
    )
    dialect_instruction = (
        "\nThis is an Arabic-language call: the caller speaks in their natural "
        "regional dialect (set by caller_dialect) — NOT Modern Standard Arabic. "
        "Real-world practice is for the professional interpreter to render into "
        "Modern Standard Arabic / Fusha, the neutral register understood across "
        "all dialects, while still picking up on the caller's dialect-specific terms."
        if is_arabic_pair else ""
    )

    # VRI (Video Remote Interpreting) is the same triadic call protocol as OPI with a
    # visual channel added — same scenario engine, just with visible non-verbal detail
    # the interpreter must also read and account for (gestures, body language, items
    # held up to camera, visible environment/setting cues).
    video_note = (
        '\nThis is a VIDEO call (VRI) — both parties are visible on camera, not just audible. '
        'Include concrete visual/non-verbal detail in visual_cues: gestures, body language, '
        'facial expressions, items either party might hold up to the camera (ID cards, medication '
        'bottles, forms, X-rays), and visible environment details. The interpreter must read and '
        'account for these non-verbal cues, not just the spoken words.'
        if is_video else ""
    )
    visual_field_note = (
        ',\n  "visual_cues": "1-2 concrete non-verbal/visual details visible on camera during this call (gestures, items shown, expressions, setting)"'
        if is_video else ""
    )

    scenario = extract_json(ask_claude(f"""Generate a realistic {'VRI (Video Remote Interpreting)' if is_video else 'OPI (Over-the-Phone Interpreting)'} call scenario.
Field: {field} | Source language: {src} | Target language: {tgt}
Difficulty: {difficulty} | Duration: ~{duration_min} min{dialect_instruction}{video_note}

CRITICAL RULES:
1. provider_name must be SPECIFIC and VARIED — absolutely NOT "Sarah Mitchell", "John Smith", "Emily Carter", or other repeatedly-generated AI names. Use diverse, field-appropriate names (e.g. Dr. Karen Osei, Officer Marcus Webb, Nurse Priya Sharma, Ms. Luisa Fernandez, Mr. James Kowalski, Dr. Ahmed Khalil). Each call must use a DIFFERENT name.
2. provider_gender must be exactly "male" or "female" — one of those two words only, matching the name.
3. caller_gender must be exactly "male" or "female" — one of those two words only, matching the name.
4. caller_name must be a realistic name from the {tgt}-speaking cultural background, matching caller_gender.
{('5. caller_dialect must be ONE specific Arabic dialect — NEVER mix dialects. Options: Lebanese, Egyptian, Iraqi, Gulf/Khaleeji, Syrian, Jordanian, Palestinian, Moroccan, Sudanese. Pick based on caller_name cultural background.' if is_arabic_pair else '')}

Return JSON only:
{{
  "provider_name": "Specific non-clichéd name with appropriate title",
  "provider_gender": "male or female",
  "provider_role": "specific role (e.g. ER Nurse, Immigration Officer, Pharmacist)",
  "caller_name": "culturally appropriate name for a {tgt} speaker",
  "caller_gender": "male or female",
  {dialect_note}"caller_situation": "why they are calling — 1 sentence",
  "chief_issue": "the specific question or problem to resolve",
  "setting": "specific location/context (e.g. Metro General ER, Valley Pharmacy, Housing Authority Office)",
  "urgency": "routine|urgent|emergency",
  "provider_opening": "Provider's natural opening line in {src}, 2-3 sentences"{visual_field_note}
}}""", 650))

    # Each interpreter cycle takes ~32 s on average (turn audio + processing latency + recording).
    # min 4 pairs to guarantee a meaningful practice session even for short calls.
    target_pairs = max(4, int(duration_min * 60 / 32))

    opi_sessions[sid] = {
        "field": field, "src": src, "tgt": tgt,
        "difficulty": difficulty, "duration_min": duration_min,
        "scenario": scenario, "turns": [], "pairs_done": 0,
        "pairs": [],   # ordered (source, interpreter-rendition) pairs — single source of truth for evaluation
        "intro_transcript": "",  # interpreter's opening self-introduction — graded for professionalism
        "target_pairs": target_pairs, "ended": False,
        "started": datetime.now().isoformat(),
        "video": is_video,  # OPI/VRI merge: same protocol, this flag is the only branch point
    }

    opening = scenario.get("provider_opening",
        f"Hello, this is {scenario.get('provider_name','the office')}. I need interpreter assistance.")

    # ── Pre-generate 3 turns for zero-latency call start ──────────
    # Turn 0: Provider opening (already have it)
    # Turn 1: Caller's first response (sequential — needs scenario context)
    # Turn 2: Provider's follow-up (sequential — needs Turn 1 for coherence)
    # TTS for all 3 runs in parallel once dialogue is written

    caller_name = scenario.get('caller_name', 'the caller')
    chief_issue  = scenario.get('chief_issue', '')
    setting      = scenario.get('setting', '')
    caller_dialect = scenario.get('caller_dialect', '').strip()

    # Per-dialect vocabulary hints — included in the generation prompt so the model
    # uses authentic vocabulary instead of drifting into Fusha or mixing dialects.
    _DIALECT_VOCAB = {
        "Lebanese":      "شو (what), بدي (I want), هيك (like this), عم (doing), مش (not), كيفك (how are you)",
        "Egyptian":      "إيه (what), عايز/عايزة (I want), كده (like this), مش (not), بقى (so/now), يعني (I mean)",
        "Iraqi":         "شنو (what), أريد (I want), چذا (like this), مو (not), هسة (now), شكو (what's wrong)",
        "Gulf/Khaleeji": "وش/ايش (what), أبي/أبغى (I want), جذي (like this), ما (not), الحين (now), إن شاء الله",
        "Syrian":        "شو (what), بدي (I want), هيك (like this), عم (doing), مو (not), الحق (honestly)",
        "Jordanian":     "شو (what), بدي (I want), هيك (like this), مش (not), هلق (now), والله (by God)",
        "Palestinian":   "شو (what), بدي (I want), هيك (like this), مش (not), هون (here), والله",
        "Moroccan":      "واش (what), بغيت (I want), هكذا (like this), مش (not), دابا (now), إلاه (God)",
        "Sudanese":      "شنو (what), عايز/عايزة (I want), كده (like this), ما (not), زول (person)",
    }
    dialect_vocab_hint = _DIALECT_VOCAB.get(caller_dialect, "")
    vocab_note = f" Characteristic {caller_dialect} vocabulary to weave in naturally: {dialect_vocab_hint}." if dialect_vocab_hint else ""

    # When the caller speaks Arabic, write their lines in their natural regional
    # dialect. NEVER mix dialects or drift into Fusha — that's the interpreter's job.
    caller_register_note = (
        f" CRITICAL: Write {caller_name}'s lines EXCLUSIVELY in {caller_dialect} Arabic dialect."
        f" Never use Modern Standard Arabic (Fusha) or mix with any other dialect — the caller"
        f" only speaks {caller_dialect}.{vocab_note}"
        if caller_dialect else ""
    )

    turn1_text = ask_claude(f"""Write the caller's opening statement in {tgt}.{caller_register_note}
Caller: {caller_name} | Issue: {chief_issue}
Setting: {setting} | Difficulty: {difficulty}
Provider just said: "{opening}"
Write 2-3 natural sentences — the caller explains why they are calling.
Plain spoken language only — no hashtags, asterisks, or markdown-style formatting.{_HUMANIZE_NOTE}
Return dialogue text only.""", 160)

    turn2_text = ask_claude(f"""Write the provider's follow-up in {src}.
Provider: {scenario.get('provider_name','')} ({scenario.get('provider_role','')})
After caller said: "{turn1_text}"
Ask one specific clinical/procedural question to gather more information.
2-3 sentences. Plain spoken language only — no hashtags, asterisks, or markdown-style formatting.{_HUMANIZE_NOTE}
Return dialogue text only.""", 160)

    # Resolve voices that actually match each character's generated gender —
    # this is the fix for "male voice for a female role". Falls back to the
    # field's static pairing only if the model didn't return usable gender info.
    provider_voice = pick_call_voice(scenario.get('provider_gender', ''), 'provider', field, scenario.get('provider_name', ''))
    caller_voice   = pick_call_voice(scenario.get('caller_gender', ''),   'caller',   field, caller_name)
    opi_sessions[sid]["provider_voice"] = provider_voice
    opi_sessions[sid]["caller_voice"]   = caller_voice

    print(f"\n[OPI] ── New call ──────────────────────────")
    print(f"[OPI] Field: {field} | Lang: {src}→{tgt} | Difficulty: {difficulty}")
    print(f"[OPI] Provider voice: {provider_voice}")
    print(f"[OPI] Caller voice:   {caller_voice}")
    print(f"[OPI] Opening: {opening[:80]}...")
    print(f"[OPI] Turn1 (caller): {turn1_text[:80]}...")
    print(f"[OPI] Turn2 (provider): {turn2_text[:80]}...")
    print(f"[OPI] Sending to ElevenLabs...")

    # TTS all 3 in parallel — provider: stability 0.6 (authoritative), caller: 0.35 (natural/nervous)
    # (any failure here propagates up to opi_start_call's wrapper, which logs the full
    # traceback and returns a clear error instead of leaving the frontend with nothing)
    with ThreadPoolExecutor(max_workers=3) as pool:
        fa0 = pool.submit(_tts, opening,    provider_voice, 0.60)
        fa1 = pool.submit(_tts, turn1_text, caller_voice,   0.35)
        fa2 = pool.submit(_tts, turn2_text, provider_voice, 0.60)
        audio0, audio1, audio2 = fa0.result(), fa1.result(), fa2.result()
    print(f"[OPI] TTS done — sizes: {len(audio0)}, {len(audio1)}, {len(audio2)} bytes")

    # Store pre-generated turns in session so next-turn knows the state
    opi_sessions[sid]["turns"] = [
        {"speaker": "provider", "text": opening},
        {"speaker": "caller",   "text": turn1_text},
        {"speaker": "provider", "text": turn2_text},
    ]
    opi_sessions[sid]["pre_turns_count"] = 3   # interpreter hasn't spoken yet

    return JSONResponse({
        "session_id":   sid,
        "scenario":     scenario,
        "target_pairs": target_pairs,
        "video":        is_video,
        "pre_turns": [
            {"speaker": "provider", "text": opening,    "audio_b64": base64.b64encode(audio0).decode()},
            {"speaker": "caller",   "text": turn1_text, "audio_b64": base64.b64encode(audio1).decode()},
            {"speaker": "provider", "text": turn2_text, "audio_b64": base64.b64encode(audio2).decode()},
        ],
    })


def _pick_call_event(difficulty: str, pairs_done: int) -> tuple:
    """
    Probabilistically select a call event based on difficulty and how far
    into the call we are.  Returns (event_type: str, event_instruction: str).
    Both are empty strings when no event fires.

    Events are tiered by difficulty:
      beginner     → emotional reactions only (low prob)
      intermediate → emotional + clarification requests
      advanced     → all of the above + interruptions + long utterances
    """
    if pairs_done < 2:
        return "", ""   # never fire in the first two rendition cycles

    d = {"foundation": 1, "beginner": 1, "intermediate": 2, "advanced": 3}.get(difficulty, 2)

    # Build weighted candidate list
    candidates: list[tuple[str, str, float]] = []
    if d >= 1:
        candidates.append((
            "emotional",
            " The caller is becoming anxious or worried about this situation. "
            "Weave in a brief authentic emotional expression (a worried interjection, "
            "a pleading tone, a pause-filler like 'يلا يا ربي' or 'والله ما عارف') "
            "before delivering the main content of this turn.",
            0.14,
        ))
    if d >= 2:
        candidates.append((
            "clarification",
            " The caller did NOT fully understand what was just conveyed to them. "
            "They ask for the previous point to be repeated or clarified before "
            "they give any new information. Keep it natural — one questioning sentence "
            "then their continuation.",
            0.18,
        ))
    if d >= 3:
        candidates.append((
            "interruption",
            " The caller is urgent and INTERRUPTS — keep this very short (one sentence). "
            "They cut in without waiting for a full pause.",
            0.12,
        ))
        candidates.append((
            "long_utterance",
            " Generate a longer, information-dense utterance (5-7 sentences) with no "
            "natural pausing points — this is a deliberate challenge for the interpreter "
            "to hold and render without losing detail.",
            0.15,
        ))

    random.shuffle(candidates)
    for event_type, instruction, prob in candidates:
        if random.random() < prob:
            return event_type, instruction
    return "", ""


@router.post("/api/opi/next-turn")
async def opi_next_turn(
    session_id:     str        = Form(...),
    audio:          UploadFile = File(None),
    text_input:     str        = Form(""),   # fallback if audio unavailable
    source_speaker: str        = Form(""),   # speaker of the line the interpreter just rendered
    source_text:    str        = Form(""),   # exact text of that line (frontend already has it — pre-gen or live)
    need_next:      str        = Form("true"),  # "false" while draining the pre-generated buffer (no generation needed yet)
):
    """
    Receive interpreter's rendition of a known source line → transcribe → record the (source, rendition)
    pair → optionally generate the next party's line and return its audio.

    `source_speaker`/`source_text` are supplied by the frontend so the backend never has to guess —
    this keeps the evaluation pairing correct whether the line being rendered was pre-generated
    (buffered, zero-latency) or generated live. `need_next=false` is used while the frontend is still
    draining its pre-generated buffer, so we just record the pairing without burning an extra
    Claude+TTS round trip on a line that would be discarded.
    """
    if session_id not in opi_sessions:
        raise HTTPException(404, "Session not found")
    sess = opi_sessions[session_id]
    if sess["ended"]:
        return JSONResponse({"is_call_ended": True})

    # ── Transcribe interpreter's recording ──────────────────────────
    transcript = text_input
    user_audio_b64 = None
    if audio:
        data = await audio.read()
        user_audio_b64 = base64.b64encode(data).decode()
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(data); tmp = f.name
        lang_code = "ar" if sess["tgt"].lower().startswith("ar") else "en"
        try:
            segs, _ = whisper.transcribe(tmp, language=lang_code, beam_size=1)
            transcript = " ".join(s.text for s in segs).strip()
        except Exception:
            pass
        finally:
            os.unlink(tmp)

    sess["turns"].append({"speaker": "interpreter", "text": transcript})
    sess["pairs_done"] += 1

    # ── Record the (source, rendition) pair using what the frontend told us ──
    # This is the single source of truth for the end-of-call evaluation — it can't
    # drift out of sync with what the user actually heard and said, regardless of
    # whether the line was pre-generated or produced live.
    # We also store the raw user audio so end-call can re-transcribe for grading.
    if source_speaker and source_text:
        sess["pairs"].append({
            "speaker":          source_speaker,
            "source_text":      source_text,
            "interpreter_text": transcript,
            "user_audio_b64":   user_audio_b64,
        })

    # ── Buffer drain: just acknowledge — the frontend already has the next line ──
    if need_next.strip().lower() == "false":
        return JSONResponse({
            "acknowledged":          True,
            "interpreter_transcript": transcript,
            "pairs_done":            sess["pairs_done"],
            "target_pairs":          sess["target_pairs"],
        })

    # ── Determine next speaker ──────────────────────────────────────
    provider_count = sum(1 for t in sess["turns"] if t["speaker"] == "provider")
    caller_count   = sum(1 for t in sess["turns"] if t["speaker"] == "caller")
    next_speaker   = "caller" if provider_count > caller_count else "provider"

    # ── Check if call should end ────────────────────────────────────
    ending = sess["pairs_done"] >= sess["target_pairs"]

    # ── Fast path: use prefetched turn if available and matching ────
    # The prefetch endpoint generates + TTS the next turn while the interpreter
    # is still recording, so by the time we get here the result is often
    # already waiting.  Only skip the prefetch when we're at the ending turn
    # (which needs a closing line, not a regular continuation).
    prefetch = sess.get("prefetch")
    if (isinstance(prefetch, dict)
            and prefetch.get("speaker") == next_speaker
            and not ending):
        sess.pop("prefetch", None)
        next_text = prefetch["text"]
        audio_out = base64.b64decode(prefetch["audio_b64"])
        sess["turns"].append({"speaker": next_speaker, "text": next_text, "event": ""})
        return JSONResponse({
            "session_id":             session_id,
            "speaker":                next_speaker,
            "text":                   next_text,
            "audio_b64":              prefetch["audio_b64"],
            "interpreter_transcript": transcript,
            "is_call_ended":          False,
            "pairs_done":             sess["pairs_done"],
            "target_pairs":           sess["target_pairs"],
            "event":                  "",
            "from_prefetch":          True,
        })

    # ── Build perceived conversation (context-aware, adaptive) ────────
    # Each party can only respond to what the INTERPRETER conveyed to them —
    # not the original source text they never heard.  Including the interpreter's
    # actual renditions here means:
    #   • If the interpreter omitted critical info, the other party won't know it
    #   • If the interpreter conveyed something incorrectly, the response drifts
    #     naturally (the caller answers the question as they understood it)
    #   • The AI generating the next line sees the realistic "perceived" dialogue
    #     rather than a perfect transcript neither party actually heard.
    perceived_lines: list[str] = []
    turns_snapshot = sess["turns"]
    for i, t in enumerate(turns_snapshot):
        if t["speaker"] == "provider":
            perceived_lines.append(f"PROVIDER (in {sess['src']}): {t['text']}")
        elif t["speaker"] == "caller":
            perceived_lines.append(f"CALLER (in {sess['tgt']}): {t['text']}")
        elif t["speaker"] == "interpreter" and t["text"].strip():
            # Find the most-recent non-interpreter speaker — that is who was rendered
            prev_src = next(
                (turns_snapshot[j] for j in range(i - 1, -1, -1)
                 if turns_snapshot[j]["speaker"] in ("provider", "caller")),
                None,
            )
            if prev_src:
                rendered_for = "CALLER" if prev_src["speaker"] == "provider" else "PROVIDER"
                perceived_lines.append(
                    f"  → {rendered_for} understood: \"{t['text']}\""
                )
    history = "\n".join(perceived_lines)

    sc = sess["scenario"]

    # Provider always speaks `src`, caller always speaks `tgt` — must stay consistent
    # with pre-generated turns, otherwise live turns silently flip language mid-call.
    speaker_lang   = sess['src'] if next_speaker == 'provider' else sess['tgt']
    caller_dialect = sc.get('caller_dialect', '').strip()
    _DIALECT_VOCAB_NT = {
        "Lebanese":      "شو, بدي, هيك, عم, مش",
        "Egyptian":      "إيه, عايز/عايزة, كده, مش, بقى",
        "Iraqi":         "شنو, أريد, چذا, مو, هسة",
        "Gulf/Khaleeji": "وش/ايش, أبي/أبغى, جذي, ما, الحين",
        "Syrian":        "شو, بدي, هيك, عم, مو",
        "Jordanian":     "شو, بدي, هيك, مش, هلق",
        "Palestinian":   "شو, بدي, هيك, مش, هون",
        "Moroccan":      "واش, بغيت, هكذا, مش, دابا",
        "Sudanese":      "شنو, عايز/عايزة, كده, ما",
    }
    dv = _DIALECT_VOCAB_NT.get(caller_dialect, "")
    register_note  = (
        f" CRITICAL: Write in PURE {caller_dialect} Arabic dialect only."
        f" Never use Fusha or mix dialects. Natural vocabulary for this dialect: {dv}."
        if (next_speaker == 'caller' and caller_dialect) else ""
    )
    plain_note = " Plain spoken language only — no hashtags, asterisks, or markdown."

    # ── Difficulty-scaled utterance length ────────────────────────────
    length_map = {
        "foundation":   ("2-3 sentences, roughly 25 words", 120),
        "beginner":     ("2-3 sentences, roughly 25 words", 120),
        "intermediate": ("3-4 sentences, roughly 50 words",  180),
        "advanced":     ("4-6 sentences, 60-90 words — may use domain-specific terminology", 260),
    }
    length_instr, length_tokens = length_map.get(sess["difficulty"], ("2-4 sentences", 180))

    # ── Probabilistic event injection ────────────────────────────────
    event_type, event_instr = _pick_call_event(sess["difficulty"], sess["pairs_done"])
    if event_instr:
        length_tokens = max(length_tokens, 180)   # events may need extra room

    if ending:
        next_text = ask_claude(
            f"Generate a natural, professional closing line (1-2 sentences in {speaker_lang}) "
            f"for the {next_speaker} to conclude this {sess['field']} call."
            f"{register_note}{plain_note}{_HUMANIZE_NOTE} Return dialogue text only.", 80)
        sess["ended"] = True
    else:
        role_instr = (
            "Ask a focused question or provide clinical/procedural information "
            "based strictly on what you just heard from the interpreter."
            if next_speaker == "provider" else
            "Respond naturally to what you understood the provider said. "
            "Be specific to your situation and speak as you normally would on the phone."
        )
        next_text = ask_claude(
            f"OPI call — write the {next_speaker}'s next line in {speaker_lang}."
            f"{register_note}{event_instr}\n\n"
            f"Context:\n"
            f"- Setting: {sc.get('setting', '')} | Issue: {sc.get('chief_issue', '')}\n"
            f"- {next_speaker.upper()}: {sc.get('provider_name' if next_speaker == 'provider' else 'caller_name', '')}\n\n"
            f"CALL SO FAR (each party responds ONLY to what the interpreter conveyed to them):\n"
            f"{history}\n\n"
            f"Length: {length_instr}. {role_instr}"
            f"{plain_note}{_HUMANIZE_NOTE}\n"
            f"Return dialogue text only — no speaker label, no quotes.",
            length_tokens,
        )

    sess["turns"].append({"speaker": next_speaker, "text": next_text, "event": event_type})
    voice     = sess.get("provider_voice") if next_speaker == "provider" else sess.get("caller_voice")
    stability = 0.60 if next_speaker == "provider" else 0.35
    audio_out = _tts(next_text, voice or ELEVENLABS_VOICE_ID, stability)

    return JSONResponse({
        "session_id":             session_id,
        "speaker":                next_speaker,
        "text":                   next_text,
        "audio_b64":              base64.b64encode(audio_out).decode(),
        "interpreter_transcript": transcript,
        "is_call_ended":          sess["ended"],
        "pairs_done":             sess["pairs_done"],
        "target_pairs":           sess["target_pairs"],
        "event":                  event_type,   # e.g. "emotional", "clarification", "interruption", ""
    })


@router.post("/api/opi/save-intro")
async def opi_save_intro(session_id: str = Form(...), intro_transcript: str = Form("")):
    """
    Store the interpreter's opening self-introduction (captured right after
    Accept, before any dialogue plays). It's folded into the end-of-call
    evaluation so professionalism is graded on the whole call — not just the
    interpreted turns.

    Now also runs a quick bilingual quality check so the frontend can give
    the interpreter immediate formative feedback before the first turn plays.
    """
    sess = opi_sessions.get(session_id)
    transcript = (intro_transcript or "").strip()
    if sess:
        sess["intro_transcript"] = transcript

    if not transcript:
        return JSONResponse({"ok": True, "feedback": {
            "has_english": False, "has_arabic_fusha": False,
            "has_name": False, "has_role": False, "has_confidentiality": False,
            "quality": "missing",
        }})

    try:
        fb = extract_json(ask_claude(
            f'Analyze this OPI interpreter self-introduction:\n"{transcript}"\n\n'
            'Return JSON only — no prose:\n'
            '{\n'
            '  "has_english": true/false,\n'
            '  "has_arabic_fusha": true/false — Modern Standard Arabic present (not dialect),\n'
            '  "has_name": true/false — stated their own name,\n'
            '  "has_role": true/false — identified as interpreter,\n'
            '  "has_confidentiality": true/false — mentioned confidentiality or impartiality,\n'
            '  "quality": "excellent|good|incomplete|missing"\n'
            '}',
            120,
        )) or {}
    except Exception:
        fb = {}

    return JSONResponse({"ok": True, "feedback": fb})


@router.post("/api/opi/prefetch-next")
async def opi_prefetch_next(session_id: str = Form(...)):
    """
    Speculatively generate + TTS the NEXT speaker's line while the interpreter
    is still recording. Triggered by the frontend the moment real speech is
    detected (MIN_SPEECH frames) — giving Claude + TTS 10-30 seconds to run
    in parallel.  The result is cached in the session and consumed by the
    subsequent opi_next_turn call, eliminating the Claude + TTS wait entirely
    for that turn (only STT latency remains after the interpreter stops).

    If the prefetch is already in-progress or session is near the end,
    returns {"ok": false} immediately so we don't double-generate.
    """
    sess = opi_sessions.get(session_id)
    if not sess or sess.get("ended") or sess.get("prefetch"):
        return JSONResponse({"ok": False, "reason": "unavailable"})

    # Mark as in-progress to prevent duplicate requests
    sess["prefetch"] = "pending"

    try:
        provider_count = sum(1 for t in sess["turns"] if t["speaker"] == "provider")
        caller_count   = sum(1 for t in sess["turns"] if t["speaker"] == "caller")
        next_speaker   = "caller" if provider_count > caller_count else "provider"

        # Don't prefetch if we're at the last turn — it'll be an ending line
        if sess["pairs_done"] + 1 >= sess["target_pairs"]:
            sess.pop("prefetch", None)
            return JSONResponse({"ok": False, "reason": "near-end"})

        sc = sess["scenario"]
        speaker_lang   = sess["src"] if next_speaker == "provider" else sess["tgt"]
        caller_dialect = sc.get("caller_dialect", "").strip()
        _DV_PF = {
            "Lebanese":      "شو, بدي, هيك, عم, مش",
            "Egyptian":      "إيه, عايز/عايزة, كده, مش, بقى",
            "Iraqi":         "شنو, أريد, چذا, مو, هسة",
            "Gulf/Khaleeji": "وش/ايش, أبي/أبغى, جذي, ما, الحين",
            "Syrian":        "شو, بدي, هيك, عم, مو",
            "Jordanian":     "شو, بدي, هيك, مش, هلق",
            "Palestinian":   "شو, بدي, هيك, مش, هون",
            "Moroccan":      "واش, بغيت, هكذا, مش, دابا",
            "Sudanese":      "شنو, عايز/عايزة, كده, ما",
        }
        register_note = (
            f" PURE {caller_dialect} Arabic dialect only."
            f" Vocabulary: {_DV_PF.get(caller_dialect, '')}."
            if (next_speaker == "caller" and caller_dialect) else ""
        )
        plain_note = " Plain spoken language only — no hashtags, asterisks, or markdown."

        # Perceived history without the current (not-yet-known) rendition
        perceived: list[str] = []
        for t in sess["turns"]:
            if t["speaker"] == "provider":
                perceived.append(f"PROVIDER: {t['text']}")
            elif t["speaker"] == "caller":
                perceived.append(f"CALLER: {t['text']}")
        history = "\n".join(perceived)

        length_map = {
            "beginner":     ("2-3 sentences, roughly 25 words", 120),
            "intermediate": ("3-4 sentences, roughly 50 words", 180),
            "advanced":     ("4-6 sentences, 60-90 words — may use domain-specific terminology", 260),
        }
        length_instr, length_tokens = length_map.get(sess["difficulty"], ("2-4 sentences", 180))
        role_instr = (
            "Ask a focused clinical or procedural question."
            if next_speaker == "provider" else
            "Respond naturally to what you understood."
        )

        next_text = ask_claude(
            f"OPI call — write the {next_speaker}'s next line in {speaker_lang}.{register_note}\n\n"
            f"Setting: {sc.get('setting','')} | Issue: {sc.get('chief_issue','')}\n\n"
            f"CONVERSATION SO FAR:\n{history}\n\n"
            f"Length: {length_instr}. {role_instr}{plain_note}{_HUMANIZE_NOTE}\n"
            f"Return dialogue text only — no speaker label, no quotes.",
            length_tokens,
        )

        voice     = sess.get("provider_voice") if next_speaker == "provider" else sess.get("caller_voice")
        stability = 0.60 if next_speaker == "provider" else 0.35
        audio_out = _tts(next_text, voice or ELEVENLABS_VOICE_ID, stability)

        sess["prefetch"] = {
            "speaker":   next_speaker,
            "text":      next_text,
            "audio_b64": base64.b64encode(audio_out).decode(),
        }
        return JSONResponse({"ok": True})

    except Exception as e:
        sess.pop("prefetch", None)
        print(f"[PREFETCH] failed: {e}")
        return JSONResponse({"ok": False, "reason": str(e)})


@router.post("/api/opi/end-call")
async def opi_end_call(session_id: str = Form(...)):
    """
    Force-end the call (user clicks End Call) and return full evaluation.
    """
    sess = opi_sessions.pop(session_id, None)
    if not sess:
        # Return a minimal result so the frontend can still log the call
        return JSONResponse({
            "overall_score": 0, "accuracy": 0, "completeness": 0,
            "terminology": 0, "fluency": 0, "professional_protocol": 0, "register_preservation": 0,
            "grade": "Incomplete", "summary": "Call ended before any turns were completed.",
            "strengths": [], "coaching_tips": ["Try completing at least one full interpretation turn."],
            "next_drill": "Practice a 30-second consecutive interpretation segment.",
            "protocol_notes": "No turns recorded.", "turn_evaluations": [], "turn_log": []
        })

    sess["ended"] = True

    # ── Re-transcribe user audio for each pair to ensure evaluation grades ──
    # the interpreter's actual spoken rendition, not any fallback text.
    ordered_pairs = sess.get("pairs", [])
    lang_code = "ar" if sess["tgt"].lower().startswith("ar") else "en"
    for p in ordered_pairs:
        user_audio_b64 = p.get("user_audio_b64")
        if user_audio_b64:
            try:
                audio_bytes = base64.b64decode(user_audio_b64)
                with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                    f.write(audio_bytes); tmp = f.name
                segs, _ = whisper.transcribe(tmp, language=lang_code, beam_size=1)
                actual_transcript = " ".join(s.text for s in segs).strip()
                p["interpreter_text"] = actual_transcript if actual_transcript else "No user audio captured"
            except Exception:
                p["interpreter_text"] = "No user audio captured"
            finally:
                try:
                    os.unlink(tmp)
                except Exception:
                    pass
        else:
            p["interpreter_text"] = "No user audio captured"

    pairs_text = [
        f"SOURCE ({p['speaker']}): {p['source_text']}\nINTERPRETER: {p['interpreter_text']}"
        for p in ordered_pairs
    ]

    sc = sess["scenario"]
    # Cap at 8 turns and trim the prompt — the evaluator was taking "ages" to
    # respond because it had to both read and *generate* a large structured
    # JSON blob (per-turn ideal renditions are the expensive part). Fewer
    # turns + a tighter token budget cuts response time meaningfully without
    # making the assessment less useful (8 turns is plenty to grade on).
    pairs_numbered = "\n\n".join(f"Turn {i+1}:\n{p}" for i, p in enumerate(pairs_text[:8]))

    intro = sess.get("intro_transcript", "").strip()
    intro_block = (
        f'INTERPRETER\'S OPENING SELF-INTRODUCTION (assess as part of professional_protocol — '
        f'a real OPI call should open with name, role as interpreter, and a brief '
        f'confidentiality/impartiality reminder):\n"{intro}"\n'
        if intro else
        'INTERPRETER\'S OPENING SELF-INTRODUCTION: none captured — note this as a missed '
        'protocol step (a professional interpreter always opens by introducing themselves).\n'
    )

    # OPI/VRI merge — video mode adds a visual channel the interpreter must account for.
    # VRI best practice: read and verbally bridge non-verbal cues (gestures, items shown
    # on camera, expressions) since the interpreter is the only bilingual party who can
    # describe them if they affect meaning. Folded into professional_protocol scoring
    # (no new weight added, so the existing rubric formula is untouched) plus a dedicated
    # visual_cue_notes field surfaced to the frontend.
    is_video_call = bool(sess.get("video"))
    visual_cues = sc.get("visual_cues", "")
    video_block = (
        f'\nVIDEO CALL (VRI) — VISUAL CUES PRESENT ON CAMERA: "{visual_cues}"\n'
        f'This is a video call, not audio-only. As part of professional_protocol, assess whether '
        f'the interpreter\'s renditions account for these non-verbal/visual cues when they carry '
        f'meaning (e.g., verbally bridging a gesture or an item shown on camera if either party '
        f'would otherwise miss it). Also return a "visual_cue_notes" field: 1 sentence on how well '
        f'visual information was handled.\n'
        if is_video_call else ""
    )
    visual_field_schema = (
        ',\n  "visual_cue_notes": "1 sentence on how well the interpreter handled the visual/non-verbal channel"'
        if is_video_call else ""
    )

    # NOTE: this used to be a single Claude call asking for both the 7 headline
    # scores AND a verbose up-to-8-entry turn_evaluations array in one JSON blob,
    # budgeted at max_tokens=2000. On calls with several real turns (especially
    # Arabic-heavy content, which tokenizes less efficiently) that budget was
    # frequently too small — the response truncated mid-JSON, json.loads() failed,
    # and extract_json()'s all-or-nothing fallback returned {"raw": text}, which
    # blanked every score field ("—" across the board) even though turn_count/
    # turn_log still rendered fine since those come from ordered_pairs, not from
    # Claude's response. Splitting into two calls means a verbose/truncated
    # per-turn breakdown can never take the headline scores down with it.
    eval_prompt_core = f"""You are a certified AIIC-standard OPI evaluator. Assess this interpreting session rigorously — do not inflate scores.

CALL METADATA
Field: {sess['field']} | Language pair: {sess['src']} → {sess['tgt']}
Scenario: {sc.get('chief_issue','')} | Setting: {sc.get('setting','')}
Difficulty: {sess['difficulty']} | Pairs interpreted: {len(ordered_pairs)}

SCORING RUBRIC (apply strictly — each dimension 0-100):
• accuracy (20%): Exact meaning conveyed — no distortions, insertions, or embellishments. Every factual element preserved.
• fusha_compliance (20%): Arabic output in Modern Standard Arabic / Fusha only. Penalize dialect words, slang, code-switching. N/A → 100 for non-Arabic pairs.
• completeness (20%): ALL elements of the source present in the rendition. Omissions and condensations penalized proportionally. Classify each omission as Strategic (deliberate, for clarity — less penalty) or Unintentional (missed content — full penalty).
• terminology (15%): Correct domain-specific terms for {sess['field']}. Each uncorrected technical error = significant deduction.
• fluency (10%): Natural pace, no excessive hedging, no false starts that impede comprehension.
• professional_protocol (10%): Bilingual self-intro (English + Arabic Fusha), first-person mode, impartiality, accuracy reminder. Missing intro = automatic 0 in this category.
• register_preservation (10%): Maintained appropriate register for the OPI setting — formal but accessible, matching the speaker's tone without drifting into overly casual or inappropriately stiff language.

overall_score = 0.20×accuracy + 0.20×fusha_compliance + 0.20×completeness + 0.15×terminology + 0.10×fluency + 0.10×professional_protocol + 0.10×register_preservation

{intro_block}{video_block}
TURN PAIRS (assess holistically — up to turn {min(len(ordered_pairs), 8)}):
{pairs_numbered}
"""

    # Call A — headline scores. Small, fixed-size payload regardless of call
    # length, so it reliably completes even on long calls with many turns.
    # Wrapped in try/except so an API/network error degrades to a clear
    # "Incomplete" result instead of a 500.
    try:
        result = extract_json(ask_claude(eval_prompt_core + f"""
Return JSON ONLY — no prose outside the braces:
{{
  "overall_score": <0-100 weighted>,
  "accuracy": <0-100>,
  "fusha_compliance": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "summary": "Exactly 2 sentences — specific findings, not generic praise.",
  "strengths": ["one concrete observed strength"],
  "coaching_tips": ["one specific, actionable improvement with a brief example"],
  "next_drill": "One concrete exercise targeting the weakest scored area",
  "protocol_notes": "1 sentence on intro quality and first-person/impartiality adherence"{visual_field_schema}
}}

Grade thresholds: A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60.
Brevity is mandatory: summary exactly 2 sentences.""", 800))
    except Exception as e:
        print(f"[OPI EVAL] headline-score call failed: {e}")
        result = {
            "overall_score": 0, "accuracy": 0, "fusha_compliance": 0, "completeness": 0,
            "terminology": 0, "fluency": 0, "professional_protocol": 0, "register_preservation": 0, "grade": "Incomplete",
            "summary": "Evaluation service did not respond — scores unavailable for this call.",
            "strengths": [], "coaching_tips": [], "next_drill": "", "protocol_notes": "",
        }

    # Call B — per-turn breakdown. This is the verbose part (up to 8 turns x
    # several free-text fields), so it gets the larger token budget. If it
    # fails or truncates, we fall back to the neutral-verdict stub below
    # instead of letting it blank out the headline scores from Call A.
    try:
        turn_evals_raw = extract_json(ask_claude(eval_prompt_core + f"""
Return JSON ONLY — no prose outside the braces:
{{
  "turn_evaluations": [
    {{
      "turn": 1,
      "speaker": "provider|caller",
      "source_text": "exact source",
      "interpreter_said": "what was rendered",
      "ideal_rendition": "Band 8 rendition in {sess['tgt']} — max 25 words",
      "verdict": "correct|acceptable|omission|addition|distortion|dialect_intrusion|error",
      "omissions": "key content left out — empty string if none",
      "omission_type": "strategic|unintentional|none",
      "additions": "content added that was not in source — empty string if none",
      "note": "specific actionable feedback — max 20 words"
    }}
  ]
}}
One entry per turn pair shown above, in order. note ≤20 words, ideal_rendition ≤25 words.""", 3000))
    except Exception as e:
        print(f"[OPI EVAL] turn-evaluations call failed: {e}")
        turn_evals_raw = {}
    result["turn_evaluations"] = turn_evals_raw.get("turn_evaluations") or []

    # Build structured turn log for the frontend dialogue boxes — straight from the
    # verified pairs list, so "Full Dialogue" always has real source/rendered text
    # even if the evaluator's JSON came back incomplete or truncated.
    structured_turns = [
        {"speaker": p["speaker"], "source": p["source_text"], "rendered": p["interpreter_text"]}
        for p in ordered_pairs
    ]
    # Guarantee turn_evaluations always has usable rows — fall back to the raw pairs
    # (with neutral verdicts) if the evaluator's JSON was missing/short/truncated.
    evals = result.get("turn_evaluations") or []
    if len(evals) < len(ordered_pairs):
        have = {e.get("turn") for e in evals if isinstance(e, dict)}
        for i, p in enumerate(ordered_pairs, start=1):
            if i in have:
                continue
            evals.append({
                "turn": i, "speaker": p["speaker"],
                "source_text": p["source_text"], "interpreter_said": p["interpreter_text"],
                "ideal_rendition": "", "verdict": "acceptable",
                "omissions": "", "additions": "",
                "note": "Evaluator did not return a detailed note for this turn.",
            })
        evals.sort(key=lambda e: e.get("turn", 0))
    result["turn_evaluations"] = evals

    result["turn_log"]     = structured_turns
    result["full_transcript"] = "\n".join(
        f"[{t['speaker'].upper()}] {t['text']}" for t in sess["turns"])
    result["turn_count"]   = len(ordered_pairs)
    result["duration_min"] = sess["duration_min"]
    result["scenario"]     = sc
    result["field"]        = sess["field"]
    result["language"]     = f"{sess['src']} → {sess['tgt']}"
    result["video"]        = is_video_call

    save_session("opi_sim", {
        "field": sess["field"], "language": result["language"],
        "scenario": sc.get("chief_issue", ""), "turns": len(ordered_pairs), "scores": result
    })
    return JSONResponse(result)


# ══════════════════════════════════════════════════════════════════════════════
# CONSECUTIVE INTERPRETATION (CI) SIMULATION
# ══════════════════════════════════════════════════════════════════════════════
#
# Architecture:
#   /api/ci/new-session   — generate scenario + first segment
#   /api/ci/get-segment   — generate next speaker segment (adaptive)
#   /api/ci/submit-turn   — receive interpreter's rendition for a segment
#   /api/ci/end-session   — run full AIIC-adapted evaluation, return KPIs
#
# Key differences from OPI:
#   • Speaker is a professional in a formal setting (no dialect caller)
#   • Segments are longer (30s–3min worth of text)
#   • No bilingual intro requirement — CI intro differs from OPI protocol
#   • Memory and note-taking are primary stress vectors (not real-time bridging)
#   • Turn-taking latency KPI: measures pause between speaker finish and interpreter start
#   • Two new KPIs: memory_accuracy, segment_handling
#   • Completeness weight elevated vs. OPI rubric
#
# CI AIIC Rubric (weights differ from OPI):
#   overall = 0.25×accuracy + 0.15×fusha_compliance + 0.25×completeness
#           + 0.15×terminology + 0.10×fluency + 0.05×professional_protocol + 0.10×register_preservation
# ──────────────────────────────────────────────────────────────────────────────

ci_sessions: dict = {}   # in-memory, keyed by session_id

# CI scenario templates by setting
CI_SETTINGS = {
    "medical": {
        "label": "Medical — Clinical & Hospital",
        "provider_roles": ["Physician", "Surgeon", "Psychiatrist", "Pediatrician", "Oncologist"],
        "topics": [
            "diagnosis explanation and treatment plan",
            "post-operative care instructions",
            "psychiatric assessment and findings",
            "medication management review",
            "clinical trial eligibility discussion",
        ],
        "segment_length_words": (60, 140),
        "protocol": "NCIHC",
        "stress": "emotional precision, zero-omission standard",
    },
    "legal": {
        "label": "Legal — Courts & Proceedings",
        "provider_roles": ["Defense Attorney", "Prosecutor", "Judge", "Legal Aid Counsel", "Notary"],
        "topics": [
            "court witness testimony",
            "attorney-client case briefing",
            "sentencing explanation",
            "rights advisement",
            "legal document review hearing",
        ],
        "segment_length_words": (80, 160),
        "protocol": "NAJIT",
        "stress": "verbatim standard, formal register, no paraphrasing",
    },
    "immigration": {
        "label": "Immigration — Asylum & Consular",
        "provider_roles": ["Immigration Judge", "USCIS Officer", "Consular Officer", "Asylum Officer", "Border Agent"],
        "topics": [
            "asylum claim hearing",
            "immigration interview",
            "visa application review",
            "deportation order explanation",
            "refugee status determination interview",
        ],
        "segment_length_words": (70, 150),
        "protocol": "NCIHC",
        "stress": "high stakes, legal status implications, strict neutrality",
    },
    "diplomatic": {
        "label": "Diplomatic — Bilateral & Protocol",
        "provider_roles": ["Government Minister", "UN Representative", "Ambassador", "Foreign Affairs Advisor", "NGO Director"],
        "topics": [
            "bilateral agreement announcement",
            "diplomatic statement on regional tensions",
            "humanitarian situation briefing",
            "policy framework presentation",
            "joint communiqué reading",
        ],
        "segment_length_words": (100, 200),
        "protocol": "AIIC",
        "stress": "ceremonial formality, no improvisation, strict protocol adherence",
    },
    "business": {
        "label": "Business — Corporate & Finance",
        "provider_roles": ["CEO", "Legal Counsel", "Financial Advisor", "HR Director", "Project Manager"],
        "topics": [
            "contract negotiation",
            "merger and acquisition briefing",
            "investor relations presentation",
            "corporate governance update",
            "financial audit findings",
        ],
        "segment_length_words": (60, 130),
        "protocol": "AIIC",
        "stress": "rapid pace, financial terminology, code-switching under pressure",
    },
    "academic": {
        "label": "Academic — Lectures & Research",
        "provider_roles": ["Professor", "Research Director", "Conference Speaker", "Academic Panelist", "Dean"],
        "topics": [
            "research methodology presentation",
            "clinical study findings report",
            "policy reform analysis",
            "literature review summary",
            "interdisciplinary symposium address",
        ],
        "segment_length_words": (100, 180),
        "protocol": "AIIC",
        "stress": "dense terminology, citation management, sustained cognitive load",
    },
    "community": {
        "label": "Community — Social & Public Health",
        "provider_roles": ["Social Worker", "Public Health Nurse", "Community Outreach Coordinator", "School Counselor", "Benefits Caseworker"],
        "topics": [
            "public health outreach session",
            "benefits enrollment explanation",
            "school parent meeting",
            "domestic violence resource briefing",
            "community health screening",
        ],
        "segment_length_words": (50, 120),
        "protocol": "NCIHC",
        "stress": "accessible register, cultural mediation, vulnerable population sensitivity",
    },
    "security": {
        "label": "Security — Law Enforcement",
        "provider_roles": ["Detective", "FBI Agent", "Police Officer", "Customs Inspector", "Emergency Coordinator"],
        "topics": [
            "suspect interview",
            "witness statement collection",
            "rights advisement",
            "customs declaration review",
            "emergency coordination briefing",
        ],
        "segment_length_words": (60, 130),
        "protocol": "NAJIT",
        "stress": "strict verbatim, absolute neutrality, high-pressure environment",
    },
    "media": {
        "label": "Media — Press & Broadcast",
        "provider_roles": ["Press Secretary", "Government Spokesperson", "News Anchor", "Political Correspondent", "Crisis Communications Officer"],
        "topics": [
            "press conference statement",
            "live news briefing",
            "official government announcement",
            "crisis communications update",
            "post-event media statement",
        ],
        "segment_length_words": (80, 160),
        "protocol": "AIIC",
        "stress": "real-time pressure, impromptu terminology, broadcast register",
    },
}

@router.post("/api/ci/new-session")
async def ci_new_session(
    field:        str = Form("medical"),
    field_type:   str = Form(""),         # sub-type e.g. "Workshop", "Asylum Interview"
    language:     str = Form("English → Arabic"),
    difficulty:   str = Form("intermediate"),
    segments:     int = Form(4),
    pace:         int = Form(2),          # 1=deliberate 2=moderate 3=fast 4=rapid
    participants: int = Form(0),          # additional voices
    one_way:      str = Form("0"),        # "1" = one-directional interpretation
    mode:         str = Form("consecutive"),   # "consecutive" | "simultaneous" | "chuchotage" | "escort" | "sight" | "legal_verbatim"
    verbatim:     str = Form("0"),               # "1" = legal verbatim evaluation weights
    atmosphere:   str = Form("booth"),         # SI only: "booth" | "remote-stable" | "remote-intermittent" | "remote-poor"
    listener_count: int = Form(1),             # Chuchotage only: 1 | 2
    noise_level:    str = Form("quiet"),       # Chuchotage only: "quiet" | "moderate" | "noisy"
    scenario_type:  str = Form(""),            # Escort/Liaison only: "business" | "social" | "administrative"
    document_type:  str = Form("letter"),      # Sight Translation only: "letter" | "form" | "contract-excerpt" | "news"
    sight_mode:     str = Form("continuous"),   # Sight Translation only: "continuous" | "chunked"
):
    """
    Create a new CI/SI/Chuchotage/Escort/Sight-Translation session. Generates the scenario
    and the first speaker segment (or document, for Sight Translation). Returns session_id,
    scenario metadata, and first segment text + audio (audio is empty for Sight Translation —
    there is no spoken source, only a written document the interpreter reads and renders orally).

    All five modes reuse this single endpoint family (per PROJECT_BRIEF.md /
    INTERPRETING_PROTOCOLS_AND_KPIS.md):
    - mode == "simultaneous": booth-style SI/RSI — atmosphere-only variant of CI content.
    - mode == "chuchotage": whispered SI — no equipment, physical proximity, ambient
      noise + listener-count modifiers, capped duration in the UI (~45 min).
    - mode == "escort": Escort/Liaison — informal bidirectional conversation, capped
      difficulty (never "expert"-framed), scenario-type context replaces formal setting.
    - mode == "sight": Sight Translation — written-input/oral-output, capped at short
      document excerpts (≤~300 words), no audio source; WPM throughput is the timing
      metric (read_duration_sec, reusing the decalage_sec field) instead of EVS/décalage.
    Segments are shorter and phrased as continuous speech with no built-in recall pause
    for the two live-render modes (SI, Chuchotage), and an Ear-Voice-Span (EVS/décalage)
    target is computed from pace+difficulty (+ noise, for Chuchotage) for client-side
    lag scoring.
    """
    try:
        from elevenlabs import ElevenLabs

        is_one_way = one_way.strip() in ("1", "true", "True")
        is_verbatim = verbatim.strip() in ("1", "true", "True")
        mode = mode.strip().lower()
        is_si = mode == "simultaneous"
        is_chuchotage = mode == "chuchotage"
        is_escort = mode == "escort"
        is_sight = mode == "sight"
        is_legal_verbatim = mode in ("legal_verbatim", "legal") or is_verbatim
        is_live_render = is_si or is_chuchotage  # concurrent listen+render, no replay
        if is_escort and difficulty in ("advanced", "expert"):
            # Escort/Liaison is explicitly the lowest-stakes mode — never let it run at
            # "expert"-framing difficulty per PROJECT_BRIEF.md.
            difficulty = "intermediate"
        sid = str(uuid.uuid4())[:8]
        src = language.split("→")[0].strip()
        tgt = (language.split("→")[1].strip() if "→" in language else "Arabic")

        setting_data = CI_SETTINGS.get(field, CI_SETTINGS["medical"])
        provider_role = random.choice(setting_data["provider_roles"])
        topic = random.choice(setting_data["topics"])
        min_w, max_w = setting_data["segment_length_words"]
        protocol  = setting_data.get("protocol", "AIIC")
        stress    = setting_data.get("stress", "")

        # Adjust segment length by difficulty + pace
        diff_mult = {"foundation": 0.55, "beginner": 0.6, "intermediate": 1.0, "advanced": 1.4, "expert": 1.8}.get(difficulty, 1.0)
        pace_mult = {1: 0.75, 2: 1.0, 3: 1.25, 4: 1.5}.get(pace, 1.0)
        seg_words = int(random.randint(min_w, max_w) * diff_mult * pace_mult)
        if is_live_render:
            # SI/Chuchotage segments are much shorter — interpreter renders concurrently
            # rather than after a full recall-length segment (booth/whisper protocol, not
            # CI consecutive).
            seg_words = max(18, int(seg_words * 0.32))
        elif is_escort:
            # Escort/Liaison is short conversational exchange, not monologue.
            seg_words = max(15, int(seg_words * 0.45))
        elif is_sight:
            # Sight Translation protocol caps documents at ~1-2 pages / non-complex —
            # excerpts here are kept short regardless of difficulty (difficulty maps to
            # document/register complexity, not length, per INTERPRETING_PROTOCOLS_AND_KPIS.md).
            seg_words = max(70, min(180, int(seg_words * 0.5)))

        # EVS/décalage target (seconds) — scales inversely with pace, per
        # INTERPRETING_PROTOCOLS_AND_KPIS.md (slow → 3-4s, expert → 1.5-2s)
        evs_target_sec = {1: 4.0, 2: 3.0, 3: 2.2, 4: 1.6}.get(pace, 3.0)
        if difficulty in ("expert",):
            evs_target_sec = max(1.2, evs_target_sec - 0.3)
        elif difficulty in ("foundation", "beginner"):
            evs_target_sec = evs_target_sec + 0.5
        if is_chuchotage:
            # No clean audio feed — ambient noise directly degrades achievable EVS.
            noise_penalty = {"quiet": 0.0, "moderate": 0.4, "noisy": 0.9}.get(noise_level, 0.0)
            evs_target_sec += noise_penalty

        # WPM throughput target (Sight Translation only) — distinct from spoken-source
        # Pace tiers; protocol benchmark is ~60-65 WPM sustained (read-while-speak load).
        wpm_target = {1: 55.0, 2: 65.0, 3: 70.0, 4: 70.0}.get(pace, 65.0) if is_sight else 0.0

        # Pace label for prompt context
        pace_label = {1: "slow and deliberate (~80 WPM)", 2: "moderate (~110 WPM)",
                      3: "fast (~140 WPM)", 4: "rapid and pressured (~170 WPM)"}.get(pace, "moderate")

        # Difficulty characteristics (multi-dimensional — NOT just WPM)
        diff_profile = {
            "foundation":   "standard neutral accent, plain accessible register, no interruptions, short clear segments, generous pauses between ideas, minimal technical vocabulary",
            "beginner":     "standard neutral accent, plain accessible register, no interruptions, short clear segments, generous pauses between ideas, minimal technical vocabulary",
            "intermediate": "mild regional accent, moderate field-specific terminology, occasional overlapping question from another participant, medium-length segments, structured but dense",
            "advanced":     "strong accent or dialect, heavy field-specific jargon and abbreviations, frequent interruptions, emotionally charged content, compressed segments, formal register",
            "expert":       "maximum cognitive pressure — heavy accent, multiple overlapping voices, dense field jargon and statistics, no recovery time between segments, high emotional stakes, rapid speaker",
        }.get(difficulty, "moderate field terminology, mild accent")

        # Setting type note (from sub-type selector)
        setting_type_note = f"Setting type: {field_type}." if field_type else ""

        # Additional participant context
        extra_voice_note = ""
        if participants > 0:
            extra_voice_note = f"\n- There are {participants} additional participant(s) in the room who may interject, overlap, or challenge the speaker."

        atmosphere_note = ""
        if is_si and atmosphere != "booth":
            atmosphere_label = {
                "remote-stable": "remote (RSI) link, stable connection",
                "remote-intermittent": "remote (RSI) link with intermittent connection issues",
                "remote-poor": "remote (RSI) link with a poor, degraded connection",
            }.get(atmosphere, "")
            atmosphere_note = f"\n- Delivered over a {atmosphere_label} — the interpreter must mentally compensate for the remote-delivery context." if atmosphere_label else ""
        if is_chuchotage:
            noise_label = {"quiet": "a quiet room", "moderate": "a moderately noisy room with background chatter",
                            "noisy": "a loud, noisy environment competing directly with the speaker's voice"}.get(noise_level, "a quiet room")
            listener_note = "a single listener seated beside the interpreter" if listener_count <= 1 else f"{listener_count} listeners seated beside the interpreter"
            atmosphere_note = f"\n- Delivered in person, whispered close-proximity style, no booth/equipment, in {noise_label}, to {listener_note}."

        escort_note = ""
        if is_escort:
            scenario_label = {
                "business": "an informal business meeting (introductions, small talk, light negotiation)",
                "social": "a casual social setting (personal conversation, community event, family context)",
                "administrative": "a personal administrative errand (registering for a service, a routine appointment, paperwork)",
            }.get(scenario_type, "a casual two-way conversation")
            escort_note = f"\n- Setting: {scenario_label} — informal, low-stakes, conversational register; the interpreter may bridge a cultural reference but must not editorialize or advocate."

        doc_type_label = {
            "letter": "a personal or business letter",
            "form": "an intake/consent form excerpt",
            "contract-excerpt": "a short contract or agreement excerpt (plain clauses, not dense legalese)",
            "news": "a short news clipping",
        }.get(document_type, "a personal or business letter")
        doc_complexity = {
            "foundation": "plain, everyday language, short sentences, no specialized terms",
            "beginner": "plain, everyday language, short sentences, no specialized terms",
            "intermediate": "moderate formality, some field-specific terms, standard paragraph structure",
            "advanced": "denser register, technical or legal-adjacent terms, longer compound sentences",
            "expert": "dense, formal/legal-adjacent register, technical terminology, complex clause structure (still well short of true legalese)",
        }.get(difficulty, "moderate formality")

        mode_label = (
            "simultaneous (booth-style, live)" if is_si else
            "whispered simultaneous (chuchotage)" if is_chuchotage else
            "escort/liaison (informal, bidirectional)" if is_escort else
            "sight translation (written-input, oral-output)" if is_sight else
            "consecutive"
        )

        # Build speaker persona
        persona_prompt = f"""Create a realistic {provider_role} persona for a {mode_label} interpreting simulation.
Field: {field} | Setting: {field_type or field} | Topic: {topic} | Difficulty: {difficulty} | Protocol: {protocol}
Return JSON only:
{{
  "name": "realistic name for the role",
  "gender": "male|female",
  "accent_note": "brief note on speaking style (e.g., 'speaks rapidly with technical jargon')",
  "setting": "one sentence describing the room/context",
  "chief_statement": "one sentence: what is this speaker presenting/explaining?"
}}"""
        persona = extract_json(ask_claude(persona_prompt, 300))

        direction_note = "This is a one-directional session — the interpreter only renders into the target language." if is_one_way else ""

        if is_si:
            seg_prompt = f"""Write a {seg_words}-word excerpt of CONTINUOUS spoken delivery for a simultaneous interpreting (SI) exercise — booth-style, no built-in pause for recall.
Speaker: {persona.get('name','the speaker')} ({provider_role})
Topic: {topic} | Field: {field} | {setting_type_note} Pace: {pace_label}
Setting: {persona.get('setting','formal setting')} | Protocol: {protocol}
Language: {src}
Primary stress: {stress}
Difficulty profile: {diff_profile}
{direction_note}{extra_voice_note}{atmosphere_note}

Rules:
- This is SPOKEN language — natural sentence rhythm, not written prose
- Write it as an uninterrupted flow of speech, the way a live speaker continues talking without waiting for an interpreter
- Include specific details: numbers, names, dates, technical terms relevant to {field}
- Apply the difficulty profile exactly — accent style, interruption pattern, register, and terminology density must match
- Pace reflects {pace_label} — adjust sentence complexity and density accordingly
- No stage directions, no markdown, no asterisks — dialogue text only
- End mid-flow at a clause boundary, NOT a deliberate pause — the speaker is not waiting for the interpreter"""
        elif is_chuchotage:
            seg_prompt = f"""Write a {seg_words}-word excerpt of CONTINUOUS spoken delivery for a chuchotage (whispered simultaneous) interpreting exercise — no booth/equipment, the interpreter is physically beside the listener(s).
Speaker: {persona.get('name','the speaker')} ({provider_role})
Topic: {topic} | Field: {field} | {setting_type_note} Pace: {pace_label}
Setting: {persona.get('setting','formal setting')} | Protocol: {protocol}
Language: {src}
Primary stress: {stress}
Difficulty profile: {diff_profile}
{direction_note}{extra_voice_note}{atmosphere_note}

Rules:
- This is SPOKEN language — natural sentence rhythm, not written prose
- Write it as an uninterrupted flow of speech, the way a live speaker continues talking without waiting for an interpreter
- Include specific details: numbers, names, dates, technical terms relevant to {field}
- Apply the difficulty profile exactly, and reflect the ambient-noise/proximity conditions described above
- Pace reflects {pace_label} — adjust sentence complexity and density accordingly
- No stage directions, no markdown, no asterisks — dialogue text only
- End mid-flow at a clause boundary, NOT a deliberate pause — the speaker is not waiting for the interpreter"""
        elif is_escort:
            seg_prompt = f"""Write a {seg_words}-word short conversational utterance for an escort/liaison interpreting exercise — informal, two-way, low-stakes dialogue (NOT a formal monologue).
Speaker: {persona.get('name','the speaker')} ({provider_role})
Topic: {topic} | Field: {field} | {setting_type_note} Pace: {pace_label}
Setting: {persona.get('setting','an informal setting')} | Protocol: {protocol}
Language: {src}
Difficulty profile (kept conversational, never courtroom/clinical-dense): {diff_profile}
{direction_note}{extra_voice_note}{escort_note}

Rules:
- This is casual SPOKEN conversation — short, natural, everyday phrasing, not a prepared statement
- May include small talk, a cultural reference, or a friendly aside — this is the cultural-mediation skill being practiced
- Keep register informal/conversational — no dense terminology, no legal/medical jargon unless the scenario specifically calls for a light administrative term
- No stage directions, no markdown, no asterisks — dialogue text only
- End at a natural pause point where the other party would respond"""
        elif is_sight:
            seg_prompt = f"""Write a {seg_words}-word WRITTEN document excerpt for a sight translation exercise — this is {doc_type_label}, in {src}, that the interpreter will read silently/at a glance and then render orally in {tgt} (no audio source, no spoken delivery — this is a written text only).
Field: {field} | {setting_type_note} Document type: {document_type}
Register/complexity: {doc_complexity}
{direction_note}

Rules:
- This is WRITTEN prose in document/letter/form register — NOT spoken dialogue, no speech rhythm
- Format it the way the real document would read (e.g. a letter has a greeting/body/closing; a form excerpt has labeled fields; a contract excerpt has short numbered or titled clauses; a news clipping has a headline-style opening)
- Include specific details: names, dates, numbers, amounts, or addresses as appropriate to {document_type}
- Apply the register/complexity exactly as specified — do not drift into either plain-language or dense-legalese territory outside that band
- Keep it within professional guidance: a short, non-complex excerpt (≤~2 page equivalent) — NOT a long legally binding instrument
- No stage directions, no markdown formatting, no asterisks — plain document text only"""
        else:
            seg_prompt = f"""Write a {seg_words}-word spoken segment for a consecutive interpreting exercise.
Speaker: {persona.get('name','the speaker')} ({provider_role})
Topic: {topic} | Field: {field} | {setting_type_note} Pace: {pace_label}
Setting: {persona.get('setting','formal setting')} | Protocol: {protocol}
Language: {src}
Primary stress: {stress}
Difficulty profile: {diff_profile}
{direction_note}{extra_voice_note}

Rules:
- This is SPOKEN language — natural sentence rhythm, not written prose
- Include specific details: numbers, names, dates, technical terms relevant to {field}
- Apply the difficulty profile exactly — accent style, interruption pattern, register, and terminology density must match
- Pace reflects {pace_label} — adjust sentence complexity and density accordingly
- No stage directions, no markdown, no asterisks — dialogue text only
- End at a natural pause point where an interpreter would render"""

        segment_text = ask_claude(seg_prompt, 500)

        # TTS for the segment — skipped entirely for Sight Translation, which has no
        # spoken source: the interpreter reads the written document text directly.
        audio_b64 = ""
        if not is_sight:
            el_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
            seg_clean = _clean_for_tts(segment_text)
            is_arabic_src = bool(re.search(r'[؀-ۿ]', seg_clean))
            voice_id = ELEVENLABS_VOICE_ID  # default; gender selection can be added later

            audio_chunks = el_client.text_to_speech.convert(
                voice_id=voice_id,
                text=seg_clean,
                model_id="eleven_turbo_v2_5" if is_arabic_src else "eleven_turbo_v2",
            )
            audio_bytes = b"".join(audio_chunks)
            audio_b64 = base64.b64encode(audio_bytes).decode()

        # Store session
        ci_sessions[sid] = {
            "field": field,
            "src": src,
            "tgt": tgt,
            "difficulty": difficulty,
            "pace": pace,
            "participants": participants,
            "one_way": is_one_way,
            "max_segments": segments,
            "persona": persona,
            "provider_role": provider_role,
            "topic": topic,
            "seg_words": seg_words,
            "setting_data": setting_data,
            "protocol": protocol,
            "mode": mode,
            "verbatim": is_verbatim,
            "atmosphere": atmosphere,
            "evs_target_sec": evs_target_sec,
            "listener_count": listener_count,
            "noise_level": noise_level,
            "scenario_type": scenario_type,
            "document_type": document_type,
            "sight_mode": sight_mode,
            "wpm_target": wpm_target,
            "pairs": [],          # {segment_text, interpreter_text, segment_num, decalage_sec}
            "segments_done": 0,
            "started": datetime.now().isoformat(),
        }

        return JSONResponse({
            "session_id": sid,
            "persona": persona,
            "provider_role": provider_role,
            "topic": topic,
            "field": field,
            "language": language,
            "difficulty": difficulty,
            "max_segments": segments,
            "segment_num": 1,
            "segment_text": segment_text,
            "document_text": segment_text if is_sight else "",
            "audio_b64": audio_b64,
            "mode": mode,
            "atmosphere": atmosphere,
            "evs_target_sec": evs_target_sec,
            "listener_count": listener_count,
            "noise_level": noise_level,
            "scenario_type": scenario_type,
            "document_type": document_type,
            "sight_mode": sight_mode,
            "wpm_target": wpm_target,
            "seg_words": seg_words,
        })

    except Exception as e:
        import traceback
        return JSONResponse({"error": str(e), "detail": traceback.format_exc()}, status_code=500)


@router.post("/api/ci/get-segment")
async def ci_get_segment(session_id: str = Form(...)):
    """
    Generate the next speaker segment for an active CI session.
    Called after the interpreter has submitted their rendition for the previous segment.
    """
    try:
        from elevenlabs import ElevenLabs

        sess = ci_sessions.get(session_id)
        if not sess:
            return JSONResponse({"error": "Session not found"}, status_code=404)

        seg_num = sess["segments_done"] + 1
        if seg_num > sess["max_segments"]:
            return JSONResponse({"done": True, "message": "All segments completed."})

        persona = sess["persona"]
        field = sess["field"]
        topic = sess["topic"]
        difficulty = sess["difficulty"]
        src = sess["src"]
        seg_words = sess["seg_words"]

        # Build context from previous pairs to keep the narrative coherent
        prev_context = ""
        if sess["pairs"]:
            last_segs = sess["pairs"][-2:]
            prev_lines = ["Segment " + str(p["segment_num"]) + ": " + p["segment_text"][:120] + "..." for p in last_segs]
            prev_context = "Previous segments covered:\n" + "\n".join(prev_lines)

        mode = sess.get("mode", "consecutive").strip().lower()
        is_si = mode == "simultaneous"
        is_chuchotage = mode == "chuchotage"
        is_escort = mode == "escort"
        is_sight = mode == "sight"
        is_legal_verbatim = mode in ("legal_verbatim", "legal")
        atmosphere = sess.get("atmosphere", "booth")
        atmosphere_note = ""
        if is_si and atmosphere != "booth":
            atmosphere_label = {
                "remote-stable": "remote (RSI) link, stable connection",
                "remote-intermittent": "remote (RSI) link with intermittent connection issues",
                "remote-poor": "remote (RSI) link with a poor, degraded connection",
            }.get(atmosphere, "")
            atmosphere_note = f"\n- Delivered over a {atmosphere_label}." if atmosphere_label else ""
        if is_chuchotage:
            noise_level = sess.get("noise_level", "quiet")
            listener_count = sess.get("listener_count", 1)
            noise_label = {"quiet": "a quiet room", "moderate": "a moderately noisy room with background chatter",
                            "noisy": "a loud, noisy environment"}.get(noise_level, "a quiet room")
            atmosphere_note = f"\n- Delivered in person, whispered close-proximity, no booth/equipment, in {noise_label}, to {listener_count} listener(s)."
        escort_note = ""
        if is_escort:
            scenario_label = {
                "business": "an informal business meeting",
                "social": "a casual social setting",
                "administrative": "a personal administrative errand",
            }.get(sess.get("scenario_type", ""), "a casual two-way conversation")
            escort_note = f"\n- Setting: {scenario_label} — keep it informal and conversational."
        doc_type_label = ""
        doc_complexity = ""
        if is_sight:
            doc_type_label = {
                "letter": "a personal or business letter",
                "form": "an intake/consent form excerpt",
                "contract-excerpt": "a short contract or agreement excerpt (plain clauses, not dense legalese)",
                "news": "a short news clipping",
            }.get(sess.get("document_type", "letter"), "a personal or business letter")
            doc_complexity = {
                "foundation": "plain, everyday language, short sentences, no specialized terms",
                "beginner": "plain, everyday language, short sentences, no specialized terms",
                "intermediate": "moderate formality, some field-specific terms, standard paragraph structure",
                "advanced": "denser register, technical or legal-adjacent terms, longer compound sentences",
                "expert": "dense, formal/legal-adjacent register, technical terminology, complex clause structure (still well short of true legalese)",
            }.get(difficulty, "moderate formality")

        if is_si:
            seg_prompt = f"""Continue this SI (simultaneous interpreting) simulation — booth-style, continuous live speech with no built-in pause for recall. Write segment {seg_num} of {sess['max_segments']} (~{seg_words} words).
Speaker: {persona.get('name','the speaker')} ({sess['provider_role']})
Topic: {topic} | Field: {field} | Difficulty: {difficulty} | Language: {src}
{prev_context}{atmosphere_note}

Rules:
- Continue naturally from where the previous segment left off, as an uninterrupted flow of live speech
- This segment should add new information (do not repeat what was said)
- Include specific details: numbers, dates, technical terms, proper nouns
- Spoken language only — no stage directions, no markdown
- End mid-flow at a clause boundary, NOT a deliberate pause — the speaker keeps going without waiting for the interpreter"""
        elif is_chuchotage:
            seg_prompt = f"""Continue this chuchotage (whispered simultaneous) interpreting simulation — no booth/equipment, continuous live speech with no built-in pause for recall. Write segment {seg_num} of {sess['max_segments']} (~{seg_words} words).
Speaker: {persona.get('name','the speaker')} ({sess['provider_role']})
Topic: {topic} | Field: {field} | Difficulty: {difficulty} | Language: {src}
{prev_context}{atmosphere_note}

Rules:
- Continue naturally from where the previous segment left off, as an uninterrupted flow of live speech
- This segment should add new information (do not repeat what was said)
- Include specific details: numbers, dates, technical terms, proper nouns
- Spoken language only — no stage directions, no markdown
- End mid-flow at a clause boundary, NOT a deliberate pause — the speaker keeps going without waiting for the interpreter"""
        elif is_escort:
            seg_prompt = f"""Continue this escort/liaison interpreting simulation — short, informal, two-way conversational exchange (NOT a formal monologue). Write the next utterance, segment {seg_num} of {sess['max_segments']} (~{seg_words} words).
Speaker: {persona.get('name','the speaker')} ({sess['provider_role']})
Topic: {topic} | Field: {field} | Language: {src}
{prev_context}{escort_note}

Rules:
- Continue naturally as casual spoken conversation, short and informal
- This turn should add new information or a natural follow-up (do not repeat what was said)
- Keep register conversational — no dense terminology unless the scenario specifically calls for a light administrative term
- Spoken language only — no stage directions, no markdown
- End at a natural pause point where the other party would respond"""
        elif is_sight:
            seg_prompt = f"""Continue this WRITTEN document for a sight translation exercise — this is {doc_type_label}, in {src} (no audio source, no spoken delivery — written text only). Write the next part of the document, segment {seg_num} of {sess['max_segments']} (~{seg_words} words).
Field: {field} | Document type: {sess.get('document_type','letter')}
Register/complexity: {doc_complexity}
{prev_context}

Rules:
- Continue naturally from where the previous excerpt left off, as written document prose (NOT spoken dialogue, no speech rhythm)
- This segment should add new information (do not repeat what was said) and stay consistent with the document type's natural structure
- Include specific details: names, dates, numbers, amounts, or addresses as appropriate
- Apply the register/complexity exactly as specified — do not drift into either plain-language or dense-legalese territory outside that band
- No stage directions, no markdown formatting, no asterisks — plain document text only
- End at a natural breakpoint (end of a clause, sentence, or labeled section)"""
        else:
            seg_prompt = f"""Continue this CI simulation. Write segment {seg_num} of {sess['max_segments']} (~{seg_words} words).
Speaker: {persona.get('name','the speaker')} ({sess['provider_role']})
Topic: {topic} | Field: {field} | Difficulty: {difficulty} | Language: {src}
{prev_context}

Rules:
- Continue naturally from where the previous segment left off
- This segment should add new information (do not repeat what was said)
- Include specific details: numbers, dates, technical terms, proper nouns
- Spoken language only — no stage directions, no markdown
- End at a natural pause point"""

        segment_text = ask_claude(seg_prompt, 500)

        # TTS is skipped entirely for Sight Translation — no spoken source; the
        # interpreter reads the written document text directly off-screen.
        audio_b64 = ""
        if not is_sight:
            el_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
            seg_clean = _clean_for_tts(segment_text)
            is_arabic_src = bool(re.search(r'[؀-ۿ]', seg_clean))

            audio_chunks = el_client.text_to_speech.convert(
                voice_id=ELEVENLABS_VOICE_ID,
                text=seg_clean,
                model_id="eleven_turbo_v2_5" if is_arabic_src else "eleven_turbo_v2",
            )
            audio_bytes = b"".join(audio_chunks)
            audio_b64 = base64.b64encode(audio_bytes).decode()

        return JSONResponse({
            "session_id": session_id,
            "segment_num": seg_num,
            "segment_text": segment_text,
            "document_text": segment_text if is_sight else "",
            "audio_b64": audio_b64,
            "done": False,
        })

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/api/ci/submit-turn")
async def ci_submit_turn(
    session_id:       str   = Form(...),
    segment_num:      int   = Form(...),
    segment_text:     str   = Form(...),
    interpreter_text: str   = Form(...),
    decalage_sec:     float = Form(0),
    turn_taking_latency_sec: float = Form(0),
):
    """
    Record the interpreter's rendition for a given segment.
    Does NOT evaluate — evaluation happens at end-session for the full picture.
    Returns acknowledgement and whether more segments remain.

    decalage_sec (SI only): client-measured Ear-Voice Span for this segment —
    elapsed time from segment-audio-start to rendition-submit. Ignored for CI.
    turn_taking_latency_sec (CI only): client-measured pause between speaker finish
    and interpreter start for this segment. Ignored for SI.
    """
    sess = ci_sessions.get(session_id)
    if not sess:
        return JSONResponse({"error": "Session not found"}, status_code=404)

    sess["pairs"].append({
        "segment_num": segment_num,
        "segment_text": segment_text,
        "interpreter_text": interpreter_text,
        "decalage_sec": decalage_sec,
        "turn_taking_latency_sec": turn_taking_latency_sec,
    })
    sess["segments_done"] += 1

    more = sess["segments_done"] < sess["max_segments"]
    return JSONResponse({"acknowledged": True, "more_segments": more})


@router.post("/api/ci/end-session")
async def ci_end_session(session_id: str = Form(...)):
    """
    End the CI session and run full AIIC-adapted evaluation.
    Returns all KPIs including CI-specific: memory_accuracy, segment_handling.
    """
    sess = ci_sessions.pop(session_id, None)
    if not sess:
        return JSONResponse({
            "overall_score": 0, "accuracy": 0, "fusha_compliance": 0,
            "completeness": 0, "terminology": 0, "fluency": 0,
            "professional_protocol": 0, "register_preservation": 0,
            "memory_accuracy": 0, "segment_handling": 0,
            "turn_taking_latency_avg_sec": 0, "turn_taking_latency_score": 0,
            "grade": "Incomplete", "summary": "Session ended before any segments were submitted.",
            "strengths": [], "coaching_tips": [], "next_drill": "",
            "segment_evaluations": [],
        })

    pairs = sess.get("pairs", [])
    if not pairs:
        return JSONResponse({
            "overall_score": 0, "accuracy": 0, "fusha_compliance": 0,
            "completeness": 0, "terminology": 0, "fluency": 0,
            "professional_protocol": 0, "register_preservation": 0,
            "memory_accuracy": 0, "segment_handling": 0,
            "turn_taking_latency_avg_sec": 0, "turn_taking_latency_score": 0,
            "grade": "Incomplete", "summary": "No segments were submitted.",
            "strengths": [], "coaching_tips": [], "next_drill": "",
            "segment_evaluations": [],
        })

    pairs_text = "\n\n".join(
        f"Segment {p['segment_num']}:\nSOURCE ({sess['src']}): {p['segment_text']}\nINTERPRETER ({sess['tgt']}): {p['interpreter_text']}"
        for p in pairs[:8]
    )

    # CI turn-taking latency aggregation
    latency_samples = [p.get("turn_taking_latency_sec", 0) for p in pairs if p.get("turn_taking_latency_sec", 0) > 0]
    turn_taking_latency_avg_sec = round(sum(latency_samples) / len(latency_samples), 2) if latency_samples else 0
    if latency_samples:
        # Score 100 at ≤2s target, decaying as latency grows
        avg_latency = turn_taking_latency_avg_sec
        if avg_latency <= 2.0:
            turn_taking_latency_score = round(100 - (avg_latency / 2.0) * 10)
        elif avg_latency <= 5.0:
            turn_taking_latency_score = round(90 - (avg_latency - 2.0) * 15)
        else:
            turn_taking_latency_score = max(0, round(45 - (avg_latency - 5.0) * 10))
    else:
        turn_taking_latency_score = None

    persona = sess.get("persona", {})
    sess_mode = sess.get("mode", "consecutive").strip().lower()
    is_si = sess_mode == "simultaneous"
    is_chuchotage = sess_mode == "chuchotage"
    is_escort = sess_mode == "escort"
    is_sight = sess_mode == "sight"
    is_legal_verbatim = sess_mode in ("legal_verbatim", "legal") or sess.get("verbatim", False)
    atmosphere = sess.get("atmosphere", "booth")

    if is_si or is_chuchotage:
        # Programmatic décalage scoring — real client timestamps, not LLM judgment.
        evs_target = sess.get("evs_target_sec", 3.0)
        decalage_samples = [p.get("decalage_sec", 0) for p in pairs if p.get("decalage_sec", 0) > 0]
        decalage_avg_sec = round(sum(decalage_samples) / len(decalage_samples), 2) if decalage_samples else 0
        if decalage_samples:
            # Score 100 at/under target, decaying as actual lag exceeds target.
            # Also penalize implausibly-fast (<0.5x target) renditions as likely skimming/guessing.
            ratio = decalage_avg_sec / evs_target if evs_target else 1
            if ratio < 0.5:
                decalage_control_score = max(40, round(100 - (0.5 - ratio) * 120))
            elif ratio <= 1.0:
                decalage_control_score = round(100 - (1.0 - ratio) * 10)
            else:
                decalage_control_score = max(0, round(100 - (ratio - 1.0) * 60))
        else:
            decalage_control_score = None  # no timing data captured — let the LLM estimate instead

        atmosphere_line = ""
        if atmosphere != "booth":
            atmosphere_label = {
                "remote-stable": "remote (RSI), stable connection",
                "remote-intermittent": "remote (RSI), intermittent connection issues",
                "remote-poor": "remote (RSI), poor/degraded connection",
            }.get(atmosphere, atmosphere)
            atmosphere_line = f"Atmosphere: {atmosphere_label} — factor connection-quality resilience into fluency/professional_protocol.\n"

        decalage_line = (
            f"Measured average Ear-Voice Span (décalage): {decalage_avg_sec}s against a target of {evs_target}s for this pace/difficulty. "
            f"Use this measured value as ground truth for live_fluency context — do not re-estimate timing yourself."
            if decalage_samples else
            "No timing data was captured for this session — estimate live_fluency from rendition quality and density alone."
        )

        noise_line = ""
        second_kpi_name = "live_fluency"
        second_kpi_desc = "Composure and delivery smoothness specifically under the no-replay, continuous-speech constraint of SI (distinct from the general fluency dimension above, which also covers register/pace fit)."
        volume_discipline_rubric = ""
        volume_discipline_json = ""
        mode_title = "SIMULTANEOUS INTERPRETATION (SI/booth)"
        if is_chuchotage:
            mode_title = "CHUCHOTAGE (whispered simultaneous)"
            noise_label = {"quiet": "a quiet room", "moderate": "a moderately noisy room", "noisy": "a loud, noisy environment"}.get(sess.get("noise_level", "quiet"), "a quiet room")
            noise_line = f"Delivered whispered, in-person, no booth/equipment, in {noise_label}, to {sess.get('listener_count', 1)} listener(s) — factor volume discipline and noise resilience.\n"
            second_kpi_name = "volume_noise_discipline"
            second_kpi_desc = "Noise resilience (tracking the source despite ambient noise/no audio isolation)."
            volume_discipline_rubric = "• volume_discipline (0-100): Whispered delivery at a controlled, listener-appropriate volume — audible to the immediate listener(s) without disturbing others nearby. Penalize excessive volume (loud whisper) or inaudible whispering.\n"
            volume_discipline_json = '  "volume_discipline": <volume_discipline 0-100 — see mode-specific KPIs above>,\n'

        result = extract_json(ask_claude(f"""You are a certified AIIC-standard evaluator for {mode_title}. Assess this session rigorously.

SESSION METADATA
Field: {sess['field']} | Language pair: {sess['src']} → {sess['tgt']}
Setting: {persona.get('setting', sess['field'])} | Speaker: {sess['provider_role']}
Topic: {sess['topic']} | Difficulty: {sess['difficulty']} | Segments: {len(pairs)}
{atmosphere_line}{noise_line}{decalage_line}

SCORING RUBRIC — live/simultaneous-family interpretation specific (0-100 each):
• accuracy (25%): Exact meaning preserved under live cognitive load — no distortions, embellishments, or additions not in source. Weighted higher than CI since there is no recall buffer.
• fusha_compliance (15%): Arabic output in Modern Standard Arabic / Fusha only. Penalize dialect, slang, code-switching. N/A → 100 for non-Arabic output.
• completeness (20%): Elements of source preserved despite continuous-speech pressure. Strategic, minor condensing of redundant content is acceptable; unintentional drops of substantive content are not. Classify each omission as Strategic (deliberate, for clarity — less penalty) or Unintentional (missed content — full penalty).
• terminology (15%): Correct domain-specific terms for {sess['field']} produced in real time.
• fluency (10%): Output fluency UNDER COGNITIVE LOAD — smoothness, lack of false starts/self-correction churn, ability to keep pace with continuous source. Weighted higher than CI since there's no stop-and-recover.
• professional_protocol (5%): Role boundaries, impartiality, no editorializing.
• register_preservation (10%): Maintained appropriate formal register for the SI booth setting — no drift into casual or conversational register in formal contexts.

MODE-SPECIFIC KPIs (0-100 each, do NOT include in overall_score calculation):
• decalage_control: Ear-Voice Span discipline — staying within the target lag window for this pace/difficulty (use the measured décalage above as ground truth when provided).
• {second_kpi_name}: {second_kpi_desc}
{volume_discipline_rubric}
overall_score = 0.25×accuracy + 0.15×fusha_compliance + 0.20×completeness + 0.15×terminology + 0.10×fluency + 0.05×professional_protocol + 0.10×register_preservation

SEGMENTS TO EVALUATE:
{pairs_text}

Return JSON ONLY:
{{
  "overall_score": <0-100 weighted>,
  "accuracy": <0-100>,
  "fusha_compliance": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "memory_accuracy": <decalage_control 0-100 — see SI-specific KPIs above>,
  "segment_handling": <{second_kpi_name} 0-100 — see SI-specific KPIs above>,
{volume_discipline_json}  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "summary": "Exactly 2 sentences — specific findings for simultaneous interpreting.",
  "strengths": ["one concrete observed SI strength"],
  "coaching_tips": ["one specific actionable SI improvement"],
  "next_drill": "One concrete SI exercise targeting the weakest area",
  "segment_evaluations": [
    {{
      "segment_num": 1,
      "source_text": "first 50 chars of source...",
      "interpreter_said": "first 50 chars of rendition...",
      "ideal_rendition": "model rendition in {sess['tgt']} — max 30 words",
      "verdict": "accurate|acceptable|omission|addition|distortion|dialect_intrusion|incomplete",
      "omission_type": "strategic|unintentional|none",
      "memory_items_hit": "numbers/names/dates correctly recalled — empty if none",
      "memory_items_missed": "specific items dropped — empty if none",
      "note": "one actionable observation — max 20 words"
    }}
  ]
}}

Grade thresholds: A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60.""", 2500))

        # Override the LLM's decalage_control guess with the programmatically measured score
        # whenever real timing samples exist — timestamps are ground truth, not a judgment call.
        if decalage_control_score is not None:
            result["memory_accuracy"] = decalage_control_score
        result["decalage_avg_sec"] = decalage_avg_sec
        result["evs_target_sec"] = evs_target
        result["mode"] = sess_mode
        result["atmosphere"] = atmosphere
        if is_chuchotage:
            result["noise_level"] = sess.get("noise_level", "quiet")
            result["listener_count"] = sess.get("listener_count", 1)
            result["kpi_labels"] = {"memory_accuracy": "Décalage Control", "segment_handling": "Noise Resilience", "volume_discipline": "Volume Discipline"}
        else:
            result["kpi_labels"] = {"memory_accuracy": "Décalage Control", "segment_handling": "Live Fluency"}

    elif is_escort:
        scenario_label = {"business": "a business meeting", "social": "an informal social setting", "administrative": "an administrative/appointment setting"}.get(sess.get("scenario_type", ""), "an informal liaison setting")
        result = extract_json(ask_claude(f"""You are a certified evaluator for ESCORT/LIAISON INTERPRETATION — informal, bidirectional, conversational interpreting in {scenario_label}. Assess this session rigorously, but calibrated to this mode's relaxed register and conversational pace (do NOT penalize informality, contractions, or conversational fillers the way you would in CI/SI).

SESSION METADATA
Field: {sess['field']} | Language pair: {sess['src']} → {sess['tgt']}
Setting: {persona.get('setting', sess['field'])} | Speaker: {sess['provider_role']}
Topic: {sess['topic']} | Difficulty: {sess['difficulty']} | Segments: {len(pairs)} | Scenario: {scenario_label}

ESCORT/LIAISON SCORING RUBRIC — informal bidirectional interpretation specific (0-100 each):
• accuracy (25%): Meaning preserved across both directions of the exchange — no distortions or unauthorized additions.
• fusha_compliance (5%): For Arabic output, prefer clear standard register; light informal register is acceptable in this mode and should NOT be penalized as "dialect" unless it becomes genuinely unclear or unprofessional.
• completeness (20%): Substantive content carried across in both directions — minor conversational small talk may be condensed without penalty. Classify each omission as Strategic (deliberate, for clarity — less penalty) or Unintentional (missed content — full penalty).
• terminology (10%): Domain terms for {sess['field']} handled correctly when they come up — informal settings rarely require deep technical terminology.
• fluency (15%): Natural, conversational delivery that doesn't feel stilted or overly formal for the setting — turn-taking handled smoothly in both directions.
• professional_protocol (15%): Role boundaries maintained while still being warm and approachable — no unsanctioned advocacy or editorializing beyond appropriate cultural mediation.
• register_preservation (15%): Matched the informal register of the setting — appropriately conversational, warm, and accessible without becoming unprofessional or overly stiff.

ESCORT-SPECIFIC KPIs (0-100 each, do NOT include in overall_score calculation):
• cultural_mediation: Did the interpreter appropriately bridge cultural context/expectations between parties when needed (e.g. flagging a cultural norm, softening a literal phrase) WITHOUT crossing into unsanctioned advocacy, editorializing, or speaking for either party beyond the role?
• conversational_naturalness: Did the rendition sound like natural conversation rather than a formal interpreted monologue — appropriate informality, tone-matching, and easy bidirectional turn-taking?

overall_score = 0.25×accuracy + 0.05×fusha_compliance + 0.20×completeness + 0.10×terminology + 0.15×fluency + 0.15×professional_protocol + 0.15×register_preservation

SEGMENTS TO EVALUATE:
{pairs_text}

Return JSON ONLY:
{{
  "overall_score": <0-100 weighted>,
  "accuracy": <0-100>,
  "fusha_compliance": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "memory_accuracy": <0-100, this is the cultural_mediation score>,
  "segment_handling": <0-100, this is the conversational_naturalness score>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "summary": "Exactly 2 sentences — specific findings for escort/liaison interpreting.",
  "strengths": ["one concrete observed escort/liaison strength"],
  "coaching_tips": ["one specific actionable escort/liaison improvement"],
  "next_drill": "One concrete escort/liaison exercise targeting the weakest area",
  "segment_evaluations": [
    {{
      "segment_num": 1,
      "source_text": "first 50 chars of source...",
      "interpreter_said": "first 50 chars of rendition...",
      "ideal_rendition": "model rendition in {sess['tgt']} — max 30 words",
      "verdict": "accurate|acceptable|omission|addition|distortion|dialect_intrusion|incomplete",
      "omission_type": "strategic|unintentional|none",
      "memory_items_hit": "cultural-mediation moments handled well — empty if none",
      "memory_items_missed": "cultural-mediation or naturalness misses — empty if none",
      "note": "one actionable observation — max 20 words"
    }}
  ]
}}

Grade thresholds: A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60.""", 2500))
        result["mode"] = "escort"
        result["scenario_type"] = sess.get("scenario_type", "")
        result["kpi_labels"] = {"memory_accuracy": "Cultural Mediation", "segment_handling": "Conversational Naturalness"}

    elif is_sight:
        # Programmatic WPM throughput scoring — real client-measured read times
        # (sent as decalage_sec, reused from the SI/Chuchotage EVS field), not LLM judgment.
        wpm_target = sess.get("wpm_target", 62.0)
        wpm_samples = []
        for p in pairs:
            read_sec = p.get("decalage_sec", 0)
            words = len((p.get("interpreter_text") or "").split())
            if read_sec > 0 and words > 0:
                wpm_samples.append(words / (read_sec / 60.0))
        wpm_avg = round(sum(wpm_samples) / len(wpm_samples), 1) if wpm_samples else None
        if wpm_avg is not None:
            # Score 100 at/near target; penalize both rushed (well over target, risking
            # accuracy/register loss) and too-slow (well under target, losing flow) delivery.
            ratio = wpm_avg / wpm_target if wpm_target else 1
            if ratio < 1.0:
                wpm_score = max(30, round(100 - (1.0 - ratio) * 90))
            else:
                wpm_score = max(30, round(100 - (ratio - 1.0) * 70))
        else:
            wpm_score = None  # no timing data captured — let the LLM estimate delivery alone

        wpm_line = (
            f"Measured average WPM throughput: {wpm_avg} against a target of ~{wpm_target} WPM (protocol benchmark 60-70 WPM sustained, read-while-speak load). "
            f"Use this measured value as ground truth for wpm_throughput — do not re-estimate timing yourself."
            if wpm_avg is not None else
            "No timing data was captured for this session — estimate wpm_throughput from rendition pacing and density alone."
        )
        doc_type_label = {
            "letter": "a personal or business letter", "form": "an intake/consent form excerpt",
            "contract-excerpt": "a short contract or agreement excerpt", "news": "a short news clipping",
        }.get(sess.get("document_type", "letter"), "a personal or business letter")

        result = extract_json(ask_claude(f"""You are a certified evaluator for SIGHT TRANSLATION — written-input, oral-output interpreting. Assess this session rigorously, using the strictest register/genre-convention standard (court-style sight translation expectations), since the source is a written, citable document rather than transient speech.

SESSION METADATA
Field: {sess['field']} | Language pair: {sess['src']} → {sess['tgt']}
Document type: {doc_type_label} | Difficulty: {sess['difficulty']} | Segments: {len(pairs)}
{wpm_line}

SIGHT TRANSLATION SCORING RUBRIC (0-100 each):
• accuracy (25%): Exact meaning of the written text preserved — no distortions, embellishments, or additions not in the document.
• fusha_compliance (10%): For Arabic output, Modern Standard Arabic / Fusha only, matching the written register. N/A → 100 for non-Arabic output.
• completeness (20%): ALL elements of the written document rendered — numbers, dates, names, clause structure. Omissions are penalized heavily, as with a citable document. Classify each omission as Strategic (deliberate, for clarity — less penalty) or Unintentional (missed content — full penalty).
• terminology (10%): Correct domain/register-specific terms and document conventions (e.g. legal/contractual phrasing, form-field structure) reproduced faithfully.
• fluency (15%): Smooth oral delivery despite the read-while-speak cognitive load — minimal false starts, backtracking, or stumbling while scanning ahead.
• professional_protocol (10%): Faithful, neutral rendering of the document's register — no softening, modernizing, or informalizing a formal/legal text, and no inserted commentary.
• register_preservation (20%): Reproduced the written register of the document faithfully — formal documents must sound formal, legal language must preserve its precision, and no drift into spoken or casual register.

SIGHT-TRANSLATION-SPECIFIC KPIs (0-100 each, do NOT include in overall_score calculation):
• wpm_throughput: Sustained reading-while-speaking pace against the 60-70 WPM protocol benchmark (use the measured value above as ground truth when provided) — distinct from spoken-source Pace, since this reflects read-aloud throughput under cognitive load.
• delivery: Public-speaking delivery quality — voice projection, confident pacing, eye-contact-equivalent composure, and avoidance of a flat/monotone read-through. This is the most commonly failed criterion in sight translation training assessments.

overall_score = 0.25×accuracy + 0.10×fusha_compliance + 0.20×completeness + 0.10×terminology + 0.15×fluency + 0.10×professional_protocol + 0.20×register_preservation

SEGMENTS TO EVALUATE:
{pairs_text}

Return JSON ONLY:
{{
  "overall_score": <0-100 weighted>,
  "accuracy": <0-100>,
  "fusha_compliance": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "memory_accuracy": <wpm_throughput 0-100 — see sight-translation-specific KPIs above>,
  "segment_handling": <delivery 0-100 — see sight-translation-specific KPIs above>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "summary": "Exactly 2 sentences — specific findings for sight translation.",
  "strengths": ["one concrete observed sight translation strength"],
  "coaching_tips": ["one specific actionable sight translation improvement"],
  "next_drill": "One concrete sight translation exercise targeting the weakest area",
  "segment_evaluations": [
    {{
      "segment_num": 1,
      "source_text": "first 50 chars of source document...",
      "interpreter_said": "first 50 chars of rendition...",
      "ideal_rendition": "model rendition in {sess['tgt']} — max 30 words",
      "verdict": "accurate|acceptable|omission|addition|distortion|dialect_intrusion|incomplete",
      "omission_type": "strategic|unintentional|none",
      "memory_items_hit": "details correctly rendered — empty if none",
      "memory_items_missed": "specific items dropped — empty if none",
      "note": "one actionable observation — max 20 words"
    }}
  ]
}}

Grade thresholds: A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60.""", 2500))

        if wpm_score is not None:
            result["memory_accuracy"] = wpm_score
        result["wpm_avg"] = wpm_avg
        result["wpm_target"] = wpm_target
        result["mode"] = "sight"
        result["document_type"] = sess.get("document_type", "letter")
        result["kpi_labels"] = {"memory_accuracy": "WPM Throughput", "segment_handling": "Public-Speaking Delivery"}

    elif is_legal_verbatim:
        result = extract_json(ask_claude(f"""You are a certified evaluator for LEGAL VERBATIM INTERPRETATION — strict accuracy mode for legal interpreting with exact wording requirements. Assess this session with extreme rigor; even minor deviations from the source register or wording are penalized.

SESSION METADATA
Field: {sess['field']} | Language pair: {sess['src']} → {sess['tgt']}
Setting: {persona.get('setting', sess['field'])} | Speaker: {sess['provider_role']}
Topic: {sess['topic']} | Difficulty: {sess['difficulty']} | Segments: {len(pairs)}

LEGAL VERBATIM SCORING RUBRIC (0-100 each):
• accuracy (30%): Exact meaning AND wording preserved — no paraphrasing, no summarization, no embellishments. Every factual and legal element preserved with maximal fidelity.
• fusha_compliance (15%): Arabic output in Modern Standard Arabic / Fusha only. Legal register must be precise and authoritative. N/A → 100 for non-Arabic output.
• completeness (25%): ALL elements of the source present — numbers, dates, names, clauses, legal formulae. ZERO omissions tolerated. Classify each omission as Strategic (deliberate, for clarity — still heavily penalized) or Unintentional (missed content — full penalty).
• terminology (15%): Correct legal terminology reproduced exactly. Every term must match the source's legal precision and convention.
• fluency (5%): Delivery must be clear but NOT at the expense of accuracy. Hesitations are acceptable if they preserve exact wording; false starts that change meaning are penalized severely.
• professional_protocol (10%): Strict impartiality, no editorializing, no cultural mediation, no softening of legal language. The interpreter is a transparent conduit.
• register_preservation (25%): Strict adherence to the legal register of the source — formal, precise, and authoritative. No drift into casual, simplified, or explanatory language. Exact register reproduction is paramount.

LEGAL VERBATIM-SPECIFIC KPIs (0-100 each, do NOT include in overall_score calculation):
• verbatim_accuracy: Exact wording preservation — did the interpreter reproduce the source's phrasing, structure, and legal formulae as closely as possible without paraphrasing?
• register_preservation: Strict register adherence — did the interpreter maintain the exact legal register and tone without simplification or modernization?

overall_score = 0.30×accuracy + 0.15×fusha_compliance + 0.25×completeness + 0.15×terminology + 0.05×fluency + 0.10×professional_protocol + 0.25×register_preservation

SEGMENTS TO EVALUATE:
{pairs_text}

Return JSON ONLY:
{{
  "overall_score": <0-100 weighted>,
  "accuracy": <0-100>,
  "fusha_compliance": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "memory_accuracy": <verbatim_accuracy 0-100 — see legal-verbatim-specific KPIs above>,
  "segment_handling": <register_preservation 0-100 — see legal-verbatim-specific KPIs above>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "summary": "Exactly 2 sentences — specific findings for legal verbatim interpreting.",
  "strengths": ["one concrete observed legal verbatim strength"],
  "coaching_tips": ["one specific actionable legal verbatim improvement"],
  "next_drill": "One concrete legal verbatim exercise targeting the weakest area",
  "segment_evaluations": [
    {{
      "segment_num": 1,
      "source_text": "first 50 chars of source...",
      "interpreter_said": "first 50 chars of rendition...",
      "ideal_rendition": "model rendition in {sess['tgt']} — max 30 words",
      "verdict": "accurate|acceptable|omission|addition|distortion|dialect_intrusion|incomplete",
      "omission_type": "strategic|unintentional|none",
      "memory_items_hit": "numbers/names/dates correctly recalled — empty if none",
      "memory_items_missed": "specific items dropped — empty if none",
      "note": "one actionable observation — max 20 words"
    }}
  ]
}}

Grade thresholds: A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60.""", 2500))
        result["mode"] = "legal_verbatim"
        result["kpi_labels"] = {"memory_accuracy": "Verbatim Accuracy", "segment_handling": "Register Preservation"}

    else:
        # Turn-taking latency line for CI session metadata
        latency_line = (
            f"Measured average turn-taking latency: {turn_taking_latency_avg_sec}s (pause between speaker finish and interpreter start). "
            f"Target: ≤2s. Use this as ground truth for turn_taking_latency scoring."
            if latency_samples else
            "No turn-taking latency data captured — estimate timing discipline from segment handling alone."
        )

        result = extract_json(ask_claude(f"""You are a certified AIIC-standard evaluator for CONSECUTIVE INTERPRETATION. Assess this session rigorously.

SESSION METADATA
Field: {sess['field']} | Language pair: {sess['src']} → {sess['tgt']}
Setting: {persona.get('setting', sess['field'])} | Speaker: {sess['provider_role']}
Topic: {sess['topic']} | Difficulty: {sess['difficulty']} | Segments: {len(pairs)}
{latency_line}

CI SCORING RUBRIC — consecutive interpretation specific (0-100 each):
• accuracy (25%): Exact meaning preserved — no distortions, embellishments, or additions not in source.
• fusha_compliance (15%): Arabic output in Modern Standard Arabic / Fusha only. Penalize dialect, slang, code-switching. N/A → 100 for non-Arabic output.
• completeness (25%): ALL elements of source present in rendition. In CI this is critical — longer segments mean more to recall. Omissions penalized heavily. Classify each omission as Strategic (deliberate, for clarity — less penalty) or Unintentional (missed content — full penalty).
• terminology (15%): Correct domain-specific terms for {sess['field']}. Technical precision is essential in consecutive settings.
• fluency (10%): Natural delivery pace appropriate for consecutive (not OPI phone style). Hesitations, false starts, and unnatural pauses penalized.
• professional_protocol (5%): Role boundaries, impartiality, no editorializing. Weighted lower than OPI as CI protocol differs.
• register_preservation (10%): Maintained appropriate formal register for the consecutive setting — matching the speaker's register without drifting into casual or overly stiff language.

CI-SPECIFIC KPIs (0-100 each, do NOT include in overall_score calculation):
• memory_accuracy: How accurately were specific details preserved — numbers, dates, names, lists, statistics?
• segment_handling: Did the interpreter manage the segment boundaries well? Appropriate length before rendering, no premature interruptions.
• turn_taking_latency: Pause discipline between speaker finish and interpreter start. Target ≤2s. Long pauses suggest hesitancy or poor note-taking flow; very short pauses may suggest premature interruption.

overall_score = 0.25×accuracy + 0.15×fusha_compliance + 0.25×completeness + 0.15×terminology + 0.10×fluency + 0.05×professional_protocol + 0.10×register_preservation

SEGMENTS TO EVALUATE:
{pairs_text}

Return JSON ONLY:
{{
  "overall_score": <0-100 weighted>,
  "accuracy": <0-100>,
  "fusha_compliance": <0-100>,
  "completeness": <0-100>,
  "terminology": <0-100>,
  "fluency": <0-100>,
  "professional_protocol": <0-100>,
  "register_preservation": <0-100>,
  "memory_accuracy": <0-100>,
  "segment_handling": <0-100>,
  "turn_taking_latency": <0-100>,
  "grade": "A(90-100)|B(80-89)|C(70-79)|D(60-69)|F(<60)",
  "summary": "Exactly 2 sentences — specific findings for consecutive interpreting.",
  "strengths": ["one concrete observed CI strength"],
  "coaching_tips": ["one specific actionable CI improvement"],
  "next_drill": "One concrete CI exercise targeting the weakest area",
  "segment_evaluations": [
    {{
      "segment_num": 1,
      "source_text": "first 50 chars of source...",
      "interpreter_said": "first 50 chars of rendition...",
      "ideal_rendition": "model rendition in {sess['tgt']} — max 30 words",
      "verdict": "accurate|acceptable|omission|addition|distortion|dialect_intrusion|incomplete",
      "omission_type": "strategic|unintentional|none",
      "memory_items_hit": "numbers/names/dates correctly recalled — empty if none",
      "memory_items_missed": "specific items dropped — empty if none",
      "note": "one actionable observation — max 20 words"
    }}
  ]
}}

Grade thresholds: A: 90-100, B: 80-89, C: 70-79, D: 60-69, F: <60.""", 2500))
        result["mode"] = "consecutive"
        if turn_taking_latency_score is not None:
            result["turn_taking_latency"] = turn_taking_latency_score
        result["turn_taking_latency_avg_sec"] = turn_taking_latency_avg_sec

    # Save session
    save_session("ci_sim", {
        "field": sess["field"],
        "language": sess["src"] + " → " + sess["tgt"],
        "topic": sess["topic"],
        "segments": len(pairs),
        "scores": result,
    })

    return JSONResponse(result)
