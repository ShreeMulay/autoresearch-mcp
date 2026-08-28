# Change: Migrate Validation to Forgejo Actions

## Status: COMPLETE

Approved by the user's Make it so directive.

The migration implementation, structural review, and exact-head Forgejo Actions verification are complete. The unavailable local OpenSpec CLI was not run; its structural check was completed by manual review as recorded in the task evidence.

## Program Bead

`ai_projects-bewu`

## Why

Active pull-request validation must move from Woodpecker to the repository's contained Forgejo Actions runner contract while preserving every proven, blocking, secret-free validation gate.

## Scope

- Replace `.woodpecker.yml` with one PR-only `.forgejo/workflows/ci.yml` named `Forgejo Actions CI`.
- Grant only contents read permission and run every job on `forgejo-ci` in digest-pinned containers.
- Run pinned checkout with credentials persistence disabled only after verifying the git and Node runtimes.
- Preserve frozen Bun install, audit, typecheck, lint, tests, build, packed-package smoke, and Node 22/24 installer contracts.
- Keep package smoke in a separate blocking `package_smoke` job under canonical Bun 1.3.10, Node 22.22.1, and npm 10.9.4; verify the exact toolchain before smoke.
- Enforce compatible transitive dependency floors in the lock and packed-consumer graph. The diagnosed `fast-uri` floor remains 3.1.3, while the root resolution is 3.1.5 because the current audit database reports 3.1.3 through 3.1.4 vulnerable.
- Expose only the terminal `ci` branch-protection context; it always runs and requires `bun`, `node22`, `node24`, and `package_smoke` success.
- Reconcile current active OpenSpec and contributor guidance without changing archives.

## Non-Goals

- Do not migrate mutable latest-Bun advisory validation, AI review, secrets, provider calls, publication, deployment, notifications, or branch mutation.
- Do not add push, default-branch, or manual triggers.
- Do not change package, release, publication, deployment, archive, or Beads state.

## Acceptance Criteria

- Contract tests fail before the workflow migration and pass after it.
- `.woodpecker.yml` is absent and the new workflow parses strictly.
- Workflow policy lint accepts all jobs, images, permissions, checkout usage, and PR containment.
- `bun audit` and packed-consumer `npm audit --omit=dev` both report zero vulnerabilities without suppression.
- Repeated canonical packs are byte-identical and match the checked-in fixture and release-artifact SHA-256, SHA-512, and SRI.
- Focused tests, frozen Bun quality gates, package smoke, locally available Node installer checks, OpenSpec structure, YAML parsing, and diff checks pass.
