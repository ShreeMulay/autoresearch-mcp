# ML Training Program

## Objective
Improve a model training artifact or configuration so the selected validation metric improves without violating reproducibility or resource constraints.

## Mission
Use this recipe for training loops, feature pipelines, hyperparameters, model selection, loss functions, and evaluation harnesses where each experiment has a measurable score.

## Target
- Primary artifact: model config, training script, feature pipeline, or experiment recipe
- Supporting artifacts: validation data, metrics output, logs, and reproducibility notes
- Ground truth evaluator: `./eval.sh`

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better unless your evaluator inverts a loss into a score
- Always preserve the validation split and leakage boundaries

## Core Loop
1. Confirm the current baseline score and variance.
2. Change one training dimension at a time: data processing, model capacity, loss, optimizer, schedule, regularization, or inference threshold.
3. Run the evaluator and record the score, wall time, and resource use.
4. Keep changes that improve validation performance without degrading guardrails.
5. Prefer simple, reproducible gains over opaque parameter churn.

## Guardrails
- Do not train on validation or test labels.
- Do not hard-code evaluation examples.
- Keep random seeds, dataset versions, and runtime settings explicit.
- Track GPU/CPU/time budget when relevant.
- Validate that gains are not explained by leakage or nondeterminism.

## Output Standard
Leave the best measured configuration in place with enough notes for another run to reproduce the result.
