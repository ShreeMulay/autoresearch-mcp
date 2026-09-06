# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - Unreleased

Planned first npm release. Versions 0.1.0 through 0.3.0 were never published to a registry. Package safety and protected Forgejo CI verification are complete. Version 0.4.0 remains unpublished and untagged pending authenticated tarball publication, installed-package smoke, and Forgejo-first tagging.

### Security

- **Shipped-content data boundary** — public guidance now requires synthetic, non-sensitive examples and prohibits PHI, patient identifiers, PHI-bearing prompts or model responses, clinical records, secrets, and production datasets in the MCP server, evaluators, review tooling, logs, fixtures, and CI.
- **Nonclinical examples** — patient-specific and clinical automation examples were replaced with synthetic product, inventory, publishing, and research workflows.

### Earlier security work

- **Sanitized generated scaffold content** — all user-provided strings (metric name, target file, project name) are stripped of newlines and control characters before being written into generated `eval.sh`, `program.md`, and `results.tsv`. Prevents shell injection through a multiline `metric_name` reaching an executable script.
- **Removed the last fake-score evaluator fallback** — `get_template` now returns a fail-closed `eval.sh` placeholder for recipes without a curated evaluator template instead of emitting `printf '0'`. This preserves the evaluator contract and prevents future recipes from accidentally logging fake improvements.
- **Strict installer argument parsing** — unknown flags (for example a `--dryrun` typo) now abort with an error before any filesystem changes instead of silently performing a real install. `--target` requires a valid value and `--help` is supported.
- **`target_file` confinement** — `scaffold_experiment` rejects target files that resolve outside `project_path`.
- **Runnable npm bins** — `autoresearch-mcp` (Bun) and `autoresearch-install-skill` (Node) ship as real executable wrappers under `bin/` (previously pointed at non-executable sources).

### Added

- **Lean release controls** — checked-in commands build and test a package tarball, publish only an explicit absolute `.tgz`, and smoke that artifact before normal Forgejo-first tagging.
- **`is_baseline` on `log_result`** — baseline measurements seed `best_score` until an improved iteration lands. Schema migration v3 adds the column.
- **Curated scaffold templates** — `scaffold_experiment` now uses the recipe templates bundled under `catalog/templates/<recipe>/` when present, and appends an experiment metadata section.
- **Complete curated recipe template coverage** — `test-amplification`, `ml-training`, and `literature-synthesis` now ship recipe-specific `program.md` and `eval.sh` templates alongside the existing templates.
- **Fail-closed placeholder evaluator** — recipes without a curated template scaffold an `eval.sh` that exits 1 with a clear message instead of printing a fake `0` score.
- **Runtime declarations** — the standalone skill installer supports Node.js 22 and 24, while the MCP server requires Bun >= 1.3.10.
- **Catalog loader strictness** — duplicate technique IDs and YAML layer/directory mismatches are reported as load errors; the bundled catalog is regression-tested to load with zero errors.
- **Real JSON Schema conversion** — schema resources now use `zod-to-json-schema` rather than a simplified placeholder conversion.

### Changed

- **Default database path** moved out of the package tree to the user data directory (`$XDG_DATA_HOME/autoresearch-mcp/autoresearch.db` or `~/.local/share/autoresearch-mcp/autoresearch.db`). `AUTORESEARCH_DB_PATH` still overrides it and `:memory:` is honored.
- **`get_server_info`** returns `{version, catalog, db_path}` and reports the database path actually opened by the active connection.
- **Search semantics** — a non-empty query that sanitizes to zero FTS tokens (for example `C++` or `AND`) returns an unsupported-query message instead of dumping the whole catalog. An empty query still lists everything.
- **`suggest_technique`** — deterministic `general-ratchet` fallback when nothing scores, and metric-dependent recipes are penalized when `has_scalar_metric` is false.
- **Input bounds** — `list_experiments.limit` capped at 100, experiment results capped at 200 per fetch, search tags capped at 20 entries, cost and duration values must be nonnegative.
- **Experiment spec surface** — `register_experiment` and `scaffold_experiment` expose and persist budget, risk policy, and metric constraints.
- **Artifact typing and tags** — artifact type inference is shared across experiment registration/scaffolding, and catalog tags are normalized on write/filter for consistent matching.
- **Skill synchronized with catalog** — recipe compositions in `SKILL.md` and the reference docs now match the shipped YAML catalog (the catalog is authoritative); removed a reference to a nonexistent `tree-search` strategy; the tool mapping covers all 11 tools.
- **Reliable scaffold contract** — generated instructions use `autoresearch/eval.sh` from the project root, require exactly one iteration 0 baseline, and describe direction-aware strict improvement. Scaffolded `results.tsv` includes `is_baseline`.
- **Honest literature smoke evaluation** — the bundled literature evaluator is labeled and tested as a citation-density smoke heuristic, not source validation or semantic-faithfulness evaluation.

### Removed

- **`log_technique_outcome`** — removed the callable tool, database write API, public type, and active documentation because no read path used the records to improve suggestions. New databases omit the table; existing databases remain compatible because startup does not destructively drop an inert historical table.
- **CI and tests** — Bun pinned-minimum plus latest coverage, standalone installer coverage on supported Node.js 22 and 24, dynamic tarball naming, packed-install smoke for MCP `tools/list`, committed Biome config, and E2E readiness polling instead of fixed sleeps.

## [0.3.0] - 2026-05-07

### Security

- **Removed `postinstall` script** — previously auto-symlinked skill files to `~/.claude/skills/` and `~/.opencode/skills/` on every `npm install`. This was flagged as a supply-chain risk by multiple security reviews. Replaced with explicit CLI command.
- **Hardened FTS5 input sanitization** — `searchCatalog()` now strips FTS5 special characters (`"`, `*`, `(`, `)`, `^`, `~`, `-`) and reserved keywords (`AND`, `OR`, `NOT`, `NEAR`) before passing to `MATCH`. Prevents query injection and crashes from malformed LLM-generated queries.
- **Added SQLite WAL mode + busy timeout** — `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` prevent `SQLITE_BUSY` errors during concurrent MCP tool calls.

### Added

- **Schema migrations** — `_migrations` table tracks schema versions. Future schema changes will apply automatically without breaking existing user databases.
- **`get_server_info` tool** — returns `{version, catalog_stats, db_path}` for skill version handshake and debugging.
- **Configurable DB path** — set `AUTORESEARCH_DB_PATH` environment variable to override default `data/autoresearch.db`.
- **Explicit skill install CLI** — `npx -p autoresearch-mcp autoresearch-install-skill` or `autoresearch-mcp install-skill` with `--target <platform>` and `--dry-run` flags.
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
