# Workflow Examples

Three end-to-end walkthroughs showing how to use autoresearch in practice.

## Example 1: Optimizing a Prompt (15 minutes)

All examples below use synthetic, non-sensitive data. Do not supply PHI, patient identifiers, PHI-bearing prompts or model responses, clinical records, secrets, or production datasets to the server or its surrounding tooling.

**Problem**: System prompt for summarizing synthetic product reviews is too verbose.
**Metric**: Compression savings (`1 - output length / input length`), higher is better.
**Constraint**: Must preserve stated product facts (evaluated by LLM judge).

### Step 1: Discover
```
User: "I need to optimize my synthetic product-review summarization prompt."
→ AI: Call suggest_technique(problem="synthetic product-review prompt optimization",
                            has_scalar_metric=true,
                            max_experiment_duration="2 minutes",
                            domain="prompt-engineering")
→ Returns: prompt-optimization recipe recommended
```

### Step 2: Get Details
```
→ AI: Call get_technique("prompt-optimization")
→ Returns: Full recipe details, composition, templates
```

### Step 3: Scaffold and Register
```
→ AI: Call scaffold_experiment(
  recipe_id="prompt-optimization",
  project_path="/home/dev/review-summarizer",
  metric_name="compression_savings",
  target_file="system_prompt.md"
)
→ Returns: Experiment ID: exp-123e4567
→ Creates: program.md, eval.sh, results.tsv in autoresearch/ directory
```

### Step 4: Run Loop
```
Iteration 0: Baseline prompt → Score: 0.42
→ AI: Run autoresearch/eval.sh from the project root, then call log_result(exp-123e4567, iteration=0, score=0.42, improved=false, is_baseline=true,
                     change_description="Baseline system prompt")

Iteration 1: Shorten instruction text → Score: 0.51
→ AI: Call log_result(exp-123e4567, iteration=1, score=0.51,
                     change_description="Shortened instruction from 200 to 80 words")

Iteration 2: Add few-shot example → Score: 0.48
→ AI: Call log_result(exp-123e4567, iteration=2, score=0.48,
                     change_description="Added 2-shot example")

Iteration 3: Compress few-shot → Score: 0.55
→ AI: Call log_result(exp-123e4567, iteration=3, score=0.55,
                     change_description="Compressed few-shot to 1 concise example")

Iteration 4: Final polish → Score: 0.54
→ AI: Call log_result(exp-123e4567, iteration=4, score=0.54,
                     change_description="Added explicit length constraint")
```

The baseline log seeds `best_score` until an improved iteration lands.

### Step 5: Conclude
```
→ AI: Call update_experiment(exp-123e4567, status="completed")
```

**Result**: Compression savings improved 42% → 55%. Best prompt: iteration 4.

---

## Example 2: Tuning API Latency (2 hours)

**Problem**: REST API p95 latency is 450ms, target is <200ms.
**Metric**: p95 latency from load test (lower is better).
**Constraint**: Must not break existing functionality.

### Phase 1: Exploration
```
→ AI: Call suggest_technique(problem="REST API p95 latency optimization",
                            has_scalar_metric=true,
                            max_experiment_duration="10 minutes",
                            needs_overnight=false,
                            domain="code-optimization")
→ Returns: code-performance recipe recommended
```

### Phase 2: Scaffold and Register
```
→ AI: Call scaffold_experiment(
  recipe_id="code-performance",
  project_path="/home/dev/api-server",
  metric_name="p95_latency_ms",
  metric_direction="minimize",
  target_file="src/routes/orders.ts"
)
→ Returns: Experiment ID: exp-api-789
```

### Phase 3: Run with Regression Guard
```
# autoresearch/eval.sh wraps benchmark + regression check and is run from the project root
Iteration 0: Existing implementation → Score: 450ms, improved: false
→ AI: Call log_result(exp-api-789, iteration=0, score=450, improved=false, is_baseline=true,
                     change_description="Baseline API implementation")

Iteration 1: Add DB connection pooling → Score: 380ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=1, score=380,
                     change_description="Added DB connection pooling")
Iteration 2: Add Redis caching → Score: 210ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=2, score=210,
                     change_description="Added Redis caching")
Iteration 3: Batch DB queries → Score: 195ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=3, score=195,
                     change_description="Batched DB queries")
Iteration 4: Add response compression → Score: 205ms, improved: false
→ AI: Call log_result(exp-api-789, iteration=4, score=205,
                     change_description="Added response compression")
Iteration 5: Tune cache TTL → Score: 192ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=5, score=192,
                     change_description="Tuned cache TTL")
Iteration 6: Add async preprocessing → Score: 188ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=6, score=188,
                     change_description="Added async preprocessing")
Iteration 7: Optimize JSON serialization → Score: 190ms, improved: false
→ AI: Call log_result(exp-api-789, iteration=7, score=190,
                     change_description="Optimized JSON serialization")
```

### Phase 4: Analyze
```
→ AI: Call get_experiment(exp-api-789, include_results=true)
→ Shows: Best = iteration 6 (188ms), total cost = $0.23, wall time = 1h 47m
```

---

## Example 3: Human-Supervised Batch

**Problem**: Classify 10,000 synthetic inventory records by stock status. Current accuracy: 87%.
**Metric**: Classification accuracy (higher is better).
**Constraint**: Review a bounded candidate set. Each candidate takes ~30s to evaluate.

### Setup
```
→ AI: Call suggest_technique(problem="synthetic inventory record classification",
                            has_scalar_metric=true,
                            max_experiment_duration="30 seconds",
                            needs_overnight=false,
                            domain="ml-training")
→ Returns: ml-training recipe (hill-climbing + benchmark-harness + single-ratchet)
```

### Scaffold and Register
```
→ AI: Call scaffold_experiment(
  recipe_id="ml-training",
  project_path="/home/dev/inventory-classifier",
  metric_name="accuracy",
  target_file="classifier.py"
)
→ Returns: Experiment ID: exp-inventory-456
```

### Evaluate a Bounded Candidate Set
Run `autoresearch/eval.sh` from the project root. Log exactly one iteration 0 baseline with `is_baseline=true`, then review and log each candidate without asserting `improved`; the server derives strict improvement.

### Review
```
→ AI: Call get_experiment(exp-inventory-456, include_results=true)
→ Shows: Best iteration = 32 (accuracy: 94.2%), stopped after iteration 42
→ Cost: $12.40, wall time: 6h 23m

→ AI: Call update_experiment(exp-inventory-456, status="completed")
```

This walkthrough is illustrative; autoresearch-mcp scaffolds and tracks the work but does not execute the candidate loop or deploy a result.
