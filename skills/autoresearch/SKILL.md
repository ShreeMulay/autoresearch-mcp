---
name: autoresearch
description: Select and apply autoresearch techniques for optimization problems. Use when user says 'optimize', 'improve this', 'run experiments', 'find best technique', 'ratchet', or when tackling prompt engineering, code optimization, ML training, or workflow tuning. Complements the autoresearch-mcp server (tools + state) with methodology, decision trees, and composition rules for bounded human/agent-driven iteration.
---

# Autoresearch Skill

## When to Activate

### Explicit Triggers
User says any of: "optimize", "improve this", "run experiments", "find best technique", "ratchet", "hill-climbing", "prompt optimization", "autoresearch", "experiment tracking", "measure performance", "tune hyperparameters", "iterate on", "A/B test", "champion-challenger"

### Implicit Signals
- User describes a problem with a measurable outcome but no clear solution path
- User wants to improve something that has been working but could be better
- User mentions comparing options, iterating, or testing variations
- User is writing prompts, code, configs, or content and wants the best version

### When NOT to Use
- One-off tasks with no repeatable evaluation ("write a greeting email")
- Problems with no measurable metric ("make this nicer")
- Time-critical fixes where experimentation delays matter ("production is down")
- User explicitly says "just pick one" or "I don't care about optimal"

## Data Safety Boundary

Use synthetic, non-sensitive data only; examples and tests use synthetic data only. Never send PHI, patient identifiers, PHI-bearing prompts or model responses, clinical records, secrets, or production datasets to this MCP server, evaluators, review tooling, logs, fixtures, or CI.

## Core Philosophy

Autoresearch is iterative improvement against a repeatable evaluation. The loop is:

```
Discover → Suggest → Scaffold → Baseline → Run → Evaluate → Log → Ratchet
```

**Ratchet principle**: Only keep improvements. The best-so-far (champion) is replaced only by something measurably better.

## Decision Tree: Which Technique?

Start here. Answer these questions in order.

### Q1: Do you have a scalar metric?
A single number that defines success (accuracy, latency, score, cost, conversion rate).

**YES** → Use a ratchet pattern (single-ratchet, champion-challenger, two-loop)
**NO** → Use an evaluator-first approach (llm-as-judge, rubric-scorer, human-approval-gate)

### Q2: How long can one experiment take?

- **< 1 minute** → hill-climbing or evolutionary (many iterations fast)
- **1-60 minutes** → beam-search or bayesian-optimization (fewer, smarter iterations)
- **> 1 hour or overnight** → prompt-optimization, beam-search, or multi-armed-bandit

### Q3: Batch or single?

- **Single artifact** (one prompt, one function) → single-ratchet or self-refine
- **Batch of related items** (100 articles, 50 records) → two-loop (outer strategy + inner batch)
- **Continuous stream** → champion-challenger or multi-armed-bandit

### Q4: Human in the loop?

- **Automated evaluator with human/agent orchestration** → Any compatible ratchet pattern
- **Human approves each change** → human-approval-gate evaluator
- **Human judges final output** → llm-as-judge or pairwise-comparison

### Q5: Domain-specific defaults

| Domain | Default Recipe | Why |
|--------|---------------|-----|
| Prompt engineering | prompt-optimization | Natural language mutations, fast eval |
| Code performance | code-performance | Benchmark harness, branch-and-merge |
| ML training | ml-training | Benchmark harness, single-ratchet |
| Content revision | content-revision | Rubric scorer, two-loop |
| Configuration tuning | config-tuning | Bayesian optimization, small search space |
| Test amplification | test-amplification | Benchmark harness, single-ratchet |
| General (unsure) | general-ratchet | Safe defaults, flexible composition |

## Core Workflows

### Workflow A: Quick Optimization (5 minutes)

For fast problems with clear metrics.

1. **Discover**: Call `suggest_technique` with problem description
2. **Scaffold**: Call `scaffold_experiment` with top recipe
3. **Baseline**: Run `autoresearch/eval.sh` from the project root and log exactly one iteration 0 result with `is_baseline=true`
4. **Iterate**: Propose mutation, re-run, compare to champion
5. **Log**: Call `log_result` for each iteration
6. **Decide**: 3-5 iterations, pick best

