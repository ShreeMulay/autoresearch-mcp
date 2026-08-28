# Tasks: Migrate Validation to Forgejo Actions

## TDD Contract

- [x] Update YAML validation tests for the Forgejo Actions contract and retired Woodpecker file absence.
- [x] Capture focused RED before implementation.

## Implementation

- [x] Delete `.woodpecker.yml` and add the contained PR-only Forgejo Actions workflow.
- [x] Preserve all blocking secret-free validation and installer commands.
- [x] Add a separate blocking canonical-toolchain `package_smoke` job and include it in terminal `ci` dependency enforcement.
- [x] Raise transitive dependency resolutions and packed-consumer floors; regenerate only `bun.lock`.
- [x] Regenerate the deterministic package fixture and final release-artifact digests/SRI.
- [x] Add one always-running terminal `ci` dependency gate.
- [x] Reconcile active current-facing contributor and v0.4.0 OpenSpec references.
- [x] Canonicalize tracked source modes in an external staging tree before both package reconstructions.
- [x] Add a regression proving restrictive and ordinary source-mode layouts produce byte-identical archives.

## Verification

- [x] Capture focused GREEN after implementation.
- [x] Run full frozen Bun quality gates and canonical package smoke.
- [x] Run locally available Node 22/24 installer checks.
- [x] Run strict YAML parsing, workflow policy lint, and `git diff --check`.
- [x] Complete a manual structural review of the proposal and task documents because the OpenSpec CLI is unavailable locally; do not claim CLI execution.

## Evidence

- Focused RED: 1 pass / 2 fail before dependency and package-job implementation.
- Focused GREEN: 3 pass / 0 fail; full suite: 272 pass / 0 fail.
- Bun 1.3.14 frozen install, audit, typecheck, lint, and build pass; audit reports no vulnerabilities.
- The normalized canonical package smoke passes locally under Bun 1.3.14, Node 22.22.2, and npm 10.9.4; packed consumer audit reports zero vulnerabilities and all six floors pass. Exact Bun 1.3.10/Node 22.22.1 verification remains pending because the local Docker daemon is inaccessible.
- Two canonical packs and the checked-in fixture are byte-identical after mode normalization: SHA-256 `1d5c26068f12be753ff2b51e9933a808cee11e2fbd46ae7e79454addf56c64e6`; SHA-512 `8f135a0a7c1c2a3b82db038d4b9ab1efde8501f720c6998431552f5d23517cdea4ec28dc0384bf5b1a1f197c67e18fcfed1cc9c5e4af0be268938b6f675e21fd`.
- Node 22.22.1 and Node 24.19.0 installer contracts pass, including dry-run, help, invalid option/target, no-write, and cleanup assertions.
- Canonical workflow lint passes. The OpenSpec CLI was unavailable locally because `openspec` was not installed, so proposal/task structure and checklist completion were reviewed manually instead; no CLI execution is claimed.
- Focused mode-layout RED failed because npm archived the checkout's existing `0600`/`0700` versus `0644`/`0755` source modes; setting npm's umask did not rewrite those modes. Focused GREEN stages current tracked file bytes with Git's `100755` bit mapped to `0755`, all other regular files to `0644`, and directories to `0755`.
- The diagnosed remote `package_smoke` mode mismatch was corrected by canonical staging. Exact-head Forgejo Actions CI subsequently passed for the migration landing, which merged through PR #11 at `63f7806`; the implementation facts and local evidence above remain the recorded basis for this completed change.
