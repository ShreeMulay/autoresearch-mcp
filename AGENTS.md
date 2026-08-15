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

## Validation CI
- `.forgejo/workflows/ci.yml` is the active PR-only validation workflow.
- Branch protection requires only its terminal `ci` job; that job fails unless the `bun`, `node22`, `node24`, and canonical `package_smoke` jobs all succeed.
- Do not reintroduce Woodpecker validation or add push, default-branch, manual, publication, deployment, secret-bearing, or provider-calling triggers to this workflow.

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

## Observability / OpenObserve Standard

This repo follows the TKE observability standard.

Source of truth:
- Local: `/home/dev/tke-observability-standard`
- Forgejo: `https://git.thekidneyexperts.com/thekidneyexperts/tke-observability-standard`
- Current release tag: `v2.0.0`

Before implementing or changing any OTEL/OpenObserve telemetry, read:

1. `/home/dev/tke-observability-standard/STANDARD.md`
2. `/home/dev/tke-observability-standard/observe.contract.yaml`
3. The matching language template:
   - Rust: `/home/dev/tke-observability-standard/rust/`
   - Python: `/home/dev/tke-observability-standard/python/`
   - TypeScript/Bun: `/home/dev/tke-observability-standard/typescript/`
4. If using Collector mode:
   - `/home/dev/tke-observability-standard/collector/otelcol-contrib.yaml`

Do not re-derive the observability standard in this repo.

Required shape:
- OpenObserve Cloud is the primary PHI-free app observability pane.
- OTLP/HTTP protobuf is canonical.
- Direct-to-OpenObserve is default for conformant app telemetry.
- Collector mode is for fanout, routing, sampling, rate limiting, legacy adapters, defense-in-depth, and Rust all-three-signal delivery.
- Canonical secrets:
  - `openobserve-otlp-endpoint`
  - `openobserve-otlp-headers`
- Required env:
  - `OTEL_EXPORTER_OTLP_ENDPOINT`
  - `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`
  - `OTEL_EXPORTER_OTLP_HEADERS`
  - `OTEL_SERVICE_NAME`
  - `SERVICE_VERSION`
  - `DEPLOY_ENV`
- Use W3C `traceparent`.
- Exclude `/health`.
- Never emit PHI, secrets, raw request/response bodies, prompts, model responses, labs, screenshots, raw exception messages, or patient identifiers.
- Python/TypeScript direct mode emit traces + logs + metrics with redacting exporters.
- Rust direct mode is trace-only in v2.0. Rust services that require logs/metrics in OpenObserve must use Collector mode.

Tests must prove endpoint normalization, header parsing, PHI/secret redaction, and safe telemetry behavior before merge.
