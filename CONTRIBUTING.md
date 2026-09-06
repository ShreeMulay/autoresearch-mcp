# Contributing

Thanks for your interest in improving autoresearch-mcp. The easiest contributions are catalog entries and recipe templates, but code improvements and issue reports are also welcome.

## Data safety for contributions

Use synthetic, non-sensitive data in examples and tests. Do not provide PHI, patient identifiers, PHI-bearing prompts or model responses, clinical records, secrets, or production datasets to the MCP server, evaluators, review tooling, logs, fixtures, or CI. Do not submit real sensitive data in issues or pull requests.

## Adding a new technique

The fastest way to contribute is to add one YAML file to the catalog.

### Pick the right layer

- `catalog/strategies/`: how the search explores candidates, such as hill climbing or beam search
- `catalog/evaluators/`: how results are scored, such as an LLM judge or benchmark harness
- `catalog/patterns/`: how the loop is orchestrated, such as single-ratchet or branch-and-merge
- `catalog/recipes/`: an opinionated composition of the other layers for a real workflow

Create one file per technique in `catalog/{layer}/{technique-id}.yaml`.

### YAML schema

Required fields for all layers:

- `id`: unique slug, usually matching the filename
- `name`: human-readable title
- `layer`: one of `strategy`, `evaluator`, `pattern`, `recipe`
- `description`: what it does
- `when_to_use`: decision criteria for choosing it

Common optional fields:

- `when_not_to_use`
- `core_pattern`
- `source`
- `tags`
- `related`
- `examples` with `domain`, `description`, optional `metric`, optional `result`
- `estimated_cost`
- `experiments_per_hour`
- `requires_gpu`

Recipe-only optional field:

- `composes.search_strategy`
- `composes.evaluator`
- `composes.execution_pattern`

### Complete example

```yaml
id: prompt-critique-loop
name: Prompt Critique Loop
layer: recipe
description: |
  Iteratively improve a prompt by generating one focused revision, scoring it on a
  fixed evaluation set, and keeping only improvements.
when_to_use: |
  - You have a stable prompt file and a repeatable eval harness.
  - Quality can be measured with an LLM judge or downstream task score.
when_not_to_use: |
  - The real bottleneck is retrieval, tooling, or model choice rather than prompt wording.
core_pattern: |
  1. Score the baseline prompt.
  2. Make one focused revision.
  3. Re-run the evaluator.
  4. Keep the change only if the score improves.
source: Composed recipe for prompt optimization
tags: [prompting, llm, iterative]
related: [prompt-optimization, hill-climbing, single-ratchet]
examples:
  - domain: support automation
    description: Improve a support system prompt against a held-out conversation set.
    metric: average judge score
    result: higher helpfulness with no policy regressions
composes:
  search_strategy: hill-climbing
  evaluator: llm-as-judge
  execution_pattern: single-ratchet
estimated_cost: $0.05-$0.20 per experiment
experiments_per_hour: 10
requires_gpu: false
```

Tips:

- Prefer concrete decision criteria over abstract theory.
- Add examples that help a future user choose quickly.
- Link related techniques so discovery stays composable.

## Adding a recipe template

Recipe templates live in `catalog/templates/{recipe-id}/` and usually include:

- `program.md`
- `eval.sh`

`program.md` should follow the Karpathy-style pattern: it is the human-agent interface, written by a human, read by an agent. Good templates are lightweight, specific, and operational.

If you add a new recipe ID, update all recipe touchpoints in the same change:

- `catalog/recipes/{recipe-id}.yaml`
- `catalog/templates/{recipe-id}/program.md`
- `catalog/templates/{recipe-id}/eval.sh`
- the `RecipeId` enum in `src/types.ts`
- scaffold/template tests that prove the recipe has usable templates

Do not add a recipe YAML file without updating `RecipeId`; MCP tool schemas use that enum for validation.

A good `program.md` should explain:

- the objective and primary metric
- what the agent can modify
- what the agent must not modify
- strategy hints for the search
- danger zones and anti-patterns
- when to continue and when to stop

`autoresearch/eval.sh` should be run from the project root, be deterministic when possible, and print a single finite float to stdout. Whether higher or lower is better is defined by `metric_direction`. Log exactly one iteration 0 result with `is_baseline=true` before candidates.

## Ratchet execution phases

When contributing toward autonomous execution, keep the `run_ratchet` path phased and explicit:

1. **Plan**: load the experiment spec, budget, risk policy, and constraints.
2. **Baseline**: run the evaluator once and record exactly one iteration 0 result with `is_baseline=true`.
3. **Mutate**: propose one bounded change to the target artifact.
4. **Evaluate**: run the evaluator and collect the scalar score plus costs.
5. **Accept or revert**: keep only strict improvements in the declared metric direction and reject all other candidates.
6. **Record**: log iteration score, change description, cost, and whether it improved the champion.
7. **Stop**: honor max iterations, time, cost, plateau, approval, and safety constraints.

Each phase should be independently testable. Avoid adding a monolithic autonomous loop that bypasses the existing experiment records.

## Code contributions

1. Fork the repo.
2. Create a branch for your change.
3. Make the update.
4. Run the checks locally:

```bash
bun test
bun run typecheck
bun run lint
bun run build
```

5. Open a pull request with a clear summary and rationale.

TypeScript conventions used in this project:

- strict mode
- Zod validation at boundaries
- RORO: receive an object, return an object
- small, composable functions over hidden side effects

## Maintainer release runbook

Release only from a clean revision already merged through the protected Forgejo pull-request path. Confirm that the checked-out revision is the intended release revision and that its exact Forgejo CI head passed. npm credentials must live in approved external user-level npm configuration outside the repository and worktree; never put credentials in command arguments, repository files, artifacts, logs, or CI.

```bash
test -z "$(git status --porcelain)"
bun run test:package -- --artifact-output /absolute/release-dir
npm whoami --registry=https://registry.npmjs.org/
bun run release:control -- publish /absolute/release-dir/autoresearch-mcp-0.4.0.tgz
bun run release:control -- smoke /absolute/release-dir/autoresearch-mcp-0.4.0.tgz

# Only after smoke succeeds:
git tag -a v0.4.0 -m "autoresearch-mcp v0.4.0"
git push forgejo v0.4.0
# Verify the Forgejo tag before mirroring it:
git push origin v0.4.0
```

The controller accepts only an absolute tarball path; never publish the working directory. npm versions are immutable: if `0.4.0` already exists, or a publish result is conflicting or ambiguous, stop and reconcile rather than retrying or replacing it. Do not automatically deprecate anything, and do not unpublish. Do not create or push the tag unless registry smoke succeeds; push Forgejo first and GitHub only after the Forgejo tag is verified.

## Filing issues

Bug reports should include:

- steps to reproduce
- expected behavior
- actual behavior
- environment details such as Bun version, OS, and relevant inputs

Feature requests should focus on the use case and problem to solve, not only the implementation idea.

## Code of Conduct

Be respectful, constructive, and inclusive. Assume good intent, give actionable feedback, and keep discussions focused on improving the project. Harassment, personal attacks, and dismissive behavior are not acceptable.
