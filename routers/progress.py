#!/usr/bin/env python3
"""
MAD Training Studio — Progress & Gamification Router
Routes: /api/progress/*
Handles: user progress tracking, module unlocks, mode/field unlocking,
XP/levels, streaks, achievements, onboarding, and placement test.
Data is stored as one JSON file per user in the progress/ directory.
"""

import json, os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Form
from fastapi.responses import JSONResponse

from shared import STUDIO_ROOT, save_session

router = APIRouter(prefix="/api/progress")

# ── Constants ─────────────────────────────────────────────────────────────────

PROGRESS_PATH = STUDIO_ROOT / "progress"
PROGRESS_PATH.mkdir(parents=True, exist_ok=True)

# ── Module Definitions (29 modules across 4 phases) ───────────────────────────

MODULES = {
    # Phase 1 — Foundations of Interpreting (8 modules)
    "M001": {"phase": 1, "title": "Shadowing Basics", "mode": "shadowing", "field": "general"},
    "M002": {"phase": 1, "title": "Active Listening", "mode": "shadowing", "field": "general"},
    "M003": {"phase": 1, "title": "Memory Training", "mode": "shadowing", "field": "general"},
    "M004": {"phase": 1, "title": "Note-Taking Basics", "mode": "consecutive", "field": "general"},
    "M005": {"phase": 1, "title": "Consecutive Interpreting Intro", "mode": "consecutive", "field": "general"},
    "M006": {"phase": 1, "title": "Source-Text Analysis Fundamentals", "mode": "consecutive", "field": "general"},
    "M007": {"phase": 1, "title": "Terminology & Glossaries", "mode": "consecutive", "field": "general"},
    "M008": {"phase": 1, "title": "Register Awareness", "mode": "shadowing", "field": "general"},

    # Phase 2 — Consecutive Interpreting (7 modules)
    "M009": {"phase": 2, "title": "CI Segments & EVS", "mode": "consecutive", "field": "general"},
    "M010": {"phase": 2, "title": "Note-Taking Advanced", "mode": "consecutive", "field": "general"},
    "M011": {"phase": 2, "title": "Medical CI", "mode": "consecutive", "field": "medical"},
    "M012": {"phase": 2, "title": "Legal CI", "mode": "consecutive", "field": "legal"},
    "M013": {"phase": 2, "title": "Business CI", "mode": "consecutive", "field": "business"},
    "M014": {"phase": 2, "title": "Legal CI Advanced", "mode": "consecutive", "field": "legal"},
    "M015": {"phase": 2, "title": "Community & Immigration CI", "mode": "consecutive", "field": "community"},

    # Phase 3 — Simultaneous Interpreting (7 modules)
    "M016": {"phase": 3, "title": "Sight Translation", "mode": "sight_translation", "field": "general"},
    "M017": {"phase": 3, "title": "EVS Training", "mode": "simultaneous", "field": "general"},
    "M018": {"phase": 3, "title": "SI Medical", "mode": "simultaneous", "field": "medical"},
    "M019": {"phase": 3, "title": "SI Business", "mode": "simultaneous", "field": "business"},
    "M020": {"phase": 3, "title": "SI Legal", "mode": "simultaneous", "field": "legal"},
    "M021": {"phase": 3, "title": "SI Diplomatic", "mode": "simultaneous", "field": "diplomatic"},
    "M022": {"phase": 3, "title": "Chuchotage", "mode": "chuchotage", "field": "general"},

    # Phase 4 — Specialization Tracks (7 modules)
    "M023": {"phase": 4, "title": "OPI Mastery", "mode": "opi", "field": "general"},
    "M024": {"phase": 4, "title": "Academic Interpreting", "mode": "opi", "field": "academic"},
    "M025": {"phase": 4, "title": "Escort & Liaison", "mode": "escort", "field": "general"},
    "M026": {"phase": 4, "title": "Summit-Level Interpreting", "mode": "simultaneous", "field": "diplomatic"},
    "M027": {"phase": 4, "title": "Security Interpreting", "mode": "chuchotage", "field": "security"},
    "M028": {"phase": 4, "title": "Media Interpreting", "mode": "simultaneous", "field": "media"},
    "M029": {"phase": 4, "title": "Certification Prep", "mode": "opi", "field": "general"},
}

PHASES = {
    1: {"title": "Foundations of Interpreting", "module_ids": [f"M{i:03d}" for i in range(1, 9)]},
    2: {"title": "Consecutive Interpreting", "module_ids": [f"M{i:03d}" for i in range(9, 16)]},
    3: {"title": "Simultaneous Interpreting", "module_ids": [f"M{i:03d}" for i in range(16, 23)]},
    4: {"title": "Specialization Tracks", "module_ids": [f"M{i:03d}" for i in range(23, 30)]},
}

# ── Mode Unlock System (8 modes) ──────────────────────────────────────────────

