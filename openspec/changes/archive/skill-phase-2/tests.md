# Test Plan: skill-phase-2

## Test Strategy

**Framework**: Bun built-in test runner (`bun:test`). No new dependencies.
**Approach**: Integration tests with in-memory SQLite for DB layer. Unit tests for pure functions.
**Isolation**: Each test gets fresh `:memory:` DB via `resetDb(":memory:")`.

## Test Suites

### 1. `tests/db/techniques.test.ts`

**Scope**: `src/db/techniques.ts` functions
**Setup**: `resetDb(":memory:")`, load 2-3 sample catalog items
**Tests**:
- `upsertCatalogItem` creates item, `getCatalogItem` retrieves it
- `getCatalogItem` returns null for missing ID
- `listCatalogItems` lists all, filters by layer, filters by tags
- `searchCatalog` finds by keyword, handles empty query (falls back to list)
- `searchCatalog` filters by layer
- `getCatalogStats` returns correct counts by layer
- `getContentHash` returns stored hash

### 2. `tests/db/experiments.test.ts`

**Scope**: `src/db/experiments.ts` functions
**Setup**: `resetDb(":memory:")`
**Tests**:
- `createExperiment` creates record, `getExperiment` retrieves it
- `getExperiment` returns null for missing ID
- `updateExperiment` updates status, timestamps, scores
- `updateExperiment` returns false for missing ID
- `logExperimentResult` inserts result, updates experiment aggregates
- `logExperimentResult` best_score tracks correctly (maximize)
- `getExperimentResults` returns all results for experiment
- `listExperiments` lists all, filters by status, filters by project
- `logTechniqueOutcome` inserts outcome record

### 3. `tests/tools/experiments.test.ts`

**Scope**: Pure helper functions from `src/tools/experiments.ts`
**Tests**:
- `inferArtifactType` detects prompt, code, config, content correctly
- `buildExperimentSpec` creates valid spec with defaults

## DB Test Setup

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { resetDb } from "../src/db/schema.js";

beforeEach(() => {
  resetDb(":memory:");
});
```

## Running Tests

```bash
bun test              # All suites
bun test --watch      # Watch mode
bun test tests/db/    # DB only
```

## Coverage Goal

- DB functions: 100% of exported functions tested
- Tool helpers: 100% of exported/pure functions tested
- No MCP SDK wiring tested (SDK's responsibility)
