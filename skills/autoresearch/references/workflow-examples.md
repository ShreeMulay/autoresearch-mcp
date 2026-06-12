# Workflow Examples

Three end-to-end walkthroughs showing how to use autoresearch in practice.

## Example 1: Optimizing a Prompt (15 minutes)

**Problem**: System prompt for summarizing medical notes is too verbose.
**Metric**: Compression ratio (output length / input length), higher is better.
**Constraint**: Must preserve clinical accuracy (evaluated by LLM judge).

### Step 1: Discover
```
User: "I need to optimize my medical note summarization prompt."
→ AI: Call suggest_technique(problem="medical note summarization prompt optimization",
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

### Step 3: Register
```
→ AI: Call register_experiment(
  project_path="/home/dev/medical-summarizer",
  metric_name="compression_ratio",
  metric_direction="maximize",
  target_artifact="system_prompt.md",
  evaluator_command="python evaluate_compression.py",
  recipe_id="prompt-optimization"
)
→ Returns: Experiment ID: exp-123e4567
```

### Step 4: Scaffold
```
→ AI: Call scaffold_experiment(
  recipe_id="prompt-optimization",
  project_path="/home/dev/medical-summarizer",
  metric_name="compression_ratio"
)
→ Creates: program.md, eval.sh in autoresearch/ directory
```

### Step 5: Run Loop
```
Iteration 1: Baseline prompt → Score: 0.42
→ AI: Call log_result(exp-123e4567, iteration=1, score=0.42, improved=false, is_baseline=true,
                     change_description="Baseline system prompt")

Iteration 2: Shorten instruction text → Score: 0.51
→ AI: Call log_result(exp-123e4567, iteration=2, score=0.51, improved=true,
                     change_description="Shortened instruction from 200 to 80 words")

Iteration 3: Add few-shot example → Score: 0.48
→ AI: Call log_result(exp-123e4567, iteration=3, score=0.48, improved=false,
                     change_description="Added 2-shot example")

Iteration 4: Compress few-shot → Score: 0.55
→ AI: Call log_result(exp-123e4567, iteration=4, score=0.55, improved=true,
                     change_description="Compressed few-shot to 1 concise example")

Iteration 5: Final polish → Score: 0.54
→ AI: Call log_result(exp-123e4567, iteration=5, score=0.54, improved=false,
                     change_description="Added explicit length constraint")
```

The baseline log seeds `best_score` until an improved iteration lands.

### Step 6: Conclude
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

**Result**: Compression ratio improved 42% → 55%. Best prompt: iteration 4.

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

### Phase 2: Register & Scaffold
```
→ AI: Call register_experiment(
  project_path="/home/dev/api-server",
  metric_name="p95_latency_ms",
  metric_direction="minimize",
  target_artifact="src/routes/patient.ts",
  evaluator_command="k6 run load-test.js",
  recipe_id="code-performance"
)
→ AI: Call scaffold_experiment(recipe_id="code-performance", ...)
```

### Phase 3: Run with Regression Guard
```
# Custom eval.sh wraps benchmark + regression check
Iteration 1: Add DB connection pooling → Score: 380ms, improved: true
Iteration 2: Add Redis caching → Score: 210ms, improved: true
Iteration 3: Batch DB queries → Score: 195ms, improved: true
Iteration 4: Add response compression → Score: 205ms, improved: false
Iteration 5: Tune cache TTL → Score: 192ms, improved: true
Iteration 6: Add async preprocessing → Score: 188ms, improved: true
Iteration 7: Optimize JSON serialization → Score: 190ms, improved: false
```

Each iteration logged with `log_result`.

### Phase 4: Analyze
```
→ AI: Call get_experiment(exp-id, include_results=true)
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

**Problem**: Process 10,000 patient records, extract CKD stage. Current accuracy: 87%.
**Metric**: Classification accuracy (higher is better).
**Constraint**: Must complete by morning. Each record takes ~30s to evaluate.

### Setup
```
→ AI: Call suggest_technique(problem="batch medical record classification",
                            has_scalar_metric=true,
                            max_experiment_duration="30 seconds",
                            needs_overnight=true,
                            domain="ml-training")
→ Returns: ml-training recipe (hill-climbing + benchmark-harness + single-ratchet)
```

### Register
```
→ AI: Call register_experiment(
  project_path="/home/dev/ckd-classifier",
  metric_name="accuracy",
  metric_direction="maximize",
  target_artifact="classifier.py",
  evaluator_command="python evaluate_batch.py --sample=100",
  recipe_id="ml-training"
)
```

### Script the Loop
```python
# overnight_loop.py
# Runs 50 iterations, each evaluating on 100-record sample
# Logs every result
# Stops if no improvement for 10 iterations
# Checkpoint every 5 iterations

for iteration in range(50):
    candidate = mutate_model(current_best)
    score = evaluate(candidate, sample_size=100)
    log_result(exp_id, iteration, score, ...)
    if score > best_score:
        best_score = score
        current_best = candidate
        save_checkpoint(iteration, candidate)
    if iteration - last_improvement > 10:
        break
```

### Morning Review
```
→ AI: Call get_experiment(exp-id, include_results=true)
→ Shows: Best iteration = 34 (accuracy: 94.2%), total iterations = 42
→ Cost: $12.40, wall time: 6h 23m

→ AI: Call update_experiment(exp-id, status="completed")
→ AI: Call log_technique_outcome(
  technique_id="ml-training",
  domain="ml-training",
  outcome="success",
  score_improvement=8.3,
  notes="Single-ratchet kept only benchmark improvements. Early stopping at iter 42 saved 8 iterations."
)
```

**Result**: Accuracy 87% → 94.2%. Model deployed after regression test.
