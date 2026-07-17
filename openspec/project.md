# Autoresearch-MCP Project State

## Current State (v0.4.0, Unreleased)

MCP server implementing Karpathy's autoresearch pattern as a composable technique catalog with experiment tracking. Version 0.4.0 is the planned first npm release. Integrity remediation and protected package/CI landing are complete, but the version remains unpublished and untagged pending npm authentication and registry closeout.

### What's Working
- **Catalog**: 30 YAML techniques across 4 layers (8 strategies, 8 evaluators, 6 patterns, 8 recipes)
- **SQLite + FTS5**: Full-text search, catalog CRUD
- **12 MCP Tools**: catalog discovery, experiment tracking, scaffolding, diagnostics, and outcome logging
- **4 Resources**: Catalog, experiment schema, technique schema, and workflow guide
- **3 Prompts**: Discovery, experiment, meta-learning
- **Self-optimization**: Tool descriptions, suggest_technique quality evaluated
- **License**: Apache-2.0
- **Repo**: https://github.com/ShreeMulay/autoresearch-mcp

### Tech Stack
- Runtime: Bun
- Language: TypeScript (strict)
- MCP SDK: @modelcontextprotocol/sdk (Stdio)
- Database: bun:sqlite + FTS5
- Validation: Zod
- Catalog: YAML → SQLite + FTS5

### Architecture
- `src/db/`: SQLite schema, techniques CRUD, experiments CRUD
- `src/tools/`: Discovery, experiments, scaffolding, meta tools
- `src/types.ts`: ExperimentSpec, TechniqueSpec, CatalogItem schemas
- `catalog/`: 30 YAML files in 4 layer directories + templates
- `examples/`: Working python-prompt-optimizer demo
- `autoresearch/self-optimize/`: Self-optimization evaluators

### In Progress
- npm authentication and tarball-only first public publication
- Byte-verifying registry smoke, Forgejo-first tag closeout, and release-state archival

### Blocked
- npm publication requires operator authentication from approved external user-level npm configuration.
- No `v0.4.0` tag or OpenSpec archive may be created before the exact tarball is published and byte-verifying registry smoke succeeds.
