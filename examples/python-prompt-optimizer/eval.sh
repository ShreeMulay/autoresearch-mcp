#!/usr/bin/env bash
# Eval harness wrapper — runs eval.py and prints the score
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/eval.py"
