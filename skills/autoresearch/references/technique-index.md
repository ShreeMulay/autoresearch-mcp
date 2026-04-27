# Autoresearch: Technique Index

Compact reference for all 30 techniques in the autoresearch catalog.

For full details on any technique, use the `get_technique` MCP tool with the ID.

---

## Strategies (8)

### hill-climbing
Greedy local search. Mutate current best, keep if better. Fast, simple, gets stuck in local optima. Best for: smooth search spaces, fast evaluation.

### evolutionary
Population-based genetic algorithm. Multiple candidates compete, winners reproduce with mutation. Best for: rugged landscapes, discrete choices.

### bayesian-optimization
Builds surrogate model of the objective. Samples where uncertainty × expected improvement is highest. Best for: expensive evaluations, continuous parameters.

### beam-search
Keeps top-k candidates at each step. Breadth + depth balance. Best for: structured outputs (code, prompts with multiple sections).

### simulated-annealing
Accepts worse solutions early with decreasing probability. Escapes local optima. Best for: complex landscapes with known good basins.

### multi-armed-bandit
Allocates trials to arms based on observed rewards. Minimizes regret. Best for: online A/B testing, dynamic environments.

### self-refine
Iterative self-correction loop. Generate → critique → revise. Best for: text/code generation where quality is subjective.

### ablation-elimination
Systematically removes components, measures impact. Best for: understanding what matters in complex systems.

---

## Evaluators (8)

### benchmark-harness
Runs standardized benchmark, returns metric. Automated, repeatable. Best for: performance optimization.

### llm-as-judge
Frontier model scores output against rubric or reference. Flexible, subjective. Best for: text quality, reasoning, creativity.

### rubric-scorer
Structured scoring across dimensions (clarity, accuracy, completeness). Best for: content quality, educational materials.

### pairwise-comparison
Presents two candidates, asks which is better. Eliminates absolute scale issues. Best for: subjective preferences, style matching.

### regression-detector
Runs existing tests + new tests. Must pass all. Best for: code changes, production systems.

### human-approval-gate
Human reviews each candidate. Slow but authoritative. Best for: high-stakes outputs, brand voice.

### cost-latency-evaluator
Multi-objective scoring (accuracy, cost, latency). Best for: production ML, API optimization.

### binary-evaluator
Pass/fail check. Simplest possible. Best for: constraint satisfaction, compilation, formatting.

---

## Patterns (6)

### single-ratchet
One champion. New candidate must beat champion to replace. Simplest ratchet. Best for: single artifact optimization.

### two-loop
Outer loop improves strategy, inner loop applies strategy to batch items. Best for: processing many similar items under one policy.

### champion-challenger
Splits traffic: champion (current best) vs challenger (candidate). Statistical significance required. Best for: production A/B testing.

### bounded-episode
Fixed budget (iterations, time, cost). Best candidate at end wins. Best for: time-boxed optimization.

### checkpoint-and-resume
Saves full state periodically. Can resume after interruption. Best for: long-running experiments, cloud preemption.

### branch-and-merge
Multiple parallel branches explore different regions. Merge best results. Best for: diverse exploration, ensemble approaches.

---

## Recipes (8)

### prompt-optimization
Strategy: hill-climbing | Evaluator: llm-as-judge | Pattern: single-ratchet
Optimize system prompts or few-shot examples. Fast iterations, quality judged by LLM.

### code-performance
Strategy: bayesian-optimization | Evaluator: benchmark-harness | Pattern: single-ratchet
Optimize code for speed or memory. Benchmark-driven, regression-safe.

### ml-training
Strategy: evolutionary | Evaluator: cost-latency-evaluator | Pattern: bounded-episode
Tune hyperparameters with multi-objective eval. Budget-aware.

### content-revision
Strategy: self-refine | Evaluator: rubric-scorer | Pattern: single-ratchet
Iterate on articles, docs, emails. Structured quality scoring.

### config-tuning
Strategy: bayesian-optimization | Evaluator: benchmark-harness | Pattern: single-ratchet
Optimize JSON/YAML/TOML configs. Small search space, expensive eval.

### test-amplification
Strategy: evolutionary | Evaluator: regression-detector | Pattern: bounded-episode
Generate tests to find edge cases. Must not break existing tests.

### general-ratchet
Strategy: hill-climbing | Evaluator: llm-as-judge | Pattern: single-ratchet
Default recipe when domain is unclear. Safe, flexible starting point.

### literature-synthesis
Strategy: beam-search | Evaluator: rubric-scorer | Pattern: two-loop
Research synthesis from multiple papers. Structured extraction + scoring.
