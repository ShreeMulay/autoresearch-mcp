/**
 * Regenerator for tests/fixtures/zod3-baseline/*.json.
 *
 * These fixtures are the compatibility oracle for the zod 3 → zod 4 move and
 * were captured on main 948d1d5 with zod 3.25.76 + zod-to-json-schema 3.25.2.
 * Re-running this script against zod 4 code will NOT reproduce a zod 3
 * baseline; it exists to document exactly how the fixtures were produced.
 *
 *   bun tests/fixtures/capture-zod3-baseline.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLegacyDatabase, snapshotDatabase } from "./legacy-db.js";
import {
	BUILD_CASES,
	LEGACY_SAFE_ROWS,
	LEGACY_UNSAFE_INT_ROWS,
	PARSE_CASES,
} from "./zod3-baseline/cases.js";

const OUT_DIR = process.env.BASELINE_OUT_DIR
	? resolve(process.env.BASELINE_OUT_DIR)
	: resolve(import.meta.dir, "zod3-baseline");
const scratch = mkdtempSync(join(tmpdir(), "zod3-baseline-"));
process.env.AUTORESEARCH_DB_PATH = join(scratch, "server.db");

const { outcomeOf, buildOutcomeOf, SCHEMAS } = await import(
	"./zod3-baseline/outcomes.js"
);
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import(
	"@modelcontextprotocol/sdk/inMemory.js"
);
const { main } = await import("../../src/index.js");
const schemaModule = await import("../../src/db/schema.js");

function write(name: string, value: unknown): void {
	writeFileSync(join(OUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });

// (1) + (2): tools/list and both schema resources from the real server.
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await main({
	connect: async (server) => {
		await server.connect(serverTransport);
	},
});
const client = new Client({ name: "baseline", version: "0" });
await client.connect(clientTransport);
const tools = await client.listTools();
write(
	"tools-list.json",
	[...tools.tools].sort((a, b) => a.name.localeCompare(b.name)),
);
const resources: Record<string, string> = {};
for (const uri of [
	"autoresearch://schemas/experiment-spec",
	"autoresearch://schemas/technique-spec",
]) {
	const read = await client.readResource({ uri });
	const first = read.contents[0];
	resources[uri] = first && "text" in first ? String(first.text) : "";
}
write("resources.json", resources);
await client.close();
schemaModule.closeDb();

// (3): parse outcomes.
write(
	"parse-cases.json",
	Object.fromEntries(
		PARSE_CASES.map((c) => [c.name, outcomeOf(SCHEMAS[c.schema], c.input)]),
	),
);
write(
	"build-cases.json",
	Object.fromEntries(BUILD_CASES.map((c) => [c.name, buildOutcomeOf(c.args)])),
);

// (4): synthetic legacy databases run through the real migrations.
const persisted: Record<string, unknown> = {};
for (const [label, rows] of [
	["safe", LEGACY_SAFE_ROWS],
	["unsafe-int", LEGACY_UNSAFE_INT_ROWS],
] as const) {
	const path = join(scratch, `${label}.db`);
	createLegacyDatabase(path, rows);
	persisted[label] = await snapshotDatabase(path, rows);
}
write("persisted.json", persisted);

rmSync(scratch, { recursive: true, force: true });
console.log(`wrote baseline fixtures to ${OUT_DIR}`);
