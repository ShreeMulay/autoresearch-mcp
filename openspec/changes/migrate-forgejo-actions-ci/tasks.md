# Tasks: Migrate Validation to Forgejo Actions

## TDD Contract

- [x] Update YAML validation tests for the Forgejo Actions contract and retired Woodpecker file absence.
- [x] Capture focused RED before implementation.

## Implementation

- [x] Delete `.woodpecker.yml` and add the contained PR-only Forgejo Actions workflow.
- [x] Preserve all blocking secret-free validation and installer commands.
- [x] Add a separate blocking canonical-toolchain package job and include it in terminal `ci` dependency enforcement.
- [x] Raise transitive dependency resolutions and packed-consumer floors; regenerate only `bun.lock`.
- [x] Regenerate the deterministic package fixture and final release-artifact digests/SRI.
- [x] Add one always-running terminal `ci` dependency gate.
- [x] Reconcile active current-facing contributor and v0.4.0 OpenSpec references.

## Verification

- [x] Capture focused GREEN after implementation.
- [x] Run full frozen Bun quality gates and canonical package smoke.
- [x] Run locally available Node 22/24 installer checks.
- [x] Run strict YAML parsing, workflow policy lint, and `git diff --check`.
- [ ] Run OpenSpec structural validation when the OpenSpec CLI is available.

## Evidence

- Focused RED: 1 pass / 2 fail before dependency and package-job implementation.
- Focused GREEN: 3 pass / 0 fail; full suite: 272 pass / 0 fail.
- Bun 1.3.14 frozen install, audit, typecheck, lint, and build pass; audit reports no vulnerabilities.
- Canonical package smoke passes under Bun 1.3.10, Node 22.22.1, and npm 10.9.4; packed consumer audit reports zero vulnerabilities and all six floors pass.
- Two canonical packs and the checked-in fixture are byte-identical: SHA-256 `5b97755d09f460b384fcf7d3f816850c532465ad48c8c0c066c5f943a2481235`; SHA-512 `3e248adf6ab0074c7e9df6069f842df849d7ba8e8463794f1d7afa3550ce31eac29a943c6bccc7cadbb4cb80a2d6e21c6057d1b0d11380d06d39ba283ab3218f`.
- Node 22.22.1 and Node 24.19.0 installer contracts pass, including dry-run, help, invalid option/target, no-write, and cleanup assertions.
- Canonical workflow lint passes. OpenSpec CLI validation remains unavailable locally because `openspec` is not installed.
