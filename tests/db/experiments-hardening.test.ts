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
import { resetDb } from "../../src/db/schema.js";
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
			improved: true,
			iteration: 1,
			score: 10,
		});
		logExperimentResult({
			change_description: "Retry with corrected metadata",
			cost_dollars: 0.02,
			cost_tokens: 200,
			duration_seconds: 7,
			experiment_id: "exp-retry",
			improved: true,
			iteration: 1,
			score: 12,
		});

		const results = getExperimentResults("exp-retry");
		expect(results).toHaveLength(1);
		expect(results[0].score).toBe(12);
		expect(results[0].change_description).toBe("Retry with corrected metadata");

		const experiment = getExperiment("exp-retry");
		expect(experiment?.total_iterations).toBe(1);
		expect(experiment?.successful_iterations).toBe(1);
		expect(experiment?.best_score).toBe(12);
		expect(experiment?.cost_tokens).toBe(200);
		expect(experiment?.cost_dollars).toBe(0.02);
		expect(experiment?.cost_wall_seconds).toBe(7);
	});
});