MODES = {
    "shadowing": {
        "label": "Shadowing",
        "practice_unlock_at": "M001",  # unlocked from day one
        "sim_unlock_at": None,         # shadowing has no simulation tier
        "description": "Echo the speaker in real-time to build ear-voice span and fluency."
    },
    "consecutive": {
        "label": "Consecutive Interpreting (CI)",
        "practice_unlock_at": "M009",
        "sim_unlock_at": "M015",
        "description": "Listen, take notes, then render the message after the speaker pauses."
    },
    "simultaneous": {
        "label": "Simultaneous Interpreting (SI)",
        "practice_unlock_at": "M017",
        "sim_unlock_at": "M022",
        "description": "Interpret in real-time while the speaker continues, using the booth."
    },
    "sight_translation": {
        "label": "Sight Translation",
        "practice_unlock_at": "M016",
        "sim_unlock_at": "M016",  # same module for practice and sim
        "description": "Translate a written text aloud into the target language."
    },
    "chuchotage": {
        "label": "Chuchotage (Whispered SI)",
        "practice_unlock_at": "M022",
        "sim_unlock_at": "M022",
        "description": "Whisper simultaneous interpretation directly to one or two listeners."
    },
    "liaison": {
        "label": "Liaison / Escort Interpreting",
        "practice_unlock_at": "M025",
        "sim_unlock_at": "M025",
        "description": "Accompany clients and interpret in informal, mobile settings."
    },
    "vri": {
        "label": "Video Remote Interpreting (VRI)",
        "practice_unlock_at": None,
        "sim_unlock_at": None,
        "description": "Remote interpreting via video conference for healthcare, legal, and business settings."
    },
    "opi": {
        "label": "Over-the-Phone Interpreting (OPI)",
        "practice_unlock_at": "M023",
        "sim_unlock_at": "M029",
        "description": "Remote interpreting over telephone or video link."
    },
}

# ── Field Unlock System (9 domains) ───────────────────────────────────────────

FIELDS = {
    "medical":     {"label": "Medical",     "unlock_module": "M011", "description": "Hospitals, clinics, patient consultations, and medical conferences."},
    "legal":       {"label": "Legal",       "unlock_module": "M014", "description": "Courts, contracts, depositions, and legal proceedings."},
    "immigration": {"label": "Immigration", "unlock_module": "M015", "description": "Visa applications, asylum interviews, and immigration proceedings."},
    "business":    {"label": "Business",    "unlock_module": "M019", "description": "Corporate meetings, negotiations, and trade events."},
    "diplomatic":  {"label": "Diplomatic",  "unlock_module": "M021", "description": "Embassy work, bilateral meetings, and international relations."},
    "academic":    {"label": "Academic",    "unlock_module": "M024", "description": "University lectures, research conferences, and scholarly exchange."},
    "community":   {"label": "Community",   "unlock_module": "M015", "description": "Social services, non-profit settings, and community outreach."},
    "security":    {"label": "Security",    "unlock_module": "M027", "description": "Defense briefings, field operations, and security contexts."},
    "media":       {"label": "Media",       "unlock_module": "M028", "description": "Press conferences, broadcast interpreting, and journalism."},
}

# ── Achievement System (19 achievements) ─────────────────────────────────────

ACHIEVEMENTS = {
    "first_steps":       {"title": "First Steps", "description": "Complete your first practice session.", "icon": "🚀"},
    "shadow_walker":     {"title": "Shadow Walker", "description": "Complete the Shadowing Basics module.", "icon": "👣"},
    "note_taker":        {"title": "Note Taker", "description": "Unlock Consecutive Interpreting practice.", "icon": "📝"},
    "in_the_booth":      {"title": "In the Booth", "description": "Unlock Simultaneous Interpreting simulation.", "icon": "🎧"},
    "on_sight":          {"title": "On Sight", "description": "Complete a Sight Translation module.", "icon": "👁️"},
    "whisper_network":   {"title": "Whisper Network", "description": "Complete the Chuchotage module.", "icon": "🤫"},
    "cultural_bridge":   {"title": "Cultural Bridge", "description": "Complete the Liaison & Escort module.", "icon": "🌉"},
    "answer_the_call":   {"title": "Answer the Call", "description": "Complete the OPI Certification Prep module.", "icon": "📞"},
    "vri_ready":         {"title": "VRI Ready", "description": "Unlock Video Remote Interpreting practice.", "icon": "🖥️"},
    "field_specialist":  {"title": "Field Specialist", "description": "Unlock all 9 interpreting domains.", "icon": "🌍"},
    "fast_tracked":      {"title": "Fast-Tracked", "description": "Place above Phase 1 via the placement test.", "icon": "⚡"},
    "certified_pro":     {"title": "Certified Pro", "description": "Complete Category C onboarding and calibration.", "icon": "🏆"},
    "streak_starter":    {"title": "Streak Starter", "description": "Maintain a 3-day practice streak.", "icon": "🔥"},
    "streak_master":     {"title": "Streak Master", "description": "Maintain a 7-day practice streak.", "icon": "🔥🔥"},
    "streak_legend":     {"title": "Streak Legend", "description": "Maintain a 30-day practice streak.", "icon": "🔥🔥🔥"},
    "level_5":           {"title": "Level 5", "description": "Reach experience level 5.", "icon": "⭐"},
    "level_10":          {"title": "Level 10", "description": "Reach experience level 10.", "icon": "🌟"},
    "phase_master":      {"title": "Phase Master", "description": "Complete every module in a single phase.", "icon": "📚"},
    "all_phases":        {"title": "All Phases", "description": "Complete all 4 phases of the training program.", "icon": "🎓"},
    "perfect_score":     {"title": "Perfect Score", "description": "Score 100% on any module assessment.", "icon": "💯"},
}

