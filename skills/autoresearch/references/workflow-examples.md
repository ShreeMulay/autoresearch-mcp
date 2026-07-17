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
Iteration 1: Baseline prompt → Score: 0.42
→ AI: Call log_result(exp-123e4567, iteration=1, score=0.42, improved=false, is_baseline=true,
                     change_description="Baseline system prompt")

Iteration 2: Shorten instruction text → Score: 0.51
→ AI: Call log_result(exp-123e4567, iteration=2, score=0.51, improved=true, is_baseline=false,
                     change_description="Shortened instruction from 200 to 80 words")

Iteration 3: Add few-shot example → Score: 0.48
→ AI: Call log_result(exp-123e4567, iteration=3, score=0.48, improved=false, is_baseline=false,
                     change_description="Added 2-shot example")

Iteration 4: Compress few-shot → Score: 0.55
→ AI: Call log_result(exp-123e4567, iteration=4, score=0.55, improved=true, is_baseline=false,
                     change_description="Compressed few-shot to 1 concise example")

Iteration 5: Final polish → Score: 0.54
→ AI: Call log_result(exp-123e4567, iteration=5, score=0.54, improved=false, is_baseline=false,
                     change_description="Added explicit length constraint")
```

The baseline log seeds `best_score` until an improved iteration lands.

### Step 5: Conclude
```
→ AI: Call update_experiment(exp-123e4567, status="completed")
→ AI: Call log_technique_outcome(
  technique_id="prompt-optimization",
  domain="prompt-engineering",
  outcome="success",
  score_improvement=30.9,  // (0.55-0.42)/0.42 * 100
  total_experiments=5,
  notes="Few-shot examples helped but needed compression. Explicit constraints backfired."
)
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
# Custom eval.sh wraps benchmark + regression check
Iteration 0: Existing implementation → Score: 450ms, improved: false
→ AI: Call log_result(exp-api-789, iteration=0, score=450, improved=false, is_baseline=true,
                     change_description="Baseline API implementation")

Iteration 1: Add DB connection pooling → Score: 380ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=1, score=380, improved=true, is_baseline=false,
                     change_description="Added DB connection pooling")
Iteration 2: Add Redis caching → Score: 210ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=2, score=210, improved=true, is_baseline=false,
                     change_description="Added Redis caching")
Iteration 3: Batch DB queries → Score: 195ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=3, score=195, improved=true, is_baseline=false,
                     change_description="Batched DB queries")
Iteration 4: Add response compression → Score: 205ms, improved: false
→ AI: Call log_result(exp-api-789, iteration=4, score=205, improved=false, is_baseline=false,
                     change_description="Added response compression")
Iteration 5: Tune cache TTL → Score: 192ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=5, score=192, improved=true, is_baseline=false,
                     change_description="Tuned cache TTL")
Iteration 6: Add async preprocessing → Score: 188ms, improved: true
→ AI: Call log_result(exp-api-789, iteration=6, score=188, improved=true, is_baseline=false,
                     change_description="Added async preprocessing")
Iteration 7: Optimize JSON serialization → Score: 190ms, improved: false
→ AI: Call log_result(exp-api-789, iteration=7, score=190, improved=false, is_baseline=false,
                     change_description="Optimized JSON serialization")
```

### Phase 4: Analyze
```
→ AI: Call get_experiment(exp-api-789, include_results=true)
→ Shows: Best = iteration 6 (188ms), total cost = $0.23, wall time = 1h 47m
```

### Phase 5: Meta-Learn
```
→ AI: Call log_technique_outcome(
  technique_id="code-performance",
  domain="code-optimization",
  outcome="success",
  score_improvement=58.2,  // (450-188)/450 * 100
  notes="Caching + batching gave biggest wins. Compression added overhead."
)
```

---

## Example 3: Overnight Batch Processing

**Problem**: Classify 10,000 synthetic inventory records by stock status. Current accuracy: 87%.
**Metric**: Classification accuracy (higher is better).
**Constraint**: Must complete by morning. Each record takes ~30s to evaluate.

### Setup
```
→ AI: Call suggest_technique(problem="synthetic inventory record classification",
                            has_scalar_metric=true,
                            max_experiment_duration="30 seconds",
                            needs_overnight=true,
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

### Script the Loop
```python
# overnight_loop.py
# Runs 50 iterations, each evaluating on a 100-record sample
# Logs every result
# Stops if no improvement for 10 iterations
# Checkpoint every 5 iterations

exp_id = "exp-inventory-456"
baseline_score = evaluate(current_best, sample_size=100)
log_result(exp_id, iteration=0, score=baseline_score, improved=False,
           is_baseline=True, change_description="Baseline inventory classifier")
best_score = baseline_score
last_improvement = 0

for iteration in range(1, 50):
    candidate = mutate_model(current_best)
    score = evaluate(candidate, sample_size=100)
    improved = score > best_score
    log_result(exp_id, iteration=iteration, score=score, improved=improved,
               is_baseline=False, change_description="Candidate model mutation")
    if improved:
        best_score = score
        current_best = candidate
        last_improvement = iteration
        save_checkpoint(iteration, candidate)
    if iteration - last_improvement >= 10:
        break
```

### Morning Review
```
→ AI: Call get_experiment(exp-inventory-456, include_results=true)
→ Shows: Best iteration = 32 (accuracy: 94.2%), stopped after iteration 42
→ Cost: $12.40, wall time: 6h 23m

→ AI: Call update_experiment(exp-inventory-456, status="completed")
→ AI: Call log_technique_outcome(
  technique_id="ml-training",
  domain="ml-training",
  outcome="success",
  score_improvement=8.3,
  notes="Single-ratchet kept only benchmark improvements. Early stopping at iter 42 saved 8 iterations."
)
```

**Result**: Accuracy 87% → 94.2%. Model deployed after regression test.
