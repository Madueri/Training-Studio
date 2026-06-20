# MAD Training Studio (InterpLab)

FastAPI backend + frontend powering the 3-tab training platform:
- **Tab 1 — Interpretation**: Consecutive, Simultaneous, Shadowing, OPI
- **Tab 2 — Voice-Over**: Teleprompter, LUFS analysis, Coaching curriculum
- **Tab 3 — IELTS**: All 4 modules, AI examiner, Band score feedback

Runs at `http://localhost:5555`. Fully standalone — no dependency on Jarvis, the voice
assistant, or any other local project. (Jarvis's only historical link to this app was a
voice command that opened a browser tab to localhost:5555 — it never ran or depended on
any Studio process. That link is gone now; this app starts and runs entirely on its own.)

## Setup (every team member runs this once)

```bash
git clone <repo-url>
cd Training-Studio
cp .env.example .env
# fill in .env with real API keys — get them from MAD, never commit this file
```

## Run

**macOS / Linux:**
```bash
./start.sh
```

**Windows (cmd or PowerShell — no Git Bash/WSL needed):**
```
start.bat
```

First run creates a virtual environment and installs dependencies automatically.
Open `http://localhost:5555`.

## Working as a team

This repo is the single source of truth. Each person:
1. Pulls latest (`git pull`) before starting work.
2. Works on a branch for anything non-trivial (`git checkout -b feature/your-thing`).
3. Commits and pushes; opens a PR to merge into `main`.

For *simultaneous* live editing (multiple people in the same file at once, not just async
git), use the **VS Code Live Share** extension on top of this same repo.

### Using Claude on this repo
Anyone on the team can point the **Claude Code** VS Code extension (or any Claude session
with file access) at this folder to keep building features, fix bugs, or review changes —
it's a normal standalone git repo.

## Required API keys (`.env`)
| Key | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | AI examiner, OPI simulation, scoring/feedback |
| `ELEVENLABS_API_KEY` | Text-to-speech for simulated callers/examiners |
| `ELEVENLABS_VOICE_ID` | Default voice for TTS |

Get real values from MAD directly (never paste them into the repo, an issue, or a PR).

## Docs
- `PROJECT_BRIEF.md` — what this product is and who it's for
- `INTERPRETING_PROTOCOLS_AND_KPIS.md` — interpretation module scoring logic
- `PROGRESS_SYSTEM_PLAN.md` — progress/gamification system design
- `sessions/` — recorded practice session data (real data to test against)
- `docs/CENTRAL-HUB-TRAINING-STUDIO.md` — product overview / status hub
- `docs/MAD-Training-Studio-OPI-Design.md` — OPI simulation design blueprint
- `docs/MAD-Training-Studio-Roadmap.md` — product roadmap
- `docs/business/` — strategy, revenue model, go-to-market, equity & legal drafts
  (⚠️ contains equity/legal drafts — confirm with MAD before granting repo access to
  anyone outside the core team)
