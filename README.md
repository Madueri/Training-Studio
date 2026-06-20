# MAD Training Studio

FastAPI backend + frontend powering the 3-tab training platform:
- **Tab 1 — Interpretation**: Consecutive, Simultaneous, Shadowing, OPI
- **Tab 2 — Voice-Over**: Teleprompter, LUFS analysis, Coaching curriculum
- **Tab 3 — IELTS**: All 4 modules, AI examiner, Band score feedback

Runs at `http://localhost:5555`. Fully standalone — no dependency on any other local project.

## Setup (every team member runs this once)

```bash
git clone <repo-url>
cd Training-Studio
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# then fill in .env with the real API keys (get them from MAD, do not commit them)
```

## Run

```bash
python app.py
```

Open `http://localhost:5555`.

## Working as a team

This repo is the single source of truth. Each person:
1. Pulls latest (`git pull`) before starting work.
2. Works on a branch for anything non-trivial (`git checkout -b feature/your-thing`).
3. Commits and pushes; opens a PR to merge into `main`.

For *simultaneous* live editing (multiple people in the same file at once, not just async git), use the **VS Code Live Share** extension on top of this same repo — install it, one person starts a session, others join with the link.

### Using Claude on this repo
Anyone on the team can point Claude Code (or this Claude/Cowork session) at this folder to keep building features, fix bugs, or review PRs — it's a normal git repo, so standard agentic-coding workflows apply.

## Project docs
- `PROJECT_BRIEF.md` — what this product is and who it's for
- `INTERPRETING_PROTOCOLS_AND_KPIS.md` — interpretation module scoring logic
- `PROGRESS_SYSTEM_PLAN.md` — progress/gamification system design
- `sessions/` — recorded practice session data (included so the team has real data to test against)

## Secrets
`.env` is gitignored. Required keys are listed in `.env.example`. Get real values from MAD directly (Slack/DM) — never paste them into the repo, an issue, or a PR.
