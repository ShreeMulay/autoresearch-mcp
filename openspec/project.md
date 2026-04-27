# Autoresearch-MCP Project State

## Current State (v0.1.0)

MCP server implementing Karpathy's autoresearch pattern as a composable technique catalog with experiment tracking.

### What's Working
- **Catalog**: 30 YAML techniques across 4 layers (8 strategies, 8 evaluators, 6 patterns, 8 recipes)
- **SQLite + FTS5**: Full-text search, catalog CRUD
- **11 MCP Tools**: search, get, suggest, register, update, log, get/list experiments, scaffold, log outcome
- **33 Resources**: Technique details served as MCP resources
- **3 Prompts**: Discovery, experiment, meta-learning
- **Example**: python-prompt-optimizer (66→96 in 2 iterations)
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
- Phase 2: Skill + tests + public release v0.2.0

### Blocked
- None
