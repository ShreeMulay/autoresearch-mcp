# Test Amplification Program

## Objective
Improve the target artifact by adding or strengthening tests that catch real regressions without creating brittle noise.

## Mission
Use this recipe when the main artifact is a codebase, package, or behavior contract and the metric rewards better defect detection, coverage, mutation score, or regression confidence.

## Data Safety
Use synthetic, non-sensitive data only; never expose PHI, patient identifiers, clinical records, secrets, PHI-bearing prompts or model responses, or production datasets to the server, evaluator, review tooling, logs, fixtures, or CI.

## Target
- Primary artifact: the tests around the selected behavior
- Supporting artifact: the implementation under test, read-only unless the evaluator proves the test exposed a real defect
- Ground truth evaluator: `autoresearch/eval.sh` from the project root

## Metric
- Run `autoresearch/eval.sh` from the project root
- It prints a single float to stdout
- Follow the scaffolded metric direction and require strict improvement
- Reject ties and regressions; retain the earlier champion
- The score should reward tests that fail for meaningful defects and pass for correct behavior

## Core Loop
1. Inspect the behavior, edge cases, and existing tests.
2. Identify one untested branch, invariant, failure mode, or integration seam.
3. Add the smallest clear test that proves the behavior.
4. Run `autoresearch/eval.sh` from the project root and any nearby targeted tests.
5. Keep tests that improve signal; remove or simplify brittle assertions.
6. Repeat with a new gap.

## Test Quality Rules
- Prefer behavior assertions over implementation details.
- Keep test fixtures minimal and readable.
- Avoid sleeps, live network calls, nondeterministic clocks, and external credentials.
- Name tests after the behavior or invariant they protect.
- If a test reveals a bug, document the bug before changing production code.

## What Not to Do
- Do not inflate coverage with tests that assert mocks were called without verifying outcomes.
- Do not rewrite broad test suites when one focused test will move the metric.
- Do not weaken existing tests to make new ones pass.

## Output Standard
Leave the repository with the strongest passing test set found within budget and a clear record of the behavior now protected.

## Continuation Rule
These are operator instructions; the autoresearch server records budgets and approvals but does not enforce them.
- Before repeated execution, obtain and record a finite bound (max iterations, time, tokens, or dollars); if none is set, ask the operator for one before looping.
- Persist through plateaus and early wins; do not end the loop merely because a result looks good.
- Stop when any recorded budget is exhausted.
- Stop and wait when human approval is required; when the risk policy sets requires_approval, obtain approval before each candidate evaluation or acceptance.
- Stop on any safety or validity failure, such as an evaluator error, a constraint violation, or a data-safety concern.
- Stop when the supervisor says stop.
