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
# → 66.0

# Read the program.md for strategy hints, then iterate on prompt.txt
# After each change, run eval.sh and check if score improved
```

## Results from 5 iterations

| Iter | Score | Change | Kept? |
|------|-------|--------|-------|
| 0 | 66.0 | Baseline | - |
| 1 | 76.0 | Added code formatting instruction | Yes (+10) |
| 2 | 96.0 | Added edge cases / best practices | Yes (+20) |
| 3 | 96.0 | Added practical examples emphasis | No (0) |
| 4 | 96.0 | Added comprehensive coverage | No (0) |
| 5 | 96.0 | Restructured into sections | No (0) |

**Result: 66 → 96 in 2 effective iterations.** The prompt improved by 45% with just two targeted changes.

## How to Use with autoresearch-mcp

In any Claude Code / OpenCode session with autoresearch-mcp connected:

```
# 1. Get technique recommendation
> suggest_technique("optimize a Python coding assistant prompt")

# 2. Scaffold the experiment (or use this example directly)
> scaffold_experiment(recipe_id: "prompt-optimization", project_path: "...")

# 3. Register for tracking
> register_experiment(project_path: "...", metric_name: "eval_score", ...)

# 4. After each iteration, log the result
> log_result(experiment_id: "...", iteration: 1, score: 76.0, improved: true, ...)

# 5. When done, log the outcome
> log_technique_outcome(technique_id: "prompt-optimization", outcome: "success", ...)
```

## Key Takeaways

1. **Small, targeted changes work.** Two precise additions beat five vague ones.
2. **The ratchet converges fast.** Most gains come in the first 2-3 iterations.
3. **Diminishing returns are real.** After hitting the evaluator's ceiling, more changes don't help.
4. **The evaluator is everything.** This demo uses keyword matching — a real project would use LLM-as-judge or task-specific benchmarks.
