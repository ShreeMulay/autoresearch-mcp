/**
 * Persisted-data oracle for the zod 4 move: synthetic pre-migration-3
 * databases (tests/fixtures/legacy-db.ts) must migrate through migrations 3
 * and 4, close, reopen, and yield byte-identical stored specs and identical
 * normalized experiments compared with the zod 3.25.76 capture — including
 * rows whose budget integers exceed Number.MAX_SAFE_INTEGER.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeDb, resetDb } from "../../src/db/schema.js";
import { registerExperimentTools } from "../../src/tools/experiments.js";
import {
	createLegacyDatabase,
	snapshotDatabase,
} from "../fixtures/legacy-db.js";
import {
	LEGACY_SAFE_ROWS,
	LEGACY_UNSAFE_INT_ROWS,
} from "../fixtures/zod3-baseline/cases.js";
import persistedBaseline from "../fixtures/zod3-baseline/persisted.json";

const scratchDirs: string[] = [];

function scratchPath(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), "zod4-persisted-"));
	scratchDirs.push(dir);
	return join(dir, name);
}

afterEach(() => {
	closeDb();
	resetDb(":memory:");
	for (const dir of scratchDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("legacy databases migrate identically under zod 4", () => {
	for (const [label, rows] of [
		["safe", LEGACY_SAFE_ROWS],
		["unsafe-int", LEGACY_UNSAFE_INT_ROWS],
	] as const) {
		it(`${label}: migrations 3+4, reopen, stored strings and experiments match`, async () => {
			const path = scratchPath(`${label}.db`);
			createLegacyDatabase(path, rows);
			const snapshot = await snapshotDatabase(path, rows);
			const expected = (persistedBaseline as Record<string, unknown>)[label];
			expect(snapshot.firstOpen.migrated).toBe(true);
			expect(snapshot.firstOpen.getExperimentErrors).toEqual([]);
			expect(snapshot).toEqual(expected as typeof snapshot);
			expect(snapshot.reopen).toEqual(snapshot.firstOpen);
		});
	}

	it("get_experiment renders a stored row with budget integers beyond MAX_SAFE_INTEGER", async () => {
		const path = scratchPath("unsafe-render.db");
		createLegacyDatabase(path, LEGACY_UNSAFE_INT_ROWS);
		resetDb(path);

		let getExperimentHandler:
			| ((args: {
					experiment_id: string;
					include_results: boolean;
			  }) => Promise<{
					content: { type: "text"; text: string }[];
					isError?: boolean;
			  }>)
			| undefined;
		registerExperimentTools({
			tool: (...args: unknown[]) => {
				if (args[0] === "get_experiment") {
					getExperimentHandler = args[3] as typeof getExperimentHandler;
				}
			},
		} as unknown as McpServer);
		if (!getExperimentHandler) throw new Error("get_experiment missing");

		const result = await getExperimentHandler({
			experiment_id: "legacy-e-unsafe-int",
			include_results: true,
		});
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain(
			"# Experiment legacy-e-unsafe-int",
		);
	});
});
