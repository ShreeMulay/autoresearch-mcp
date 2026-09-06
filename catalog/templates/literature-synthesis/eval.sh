#!/usr/bin/env bash
set -euo pipefail

# Citation-density smoke heuristic only.
# Contract: print exactly one finite numeric score to stdout; higher means more
# citation markers per word. This does not validate sources, claims, or semantic
# faithfulness. Replace it with a project-specific evaluator for those properties.

TARGET_FILE="${1:-synthesis.md}"

if [[ -f "$TARGET_FILE" ]]; then
  AUTORESEARCH_TARGET_FILE="$TARGET_FILE" bun -e '
    const text = await Bun.file(process.env.AUTORESEARCH_TARGET_FILE).text();
    const words = text.match(/\w+/g)?.length ?? 0;
    const citations = text.match(/\[[^\]]+\]|\([^)]*\d{4}[^)]*\)/g)?.length ?? 0;
    const score = words === 0 ? 0 : Math.min(1, citations / Math.max(1, words / 250));
    console.log(Number(score.toFixed(4)));
  '
  exit 0
fi

printf '%s\n' 'autoresearch: configure the citation-density smoke heuristic target for this project' >&2
exit 1
