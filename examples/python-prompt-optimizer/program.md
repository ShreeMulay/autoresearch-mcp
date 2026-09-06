# Python Prompt Optimizer — Autoresearch Program

## Objective
Optimize `prompt.txt` to maximize the eval score from `eval.py`.
The eval scores the system prompt on how well it guides an LLM to answer
10 Python programming questions with accuracy, code examples, and clear structure.

Higher score = better prompt. Current scoring rubric values:
- Instructing the model to provide code examples (+2 per code question)
- Step-by-step reasoning instructions (+1 per question)
- Code formatting guidance (+1 per question)
- Conciseness instructions (+1 per question)
- Edge case / best practice coverage (+1 per question)
- General guidance coverage (+4 per question)

## Target File
**ONLY modify `prompt.txt`**. This is the system prompt that will be evaluated.

## What NOT to Modify
- `eval.py` — the evaluator. This is LOCKED. Do not read it to game the metric.
- `eval.sh` — the harness wrapper.
- `eval_set.json` — the test questions. Do not read these to overfit.
- `results.tsv` — append-only experiment log.

## Strategy Hints
Try these kinds of changes (one at a time for clear attribution):
1. Add instruction to always include code examples with proper formatting
2. Add instruction for step-by-step explanations
3. Add instruction to mention common pitfalls and edge cases
4. Add instruction for concise, focused answers
5. Try different prompt structures (bullet points vs. paragraphs)
6. Add instruction about Python best practices and idiomatic code
7. Add formatting guidance (markdown code blocks, headers)
8. Try role-playing framings ("You are a senior Python developer...")
9. Add instruction about error handling awareness
10. Experiment with prompt length — sometimes shorter is better

## Experiment Protocol
1. Before making candidates, run `bash eval.sh` on the current `prompt.txt`
2. Record that score as iteration 0 with `is_baseline=true`; there must be exactly one baseline row
3. Make ONE focused change to the prompt
4. Run `bash eval.sh` to get the candidate score
5. If strictly improved: keep the change and commit
6. If not improved: revert to the previous version
7. Record the candidate with a later iteration number and `is_baseline=false`
8. Repeat

## Results Logging
`results.tsv` uses these columns:
```
iteration\tscore\timproved\tis_baseline\tchange_description
```

The first data row must be iteration 0 with `improved=false` and
`is_baseline=true`. Append candidate rows only after that baseline; candidate
rows use `is_baseline=false`.

## NEVER STOP
Keep iterating until the score plateaus or the budget runs out.
The goal is to find the highest-scoring prompt through systematic experimentation.
Each experiment teaches you something about what the evaluator values.
