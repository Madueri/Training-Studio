# MAD Training Studio (InterpLab)

> 🏷️ Hub: [[CENTRAL-HUB-TRAINING-STUDIO]]

FastAPI backend + frontend powering the interpreter training platform:
- **Tab 1 — Interpretation**: Consecutive, Simultaneous, Shadowing, OPI
- **Tab 2 — Voice-Over**: Teleprompter, LUFS analysis, Coaching curriculum

Runs at `http://localhost:5555`. Fully standalone — no dependency on any other local project.

## Setup

```bash
git clone <repo-url>
cd Training-Studio
cp .env.example .env
# fill in .env with real API keys — never commit this file
```

## Run

**macOS / Linux:**
```bash
./start.sh
```

**Windows (cmd or PowerShell):**
```
start.bat
```

First run creates a virtual environment and installs dependencies automatically.
Open `http://localhost:5555`.

## Required API keys (`.env`)
| Key | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | AI examiner, OPI simulation, scoring/feedback |
| `ELEVENLABS_API_KEY` | Text-to-speech for simulated callers/examiners |
| `ELEVENLABS_VOICE_ID` | Default voice for TTS |

Never paste API keys into the repo, an issue, or a PR.

## Project structure

```
Training-Studio/
├── app.py                    # FastAPI entry point
├── shared.py                 # Config, clients, helpers
├── routers/                  # API route modules
│   ├── interpretation.py
│   └── voiceover.py
├── static/                   # Frontend assets
│   ├── index.html
│   ├── css/
│   └── js/
├── sessions/                 # Recorded practice sessions (runtime data)
├── docs/                     # Product & technical documentation
├── .env.example              # Template for environment variables
├── requirements.txt
├── start.sh / start.bat      # One-command launchers
└── README.md
```

## Tech stack

- **Backend**: FastAPI + Python 3
- **AI / LLM**: Anthropic Claude (Haiku)
- **TTS**: ElevenLabs
- **Transcription**: faster-whisper
- **Frontend**: Vanilla JavaScript (single-file, no build step)
- **Audio**: PyAV, librosa, numpy
