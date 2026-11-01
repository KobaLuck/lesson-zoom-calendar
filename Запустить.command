#!/bin/sh
set -eu
cd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x .venv/bin/python ]; then
    exec .venv/bin/python 'Урок-Zoom.py'
fi
exec python3 'Урок-Zoom.py'
