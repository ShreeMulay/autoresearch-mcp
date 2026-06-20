#!/usr/bin/env bash
set -euo pipefail

# Replace this with the project-specific test amplification evaluator.
# Contract: print exactly one numeric score to stdout; higher is better.
# Suggested signals: mutation score, changed-line coverage, targeted test pass rate,
# or a weighted composite that penalizes flaky and slow tests.

if [[ -f package.json ]]; then
  bun test >/dev/null
  echo "1.0"
  exit 0
fi

if [[ -f pyproject.toml ]]; then
  python -m pytest >/dev/null
  echo "1.0"
  exit 0
fi

printf '%s\n' 'autoresearch: configure a test amplification evaluator for this project' >&2
exit 1
