# ML Training Program

## Objective
Improve a model training artifact or configuration so the selected validation metric improves without violating reproducibility or resource constraints.

## Mission
Use this recipe for training loops, feature pipelines, hyperparameters, model selection, loss functions, and evaluation harnesses where each experiment has a measurable score.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifact: model config, training script, feature pipeline, or experiment recipe
- Supporting artifacts: validation data, metrics output, logs, and reproducibility notes
- Ground truth evaluator: `autoresearch/eval.sh` from the project root

## Metric
- Run `autoresearch/eval.sh` from the project root
- It prints a single float to stdout
- Follow the scaffolded metric direction and require strict improvement
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
