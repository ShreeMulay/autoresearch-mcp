# Prompt Optimization Program

## Objective
Improve the target prompt's evaluation score in the declared metric direction.

## Mission
You are running a bounded ratchet on a prompt file.
Your job is to edit the target prompt, run the evaluator, study the result, and keep any change that improves the score.
Treat the current best prompt as the baseline to beat.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifact: the target prompt file for this task
- Secondary artifacts: notes, scratch files, or candidate variants if useful
- The evaluator is the source of truth, not your intuition

## Metric
- Run `autoresearch/eval.sh` from the project root
- It must print a single float to stdout
- Follow the scaffolded metric direction and require strict improvement
- Reject ties and regressions; retain the earlier champion
- Optimize strictly for that score while preserving the real intent of the prompt

## Core Loop
1. Read the current prompt carefully
2. Form a hypothesis for why it is underperforming
3. Make one focused change or one coherent bundle of related changes
4. Run `autoresearch/eval.sh` from the project root
5. If the score improves, keep the change
6. If the score gets worse or stays flat, revert or pivot
7. Repeat

## Strategy Hints
Try changes like:
- rewording instructions for precision
- adding, removing, or simplifying examples
- restructuring sections to improve clarity
- changing tone to be firmer or more concise
- separating constraints from goals
- clarifying output format
- removing redundant or conflicting instructions
- tightening success criteria

## Prompt Design Principles
- Prefer clear instructions over clever wording
- Reduce ambiguity whenever possible
- Keep related ideas grouped together
- Put critical constraints where they are hard to miss
- Avoid verbose filler that consumes tokens without adding control
- If examples help, make them short and representative

## Constraints
- Keep the prompt under the available token budget
- Maintain the core intent of the original task
- Do not optimize by making the prompt irrelevant to the true goal
- Do not assume the evaluator is perfect; watch for overfitting signals
- Keep the prompt internally consistent

## Change Discipline
- Make it easy to explain why each revision might help
- Prefer small, interpretable edits before large rewrites
- When doing a full rewrite, preserve the original mission and constraints
- Track what kinds of changes tend to help on this task

## Failure Handling
- If a change hurts, back out quickly
- If scores plateau, try a different prompt structure rather than random churn
- If a candidate ties the champion, revert it and retain the earlier champion

## Output Standard
- The working tree should contain the current best prompt
- The best prompt should be the one you would hand to production given the measured score

## Continuation Rule
These are operator instructions; the autoresearch server records budgets and approvals but does not enforce them.
- Before repeated execution, obtain and record a finite bound (max iterations, time, tokens, or dollars); if none is set, ask the operator for one before looping.
- Persist through plateaus and early wins; do not end the loop merely because a result looks good.
- Stop when any recorded budget is exhausted.
- Stop and wait when human approval is required; when the risk policy sets requires_approval, obtain approval before each candidate evaluation or acceptance.
- Stop on any safety or validity failure, such as an evaluator error, a constraint violation, or a data-safety concern.
- Stop when the supervisor says stop.
