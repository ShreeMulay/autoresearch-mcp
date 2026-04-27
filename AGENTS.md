# autoresearch-mcp

## Project Overview
MCP server for autoresearch technique discovery, experiment scaffolding, tracking, and autonomous optimization loops. Based on Karpathy's autoresearch pattern, generalized to any domain with a measurable metric.

## Architecture
- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **MCP SDK**: @modelcontextprotocol/sdk (Stdio transport MVP)
- **Database**: bun:sqlite + FTS5
- **Validation**: Zod
- **Catalog**: YAML source of truth → SQLite + FTS5 for search

## Key Design Decisions
1. **Composable catalog**: 4 layers (strategies, evaluators, patterns, recipes) — NOT a flat list
2. **Schemas first**: ExperimentSpec and TechniqueSpec defined before tools
3. **Workflow before platform**: `run_ratchet` end-to-end tool before component tools
4. **Trust escalation**: read-only → write-DB → write-filesystem → execute → autonomous
5. **FTS5 over Qdrant**: Sufficient for MVP catalog size (~30 items)
6. **MCP Resources + Prompts**: Static content served as Resources, not Tools

## Conventions
- Tool names: snake_case
- Resource URIs: `autoresearch://category/item`
- Catalog YAML: one file per technique in `catalog/{layer}/`
- Templates: organized by recipe in `catalog/templates/{recipe}/`
- All experiment data models include cost tracking (tokens, dollars, wall time)

## Phase Plan
- Phase 0.5: Catalog only (3 discovery tools + Resources)
- Phase 1: + Experiment tracking + scaffolding
- Phase 2a: Agent-driven execution with human approval
- Phase 2b: Autonomous prompt optimization (run_ratchet)
- Phase 3: Docker sandbox + code execution
- Phase 4: Full Nightcrawler bounded episodes

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
