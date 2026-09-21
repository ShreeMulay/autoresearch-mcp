#!/usr/bin/env bash
set -euo pipefail

# Replace this with the project-specific ML evaluator.
# Contract: print exactly one finite numeric score to stdout.
# Scaffolding binds the metric direction. Standalone use defaults to maximize:
# validation_loss is negated for maximize and left unchanged for minimize.
# An explicit metrics.score is already in the caller's declared direction.

if [[ -f metrics.json ]]; then
  bun -e '
    const metrics = await Bun.file("metrics.json").json();
    const direction = process.env.AUTORESEARCH_METRIC_DIRECTION ?? "maximize";
    if (!["minimize", "maximize"].includes(direction)) throw new Error("Invalid metric direction");
    const loss = metrics.validation_loss;
    const score = metrics.score ?? (loss == null ? undefined : (direction === "minimize" ? Number(loss) : -Number(loss)));
    if (score == null || typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error("metrics.json must contain a finite numeric score or validation_loss");
    }
    console.log(score);
  '
  exit 0
fi

printf '%s\n' 'autoresearch: configure an ML evaluator that prints one numeric score' >&2
exit 1
