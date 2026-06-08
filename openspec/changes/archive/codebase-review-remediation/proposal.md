# OpenSpec: Codebase Review Remediation

## Status: COMPLETED
## Change ID: codebase-review-remediation
## Bead: autoresearch-mcp-cvd

---

## Summary

Remediate the full codebase review findings that block a safe v0.3.x release: runnable npm binaries, valid explicit skill installer, safe mutable database location, authoritative migrations, robust FTS/tag filtering, protected scaffolding, transactional/idempotent experiment logging, aligned docs/CI, and packed-package smoke coverage.

## Motivation

The previous hardening pass fixed important security items but left release blockers:

1. Published bins are not reliably executable.
2. The install-skill bin is invalid JavaScript.
3. Template reading allows path traversal.
4. Scaffolding can overwrite result history.
5. Mutable DB state defaults into the package/source tree.
6. Typecheck/lint currently fail.
7. FTS/tag filtering still has correctness holes.
8. Experiment result logging is not idempotent or transactional.

## Acceptance Criteria

### Package and CLI

- [x] `autoresearch-mcp` bin is a real executable wrapper with a shebang.
- [x] `autoresearch-install-skill` is valid JavaScript and passes `node --check`.
- [x] `autoresearch-mcp install-skill --dry-run` dispatches to the installer rather than starting the MCP server.
- [x] Skill install copies files into persistent skill directories by default instead of symlinking to ephemeral package paths.
- [x] README and CHANGELOG document valid install commands.

### Database and Search

- [x] Default DB path is outside the package tree in a user data directory.
- [x] DB parent directory is created before SQLite opens a file DB.
- [x] `AUTORESEARCH_DB_PATH=":memory:"` remains in memory and creates no filesystem artifacts.
- [x] Schema DDL lives in numbered migrations; migration application is transactional.
- [x] Experiment results are unique per `(experiment_id, iteration)`.
- [x] Result logging is idempotent for retries and recomputes/updates aggregates safely.
- [x] FTS query construction uses a safe-token allowlist and handles punctuation, URLs, file paths, and `C++` without throwing.
- [x] Tag filters are applied in search mode and use JSON semantics rather than unescaped `LIKE`.
- [x] Catalog loader deletes managed rows for removed YAML files and can rebuild FTS.

### Tools and Resources

- [x] `get_template` rejects path traversal and only serves known template files.
- [x] `scaffold_experiment` refuses to overwrite files unless `overwrite: true` is explicit.
- [x] Scaffolded evaluator is executable or uses a shell command that does not require executable permission.
- [x] Experiment specs are validated before persistence and after reads.
- [x] Tool limits are bounded.
- [x] MCP server version matches package version.

### Quality Gates

- [x] Red-first tests cover the above behavior before implementation.
- [x] `bun test` passes.
- [x] `bun run typecheck` passes.
- [x] `bun run lint` passes.
- [x] Packed package smoke test exercises both public bins.
- [x] CI uses package scripts and includes package smoke coverage.

## Test Plan

1. Add package CLI tests for bin wrappers and installer parseability.
2. Add DB tests for default path, `:memory:`, migrations, duplicate iteration idempotency, and spec validation.
3. Add FTS/tag tests for punctuation, URLs, file paths, `C++`, and combined search+tags.
4. Add scaffolding tests for no-overwrite, overwrite, executable evaluator, and template traversal rejection.
5. Confirm tests fail before implementation.
6. Implement minimal changes until all tests and quality gates pass.

## Deployment Plan

1. Commit remediation branch.
2. Push to Forgejo primary remote; mirror to GitHub if available.
3. Open/merge PR or fast-forward according to repository branch protection.
4. Verify final status is clean and pushed.
5. npm publish remains a separate human-authenticated step.