### Workflow B: Serious Experiment (1 hour)

For important optimizations with budget for rigor.

1. **Discover**: `suggest_technique` + `search_techniques` for related approaches
2. **Get details**: `get_technique` on top 2-3 candidates
3. **Register**: `register_experiment` with full spec
4. **Scaffold**: `scaffold_experiment` for starter files
5. **Baseline**: Run `autoresearch/eval.sh` from the project root and log exactly one iteration 0 result with `is_baseline=true`
6. **Run ratchet**: Use bounded human/agent-driven iterations with strict champion replacement in the declared metric direction
7. **Log all**: `log_result` every iteration; omit `improved` for candidates so the server derives it
8. **Analyze**: `get_experiment` with include_results=true

### Workflow C: Human-Supervised Batch

For a bounded set of candidates prepared or reviewed by a human or agent.

1. **Setup**: Register the experiment, scaffold, and verify the evaluator manually
2. **Baseline**: Log exactly one iteration 0 result with `is_baseline=true`
3. **Review**: Evaluate bounded candidate changes under the configured approval policy
4. **Compare**: Retain only strict improvements in the declared metric direction
5. **Integrate**: Review the best result and use `update_experiment` when complete

## MCP Tool Mapping

| Workflow Step | Primary Tool | Purpose |
|--------------|-------------|---------|
| Discover techniques | `suggest_technique` | AI recommends based on your constraints |
| Deep dive | `get_technique` | Full details, templates, examples |
| Browse catalog | `search_techniques` | Natural language search all 30 techniques |
| Start tracking | `register_experiment` | Create experiment record in SQLite |
| Generate files | `scaffold_experiment` | Create program.md + eval.sh starter files |
| Fetch template | `get_template` | Fetch a recipe's template file such as program.md or eval.sh |
| Log iteration | `log_result` | Record score, change description, cost |
| View progress | `get_experiment` | Experiment summary + all results |
| Browse runs | `list_experiments` | All experiments, filter by status/project |
| Update status | `update_experiment` | Mark running/paused/completed/failed |
| Diagnostics | `get_server_info` | Version, catalog stats, and DB path for diagnostics/handshake |

## Composition Rules

Recipes are composed from 4 layers. You can build custom recipes by mixing layers.

### Layers

1. **Strategy** (search algorithm): How do you explore the space?
   - hill-climbing: greedy local search
   - evolutionary: population-based, genetic mutations
   - bayesian-optimization: model-based, sample-efficient
   - beam-search: keep top-k candidates
   - simulated-annealing: early exploration, late exploitation

2. **Evaluator** (scoring function): How do you judge success?
   - benchmark-harness: automated benchmark
   - llm-as-judge: frontier model evaluates quality
   - rubric-scorer: structured rubric scoring
   - regression-detector: must not break existing
   - human-approval-gate: human decides

3. **Pattern** (execution structure): How do you organize the loop?
   - single-ratchet: one champion, replace if better
   - two-loop: outer strategy + inner batch
   - champion-challenger: A/B test with traffic splitting
   - bounded-episode: fixed budget, best wins
   - checkpoint-and-resume: save state, restart later

4. **Recipe** (pre-composed defaults): Ready-made combinations for common problems.
   - prompt-optimization: hill-climbing + llm-as-judge + single-ratchet
   - code-performance: hill-climbing + benchmark-harness + branch-and-merge
   - ml-training: hill-climbing + benchmark-harness + single-ratchet

### Building Custom Recipes

Pick one from each layer. The only rule: strategy and evaluator must be compatible.

```
Strategy              + Evaluator                    + Pattern           = Recipe
hill-climbing         + llm-as-judge                 + single-ratchet    = prompt-optimization variant
evolutionary          + benchmark-harness          + bounded-episode   = code-performance variant
bayesian-optimization + rubric-scorer                + champion-challenger = config-tuning variant
```

