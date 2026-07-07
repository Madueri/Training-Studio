#!/usr/bin/env python3
"""
InterpLing — Backend
FastAPI server powering the training platform:
  Tab 1: Interpretation (Consecutive, Simultaneous, Shadowing, OPI)
  Tab 2: Voice-Over (Teleprompter, LUFS analysis, Coaching curriculum)
Runs on: http://localhost:5555

Routes are split across routers/ (interpretation.py, voiceover.py).
Shared config/clients/helpers live in shared.py. This file only keeps the
root route, the cross-tab /api/sessions route, app setup, and the launcher.
"""

import json
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from shared import SESSIONS_PATH, SUPABASE_URL, SUPABASE_ANON_KEY
from routers import interpretation, voiceover, progress, auth

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="InterpLing")

# CORS: allow localhost for dev, restrict in production
_allowed_origins = [
    "http://localhost:5555",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://127.0.0.1:5555",
]
# Add production origins from env if available
import os
_prod_origins = os.getenv("ALLOWED_ORIGINS", "")
if _prod_origins:
    _allowed_origins.extend([o.strip() for o in _prod_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(interpretation.router)
app.include_router(voiceover.router)
app.include_router(progress.router)
app.include_router(auth.router)

# ── Root ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")

# ── Public Config (serves Supabase credentials so the frontend never hardcodes them)

@app.get("/api/config")
async def get_config():
    """GET /api/config — return public Supabase config for frontend auth initialization."""
    return JSONResponse({
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
    })

# ── Sessions (cross-tab, used by Progress page) ──────────────────────────────

@app.get("/api/sessions")
async def get_sessions(request: Request):
    """GET /api/sessions — return recent sessions. If authenticated, filter by user_id."""
    try:
        # Try to get authenticated user (optional)
        user_id = None
        try:
            from auth import get_optional_user
            user = await get_optional_user(request)
            if user:
                user_id = user["id"]
        except Exception:
            pass

        sessions = []
        for f in sorted(SESSIONS_PATH.glob("*.json"), reverse=True)[:50]:
            try:
                d = json.loads(f.read_text())
                # If authenticated, filter to user's own sessions
                if user_id and d.get("user_id") and d.get("user_id") != user_id:
                    continue
                score = d.get("scores", d.get("feedback", {})).get("overall_score",
                        d.get("feedback", {}).get("overall_band", 0))
                sessions.append({
                    "file": f.name,
                    "timestamp": d.get("timestamp", f.stem[-15:] if len(f.stem) >= 15 else f.stem),
                    "type": f.name.split("_")[0] if "_" in f.name else "unknown",
                    "score": score,
                    "user_id": d.get("user_id", "unknown"),
                })
            except Exception:
                continue
        return JSONResponse({"sessions": sessions, "authenticated": bool(user_id)})
    except Exception:
        return JSONResponse({"sessions": [], "authenticated": False})


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """GET /health — return server status."""
    return JSONResponse({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
    })


if __name__ == "__main__":
    import uvicorn
    print("🎙  InterpLing starting on http://localhost:5555")
    uvicorn.run(app, host="0.0.0.0", port=5555, reload=False)
