#!/usr/bin/env bash
set -euo pipefail

# Replace this with the project-specific ML evaluator.
# Contract: print exactly one numeric score to stdout; higher is better.
# If the natural metric is a loss, emit an inverted score such as -loss.

if [[ -f metrics.json ]]; then
  bun -e '
    const metrics = await Bun.file("metrics.json").json();
    const score = metrics.score ?? (metrics.validation_loss == null ? undefined : -Number(metrics.validation_loss));
    if (score == null || typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error("metrics.json must contain a finite numeric score or validation_loss");
    }
    console.log(score);
  '
  exit 0
fi

printf '%s\n' 'autoresearch: configure an ML evaluator that prints one numeric score' >&2
exit 1
