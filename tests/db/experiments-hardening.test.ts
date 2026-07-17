/**
 * Regression tests for experiment persistence safety.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	createExperiment,
	getExperiment,
	getExperimentResults,
	logExperimentResult,
} from "../../src/db/experiments.js";
import { getDb, resetDb } from "../../src/db/schema.js";
import type { ExperimentSpec } from "../../src/types.js";

function validSpec(overrides?: Partial<ExperimentSpec>): ExperimentSpec {
	return {
		target_artifact: "prompt.md",
		artifact_type: "prompt",
		recipe_id: "prompt-optimization",
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
		constraints: {
			metric_ceilings: {},
			metric_floors: {},
		},
		...overrides,
	};
}

beforeEach(() => {
	resetDb(":memory:");
});

describe("experiment spec validation", () => {
	it("rejects invalid experiment specs before persistence", () => {
		expect(() =>
			createExperiment({
				id: "invalid",
				project_path: "/test",
				spec: JSON.stringify({ target_artifact: "missing-required-fields.md" }),
			}),
		).toThrow(/Invalid experiment spec/);

		expect(getExperiment("invalid")).toBeNull();
	});
});

describe("experiment result idempotency", () => {
	it("records migration v3 for baseline result semantics", () => {
		const db = getDb();
		const migration = db
			.prepare("SELECT version, name FROM _migrations WHERE version = 3")
			.get() as { name: string; version: number } | null;

		expect(migration).toEqual({
			name: "result_baseline_semantics",
			version: 3,
		});
	});

	it("uses the latest baseline score until an improved result exists", () => {
		createExperiment({
			id: "exp-baseline",
			project_path: "/test",
			spec: validSpec(),
		});

		logExperimentResult({
			change_description: "Pre-change measurement",
			experiment_id: "exp-baseline",
			improved: false,
			is_baseline: true,
			iteration: 0,
			score: 50,
		});

		expect(getExperiment("exp-baseline")?.best_score).toBe(50);

		logExperimentResult({
			change_description: "Improved change",
			experiment_id: "exp-baseline",
			improved: true,
			iteration: 1,
			score: 60,
		});

		expect(getExperiment("exp-baseline")?.best_score).toBe(60);
	});

	it("does not double-count retried iteration logs", () => {
		createExperiment({
			id: "exp-retry",
			project_path: "/test",
			spec: validSpec(),
		});

		logExperimentResult({
			change_description: "First attempt",
			cost_dollars: 0.01,
			cost_tokens: 100,
			duration_seconds: 5,
			experiment_id: "exp-retry",
			improved: false,
			is_baseline: true,
			iteration: 1,
			score: 10,
		});
		logExperimentResult({
			change_description: "Retry with corrected metadata",
			cost_dollars: 0.02,
			cost_tokens: 200,
			duration_seconds: 7,
			experiment_id: "exp-retry",
			improved: false,
			is_baseline: true,
			iteration: 1,
			score: 12,
		});

		const results = getExperimentResults("exp-retry");
		expect(results).toHaveLength(1);
		expect(results[0].score).toBe(12);
		expect(results[0].change_description).toBe("Retry with corrected metadata");

		const experiment = getExperiment("exp-retry");
		expect(experiment?.total_iterations).toBe(1);
		expect(experiment?.successful_iterations).toBe(0);
		expect(experiment?.best_score).toBe(12);
		expect(experiment?.cost_tokens).toBe(200);
		expect(experiment?.cost_dollars).toBe(0.02);
		expect(experiment?.cost_wall_seconds).toBe(7);
	});

	it("updates is_baseline on retried iteration logs", () => {
		createExperiment({
			id: "exp-retry-baseline",
			project_path: "/test",
			spec: validSpec(),
		});

		logExperimentResult({
			change_description: "First attempt",
			experiment_id: "exp-retry-baseline",
			improved: false,
			is_baseline: true,
			iteration: 0,
			score: 10,
		});
		logExperimentResult({
			change_description: "Retry marks baseline",
			experiment_id: "exp-retry-baseline",
			improved: false,
			is_baseline: true,
			iteration: 0,
			score: 12,
		});

		const results = getExperimentResults("exp-retry-baseline");
		expect(results).toHaveLength(1);
		expect(results[0].is_baseline).toBe(true);
		expect(getExperiment("exp-retry-baseline")?.best_score).toBe(12);
	});

	it("caps result retrieval at 200 rows by default", () => {
		createExperiment({
			id: "exp-many-results",
			project_path: "/test",
			spec: validSpec(),
		});

		for (let iteration = 0; iteration < 250; iteration++) {
			logExperimentResult({
				change_description: `Change ${iteration}`,
				experiment_id: "exp-many-results",
				...(iteration === 0 ? { is_baseline: true } : {}),
				iteration,
				score: iteration,
			});
		}

		const results = getExperimentResults("exp-many-results");
		expect(results).toHaveLength(200);
		expect(results[0].iteration).toBe(0);
		expect(results[199].iteration).toBe(199);
	});

	it("rejects negative duration and cost values", () => {
		createExperiment({
			id: "exp-negative-costs",
			project_path: "/test",
			spec: validSpec(),
		});

		expect(() =>
			logExperimentResult({
				change_description: "Negative duration",
				duration_seconds: -1,
				experiment_id: "exp-negative-costs",
				improved: false,
				iteration: 1,
				score: 10,
			}),
		).toThrow(/duration_seconds must be nonnegative/);
		expect(() =>
			logExperimentResult({
				change_description: "Negative tokens",
				cost_tokens: -1,
				experiment_id: "exp-negative-costs",
				improved: false,
				iteration: 2,
				score: 10,
			}),
		).toThrow(/cost_tokens must be nonnegative/);
		expect(() =>
			logExperimentResult({
				change_description: "Negative dollars",
				cost_dollars: -0.01,
				experiment_id: "exp-negative-costs",
				improved: false,
				iteration: 3,
				score: 10,
			}),
		).toThrow(/cost_dollars must be nonnegative/);
	});
});