# ── XP / Level System ───────────────────────────────────────────────────────

XP_PER_SESSION_BASE = 10
XP_PER_MODULE_PASS = 50
XP_PER_PHASE_PASS = 100
XP_FIRST_MODE_COMPLETE = 25
XP_PERFECT_BONUS = 25


def _xp_threshold(level: int) -> int:
    """Cumulative XP needed to reach a given level."""
    # Level 1 = 0, Level 2 = 100, Level 3 = 300, Level 4 = 600, Level 5 = 1000 ...
    return 50 * level * (level - 1)


def calculate_level(total_xp: int) -> int:
    """Return current level based on total XP."""
    level = 1
    while _xp_threshold(level + 1) <= total_xp:
        level += 1
    return level


def xp_for_next_level(level: int) -> int:
    """Return XP needed to reach the *next* level from the current level's base."""
    return _xp_threshold(level + 1) - _xp_threshold(level)


def xp_progress_in_level(total_xp: int) -> dict:
    """Return {level, current, next, percent} for UI progress bars."""
    level = calculate_level(total_xp)
    base = _xp_threshold(level)
    nxt = _xp_threshold(level + 1)
    current = total_xp - base
    needed = nxt - base
    return {
        "level": level,
        "current_xp_in_level": current,
        "xp_needed_for_next": needed,
        "percent": round(100 * current / needed, 1) if needed else 100,
    }


# ── Persistence ───────────────────────────────────────────────────────────────


def _user_progress_file(user_id: str) -> Path:
    return PROGRESS_PATH / f"{user_id}.json"


def _default_progress(user_id: str) -> dict:
    """Return a fresh progress object for a brand-new user."""
    return {
        "user_id": user_id,
        "category": None,               # "A", "B", or "C"
        "current_phase": 1,
        "current_module": "M001",
        "total_xp": 0,
        "level": 1,
        "streak_days": 0,
        "last_practice_date": None,
        "total_practice_minutes": 0,
        "total_sessions": 0,
        "module_status": {
            mid: {"status": "locked", "score": 0.0, "attempts": 0, "passed_at": None}
            for mid in MODULES
        },
        "mode_progress": {
            mode: {"practice_unlocked": False, "sim_unlocked": False, "module_id": None}
            for mode in MODES
        },
        "field_unlocks": ["general"],
        "achievements": [],
        "onboarding_complete": False,
        "placement_test": None,         # {score, phase_recommended, details}
        "calibration_session": None,    # for Category C
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }


def load_progress(user_id: str) -> dict:
    """Load a user's progress from JSON. Returns default if not found."""
    fp = _user_progress_file(user_id)
    if fp.exists():
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            # Ensure all module keys exist (migration for new modules)
            for mid in MODULES:
                if mid not in data.get("module_status", {}):
                    data["module_status"][mid] = {"status": "locked", "score": 0.0, "attempts": 0, "passed_at": None}
            # Ensure all mode keys exist (migration for renamed/added modes)
            for mode in MODES:
                if mode not in data.get("mode_progress", {}):
                    data["mode_progress"][mode] = {"practice_unlocked": False, "sim_unlocked": False, "module_id": None}
            # Migrate old "escort" key to "liaison"
            if "escort" in data.get("mode_progress", {}) and "liaison" in MODES:
                data["mode_progress"]["liaison"] = data["mode_progress"].pop("escort")
            return data
        except Exception:
            pass
    return _default_progress(user_id)


def save_progress(data: dict):
    """Persist a user's progress to JSON."""
    data["updated_at"] = datetime.now().isoformat()
    fp = _user_progress_file(data["user_id"])
    fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Mode Name Normalization (frontend ↔ backend) ────────────────────────────────

# Frontend uses shorter mode names; backend uses full canonical names.
# This mapping ensures compatibility between the two.
_MODE_NAME_MAP = {
    "escort": "liaison",
    "sight": "sight_translation",
    "vri": "vri",
    "vri-opi": "opi",
    "relay": "relay",
}

def normalize_mode(mode: Optional[str]) -> Optional[str]:
    """Convert a frontend mode name to the backend canonical name."""
    if not mode:
        return mode
    return _MODE_NAME_MAP.get(mode, mode)


# ── Unlock Logic ──────────────────────────────────────────────────────────────


