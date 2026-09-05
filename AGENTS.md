# autoresearch-mcp

## Architecture
- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **MCP SDK**: @modelcontextprotocol/sdk (Stdio transport MVP)
- **Database**: bun:sqlite + FTS5
- **Validation**: Zod
- **Catalog**: YAML source of truth → SQLite + FTS5 for search

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

## Beads Safety

- Use exactly `bd 0.43.0 (dev)` with `BEADS_NO_DAEMON=1`, an external database, and both auto-flush and auto-import disabled.
- Infer the canonical issue prefix read-only from the existing ledger; never invent or change it.
- Export mutations only through `/home/dev/ai_projects/scripts/export_beads_preserving_history.py` with its required safeguards.
- Never hand-edit `.beads` or run raw `bd sync`.

## Landing

- Run the repository's applicable validation before committing and pushing the existing branch.
- Open a Forgejo pull request and require `Forgejo Actions CI / ci (pull_request)` to pass for the exact pushed HEAD.
- Merge only through the protected path after that exact-head check is green; never bypass branch protection.
- Oracle input, when used, is advisory and never an approval gate.

## Observability

- Follow `/home/dev/tke-observability-standard/STANDARD.md`, `observe.contract.yaml`, and the TypeScript/Bun template before changing telemetry; do not re-derive the standard here.
- Keep telemetry PHI-free and secret-free. Never emit raw requests, responses, prompts, model output, identifiers, or unsanitized exceptions.
- Validate endpoint normalization, header parsing, redaction, and safe telemetry behavior before merge.
