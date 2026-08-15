# Change: v0.4.0 Integrity Remediation

## Status: IMPLEMENTED — REGISTRY CLOSEOUT PENDING

## Bead

`autoresearch-mcp-22g`

## Why

The 2026-07-16 comprehensive release review overturned the earlier release-ready verdict. The identified evaluator, CLI, packed-guidance, scaffold-control, result-integrity, catalog-loading, dependency/runtime, and protected packed-CI defects have been remediated and landed. The package remains unpublished and untagged while npm authentication and deterministic registry closeout are pending.

## Scope

- Make every shipped evaluator either measure a variable score from explicit inputs or fail closed without numeric stdout.
- Preserve installer failure status through both public bins.
- Audit all packed content, replace clinical automation examples with synthetic nonclinical examples, and add explicit PHI/secret prohibitions.
- Include custom instructions, budgets, risk policy, constraints, and stopping controls in generated programs.
- Derive result improvement and champion state server-side from metric direction and current state.
- Validate the complete YAML catalog before applying one atomic database snapshot; abort startup on catalog errors.
- Harden migration concurrency, experiment lifecycle transitions, scaffold writes, path handling, numeric bounds, and duration-aware recipe compatibility filtering.
- Put packed-package inspection, installation, CLI failure checks, and MCP handshake in protected Forgejo Actions CI.
- Raise dependency security floors and make supported runtime claims match CI.
- Reconcile README, changelog, OpenSpec, package metadata, and release state.

## Non-Goals

- Do not implement autonomous command execution or `run_ratchet`.
- Do not publish or tag until every local and CI gate passes.
- Do not route PHI, prompts, model responses, or secrets through review tooling.
- Do not enable the globally removed Autoresearch MCP registration as part of package remediation.
- Do not adopt MCP SDK v2 while it remains pre-stable.

## Acceptance Criteria

- All eight curated evaluators have executable contract tests; placeholders exit nonzero and functional evaluators produce fixture-dependent scores.
- Both public bins return nonzero for unknown flags, invalid targets, and installation failures.
- Curated and fallback `program.md` output contains exactly one normalized Run Controls section with supplied custom instructions, defaults, budget, risk policy, constraints, stopping conditions, metric direction, and evaluator command.
- `log_result` derives improvement server-side in iteration order; inconsistent compatibility assertions, missing/multiple baselines, ineligible scores, unsupported acceptance rules, and non-finite values fail without partial writes.
- Catalog parse, reference, database, and FTS failures leave the prior catalog and FTS snapshot unchanged and prevent server startup.
- Concurrent migration initialization succeeds against one database.
- Invalid lifecycle transitions and incoherent numeric budgets are rejected.
- Scaffold failure at every mutation boundary restores exact prior contents/modes and leaves no partial files, staging artifacts, or experiment row; concurrent scaffolds for one project are rejected or serialized.
- Changing only a valid duration constraint can change recommendation ordering; malformed, zero, and negative durations are rejected.
- Forgejo Actions CI tests the exact packed tarball from a clean sandbox and records tarball SHA-256 plus commit SHA.
- Dependency floors are `@modelcontextprotocol/sdk >=1.29.0 <2`, `yaml >=2.8.3 <3`, `zod >=3.25.28 <4`, and exact `zod-to-json-schema 3.25.2`; Biome remains on major 1.
- The packed tarball contains no workflow encouraging patient-record automation and explicitly prohibits PHI, patient identifiers, PHI-bearing prompts/model responses, secrets, and production datasets in the server, evaluators, review tooling, logs, fixtures, and CI.
- Public documentation does not claim publication before registry verification.
- Full tests, typecheck, lint, build, package audit, packed install, and MCP smoke pass.

## Deployment and Rollback

There is no deployed service. Delivery is an npm package release after Forgejo merge and CI. Until publication, rollback is branch/PR abandonment. Forgejo `main` is verified and ordinarily mirrored to GitHub before publication. Publishing is an explicitly operator-authorized irreversible step. Reconstruct the tarball from merged main with the exact pinned CI toolchain and publish only if SHA-256 and SHA-512 match the immutable CI evidence. Registry smoke must verify version, clean installation, both bins, and MCP handshake. Only then may that commit be tagged `v0.4.0`, and only that release tag is mirrored after smoke. If smoke fails, deprecate the immutable faulty version, do not tag or close the release, and use a new version for correction only with explicit operator authorization.
