# Tasks: v0.4.0 Deterministic Release Closeout

## Phase 1 — Contracts and Red Tests

- [x] Add closed-schema artifact identity/digest/SRI contract tests.
- [x] Add hermetic fake-npm/fake-git publication state-machine tests: no network, exact publish-once tarball argv, confirmation/account/registry/ref/tag/digest/dirty failures, E404 discrimination, main advancement, definitive failure, timeout-after-acceptance, persistent absence, and pre-existing exact/conflicting bytes.
- [x] Add bounded fresh-environment registry-smoke tests and prove local-artifact mode cannot weaken registry identity/hash or authorize mutation.
- [x] Add separately authorized deprecation/clear/tag tests, including external evidence SHA binding, independent remote tag states, peeled-target verification, resume combinations, clear-field verification, and explicit unpublish prohibition.

## Phase 2 — Implementation

- [x] Add the authoritative artifact record.
- [x] Extend package smoke with digest enforcement and verified artifact export.
- [x] Add fail-closed tarball publication, read-only reconciliation, and byte-verifying registry-smoke commands.
- [x] Add separately authorized deprecation/clear and tag-closeout commands.
- [x] Add exact deprecation/no-tag/no-unpublish rollback guidance.

## Phase 3 — State Reconciliation

- [x] Reconcile README, changelog, project state, both v0.4.0 OpenSpecs, and Beads.
- [x] Record npm authentication as the only remaining external release blocker.

## Phase 4 — Verification and Landing

- [x] Run all local release gates and obtain independent Oracle GO.
- [x] Export Beads state and commit the complete change.
- [x] Push Forgejo branch, open PR, pass exact-head CI, merge, and restore protection.
- [x] Verify post-merge Forgejo main CI, mirror GitHub, and verify mirror CI.
- [x] Reconcile shared checkout and remove the clean worktree.

## Phase 5 — Auth-Gated Registry Transaction

- [ ] Authenticate to npm when operator credentials are available.
- [ ] Run the checked-in publish command and clean registry smoke.
- [ ] Tag verified merged commit `v0.4.0` on Forgejo and mirror the tag to GitHub.
- [ ] Archive all completed v0.4.0 OpenSpecs and close `autoresearch-mcp-7qa`.
