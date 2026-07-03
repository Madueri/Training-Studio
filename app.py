#!/usr/bin/env python3
"""
MAD Training Studio — Backend
FastAPI server powering the 3-tab training platform:
  Tab 1: Interpretation (Consecutive, Simultaneous, Shadowing, OPI)
  Tab 2: Voice-Over (Teleprompter, LUFS analysis, Coaching curriculum)
  Tab 3: IELTS (All 4 modules, AI examiner, Band score feedback)
Runs on: http://localhost:5555

Routes are split across routers/ (interpretation.py, voiceover.py, ielts.py).
Shared config/clients/helpers live in shared.py. This file only keeps the
root route, the cross-tab /api/sessions route, app setup, and the launcher.
"""

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from shared import SESSIONS_PATH
from routers import interpretation, voiceover, ielts, progress

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="MAD Training Studio")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(interpretation.router)
app.include_router(voiceover.router)
app.include_router(ielts.router)
app.include_router(progress.router)

# ── Root ──────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")

# ── Sessions (cross-tab, used by Progress page) ──────────────────────────────

@app.get("/api/sessions")
async def get_sessions():
    try:
        sessions = []
        for f in sorted(SESSIONS_PATH.glob("*.json"), reverse=True)[:30]:
            d = json.loads(f.read_text())
            score = d.get("scores", d.get("feedback", {})).get("overall_score",
                    d.get("feedback", {}).get("overall_band", 0))
            sessions.append({"file": f.name, "timestamp": d.get("timestamp", f.stem[-15:]),
                             "type": f.name.split("_")[0], "score": score})
        return JSONResponse(sessions)
    except Exception:
        return JSONResponse([])


if __name__ == "__main__":
    import uvicorn
    print("🎙  MAD Training Studio starting on http://localhost:5555")
    uvicorn.run(app, host="0.0.0.0", port=5555, reload=False)
