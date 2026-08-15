# Tasks: v0.4.0 Integrity Remediation

## Phase 1 — Red Tests

- [x] Add evaluator truthfulness tests for all curated templates.
- [x] Add primary-bin failure propagation tests.
- [x] Add generated program run-control tests.
- [x] Add maximize/minimize result-integrity tests.
- [x] Add catalog rollback/startup-failure tests.
- [x] Add migration concurrency and lifecycle transition tests.
- [x] Add scaffold fault-injection rollback/path tests for fresh and overwrite flows.
- [x] Add duration-compatibility filtering and numeric-bound tests.

## Phase 2 — Core Implementation

- [x] Fail-close nonfunctional curated evaluators.
- [x] Preserve installer and top-level CLI failure status.
- [x] Generate explicit scaffold run controls and atomic installation behavior.
- [x] Derive champion state and enforce lifecycle/result invariants.
- [x] Load catalog as one validated atomic snapshot and fail startup on errors.
- [x] Harden schemas, migration locking, scaffold rollback, and duration-aware recommendation.

## Phase 3 — Package and Dependency Surface

- [x] Audit every packed file; replace clinical automation guidance with synthetic data and add explicit PHI/secret prohibitions.
- [x] Raise dependency/runtime floors and update lockfile.
- [x] Verify resolved dependencies satisfy every reviewed floor.

## Phase 4 — Primary CI and Documentation

- [x] Add packed-artifact smoke to protected Forgejo Actions CI.
- [x] Reconcile README, changelog, project state, OpenSpec, and package metadata.

## Phase 5 — Verification and Landing

- [x] Run full local gates and packed-package smoke.
- [x] Obtain independent Oracle review and resolve findings.
- [x] Export Beads state and commit the complete change.
- [x] Push Forgejo branches, open PRs, pass exact-head CI, merge through the documented admin protection workflow, and restore protection.
- [x] Verify post-merge main CI and mirror GitHub.
- [x] Reconcile the shared checkout and remove the clean worktree.

## Phase 6 — Registry Closeout

- [x] Obtain explicit operator authorization for irreversible npm publication.
- [ ] Authenticate to npm if operator credentials are available.
- [ ] Publish the verified tarball and perform byte-verifying clean registry smoke.
- [ ] Tag verified merged commit `v0.4.0` on Forgejo and GitHub.
- [ ] Archive completed OpenSpecs and close Beads.