def _update_mode_progress(progress: dict):
    """Recompute mode unlocks based on the new skill tree."""
    module_status = progress["module_status"]
    mp = progress["mode_progress"]

    def passed(mid):
        return module_status.get(mid, {}).get("status") == "passed"

    def any_ci_passed():
        return any(passed(m) for m in ["M009", "M010", "M011", "M012", "M013", "M014", "M015"])

    # Shadowing: always unlocked
    mp["shadowing"]["practice_unlocked"] = True
    mp["shadowing"]["sim_unlocked"] = False
    mp["shadowing"]["module_id"] = "M001"

    # CI: unlocks after Shadowing practice
    ci_unlocked = mp["shadowing"]["practice_unlocked"]
    mp["consecutive"]["practice_unlocked"] = ci_unlocked
    mp["consecutive"]["sim_unlocked"] = passed("M015")
    mp["consecutive"]["module_id"] = "M009"

    # SI: unlocks after Shadowing + CI module completion
    si_unlocked = ci_unlocked and any_ci_passed()
    mp["simultaneous"]["practice_unlocked"] = si_unlocked
    mp["simultaneous"]["sim_unlocked"] = passed("M022")
    mp["simultaneous"]["module_id"] = "M017"

    # Sight Translation: unlocks after CI practice OR SI practice
    sight_unlocked = ci_unlocked or si_unlocked
    mp["sight_translation"]["practice_unlocked"] = sight_unlocked
    mp["sight_translation"]["sim_unlocked"] = passed("M016")
    mp["sight_translation"]["module_id"] = "M016"

    # Liaison: unlocks after CI practice
    liaison_unlocked = ci_unlocked
    mp["liaison"]["practice_unlocked"] = liaison_unlocked
    mp["liaison"]["sim_unlocked"] = passed("M025")
    mp["liaison"]["module_id"] = "M025"

    # Chuchotage: unlocks after SI practice
    chuchotage_unlocked = si_unlocked
    mp["chuchotage"]["practice_unlocked"] = chuchotage_unlocked
    mp["chuchotage"]["sim_unlocked"] = passed("M022")
    mp["chuchotage"]["module_id"] = "M022"

    # VRI: unlocks after SI + Chuchotage
    vri_unlocked = si_unlocked and chuchotage_unlocked
    mp["vri"]["practice_unlocked"] = vri_unlocked
    mp["vri"]["sim_unlocked"] = False
    mp["vri"]["module_id"] = None

    # OPI: unlocks after CI + Legal Verbatim
    # Legal Verbatim is a CI specialization (not a standalone mode)
    legal_verbatim_unlocked = ci_unlocked and (passed("M012") or passed("M014"))
    opi_unlocked = ci_unlocked and legal_verbatim_unlocked
    mp["opi"]["practice_unlocked"] = opi_unlocked
    mp["opi"]["sim_unlocked"] = passed("M029")
    mp["opi"]["module_id"] = "M023"


def _update_field_unlocks(progress: dict):
    """Recompute field unlocks based on passed modules."""
    passed = {mid for mid, s in progress["module_status"].items() if s.get("status") == "passed"}
    unlocked = set(progress.get("field_unlocks", ["general"]))
    for field, cfg in FIELDS.items():
        if cfg["unlock_module"] and cfg["unlock_module"] in passed:
            unlocked.add(field)
    progress["field_unlocks"] = sorted(unlocked)


def _check_achievements(progress: dict) -> list[str]:
    """Return newly-earned achievement IDs since last check."""
    existing = set(progress.get("achievements", []))
    new = []
    ms = progress["module_status"]
    passed = {mid for mid, s in ms.items() if s.get("status") == "passed"}
    total_sessions = progress.get("total_sessions", 0)
    streak = progress.get("streak_days", 0)
    level = progress.get("level", 1)
    fields = set(progress.get("field_unlocks", []))
    mode_progress = progress["mode_progress"]

    checks = {
        "first_steps": total_sessions >= 1,
        "shadow_walker": "M001" in passed,
        "note_taker": mode_progress["consecutive"]["practice_unlocked"],
        "in_the_booth": mode_progress["simultaneous"]["sim_unlocked"],
        "on_sight": "M016" in passed,
        "whisper_network": "M022" in passed,
        "cultural_bridge": "M025" in passed,
        "answer_the_call": "M029" in passed,
        "vri_ready": mode_progress["vri"]["practice_unlocked"],
        "field_specialist": len(fields) >= 9,
        "fast_tracked": progress.get("placement_test") is not None,
        "certified_pro": progress.get("category") == "C" and progress.get("calibration_session") is not None,
        "streak_starter": streak >= 3,
        "streak_master": streak >= 7,
        "streak_legend": streak >= 30,
        "level_5": level >= 5,
        "level_10": level >= 10,
        "phase_master": any(
            all(ms.get(mid, {}).get("status") == "passed" for mid in p["module_ids"])
            for p in PHASES.values()
        ),
        "all_phases": all(
            all(ms.get(mid, {}).get("status") == "passed" for mid in p["module_ids"])
            for p in PHASES.values()
        ),
        "perfect_score": any(
            s.get("score", 0) >= 100 for s in ms.values()
        ),
    }

    for aid, condition in checks.items():
        if condition and aid not in existing:
            new.append(aid)

    return new


def _update_streak(progress: dict):
    """Update streak_days based on last_practice_date."""
    today = datetime.now().date()
    last = progress.get("last_practice_date")
    if last:
        try:
            last_date = datetime.fromisoformat(last).date()
        except Exception:
            last_date = today
    else:
        last_date = None

    if last_date is None:
        progress["streak_days"] = 1
    elif last_date == today:
        pass  # already practiced today, streak unchanged
    elif last_date == today - timedelta(days=1):
        progress["streak_days"] += 1
    else:
        progress["streak_days"] = 1  # streak broken, restart

    progress["last_practice_date"] = today.isoformat()


# ── Onboarding Helpers ────────────────────────────────────────────────────────


