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
- Ground truth evaluator: `./eval.sh`

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better
- The score should reward tests that fail for meaningful defects and pass for correct behavior

## Core Loop
1. Inspect the behavior, edge cases, and existing tests.
2. Identify one untested branch, invariant, failure mode, or integration seam.
3. Add the smallest clear test that proves the behavior.
4. Run `./eval.sh` and any nearby targeted tests.
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
