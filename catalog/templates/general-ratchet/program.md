# General Ratchet Program

## Objective
Improve the target artifact to maximize the evaluation score for any domain with a measurable metric.

## Mission
This is the most customizable ratchet template.
Use it when the domain does not cleanly fit prompt editing, code optimization, config tuning, or content revision.
Adapt the loop to the artifact and evaluator you have.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifact: [describe the thing being improved]
- Supporting artifacts: [optional helper files, datasets, notes, or scripts]
- Ground truth evaluator: `./eval.sh`

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better
- Define the score so it captures real progress on the task

## Problem Framing
Before making changes, fill in or infer:
- what artifact is being changed
- what counts as success
- what constraints cannot be violated
- what kinds of modifications are allowed
- what failure modes matter most

## Core Loop
1. Inspect the current artifact
2. Form a concrete hypothesis for improvement
3. Apply a focused change
4. Run `./eval.sh`
5. Keep gains, reject regressions
6. Update your mental model of what helps
7. Repeat

## Placeholder Strategy Section
Possible search strategies:
- local hill climbing
- broader rewrites followed by refinement
- branching candidates and keeping the best
- alternating between exploration and exploitation
- systematic sweeps over a few controllable dimensions

## Placeholder Constraints Section
Possible constraints:
- preserve core intent
- keep outputs valid and executable
- maintain compatibility with existing interfaces
- avoid regressions on known edge cases
- stay within budget for tokens, time, or compute

## Placeholder Validation Section
Possible validation checks:
- correctness tests
- style or lint checks
- domain-specific rules
- manual spot checks on representative examples
- guardrail metrics separate from the main score

## Search Discipline
- Prefer interpretable changes over random churn
- Use the evaluator as feedback, not as a substitute for thinking
- Keep a clear notion of the current best candidate
- Revisit assumptions when progress stalls

## Adaptation Notes
- If the evaluator is noisy, rerun promising candidates
- If constraints are strict, validate before each scored run
- If the space is large, identify the highest leverage dimensions first
- If the domain is unfamiliar, simplify the search and learn from outcomes

## Output Standard
- Leave the best measured artifact in place
- The chosen result should reflect both evaluator gains and constraint compliance

## Continuation Rule
Continue until the explicit budget or stop condition is reached.
This template is intentionally open-ended, so do not stop early without a defined reason.
