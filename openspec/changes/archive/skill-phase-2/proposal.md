# OpenSpec: Autoresearch Skill + Tests + Release v0.2.0

## Status: COMPLETED WITHOUT v0.2.0 PUBLICATION
## Change ID: skill-phase-2

---

## Summary

Add an autoresearch skill (markdown methodology) to complement the MCP server, plus a comprehensive test suite, install script, and release as v0.2.0.

## Motivation

The MCP server provides tools and state (SQLite catalog, experiment tracking) but consumes ~2000+ tokens of context window. A skill provides the methodology layer (decision trees, workflow patterns, anti-patterns) at ~100-400 tokens, lazy-loaded only when relevant. Together they form brain + hands: skill guides strategy, MCP executes.

## Acceptance Criteria

### Skill
- [x] `skills/autoresearch/SKILL.md` exists with YAML frontmatter (name, description)
- [x] SKILL.md includes: trigger phrases, decision tree, core workflows, MCP tool mapping, composition rules, anti-patterns, quick reference table of all 30 techniques
- [x] `references/technique-index.md`: compact 30-item reference
- [x] `references/composition-patterns.md`: strategy-evaluator compatibility matrix + custom recipe building
- [x] `references/workflow-examples.md`: 3 end-to-end examples (prompt optimization, API latency, overnight batch)
- [x] Description ≤ 1024 characters for Claude Code compatibility

### Tests
- [x] `tests/db/techniques.test.ts`: Test catalog CRUD (search, list, stats, get) with in-memory SQLite
- [x] `tests/db/experiments.test.ts`: Test experiment CRUD (create, update, log results, list) with in-memory SQLite
- [x] `tests/tools/experiments.test.ts`: Test helper functions (spec builder, formatters) from experiments.ts
- [x] All tests pass with `bun test`

### Package
- [x] `package.json`: `files` array includes `skills/`, version bumped to `0.2.0`
- [x] `scripts/install-skill.js`: Cross-platform skill installation (OpenCode, Claude Code, pi.dev)
- [x] `README.md`: Skill install instructions for all 3 platforms

### Release
- [x] Implementation landed and was later superseded by subsequent hardening releases.
- [ ] `npm publish` succeeds (v0.2.0) — intentionally not completed; the planned first public release is now v0.4.0.
- [ ] `npx autoresearch-mcp` works from fresh registry install — deferred to the first public release smoke test.

## Design Decisions

### Skill lives IN the MCP repo (Option A)
Single repo, single version. Skill + MCP always in sync. Users get both on `npm install`.

### Tests use in-memory SQLite
Add `resetDb(path?: string)` to `schema.ts` for test isolation. No file-based DB in tests.

### Install script is idempotent + non-blocking
Prints instructions if auto-symlink fails. Never errors on install.

## Files Changed

```
skills/autoresearch/SKILL.md                           # NEW
skills/autoresearch/references/technique-index.md     # NEW
skills/autoresearch/references/composition-patterns.md # NEW
skills/autoresearch/references/workflow-examples.md    # NEW
scripts/install-skill.js                              # NEW
tests/db/techniques.test.ts                           # NEW
tests/db/experiments.test.ts                          # NEW
tests/tools/experiments.test.ts                       # NEW
src/db/schema.ts                                      # MODIFY (add resetDb)
package.json                                          # MODIFY
README.md                                             # MODIFY
```

## Test Plan

1. Run `bun test` — all 3 test suites pass
2. Run `bun run typecheck` — no type errors
3. Run `bun run lint` — passes Biome
4. Run `bun run start` — MCP server starts normally
5. Verify skill files are included in npm pack (`npm pack --dry-run`)
