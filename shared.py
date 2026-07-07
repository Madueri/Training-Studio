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

# No fallback to external systems — this app is fully standalone. If any of
# these are missing, fail loudly here instead of silently borrowing another app's
# keys/voice at runtime.
_required = [
    ("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY),
    ("ELEVENLABS_API_KEY", ELEVENLABS_API_KEY),
    ("ELEVENLABS_VOICE_ID", ELEVENLABS_VOICE_ID),
]
# Auth keys are optional during development (demo mode works without them)
_missing = [name for name, val in _required if not val]
if _missing:
    sys.exit(
        f"Missing required .env value(s): {', '.join(_missing)}. "
        f"Copy .env.example to .env in this folder and fill them in — "
        f"see README.md for what each key is for."
    )

STUDIO_ROOT   = Path(__file__).parent          # always relative to app.py
SESSIONS_PATH = STUDIO_ROOT / "sessions"
SESSIONS_PATH.mkdir(parents=True, exist_ok=True)

import anthropic
from faster_whisper import WhisperModel

claude   = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
whisper  = WhisperModel("tiny", device="cpu", compute_type="int8")

# ── Helpers ───────────────────────────────────────────────────────────────────

def ask_claude(prompt: str, max_tokens: int = 800) -> str:
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
