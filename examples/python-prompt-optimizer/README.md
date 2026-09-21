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

# 2. This example already has its setup, so register it without scaffolding
> register_experiment(project_path: ".../python-prompt-optimizer", metric_name: "eval_score", metric_direction: "maximize", target_artifact: "prompt.txt", evaluator_command: "bash eval.sh")
-> Returns: Experiment ID: exp-id

# 3. Before candidates, log exactly one measured baseline using the returned ID
> log_result(experiment_id: "exp-id", iteration: 0, score: 96.0, is_baseline: true, change_description: "checked-in baseline")

# 4. After each candidate, log its actual measured score without asserting improved
> log_result(experiment_id: "exp-id", iteration: 1, score: <measured-score>, change_description: "candidate change")
```

For a new project needing starter files, use `scaffold_experiment` instead. It creates files and registers the experiment; reuse its returned Experiment ID without a second `register_experiment` call. Configure its placeholder evaluator before logging any scores.

`log_result` updates SQLite only. The checked-in baseline row is not automatically imported. `results.tsv` is manually maintained and is not automatically synchronized with SQLite; append candidate rows yourself if using both logs.

## Key Takeaways

1. **Establish the baseline first.** Log exactly one earlier result with `is_baseline=true` before candidates.
2. **Retention is strict.** Keep a candidate only when it strictly improves on the best earlier score.
3. **The evaluator is limited.** This demo uses deterministic keyword matching; a real project needs a task-specific benchmark or review process.
