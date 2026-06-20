#!/usr/bin/env bash
set -euo pipefail

# Replace this with the project-specific ML evaluator.
# Contract: print exactly one numeric score to stdout; higher is better.
# If the natural metric is a loss, emit an inverted score such as -loss.

if [[ -f metrics.json ]]; then
  python - <<'PY'
import json
with open('metrics.json', 'r', encoding='utf-8') as fh:
    metrics = json.load(fh)
score = metrics.get('score')
if score is None and 'validation_loss' in metrics:
    score = -float(metrics['validation_loss'])
if score is None:
    raise SystemExit('metrics.json must contain score or validation_loss')
print(float(score))
PY
  exit 0
fi

printf '%s\n' 'autoresearch: configure an ML evaluator that prints one numeric score' >&2
exit 1
