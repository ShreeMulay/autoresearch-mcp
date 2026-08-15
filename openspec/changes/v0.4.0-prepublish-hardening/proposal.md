# Change: v0.4.0 Pre-Publish Hardening

## Status: IMPLEMENTED LEGACY SCOPE — REGISTRY CLOSEOUT PENDING

## Why

A full post-merge codebase review (oracle, 2026-06-12) found one security blocker, a skill-vs-catalog drift blocker, a runtime-contract blocker, and 14 major issues that must land before the first public npm release. Beads epic: `autoresearch-mcp-19a`.

## Decisions

- The YAML catalog is the authoritative source for recipe compositions; skill and reference docs are regenerated to match.
- Server runtime requires Bun; the standalone skill installer supports Node.js 22 and 24. Both are declared in `engines` and documented.
- First npm release will be `0.4.0` (0.3.0 was never published).
- Follow-up backlog bead `autoresearch-mcp-46d` has been completed: budget/risk/constraints exposure, real zod-to-json-schema conversion, missing recipe templates, artifact inference reuse, tag normalization, E2E readiness polling, and Biome configuration are landed.
- Final release hygiene before npm publish MUST remove all fake-score evaluator fallbacks, verify the package contents from a packed tarball, and archive completed OpenSpec changes.
- A later comprehensive release review overturned the release-ready conclusion. Its integrity remediation and protected package/CI landing are now complete; version 0.4.0 remains unpublished and untagged pending npm authentication and deterministic registry closeout.

## What Changes

### Phase A - Blockers

- [x] A1: Sanitize all user-provided strings interpolated into generated `eval.sh` / `program.md` / `results.tsv` (strip newlines and control chars). Red test: multiline `metric_name` cannot inject a shell command line.
- [x] A2: Regenerate `skills/autoresearch/SKILL.md` and `references/*` from the YAML catalog. Fix drifted compositions for code-performance, ml-training, content-revision, literature-synthesis, general-ratchet (plus test-amplification found drifted). Remove nonexistent `tree-search`. Tool mapping covers all 12 tools.
- [x] A3: Runtime contract: `engines.node` supports Node.js 22 and 24; README distinguishes the Bun server from the Node-only installer and does not describe `bunx` as a global install.
- [x] A4: Installer arg parsing is strict: unknown flags rejected (exit non-zero, no writes), `--target` requires a valid value, `--help` supported. Red tests for `--dryrun` typo and missing target value.

### Phase B - Majors

- [x] B1: README tool table lists all 12 tools including `get_server_info`; CHANGELOG gains a correct 0.4.0 section (actual `catalog` key, user-data-dir default DB path).
- [x] B2: `scaffold_experiment` rejects `target_file` that resolves outside `project_path`.
- [x] B3: `scaffold_experiment` uses curated `catalog/templates/<recipe>/` content when present; generated fallback evaluator fails closed (stderr notice + exit 1) instead of printing 0.
- [x] B4: Input bounds: `list_experiments.limit` max 100; `get_experiment` results capped at 200; tags max 20 entries / 64 chars; cost and duration nonnegative.
- [x] B5: A non-empty search query that sanitizes to zero FTS tokens returns no results plus an unsupported-query message instead of the full catalog.
- [x] B6: `suggest_technique` defaults to `general-ratchet` on zero-score ties and penalizes metric-dependent recipes when `has_scalar_metric` is false. Scoring covered by unit tests (`rankRecipes`).
- [x] B7: Catalog loader errors loudly on duplicate IDs and YAML-vs-directory layer mismatch; bundled catalog loads with zero errors (regression-tested).
- [x] B8: `log_result` gains optional `is_baseline`; `best_score` falls back to the baseline score when no improved iterations exist. Migration v3 adds the column.
- [x] B9: CI: pinned Bun validation plus Node.js 22/24 coverage exercises the standalone installer bin; tarball naming is derived from package.json; packed-install smoke asserts the MCP `tools/list` response includes the expected tools.
- [x] B10: `get_server_info` reports the active database path actually opened, not a recomputed value.

### Release

- [x] Version bumped to 0.4.0 in `package.json` and `src/version.ts`; CHANGELOG updated.
- [x] `bun test` (101 pass / 0 fail), `bunx tsc --noEmit`, `bun run lint`, `bun run build` all pass.
- [x] Packed tarball smoke passes for both public bins, including tools/list and serverInfo 0.4.0 assertions and unknown-flag rejection.
- [x] PR #8 merged to `main` (squash `a971c0a`); subsequent protected CI/runtime reconciliation verified pinned Bun and Node.js 22/24 validation.
- [ ] Publish the verified `0.4.0` tarball and complete byte-verifying registry smoke. BLOCKED: requires operator npm authentication from approved external user-level config; tracked in Beads.
- [x] Forgejo repo `thekidneyexperts/autoresearch-mcp` created (public), `main` pushed at `a971c0a`, branch protection restored (no direct push, 1 approval), GitHub configured as push mirror with sync_on_commit.
- [x] Active validation migrated from Woodpecker to PR-only `.forgejo/workflows/ci.yml`; the single required context is the terminal `ci` job, which requires the pinned Bun and Node.js 22/24 jobs.
- [x] Deferred review backlog landed via Forgejo PR #3 (`be1247d`): missing recipe templates, real zod-to-json-schema, budget/risk/constraints exposure, shared artifact inference, tag normalization, E2E readiness polling, and Biome config.
- [x] Final release hygiene PR: remove/fail-close the remaining fake-score `get_template` fallback, add regression coverage, update CHANGELOG for PR #3/final fix, resolve AGENTS.md observability guidance, archive completed v0.3.0 OpenSpec, and run quality/package gates.
- [x] Complete the superseding v0.4.0 integrity remediation and obtain protected package/CI evidence before publication.

## Close Criteria

This change can be archived only after all of the following are true:

- Final release hygiene PR is merged through Forgejo with required Forgejo Actions CI green.
- `bun test`, `bun run typecheck`, `bun run lint`, and `bun run build` pass on the release commit.
- Packed-package audit/smoke proves runtime files are included and local DBs/secrets/worktree files are excluded.
- `autoresearch-mcp@0.4.0` is published to npm.
- Registry smoke verifies the server bin and skill installer from the published package.
- Git tag `v0.4.0` exists on Forgejo and the GitHub mirror.
- Bead `autoresearch-mcp-7qa` is closed.
