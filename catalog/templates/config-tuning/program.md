# Config Tuning Program

## Objective
Tune the target configuration or hyperparameters to maximize the evaluation score.

## Mission
You are optimizing a configuration file rather than source code.
Use disciplined parameter changes, measure outcomes, and keep the best valid config.

## Target
- Primary artifact: the target config file
- Optional artifacts: search notes, result tables, sweep logs
- The evaluator determines whether a config is actually better

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better
- Accept changes based on measured score, not intuition alone

## Validity Rule
Keep configs valid at all times.
Do not leave broken syntax, missing required fields, or impossible parameter combinations.
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Search Style
Use a systematic search process.
Prefer informed sweeps over random wandering.
Use prior results to guide the next candidate.

## Core Loop
1. Read the current config and understand the main knobs
2. Identify which parameters likely matter most
3. Propose one change or one small set of coordinated changes
4. Run `./eval.sh`
5. Record the outcome mentally or in notes
6. Keep improvements and reject regressions
7. Narrow in on promising regions

## Strategy Hints
Try:
- systematic parameter sweeps
- coarse-to-fine tuning
- one-factor-at-a-time tests when interactions are unclear
- paired changes when parameters are known to interact
- using prior best settings as anchors
- checking for saturation at boundaries

## Interpretation Rules
- Distinguish real gains from evaluator noise
- Prefer stable improvements over one-off spikes
- If results are noisy, rerun promising configs
- Watch for diminishing returns when near a plateau

## Constraints
- Preserve the intended operating mode of the system
- Keep values within realistic ranges
- Avoid silent invalid states that pass parsing but fail behaviorally
- Do not edit unrelated files unless required by the tuning workflow

## Practical Heuristics
- Start with the highest leverage parameters
- Use wider moves early and smaller moves later
- If you see a strong trend, continue in that direction until it weakens
- If the space is large, prioritize parameters with interpretable effects

## Plateau Handling
- Reassess which parameters are actually sensitive
- Explore interactions if single-variable changes stall
- Return to the best known config before branching further

## Output Standard
- Leave the best valid config in place
- The selected config should be measurable, reproducible, and evaluator-approved

## Continuation Rule
Keep iterating until the sweep budget, time budget, or supervisor stop condition is reached.
Do not stop after the first apparent improvement.