**Compatibility rules**:
- GPU-required strategies (some evolutionary variants) need GPU evaluator or surrogate
- human-approval-gate limits iteration speed — pair with sample-efficient strategies (bayesian-optimization, multi-armed-bandit)
- regression-detector should wrap any evaluator for production systems

## Anti-Patterns

### DON'T: Run without registering
Always `register_experiment` before `log_result`. Orphaned results lose context.

### DON'T: Log candidates before the baseline
Log exactly one iteration 0 result with `is_baseline=true` before any candidate result.

### DON'T: Skip evaluation
"Looks better" is not a metric. Define the evaluator before running the loop.

### DON'T: Change the metric mid-experiment
If you realize your metric is wrong, stop, register a new experiment with the new metric.

### DON'T: Run infinite loops without checkpoints
Use bounded-episode or checkpoint-and-resume. Power outages happen.

### DON'T: Ignore cost
Define token/dollar budgets and stopping conditions in the experiment spec, then enforce them in the agent loop. `register_experiment` tracks core fields; call `log_result` with cost data and review `list_experiments` to see cumulative spend.

### DON'T: Over-optimize early
Start with general-ratchet recipe. Only build custom compositions after 3+ experiments in the same domain.

## Reference

- Full technique catalog: `references/technique-index.md`
- Composition patterns: `references/composition-patterns.md`
- Workflow examples: `references/workflow-examples.md`

## Quick Reference: All Techniques

| ID | Layer | Name | One-Line |
|----|-------|------|----------|
| hill-climbing | strategy | Hill Climbing | Greedy local search, best neighbor wins |
| evolutionary | strategy | Evolutionary | Population-based genetic mutations |
| bayesian-optimization | strategy | Bayesian Optimization | Model-based, sample-efficient |
| beam-search | strategy | Beam Search | Keep top-k candidates |
| simulated-annealing | strategy | Simulated Annealing | Early exploration, late exploitation |
| multi-armed-bandit | strategy | Multi-Armed Bandit | Explore/exploit with regret bounds |
| self-refine | strategy | Self-Refine | Iterative self-correction |
| ablation-elimination | strategy | Ablation Elimination | Remove components, measure impact |
| benchmark-harness | evaluator | Benchmark Harness | Automated performance benchmark |
| llm-as-judge | evaluator | LLM as Judge | Frontier model evaluates quality |
| rubric-scorer | evaluator | Rubric Scorer | Structured rubric scoring |
| pairwise-comparison | evaluator | Pairwise Comparison | A/B comparison between candidates |
| regression-detector | evaluator | Regression Detector | Must not break existing behavior |
| human-approval-gate | evaluator | Human Approval Gate | Human decides yes/no |
| cost-latency-evaluator | evaluator | Cost/Latency Evaluator | Multi-objective cost scoring |
| single-ratchet | pattern | Single Ratchet | One champion, replace if better |
| two-loop | pattern | Two Loop | Outer strategy + inner batch |
| champion-challenger | pattern | Champion-Challenger | A/B test with traffic splitting |
| bounded-episode | pattern | Bounded Episode | Fixed budget, best wins |
| checkpoint-and-resume | pattern | Checkpoint & Resume | Save state, restart later |
| branch-and-merge | pattern | Branch & Merge | Parallel branches, merge best |
| prompt-optimization | recipe | Prompt Optimization | Optimize prompts with ratchet loop |
| code-performance | recipe | Code Performance | Optimize code speed/memory |
| ml-training | recipe | ML Training | Tune hyperparameters |
| content-revision | recipe | Content Revision | Iterate on text/content |
| config-tuning | recipe | Config Tuning | Optimize configuration files |
| test-amplification | recipe | Test Amplification | Generate tests to find bugs |
| general-ratchet | recipe | General Ratchet | Default recipe for any domain |
| literature-synthesis | recipe | Literature Synthesis | Research synthesis from papers |

## Attribution

Methodology inspired by Andrej Karpathy's autoresearch. This skill + the autoresearch-mcp server implement the composable technique catalog pattern for AI-assisted optimization.

License: Apache-2.0