def _apply_category_a(progress: dict, placement_score: float):
    """Category A: full placement-test routing."""
    progress["category"] = "A"
    # Determine starting phase based on score
    if placement_score < 50:
        start_phase = 1
    elif placement_score < 70:
        start_phase = 2
    elif placement_score < 85:
        start_phase = 3
    else:
        start_phase = 4

    progress["current_phase"] = start_phase
    start_module = PHASES[start_phase]["module_ids"][0]
    progress["current_module"] = start_module

    # Unlock all modules up to the starting phase, mark prior phases complete
    for phase_num, phase in PHASES.items():
        for mid in phase["module_ids"]:
            if phase_num < start_phase:
                progress["module_status"][mid] = {
                    "status": "passed",
                    "score": 75.0,
                    "attempts": 1,
                    "passed_at": datetime.now().isoformat(),
                }
                progress["total_xp"] += XP_PER_MODULE_PASS
            elif phase_num == start_phase and mid == start_module:
                progress["module_status"][mid] = {
                    "status": "unlocked",
                    "score": 0.0,
                    "attempts": 0,
                    "passed_at": None,
                }
    progress["level"] = calculate_level(progress["total_xp"])


def _apply_category_b(progress: dict, practiced_modes: list[str] = None):
    """Category B: skips Phase 1, starts at Phase 2 or higher."""
    progress["category"] = "B"
    practiced_modes = practiced_modes or []
    # Determine starting phase based on practiced modes
    start_phase = 2
    if "simultaneous" in practiced_modes:
        start_phase = 3
    if "opi" in practiced_modes and "simultaneous" not in practiced_modes:
        start_phase = 2  # OPI draws on CI skills
    if "simultaneous" in practiced_modes and "consecutive" in practiced_modes:
        start_phase = 3

    progress["current_phase"] = start_phase
    start_module = PHASES[start_phase]["module_ids"][0]
    progress["current_module"] = start_module

    # Mark Phase 1 complete, unlock start of target phase
    for mid in PHASES[1]["module_ids"]:
        progress["module_status"][mid] = {
            "status": "passed",
            "score": 75.0,
            "attempts": 1,
            "passed_at": datetime.now().isoformat(),
        }
        progress["total_xp"] += XP_PER_MODULE_PASS

    for phase_num, phase in PHASES.items():
        if phase_num == start_phase:
            for mid in phase["module_ids"]:
                if mid == start_module:
                    progress["module_status"][mid] = {
                        "status": "unlocked",
                        "score": 0.0,
                        "attempts": 0,
                        "passed_at": None,
                    }
    progress["total_xp"] += XP_PER_PHASE_PASS  # bonus for skipping Phase 1
    progress["level"] = calculate_level(progress["total_xp"])


def _apply_category_c(progress: dict):
    """Category C: everything unlocked, sandbox mode."""
    progress["category"] = "C"
    progress["current_phase"] = 4
    progress["current_module"] = "M029"
    for mid in MODULES:
        progress["module_status"][mid] = {
            "status": "passed",
            "score": 80.0,
            "attempts": 1,
            "passed_at": datetime.now().isoformat(),
        }
        progress["total_xp"] += XP_PER_MODULE_PASS
    progress["total_xp"] += XP_PER_PHASE_PASS * 4
    progress["level"] = calculate_level(progress["total_xp"])
    progress["field_unlocks"] = list(FIELDS.keys())
    for mode in MODES:
        progress["mode_progress"][mode] = {
            "practice_unlocked": True,
            "sim_unlocked": True,
            "module_id": MODES[mode]["practice_unlock_at"],
        }


# ── Auth-aware user_id helper ───────────────────────────────────────────────────

from fastapi import Request

async def _resolve_user_id(request: Request, explicit_user_id: str | None = None) -> str:
    """Try to get user_id from auth token, fall back to explicit parameter."""
    try:
        from auth import get_optional_user
        user = await get_optional_user(request)
        if user:
            return user["id"]
    except Exception:
        pass
    return explicit_user_id or "demo-user"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/{user_id}")
async def get_progress(user_id: str, request: Request):
    """GET /api/progress/{user_id} — return full user progress state.
    If Authorization header is present, overrides user_id with authenticated user."""
    try:
        resolved_user_id = await _resolve_user_id(request, user_id)
        progress = load_progress(resolved_user_id)
        # Recompute derived fields before returning
        _update_mode_progress(progress)
        _update_field_unlocks(progress)
        progress["level"] = calculate_level(progress["total_xp"])
        progress["xp_details"] = xp_progress_in_level(progress["total_xp"])

        # Build unlocked achievements list with full metadata
        achievements_unlocked = []
        for aid in progress.get("achievements", []):
            if aid in ACHIEVEMENTS:
                achievements_unlocked.append({"id": aid, **ACHIEVEMENTS[aid]})

        # Build next unlock target for UI
        next_unlock = None
        for mode, cfg in MODES.items():
            mp = progress["mode_progress"][mode]
            if not mp["practice_unlocked"] and cfg["practice_unlock_at"]:
                next_unlock = {
                    "type": "mode_practice",
                    "mode": mode,
                    "label": cfg["label"],
                    "requires_module": cfg["practice_unlock_at"],
                    "requires_module_title": MODULES[cfg["practice_unlock_at"]]["title"],
                }
                break
            if not mp["sim_unlocked"] and cfg["sim_unlock_at"]:
                next_unlock = {
                    "type": "mode_simulation",
                    "mode": mode,
                    "label": cfg["label"],
                    "requires_module": cfg["sim_unlock_at"],
                    "requires_module_title": MODULES[cfg["sim_unlock_at"]]["title"],
                }
                break

        # Add leaderboard rank (placeholder — computed on-the-fly from files)
        all_files = list(PROGRESS_PATH.glob("*.json"))
        leaderboard = []
        for fp in all_files:
            try:
                d = json.loads(fp.read_text())
                leaderboard.append({
                    "user_id": d.get("user_id", fp.stem),
                    "total_xp": d.get("total_xp", 0),
                    "level": calculate_level(d.get("total_xp", 0)),
                    "streak_days": d.get("streak_days", 0),
                })
            except Exception:
                pass
        leaderboard.sort(key=lambda x: (-x["total_xp"], -x["streak_days"]))
        rank = next((i + 1 for i, e in enumerate(leaderboard) if e["user_id"] == resolved_user_id), None)

        response = {
            "progress": progress,
            "achievements_unlocked": achievements_unlocked,
            "achievements_total": len(ACHIEVEMENTS),
            "next_unlock": next_unlock,
            "leaderboard_rank": rank,
            "leaderboard_top_10": leaderboard[:10],
        }
        return JSONResponse(response)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/onboarding")
