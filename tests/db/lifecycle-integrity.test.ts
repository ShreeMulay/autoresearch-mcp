import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createExperiment,
	getExperiment,
	updateExperiment,
} from "../../src/db/experiments.js";
import { closeDb, resetDb } from "../../src/db/schema.js";
import type { ExperimentSpec } from "../../src/types.js";

const spec: ExperimentSpec = {
	target_artifact: "target.md",
	artifact_type: "content",
	mutation_strategy: "LLM edit",
	evaluator_command: "bash eval.sh",
	metric_name: "score",
	metric_direction: "maximize",
	acceptance_rule: "strict-improvement",
	budget: {},
	environment: {},
	stopping_conditions: ["budget-exhaustion"],
	risk_policy: {
		network_denied: true,
		requires_approval: false,
		sandbox_only: false,
		secrets_denied: true,
	},
	constraints: { metric_ceilings: {}, metric_floors: {} },
};

beforeEach(() => {
	resetDb(":memory:");
	createExperiment({ id: "lifecycle", project_path: "/fixture", spec });
});

describe("experiment lifecycle integrity", () => {
	it.each(["paused", "completed"])(
		"rejects scaffolded -> %s and leaves timestamps coherent",
		(status) => {
			expect(() => updateExperiment("lifecycle", { status })).toThrow(
				/transition/i,
			);
			expect(getExperiment("lifecycle")).toMatchObject({
				status: "scaffolded",
				started_at: undefined,
				completed_at: undefined,
			});
		},
	);

	it("sets start/completion once and keeps terminal states terminal", () => {
		updateExperiment("lifecycle", { status: "running" });
		const startedAt = getExperiment("lifecycle")?.started_at;
		expect(startedAt).toBeDefined();

		updateExperiment("lifecycle", { status: "paused" });
		updateExperiment("lifecycle", { status: "running" });
		expect(getExperiment("lifecycle")?.started_at).toBe(startedAt);

		updateExperiment("lifecycle", { status: "completed" });
		const completedAt = getExperiment("lifecycle")?.completed_at;
		expect(completedAt).toBeDefined();
		expect(() => updateExperiment("lifecycle", { status: "failed" })).toThrow(
			/transition|terminal/i,
		);
		expect(getExperiment("lifecycle")?.completed_at).toBe(completedAt);
	});

	it("serializes competing terminal transitions across processes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autoresearch-lifecycle-race-"));
		const dbPath = join(dir, "shared.db");
		const experimentsUrl = new URL(
			resolve(import.meta.dir, "../../src/db/experiments.ts"),
			"file://",
		).href;
		const schemaUrl = new URL(
			resolve(import.meta.dir, "../../src/db/schema.ts"),
			"file://",
		).href;
		try {
			resetDb(dbPath);
			createExperiment({ id: "race", project_path: "/fixture", spec });
			updateExperiment("race", { status: "running" });
			closeDb();

			const spawnTransition = (status: "completed" | "failed") => {
				const script = [
					`import { updateExperiment } from ${JSON.stringify(experimentsUrl)};`,
					`import { resetDb } from ${JSON.stringify(schemaUrl)};`,
					`resetDb(${JSON.stringify(dbPath)});`,
					`updateExperiment("race", { status: ${JSON.stringify(status)} });`,
				].join(" ");
				return Bun.spawn(["bun", "--eval", script], {
					stderr: "pipe",
					stdout: "pipe",
				});
			};
			const processes = [
				spawnTransition("completed"),
				spawnTransition("failed"),
			];
			const exitCodes = await Promise.all(
				processes.map((process) => process.exited),
			);
			expect(exitCodes.sort()).toEqual([0, 1]);

			resetDb(dbPath);
			expect(["completed", "failed"]).toContain(getExperiment("race")?.status);
		} finally {
			closeDb();
			await rm(dir, { force: true, recursive: true });
		}
	});
});
