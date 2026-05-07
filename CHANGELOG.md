# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-07

### Security

- **Removed `postinstall` script** — previously auto-symlinked skill files to `~/.claude/skills/` and `~/.opencode/skills/` on every `npm install`. This was flagged as a supply-chain risk by multiple security reviews. Replaced with explicit CLI command.
- **Hardened FTS5 input sanitization** — `searchCatalog()` now strips FTS5 special characters (`"`, `*`, `(`, `)`, `^`, `~`, `-`) and reserved keywords (`AND`, `OR`, `NOT`, `NEAR`) before passing to `MATCH`. Prevents query injection and crashes from malformed LLM-generated queries.
- **Added SQLite WAL mode + busy timeout** — `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` prevent `SQLITE_BUSY` errors during concurrent MCP tool calls.

### Added

- **Schema migrations** — `_migrations` table tracks schema versions. Future schema changes will apply automatically without breaking existing user databases.
- **`get_server_info` tool** — returns `{version, catalog_stats, db_path}` for skill version handshake and debugging.
- **Configurable DB path** — set `AUTORESEARCH_DB_PATH` environment variable to override default `data/autoresearch.db`.
- **Explicit skill install CLI** — `npx autoresearch-install-skill` or `npx autoresearch-mcp install-skill` with `--target <platform>` and `--dry-run` flags.
- **Discovery tool tests** — `tests/db/techniques-sanitize.test.ts` covers 9 FTS5 edge cases (quotes, wildcards, parens, keywords, mixed).
- **Schema migration tests** — `tests/db/schema.test.ts` verifies migrations table, idempotency, WAL mode, busy timeout, foreign keys.
- **E2E integration test** — `tests/e2e/server.test.ts` spawns the MCP server process, sends JSON-RPC `initialize` and `tools/list`, verifies all expected tools are registered.

### Changed

- **Version bump** to 0.3.0.
- **npm `files` whitelist** now explicitly includes `CHANGELOG.md`.

## [0.2.0] - 2026-04-27

### Added

- **Autoresearch skill** (`skills/autoresearch/SKILL.md`) — methodology layer for OpenCode, Claude Code, and pi.dev. Includes decision trees, workflow patterns, MCP tool mapping, composition rules, and anti-patterns.
- **Skill references** — `technique-index.md`, `composition-patterns.md`, `workflow-examples.md`.
- **Test suite** — 40 tests across catalog CRUD, experiment tracking, and tool helpers.
- **Install script** — `scripts/install-skill.js` for cross-platform skill symlinking.

## [0.1.0] - 2026-03-31

### Added

- **MCP server** with 11 tools: catalog discovery, experiment tracking, scaffolding, meta-learning.
- **30-technique catalog** across 4 composable layers: strategies, evaluators, patterns, recipes.
- **SQLite + FTS5** for full-text catalog search and experiment persistence.
- **Example project** — `python-prompt-optimizer` demonstrating 66→96 score improvement.
- **Apache-2.0 license** with Karpathy attribution.
