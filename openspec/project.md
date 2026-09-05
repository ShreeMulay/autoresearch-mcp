# Autoresearch-MCP Project State

## Current State (v0.4.0, Unreleased)

MCP server implementing Karpathy's autoresearch pattern as a composable technique catalog with experiment tracking. Version 0.4.0 is the planned first npm release. Package hardening, the Forgejo Actions CI migration, and the lean release implementation are complete and archived. The version remains unpublished and untagged; execution is tracked only by Bead `autoresearch-mcp-7qa` and does not require an active OpenSpec.

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
- Bead `autoresearch-mcp-7qa`: authenticated npm publication, registry smoke, and Forgejo-first tag push

### Blocked
- npm publication requires operator authentication from approved external user-level npm configuration.
- Do not tag `v0.4.0` until publication and registry smoke succeed. A conflicting or ambiguous immutable npm version must stop for reconciliation.
