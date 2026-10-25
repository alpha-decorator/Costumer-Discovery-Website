#!/usr/bin/env bash
# Starts the Trata engine (macOS / Linux). Usage: ./start-engine.sh [selftest]
# torch (needed for the Hindi speech model) supports Python 3.10 - 3.12 only, so one of those is picked.
set -e
cd "$(dirname "$0")"
ok_python() { "$1" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; }
if [ -x .venv/bin/python ] && ! ok_python .venv/bin/python; then echo "Existing .venv uses an unsupported Python; rebuilding it..."; rm -rf .venv; fi
if [ ! -x .venv/bin/python ]; then
  PY=""
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && ok_python "$candidate"; then PY="$candidate"; break; fi
  done
  [ -n "$PY" ] || { echo "Python 3.10, 3.11 or 3.12 is needed (newer versions do not work with torch yet)."; exit 1; }
  "$PY" -m venv .venv
fi
source .venv/bin/activate
if [ ! -f .venv/installed.flag ]; then python -m pip install --upgrade pip && python -m pip install -r requirements.txt && touch .venv/installed.flag; fi
exec python -m trata_engine "$@"
