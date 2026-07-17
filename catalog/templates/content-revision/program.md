# Content Revision Program

## Objective
Improve content quality with a measurable rubric-driven evaluation process.

## Mission
You are revising content using a two-loop workflow.
The outer loop improves the generation or revision strategy.
The inner loop applies that strategy to each article or content unit.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifacts: article drafts or content files
- Strategy artifact: the reusable generation or revision approach
- Evaluation artifact: rubric-based scoring from `eval.sh`

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better
- The score should reflect rubric quality across the content set

## Two-Loop Structure
Outer loop:
- improve the revision strategy itself
- test whether the strategy generalizes across multiple pieces

Inner loop:
- apply the current strategy to each article
- revise for quality, coherence, and rubric alignment

## Rubric Orientation
Common rubric dimensions may include:
- clarity
- accuracy
- structure
- completeness
- tone fit
- readability
- originality or usefulness

## Core Loop
1. Read the current strategy and sample content
2. Identify the weakest rubric dimension
3. Update the strategy or instructions
4. Apply the strategy to one or more articles
5. Run `./eval.sh`
6. Keep the strategy only if aggregate score improves
7. Repeat

## Strategy Hints
Try:
- stronger outlining before drafting
- clearer section goals
- tighter style guidance
- explicit rubric checklists
- examples of strong versus weak passages
- post-pass cleanup for redundancy or awkward transitions

## Article-Level Tactics
- strengthen openings and conclusions
- improve paragraph flow
- remove repetition
- increase specificity where needed
- simplify confusing sentences
- align tone to audience and purpose

## Constraints
- Preserve factual integrity
- Maintain the intended audience and voice
- Do not inflate score with empty verbosity
- Keep revisions grounded in the rubric, not just stylistic preference
- Avoid losing useful substance while improving polish

## Generalization Rule
- Prefer strategy changes that help multiple articles
- Do not overfit to one article if the total set gets worse
- Watch for regressions in pieces that were already strong

## Output Standard
- Leave behind the current best strategy and the best revised content set found so far
- The winning version should improve the measured rubric score, not just sound nicer

## Continuation Rule
Continue iterating until the content budget, article budget, or supervisor stop condition is reached.
Do not stop at the first good-looking draft.
