# OpenSpec: Security Hardening + Test Coverage v0.3.0

## Status: COMPLETED
## Change ID: hardening-v0.3.0

---

## Summary

Address all Council review blockers from v0.2.0: remove postinstall (supply-chain security), add schema migrations, harden FTS5 input sanitization, add WAL + busy_timeout, add get_server_info tool, make DB path configurable, add explicit skill install CLI, and expand test coverage with schema, sanitization, and E2E tests.

## Motivation

v0.2.0 LLM Council review (6 models) flagged critical security and reliability issues:
1. postinstall script = supply-chain malware vector
2. No schema migrations = breaking changes on user DBs
3. Unsanitized FTS5 queries = crashes from LLM-generated input
4. No WAL = SQLITE_BUSY under concurrent tool calls
5. Missing E2E test = no verification server actually starts

## Acceptance Criteria

### Security
- [x] postinstall script removed from package.json
- [x] Explicit `autoresearch-install-skill` CLI with `--target` and `--dry-run`
- [x] FTS5 sanitization strips `" * ( ) ^ ~ -` and keywords `AND OR NOT NEAR`
- [x] SQLite WAL mode + busy_timeout=5000

### Schema
- [x] `_migrations` table tracks schema versions
- [x] Migration runner applies pending migrations on server start
- [x] Idempotent — re-running does not duplicate

### Features
- [x] `get_server_info` tool returns `{version, catalog_stats, db_path}`
- [x] `AUTORESEARCH_DB_PATH` env var overrides default DB path
- [x] `install-skill.js` rewritten with platform detection and safety checks

### Tests
- [x] `tests/db/schema.test.ts` — migrations, idempotency, WAL, busy_timeout, FK
- [x] `tests/db/techniques-sanitize.test.ts` — 9 FTS5 edge cases
- [x] `tests/e2e/server.test.ts` — JSON-RPC initialize + tools/list
- [x] All 60 tests pass

### Release
- [x] CHANGELOG.md with v0.3.0 release notes
- [x] Version bumped to 0.3.0 in package.json
- [x] npm `files` whitelist includes CHANGELOG.md
- [x] PR created, reviewed, merged to main
- [ ] npm publish (blocked: requires user auth)

## Design Decisions

### Migration v1 is a no-op (`SELECT 1`)
initSchema already creates all tables. v1 serves as baseline for future ALTER TABLE migrations.

### FTS5 sanitization: strip, don't escape
Escaping FTS5 syntax is complex and error-prone. Stripping special chars + wrapping remaining words with `OR` is robust for LLM-generated queries.

### `:memory:` databases report "memory" journal mode
WAL is only meaningful for file-based DBs. Tests accept both "wal" and "memory".

## Files Changed

```
src/db/schema.ts                    # MODIFY — migrations, WAL, busy_timeout, configurable path
src/db/techniques.ts                # MODIFY — FTS5 sanitization
src/tools/meta.ts                   # MODIFY — add get_server_info tool
scripts/install-skill.js            # MODIFY — explicit CLI, remove postinstall behavior
package.json                        # MODIFY — remove postinstall, bump version, add bin
CHANGELOG.md                        # NEW
openspec/changes/hardening-v0.3.0/  # NEW
tests/db/schema.test.ts             # NEW
tests/db/techniques-sanitize.test.ts # NEW
tests/e2e/server.test.ts           # NEW
```

## Test Plan

1. `bun test` — 60 tests pass, 0 fail
2. `bun run typecheck` — no type errors
3. `bun run lint` — passes Biome
4. `bun run start` — MCP server starts, migrations apply
5. `npm pack --dry-run` — includes CHANGELOG.md

## References

- Council review: 6 models (Llama 4, Qwen 3.5, Gemini 3.1, Grok 4.3, DeepSeek V4, Kimi K2.6)
- PR: https://github.com/ShreeMulay/autoresearch-mcp/pull/5
