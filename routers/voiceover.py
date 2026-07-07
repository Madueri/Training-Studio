#!/usr/bin/env python3
"""
InterpLing — Voice-Over router
Routes: /api/analyze-voiceover
"""

from fastapi import APIRouter, Form
from fastapi.responses import JSONResponse

from shared import ask_claude, extract_json, save_session

router = APIRouter()

# ── Voice-Over Analysis ───────────────────────────────────────────────────────

@router.post("/api/analyze-voiceover")
async def analyze_voiceover(
    transcript: str   = Form(...),
    target_text: str  = Form(""),
    live_db: float    = Form(-20.0)
):
    try:
        script_section = f"\nTARGET SCRIPT:\n{target_text}" if target_text.strip() else ""
        result = extract_json(ask_claude(f"""You are a senior broadcast voice coach evaluating a voice-over.

RECORDING TRANSCRIPT:
{transcript}
{script_section}
MEASURED PEAK LEVEL: {live_db:.1f} dBFS
EBU R128 BROADCAST TARGET: -23 LUFS  |  ONLINE TARGET: -16 LUFS

Return coaching feedback JSON only:
{{
  "overall_score": <0-100>,
  "clarity": <0-100>,
  "pacing": <0-100>,
  "intonation": <0-100>,
  "pronunciation": <0-100>,
  "energy": <0-100>,
  "script_accuracy": <0-100 or null>,
  "broadcast_ready": <true/false>,
  "strengths": ["specific positive"],
  "coaching_points": ["specific technical fix"],
  "next_exercise": "one drill to practice today",
  "summary": "2-sentence assessment from a broadcast coach perspective"
}}""", 700))

        save_session("vo", {"transcript": transcript, "target": target_text[:200], "feedback": result})
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
