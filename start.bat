@echo off
REM One-command launcher for Windows (cmd or PowerShell) — no external voice assistant required.
cd /d "%~dp0"

if not exist venv (
    echo Setting up virtual environment ^(first run only^)...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

if not exist .env (
    echo Missing .env — copy .env.example to .env and fill in your API keys first.
    exit /b 1
)

echo Starting MAD Training Studio at http://localhost:5555 ...
python app.py