async def onboarding(
    request: Request,
    user_id: str = Form(...),
    category: str = Form(...),              # "A", "B", or "C"
    practiced_modes: Optional[str] = Form(None),  # comma-separated for Category B
    calibration_passed: Optional[bool] = Form(False),  # for Category C
):
    """
    POST /api/progress/onboarding
    Complete onboarding and set user category (A/B/C).
    """
    try:
        resolved_user_id = await _resolve_user_id(request, user_id)
        progress = load_progress(resolved_user_id)
        progress["onboarding_complete"] = True

        if category.upper() == "A":
            progress["category"] = "A"
            progress["current_phase"] = 1
            progress["current_module"] = "M001"
            progress["module_status"]["M001"]["status"] = "unlocked"
            progress["mode_progress"]["shadowing"]["practice_unlocked"] = True

        elif category.upper() == "B":
            modes = [m.strip() for m in practiced_modes.split(",")] if practiced_modes else []
            _apply_category_b(progress, modes)
            progress["mode_progress"]["shadowing"]["practice_unlocked"] = True

        elif category.upper() == "C":
            if not calibration_passed:
                return JSONResponse(
                    {"error": "Category C requires calibration_passed=true"},
                    status_code=400
                )
            _apply_category_c(progress)
            progress["calibration_session"] = {
                "passed": True,
                "score": 90.0,
                "completed_at": datetime.now().isoformat(),
            }
        else:
            return JSONResponse({"error": "Invalid category. Use A, B, or C."}, status_code=400)

        _update_mode_progress(progress)
        _update_field_unlocks(progress)
        progress["level"] = calculate_level(progress["total_xp"])
        save_progress(progress)

        save_session("onboarding", {
            "user_id": resolved_user_id,
            "category": category.upper(),
            "practiced_modes": practiced_modes,
        })

        return JSONResponse({
            "success": True,
            "user_id": resolved_user_id,
            "category": progress["category"],
            "current_phase": progress["current_phase"],
            "current_module": progress["current_module"],
            "level": progress["level"],
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/placement-test")
async def placement_test(
    request: Request,
    user_id: str = Form(...),
    shadowing_score: float = Form(0.0),      # 0-100
    consecutive_score: float = Form(0.0),    # 0-100
    sight_translation_score: float = Form(0.0),  # 0-100
    simultaneous_score: float = Form(0.0),   # 0-100
):
    """
    POST /api/progress/placement-test
    Submit placement test scores (Category A users).
    Composite score determines starting phase.
    """
    try:
        resolved_user_id = await _resolve_user_id(request, user_id)
        progress = load_progress(resolved_user_id)
        if not progress.get("onboarding_complete"):
            return JSONResponse(
                {"error": "Onboarding not complete. Call /api/progress/onboarding first."},
                status_code=400
            )
        if progress.get("category") != "A":
            return JSONResponse(
                {"error": "Placement test is only for Category A users."},
                status_code=400
            )

        composite = (shadowing_score + consecutive_score + sight_translation_score + simultaneous_score) / 4.0

        placement_result = {
            "shadowing_score": shadowing_score,
            "consecutive_score": consecutive_score,
            "sight_translation_score": sight_translation_score,
            "simultaneous_score": simultaneous_score,
            "composite_score": round(composite, 2),
            "completed_at": datetime.now().isoformat(),
        }
        progress["placement_test"] = placement_result

        # Apply phase placement based on composite score
        _apply_category_a(progress, composite)

        # Add fast_tracked achievement if placed above Phase 1
        if composite >= 50 and "fast_tracked" not in progress.get("achievements", []):
            progress["achievements"].append("fast_tracked")

        _update_mode_progress(progress)
        _update_field_unlocks(progress)
        progress["level"] = calculate_level(progress["total_xp"])
        save_progress(progress)

        save_session("placement_test", {
            "user_id": resolved_user_id,
            "composite_score": composite,
            "starting_phase": progress["current_phase"],
        })

        return JSONResponse({
            "success": True,
            "composite_score": round(composite, 2),
            "starting_phase": progress["current_phase"],
            "starting_module": progress["current_module"],
            "placement_result": placement_result,
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/session-complete")
async def session_complete(
    request: Request,
    user_id: str = Form(...),
    module_id: Optional[str] = Form(None),   # e.g., "M005"
    mode: Optional[str] = Form(None),        # e.g., "consecutive"
    field: Optional[str] = Form("general"),
    duration_minutes: int = Form(0),
    score: float = Form(0.0),              # 0-100
    session_type: str = Form("practice"),   # "practice" or "simulation"
    feedback_summary: Optional[str] = Form(None),
):
    """
    POST /api/progress/session-complete
    Record a completed practice/simulation session, update XP, streaks,
    module status, and check for new achievements/unlocks.
    """
    try:
        progress = load_progress(resolved_user_id)
        if not progress.get("onboarding_complete"):
            return JSONResponse(
                {"error": "Onboarding not complete."},
                status_code=400
            )

        # Normalize frontend mode name to backend canonical name
        mode = normalize_mode(mode)

        # Update streak
        _update_streak(progress)
        streak = progress["streak_days"]

        # Calculate XP
        base_xp = XP_PER_SESSION_BASE
        score_bonus = int(score / 2)  # 0-50 XP based on score
        streak_bonus = 0
        if streak >= 3:
            streak_bonus = 5
        if streak >= 7:
            streak_bonus = 10
        if streak >= 30:
            streak_bonus = 25

        perfect_bonus = XP_PERFECT_BONUS if score >= 100 else 0
        total_xp_earned = base_xp + score_bonus + streak_bonus + perfect_bonus

        progress["total_xp"] += total_xp_earned
        progress["total_practice_minutes"] += duration_minutes
        progress["total_sessions"] = progress.get("total_sessions", 0) + 1
        progress["level"] = calculate_level(progress["total_xp"])

        # Update module status if a module was specified
        module_passed = False
        if module_id and module_id in MODULES:
            mod = progress["module_status"].get(module_id, {})
            if mod.get("status") == "locked":
                mod["status"] = "unlocked"
            mod["attempts"] = mod.get("attempts", 0) + 1
            if score > mod.get("score", 0):
                mod["score"] = round(score, 2)
            if score >= 70 and mod.get("status") != "passed":
                mod["status"] = "passed"
                mod["passed_at"] = datetime.now().isoformat()
                progress["total_xp"] += XP_PER_MODULE_PASS
                module_passed = True

                # Unlock next module in the same phase (linear progression)
                phase = MODULES[module_id]["phase"]
                module_ids = PHASES[phase]["module_ids"]
                if module_id in module_ids:
                    idx = module_ids.index(module_id)
                    if idx + 1 < len(module_ids):
                        next_mid = module_ids[idx + 1]
                        if progress["module_status"][next_mid]["status"] == "locked":
                            progress["module_status"][next_mid]["status"] = "unlocked"
                            progress["current_module"] = next_mid

                # Check for phase completion
                phase_complete = all(
                    progress["module_status"][m]["status"] == "passed"
                    for m in module_ids
                )
                if phase_complete:
                    progress["total_xp"] += XP_PER_PHASE_PASS
                    # Unlock first module of next phase
                    next_phase = phase + 1
                    if next_phase in PHASES:
                        first_next = PHASES[next_phase]["module_ids"][0]
                        if progress["module_status"][first_next]["status"] == "locked":
                            progress["module_status"][first_next]["status"] = "unlocked"
                            progress["current_phase"] = next_phase
                            progress["current_module"] = first_next

        # Update mode progress
        _update_mode_progress(progress)

        # Update field unlocks
        _update_field_unlocks(progress)

        # Check achievements
        new_achievements = _check_achievements(progress)
        for aid in new_achievements:
            progress["achievements"].append(aid)

        save_progress(progress)

        save_session("session", {
            "user_id": resolved_user_id,
            "module_id": module_id,
            "mode": mode,
            "field": field,
            "duration_minutes": duration_minutes,
            "score": score,
            "session_type": session_type,
            "xp_earned": total_xp_earned,
            "feedback_summary": feedback_summary,
        })

        return JSONResponse({
            "success": True,
            "xp_earned": total_xp_earned,
            "total_xp": progress["total_xp"],
            "level": progress["level"],
            "streak_days": streak,
            "module_passed": module_passed,
            "new_achievements": new_achievements,
            "new_achievement_details": [{"id": a, **ACHIEVEMENTS[a]} for a in new_achievements],
            "next_unlock": _get_next_unlock(progress),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def _get_next_unlock(progress: dict) -> Optional[dict]:
    """Helper to describe the next upcoming unlock for the user."""
    for mode, cfg in MODES.items():
        mp = progress["mode_progress"][mode]
        if not mp["practice_unlocked"]:
            if cfg.get("practice_unlock_at"):
                return {
                    "type": "mode_practice",
                    "mode": mode,
                    "label": cfg["label"],
                    "requires_module": cfg["practice_unlock_at"],
                    "requires_module_title": MODULES[cfg["practice_unlock_at"]]["title"],
                }
            else:
                return {
                    "type": "mode_practice",
                    "mode": mode,
                    "label": cfg["label"],
                    "requires_module": None,
                    "requires_module_title": "Complete prerequisite modes",
                }
        if not mp["sim_unlocked"] and cfg.get("sim_unlock_at"):
            return {
                "type": "mode_simulation",
                "mode": mode,
                "label": cfg["label"],
                "requires_module": cfg["sim_unlock_at"],
                "requires_module_title": MODULES[cfg["sim_unlock_at"]]["title"],
            }
    # Check fields
    passed = {mid for mid, s in progress["module_status"].items() if s.get("status") == "passed"}
    for field, cfg in FIELDS.items():
        if field not in progress.get("field_unlocks", []) and cfg["unlock_module"]:
            return {
                "type": "field",
                "field": field,
                "label": cfg["label"],
                "requires_module": cfg["unlock_module"],
                "requires_module_title": MODULES[cfg["unlock_module"]]["title"],
            }
    return None


@router.get("/check-unlock")
async def check_unlock(request: Request, user_id: str, mode: Optional[str] = None, field: Optional[str] = None):
    """
    GET /api/progress/check-unlock?user_id=...&mode=...&field=...
    Check if a specific mode or field is unlocked for a user.
    """
    try:
        resolved_user_id = await _resolve_user_id(request, user_id)
        progress = load_progress(resolved_user_id)
        _update_mode_progress(progress)
        _update_field_unlocks(progress)

        # Normalize frontend mode name to backend canonical name
        if mode:
            mode = normalize_mode(mode)

        result = {"user_id": resolved_user_id, "unlocked": False, "reason": None}

        if mode:
            if mode not in MODES:
                return JSONResponse({"error": f"Unknown mode: {mode}"}, status_code=400)
            mp = progress["mode_progress"].get(mode, {})
            result["mode"] = mode
            result["mode_label"] = MODES[mode]["label"]
            result["practice_unlocked"] = mp.get("practice_unlocked", False)
            result["sim_unlocked"] = mp.get("sim_unlocked", False)
            result["unlocked"] = result["practice_unlocked"] or result["sim_unlocked"]
            if not result["practice_unlocked"]:
                gate = MODES[mode]["practice_unlock_at"]
                result["reason"] = f"Practice unlocks after completing module {gate}: {MODULES[gate]['title']}"
            elif not result["sim_unlocked"] and MODES[mode]["sim_unlock_at"]:
                gate = MODES[mode]["sim_unlock_at"]
                result["reason"] = f"Simulation unlocks after passing module {gate}: {MODULES[gate]['title']}"

        if field:
            if field not in FIELDS:
                return JSONResponse({"error": f"Unknown field: {field}"}, status_code=400)
            unlocked = field in progress.get("field_unlocks", [])
            result["field"] = field
            result["field_label"] = FIELDS[field]["label"]
            result["field_unlocked"] = unlocked
            result["unlocked"] = unlocked
            if not unlocked and FIELDS[field]["unlock_module"]:
                gate = FIELDS[field]["unlock_module"]
                result["reason"] = f"Unlocks after passing module {gate}: {MODULES[gate]['title']}"

        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/leaderboard")
async def leaderboard(limit: int = 10):
    """
    GET /api/progress/leaderboard?limit=10
    Return global leaderboard ranked by total XP and streak.
    """
    try:
        all_files = list(PROGRESS_PATH.glob("*.json"))
        entries = []
        for fp in all_files:
            try:
                d = json.loads(fp.read_text())
                entries.append({
                    "user_id": d.get("user_id", fp.stem),
                    "total_xp": d.get("total_xp", 0),
                    "level": calculate_level(d.get("total_xp", 0)),
                    "streak_days": d.get("streak_days", 0),
                    "total_sessions": d.get("total_sessions", 0),
                    "total_practice_minutes": d.get("total_practice_minutes", 0),
                    "achievements_count": len(d.get("achievements", [])),
                })
            except Exception:
                pass

        entries.sort(key=lambda x: (-x["total_xp"], -x["streak_days"], -x["level"]))

        return JSONResponse({
            "leaderboard": entries[:limit],
            "total_users": len(entries),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Additional utility endpoints (not strictly required but useful) ────────────


@router.get("/modules")
async def list_modules():
    """GET /api/progress/modules — return full module catalog."""
    try:
        return JSONResponse({
            "phases": {str(k): v for k, v in PHASES.items()},
            "modules": MODULES,
            "modes": {k: {"label": v["label"], "description": v["description"]} for k, v in MODES.items()},
            "fields": {k: {"label": v["label"], "description": v["description"]} for k, v in FIELDS.items()},
            "achievements": ACHIEVEMENTS,
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/achievements/{user_id}")
async def get_achievements(request: Request, user_id: str):
    """GET /api/progress/achievements/{user_id} — return achievement status."""
    try:
        resolved_user_id = await _resolve_user_id(request, user_id)
        progress = load_progress(resolved_user_id)
        unlocked = set(progress.get("achievements", []))
        all_achievements = []
        for aid, info in ACHIEVEMENTS.items():
            all_achievements.append({
                "id": aid,
                "unlocked": aid in unlocked,
                **info,
            })
        return JSONResponse({
            "user_id": resolved_user_id,
            "achievements": all_achievements,
            "unlocked_count": len(unlocked),
            "total_count": len(ACHIEVEMENTS),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
