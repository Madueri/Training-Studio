#!/usr/bin/env bash
# One-command launcher — no external voice assistant required.
set -e
cd "$(dirname "$0")"

if [ ! -d venv ]; then
  echo "Setting up virtual environment (first run only)..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
else
  source venv/bin/activate
fi

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill in your API keys first."
  exit 1
fi

echo "Starting InterpLing at http://localhost:5555 ..."
python app.py
