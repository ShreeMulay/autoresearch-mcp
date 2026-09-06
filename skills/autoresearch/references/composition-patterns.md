# Composition Patterns

How to combine strategies, evaluators, and patterns into effective recipes.

## The 4-Layer Model

Every autoresearch recipe is composed of:

1. **Strategy**: How you search the space
2. **Evaluator**: How you judge success
3. **Pattern**: How you organize the execution
4. **Recipe**: A pre-composed triple (strategy + evaluator + pattern) for a common problem

## Building Custom Recipes

### Step 1: Identify Your Constraints

Answer these questions:

| Question | Affects |
|----------|---------|
| Do you have a scalar metric? | Pattern choice (ratchet needs scalar) |
| How long per experiment? | Strategy choice (fast = hill-climbing, slow = bayesian-optimization) |
| How many items? | Pattern choice (single = ratchet, batch = two-loop) |
| Is evaluation automated? | Evaluator choice (auto = benchmark-harness, subjective = llm-as-judge) |
| Can you run overnight? | Strategy choice (evolutionary benefits from long runs) |
| Is production safety required? | Evaluator choice (add regression-detector) |

### Step 2: Pick Compatible Layers

**Strategy-Evaluator Compatibility Matrix**

| Strategy | benchmark-harness | llm-as-judge | rubric-scorer | pairwise-comparison | regression-detector | human-approval-gate |
|----------|-------------------|--------------|---------------|---------------------|---------------------|---------------------|
| hill-climbing | Best | Good | Good | Slow | Good | Too slow |
| evolutionary | Best | Good | Good | Slow | Good | Too slow |
| bayesian-optimization | Good | Expensive | Expensive | N/A | Good | N/A |
| beam-search | Good | Expensive | Good | N/A | Good | N/A |
| simulated-annealing | Best | Good | Good | Slow | Good | Too slow |
| multi-armed-bandit | Best | Good | Good | Slow | Good | Too slow |
| self-refine | N/A | Best | Best | N/A | N/A | Good |
| ablation-elimination | Good | N/A | N/A | N/A | Best | N/A |

**Legend**: Best = natural fit, Good = works well, Slow = possible but inefficient, Expensive = high cost per iteration, N/A = not applicable, Too slow = human bottleneck

### Step 3: Choose Pattern

| Pattern | When to Use |
|---------|-------------|
| single-ratchet | One artifact, clear metric, sequential improvement |
| two-loop | Many similar items, shared strategy, per-item evaluation |
| champion-challenger | Production traffic, statistical significance needed |
| bounded-episode | Fixed budget (time/money), must stop and deliver |
| checkpoint-and-resume | Long runs, interruption risk, cloud environments |
| branch-and-merge | Diverse exploration, parallel resources available |

### Step 4: Assemble

Example: "I want to optimize my API response format for clarity, evaluated by customer support tickets."

- **Strategy**: self-refine (iterative text improvement)
- **Evaluator**: llm-as-judge (or human-approval-gate if stakes high)
- **Pattern**: single-ratchet (one format document)
- **Custom recipe**: self-refine + llm-as-judge + single-ratchet

## Common Pitfalls

### Mismatched Speed
Pairing slow evaluator (human-approval-gate) with fast strategy (hill-climbing) creates a bottleneck. Either automate evaluation or switch to sample-efficient strategy.

### Missing Regression Guard
Production optimizations without regression-detector are dangerous. Always add regression check for deployed systems.

### Over-Engineering First Recipe
Start with general-ratchet. Build custom recipes only after 3+ experiments teach you what matters in your domain.

### Ignoring Cost
bayesian-optimization with llm-as-judge evaluator = expensive per iteration. Set iteration budgets. Use cost-latency-evaluator for multi-objective awareness.

## Meta-Composition

You can compose recipes themselves:

```
Phase 1: general-ratchet (explore, find promising region)
Phase 2: custom recipe (exploit, fine-tune in good region)
Phase 3: champion-challenger (validate, production A/B test)
```

Log each phase as a separate experiment and compare its recorded result history directly.
