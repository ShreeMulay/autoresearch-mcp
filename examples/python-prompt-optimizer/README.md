# Python Prompt Optimizer — Autoresearch Example

A working example of the Karpathy ratchet pattern applied to prompt optimization.

## What's Here

```
python-prompt-optimizer/
├── prompt.txt          ← The file being optimized (agent modifies this)
├── eval.py             ← The evaluator (LOCKED — do not modify)
├── eval.sh             ← Shell wrapper for eval.py
├── eval_set.json       ← 10 Python questions with scoring rubric
├── program.md          ← Agent instructions (human writes this)
└── results.tsv         ← Experiment log
```

## The Pattern

```
Edit prompt.txt → Run eval.sh → Score improved? → Keep or revert → Repeat
```

## Quick Start

```bash
# Check baseline score
bash eval.sh
# → 96.0

# Read the program.md for strategy hints, then iterate on prompt.txt
# After each change, run eval.sh and check if score improved
```

## Checked-in baseline

The checked-in `prompt.txt` currently scores **96.0** with the checked-in evaluator and fixture. `results.tsv` records that current state as iteration 0 with `is_baseline=true`; it does not claim a reproducible history for earlier prompt versions that are not checked in. Candidate changes should be retained only when their score is strictly greater than the current best score.

## How to Use with autoresearch-mcp

In any Claude Code / OpenCode session with autoresearch-mcp connected:

```
# 1. Get technique recommendation
> suggest_technique("optimize a Python coding assistant prompt")

# 2. Scaffold the experiment (or use this example directly)
> scaffold_experiment(recipe_id: "prompt-optimization", project_path: "...")

# 3. Register for tracking
> register_experiment(project_path: "...", metric_name: "eval_score", ...)

# 4. Before candidates, log exactly one baseline
> log_result(experiment_id: "...", iteration: 0, score: 96.0, is_baseline: true, improved: false, ...)

# 5. After each candidate, log the result without asserting improved
> log_result(experiment_id: "...", iteration: 1, score: 97.0, ...)
```

## Key Takeaways

1. **Establish the baseline first.** Log exactly one earlier result with `is_baseline=true` before candidates.
2. **Retention is strict.** Keep a candidate only when it strictly improves on the best earlier score.
3. **The evaluator is limited.** This demo uses deterministic keyword matching; a real project needs a task-specific benchmark or review process.
