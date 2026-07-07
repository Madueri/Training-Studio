#!/usr/bin/env python3
"""
InterpLing — Shared module
Config, clients, and small helper functions used by app.py and every router
(routers/interpretation.py, routers/voiceover.py).

This module must NEVER import from app.py or from routers/ — app.py and the
routers import FROM here, never the other way around (no circular imports).
"""

import os, sys, json, re
from pathlib import Path
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────
# Primary source: this folder's own .env — keeps the Studio fully standalone.
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
SUPABASE_URL        = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY   = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

def _is_placeholder(val: str) -> bool:
    """Return True if the value is empty or looks like a placeholder."""
    if not val or not val.strip():
        return True
    lowered = val.strip().lower()
    return (
        "your_" in lowered
        or "placeholder" in lowered
        or "example" in lowered
        or "fake" in lowered
        or "dummy" in lowered
        or "test" in lowered
        or len(val.strip()) < 8
    )

ELEVENLABS_CONFIGURED = not _is_placeholder(ELEVENLABS_API_KEY) and not _is_placeholder(ELEVENLABS_VOICE_ID)
ANTHROPIC_CONFIGURED  = not _is_placeholder(ANTHROPIC_API_KEY)

# No fallback to external systems — this app is fully standalone. If any of
# these are missing, warn here instead of crashing at runtime.
_required = [
    ("ANTHROPIC_API_KEY", ANTHROPIC_CONFIGURED),
    ("ELEVENLABS_API_KEY", ELEVENLABS_CONFIGURED),
    ("ELEVENLABS_VOICE_ID", ELEVENLABS_CONFIGURED),
]
_missing = [name for name, ok in _required if not ok]
if _missing:
    print(f"\n[WARNING] Missing or placeholder .env value(s): {', '.join(_missing)}.")
    print(f"Copy .env.example to .env in this folder and fill them in — see README.md.\n")
    # DO NOT sys.exit() — allow the server to start so the user can see the UI
    # and the frontend can show a proper error message.

STUDIO_ROOT   = Path(__file__).parent          # always relative to app.py
SESSIONS_PATH = STUDIO_ROOT / "sessions"
SESSIONS_PATH.mkdir(parents=True, exist_ok=True)

# Only create clients if keys are configured
claude = None
if ANTHROPIC_CONFIGURED:
    try:
        import anthropic
        claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    except Exception as e:
        print(f"[WARNING] Failed to initialize Anthropic client: {e}")

whisper = None
try:
    from faster_whisper import WhisperModel
    whisper = WhisperModel("tiny", device="cpu", compute_type="int8")
except Exception as e:
    print(f"[WARNING] Failed to initialize Whisper model: {e}")

def ask_claude(prompt: str, max_tokens: int = 800) -> str:
    if not claude:
        raise RuntimeError(
            "Anthropic API key is not configured. "
            "Please set ANTHROPIC_API_KEY in your .env file."
        )
    r = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}]
    )
    return r.content[0].text.strip()

def extract_json(text: str) -> dict:
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return {"raw": text}

def save_session(name: str, data: dict):
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    fp  = SESSIONS_PATH / f"{name}_{ts}.json"
    fp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
