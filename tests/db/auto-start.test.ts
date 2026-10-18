/**
 * Lifecycle auto-start and aggregate integrity for logExperimentResult.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	createExperiment,
	getExperiment,
	getExperimentResults,
	logExperimentResult,
	updateExperiment,
} from "../../src/db/experiments.js";
import { getDb, resetDb } from "../../src/db/schema.js";
import type { ExperimentSpec, ExperimentStatus } from "../../src/types.js";

function spec(overrides: Partial<ExperimentSpec> = {}): ExperimentSpec {
	return {
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
		...overrides,
	};
}

function setStatusDirectly(id: string, status: ExperimentStatus): void {
	getDb()
		.prepare("UPDATE experiments SET status = $status WHERE id = $id")
		.run({ $id: id, $status: status });
}

function snapshot(id: string) {
	const experiment = getExperiment(id);
	return {
		status: experiment?.status,
		started_at: experiment?.started_at,
		completed_at: experiment?.completed_at,
		total_iterations: experiment?.total_iterations,
		successful_iterations: experiment?.successful_iterations,
		best_score: experiment?.best_score,
		cost_tokens: experiment?.cost_tokens,
		cost_dollars: experiment?.cost_dollars,
		cost_wall_seconds: experiment?.cost_wall_seconds,
		results: getExperimentResults(id),
	};
}

beforeEach(() => {
	resetDb(":memory:");
	createExperiment({ id: "exp", project_path: "/fixture", spec: spec() });
});

describe("logExperimentResult auto-start", () => {
	it("starts a scaffolded experiment on a valid baseline and allows completion", () => {
		expect(getExperiment("exp")?.status).toBe("scaffolded");
		logExperimentResult({
			experiment_id: "exp",
			iteration: 0,
			score: 1,
			is_baseline: true,
			change_description: "baseline",
		});
		const started = getExperiment("exp");
		expect(started?.status).toBe("running");
		expect(started?.started_at).toBeDefined();

		logExperimentResult({
			experiment_id: "exp",
			iteration: 1,
			score: 2,
			change_description: "candidate",
		});
		expect(getExperiment("exp")?.started_at).toBe(started?.started_at);
		expect(updateExperiment("exp", { status: "completed" })).toBe(true);
		expect(getExperiment("exp")?.status).toBe("completed");
	});

	it("preserves a pre-existing started_at when auto-starting", () => {
		getDb()
			.prepare("UPDATE experiments SET started_at = '2020-01-01 00:00:00'")
			.run();
		logExperimentResult({
			experiment_id: "exp",
			iteration: 0,
			score: 1,
			is_baseline: true,
			change_description: "baseline",
		});
		expect(getExperiment("exp")).toMatchObject({
			status: "running",
			started_at: "2020-01-01 00:00:00",
		});
	});

	it.each<[string, Parameters<typeof logExperimentResult>[0]]>([
		[
			"candidate without baseline",
			{ experiment_id: "exp", iteration: 1, score: 1, change_description: "c" },
		],
		[
			"improved assertion mismatch",
			{
				experiment_id: "exp",
				iteration: 0,
				score: 1,
				is_baseline: true,
				improved: true,
				change_description: "b",
			},
		],
		[
			"non-finite score",
			{
				experiment_id: "exp",
				iteration: 0,
				score: Number.NaN,
				is_baseline: true,
				change_description: "b",
			},
		],
		[
			"non-finite cost",
			{
				experiment_id: "exp",
				iteration: 0,
				score: 1,
				is_baseline: true,
				cost_dollars: Number.POSITIVE_INFINITY,
				change_description: "b",
			},
		],
		[
			"unsafe iteration",
			{
				experiment_id: "exp",
				iteration: Number.MAX_SAFE_INTEGER + 1,
				score: 1,
				is_baseline: true,
				change_description: "b",
			},
		],
	])("keeps scaffolded status after a rejected log: %s", (_label, input) => {
		const before = snapshot("exp");
		expect(() => logExperimentResult(input)).toThrow();
		expect(snapshot("exp")).toEqual(before);
		expect(before.status).toBe("scaffolded");
		expect(before.started_at).toBeUndefined();
	});

	it("rolls back status when a second baseline is rejected after the first", () => {
		createExperiment({ id: "other", project_path: "/fixture", spec: spec() });
		logExperimentResult({
			experiment_id: "other",
			iteration: 0,
			score: 1,
			is_baseline: true,
			change_description: "baseline",
		});
		setStatusDirectly("other", "scaffolded");
		const before = snapshot("other");
		expect(() =>
			logExperimentResult({
				experiment_id: "other",
				iteration: 1,
				score: 2,
				is_baseline: true,
				change_description: "second baseline",
			}),
		).toThrow(/baseline already exists/);
		expect(snapshot("other")).toEqual(before);
	});

	it.each<ExperimentStatus>(["paused", "completed", "failed", "running"])(
		"does not change %s status when logging",
		(status) => {
			setStatusDirectly("exp", status);
			logExperimentResult({
				experiment_id: "exp",
				iteration: 0,
				score: 1,
				is_baseline: true,
				change_description: "baseline",
			});
			logExperimentResult({
				experiment_id: "exp",
				iteration: 1,
				score: 2,
				change_description: "candidate",
			});
			expect(getExperiment("exp")?.status).toBe(status);
			expect(getExperiment("exp")?.started_at).toBeUndefined();
		},
	);

	it("re-logging iteration 0 preserves row count, totals, and started_at", () => {
		const baseline = {
			experiment_id: "exp",
			iteration: 0,
			score: 1,
			is_baseline: true,
			cost_dollars: 0.5,
			cost_tokens: 10,
			duration_seconds: 2,
			change_description: "baseline",
		};
		logExperimentResult(baseline);
		const first = snapshot("exp");
		logExperimentResult(baseline);
		const second = snapshot("exp");
		expect(second.results).toHaveLength(1);
		expect(second).toEqual(first);
		expect(second.status).toBe("running");
	});
});

describe("logExperimentResult invalid transition guidance", () => {
	it.each(["completed", "paused"] as const)(
		"explains how to start a scaffolded experiment before %s",
		(status) => {
			expect(() => updateExperiment("exp", { status })).toThrow(
				/log a baseline result \(which starts the run\) or set status=running first/,
			);
			expect(getExperiment("exp")?.status).toBe("scaffolded");
		},
	);

	it("keeps accurate wording for terminal transitions", () => {
		updateExperiment("exp", { status: "running" });
		updateExperiment("exp", { status: "completed" });
		let message = "";
		try {
			updateExperiment("exp", { status: "running" });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain(
			"Invalid experiment status transition: completed -> running",
		);
		expect(message).not.toContain("baseline");
	});
});

describe("logExperimentResult iteration and aggregate integrity", () => {
	it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 2 ** 60])(
		"rejects unsafe or negative iteration %p",
		(iteration) => {
			expect(() =>
				logExperimentResult({
					experiment_id: "exp",
					iteration,
					score: 1,
					is_baseline: true,
					change_description: "b",
				}),
			).toThrow(/iteration must be a nonnegative safe integer/);
			expect(getExperimentResults("exp")).toEqual([]);
		},
	);

	it("accepts the largest safe integer iteration", () => {
		logExperimentResult({
			experiment_id: "exp",
			iteration: Number.MAX_SAFE_INTEGER,
			score: 1,
			is_baseline: true,
			change_description: "b",
		});
		expect(getExperimentResults("exp")[0]?.iteration).toBe(
			Number.MAX_SAFE_INTEGER,
		);
	});

	it("rolls back a log whose recomputed cost_dollars overflows", () => {
		logExperimentResult({
			experiment_id: "exp",
			iteration: 0,
			score: 1,
			is_baseline: true,
			cost_dollars: 1e308,
			change_description: "baseline",
		});
		const before = snapshot("exp");
		expect(before.cost_dollars).toBe(1e308);
		expect(() =>
			logExperimentResult({
				experiment_id: "exp",
				iteration: 1,
				score: 2,
				cost_dollars: 1e308,
				change_description: "overflow",
			}),
		).toThrow(/cost_dollars aggregate must be finite/);
		expect(snapshot("exp")).toEqual(before);
		expect(getExperimentResults("exp")).toHaveLength(1);
	});

	it("rolls back a log whose recomputed wall seconds overflow", () => {
		logExperimentResult({
			experiment_id: "exp",
			iteration: 0,
			score: 1,
			is_baseline: true,
			duration_seconds: 1.5e308,
			change_description: "baseline",
		});
		const before = snapshot("exp");
		expect(() =>
			logExperimentResult({
				experiment_id: "exp",
				iteration: 1,
				score: 2,
				duration_seconds: 1.5e308,
				change_description: "overflow",
			}),
		).toThrow(/cost_wall_seconds aggregate must be finite/);
		expect(snapshot("exp")).toEqual(before);
	});
});
