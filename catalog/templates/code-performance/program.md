# Code Performance Program

## Objective
Improve the target code so benchmark score increases while existing behavior remains correct.

## Mission
You are optimizing implementation performance against a measurable benchmark.
The target file is editable.
Your job is to find faster approaches without breaking correctness.

## Target
- Primary artifact: the target source file or small set of source files
- Validation artifacts: benchmark harness, tests, profiling notes
- Keep the benchmark runner and test suite as the ground truth

## Metric
- Run `./eval.sh`
- It prints a single float to stdout
- Higher is better
- Treat score changes as the decision rule for accepting or rejecting changes

## Required Safety Rule
Do not break existing tests.
If there is a test suite, keep it passing after every accepted change.
If a faster version fails correctness checks, it is not an improvement.

## Core Loop
1. Understand the hot path
2. Form a hypothesis about the main bottleneck
3. Change the implementation
4. Run tests if available
5. Run `./eval.sh`
6. Keep the change only if correctness holds and score improves
7. Repeat

## Strategy Hints
Consider:
- algorithmic improvements with better asymptotic cost
- caching repeated work
- batching operations to reduce overhead
- reducing allocations and copies
- using more appropriate data structures
- parallelization where safe and worthwhile
- avoiding unnecessary serialization or parsing
- precomputing reusable values

## Profiling Mindset
- Optimize the expensive path, not the convenient path
- Prefer measured bottlenecks over guesses
- Validate that a micro-optimization matters to the full benchmark
- Watch for tradeoffs in memory, complexity, and maintainability

## Constraints
- Preserve public behavior and interfaces unless explicitly allowed
- Keep code readable enough for future maintenance
- Avoid speculative complexity without measured gain
- Do not delete essential guardrails for a benchmark bump
- Avoid changing unrelated code

## Escalation Order
- Start with easy wins
- Then consider structural changes
- Use major rewrites only when the expected gain is meaningful

## Plateau Handling
- If scores stop moving, revisit algorithmic choices
- If one area is saturated, search for the next bottleneck
- If benchmark noise is high, rerun and compare medians or averages

## Output Standard
- Leave the repository with the fastest verified version found so far
- The accepted code should be benchmark-improved and behaviorally correct

## Continuation Rule
Continue iterating until the run budget, time budget, or supervisor stop condition is reached.
Do not stop merely because the code looks optimized.
