/**
 * Tests for experiment DB operations (src/db/experiments.ts)
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	createExperiment,
	getExperiment,
	getExperimentResults,
	listExperiments,
	logExperimentResult,
	logTechniqueOutcome,
	updateExperiment,
} from "../../src/db/experiments.js";
import { resetDb } from "../../src/db/schema.js";
import type { ExperimentSpec } from "../../src/types.js";

function validSpec(overrides?: Partial<ExperimentSpec>): ExperimentSpec {
	return {
		target_artifact: "test.md",
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

describe("createExperiment + getExperiment", () => {
	it("creates and retrieves an experiment", () => {
		createExperiment({
			id: "exp-001",
			spec: validSpec(),
			project_path: "/test",
			project_name: "Test Project",
			status: "scaffolded",
		});

		const exp = getExperiment("exp-001");
		expect(exp).not.toBeNull();
		expect(exp?.id).toBe("exp-001");
		expect(exp?.project_path).toBe("/test");
		expect(exp?.project_name).toBe("Test Project");
		expect(exp?.status).toBe("scaffolded");
		expect(exp?.total_iterations).toBe(0);
		expect(exp?.successful_iterations).toBe(0);
	});

	it("returns null for missing experiment", () => {
		const exp = getExperiment("nonexistent");
		expect(exp).toBeNull();
	});

	it("defaults status to scaffolded", () => {
		createExperiment({
			id: "exp-002",
			spec: validSpec(),
			project_path: "/test",
		});

		const exp = getExperiment("exp-002");
		expect(exp?.status).toBe("scaffolded");
	});
});

describe("updateExperiment", () => {
	it("updates status and timestamps", () => {
		createExperiment({
			id: "exp-003",
			spec: validSpec(),
			project_path: "/test",
		});

		const updated = updateExperiment("exp-003", { status: "running" });
		expect(updated).toBe(true);

		const exp = getExperiment("exp-003");
		expect(exp?.status).toBe("running");
	});

	it("updates scores and cost", () => {
		createExperiment({
			id: "exp-004",
			spec: validSpec(),
			project_path: "/test",
		});

		updateExperiment("exp-004", {
			best_score: 95.5,
			total_iterations: 5,
			successful_iterations: 3,
			cost_tokens: 1000,
			cost_dollars: 0.05,
			cost_wall_seconds: 120,
		});

		const exp = getExperiment("exp-004");
		expect(exp?.best_score).toBe(95.5);
		expect(exp?.total_iterations).toBe(5);
		expect(exp?.successful_iterations).toBe(3);
		expect(exp?.cost_tokens).toBe(1000);
		expect(exp?.cost_dollars).toBe(0.05);
		expect(exp?.cost_wall_seconds).toBe(120);
	});

	it("returns false for missing experiment", () => {
		const updated = updateExperiment("nonexistent", { status: "running" });
		expect(updated).toBe(false);
	});

	it("updates notes", () => {
		createExperiment({
			id: "exp-005",
			spec: validSpec(),
			project_path: "/test",
		});

		updateExperiment("exp-005", { notes: "Initial observation" });

		const exp = getExperiment("exp-005");
		expect(exp?.notes).toBe("Initial observation");
	});
});

describe("logExperimentResult", () => {
	it("logs a result and updates aggregates", () => {
		createExperiment({
			id: "exp-006",
			spec: validSpec(),
			project_path: "/test",
		});

		logExperimentResult({
			experiment_id: "exp-006",
			iteration: 1,
			score: 75,
			improved: true,
			change_description: "Baseline",
			duration_seconds: 10,
			cost_tokens: 500,
			cost_dollars: 0.02,
		});

		const exp = getExperiment("exp-006");
		expect(exp?.total_iterations).toBe(1);
		expect(exp?.successful_iterations).toBe(1);
		expect(exp?.best_score).toBe(75);
		expect(exp?.cost_tokens).toBe(500);
		expect(exp?.cost_dollars).toBe(0.02);
		expect(exp?.cost_wall_seconds).toBe(10);
	});

	it("tracks best_score correctly across multiple iterations", () => {
		createExperiment({
			id: "exp-007",
			spec: validSpec(),
			project_path: "/test",
		});

		// Iteration 1: baseline, improved (no prior best)
		logExperimentResult({
			experiment_id: "exp-007",
			iteration: 1,
			score: 80,
			improved: true,
			change_description: "Baseline",
		});

		// Iteration 2: worse, not improved
		logExperimentResult({
			experiment_id: "exp-007",
			iteration: 2,
			score: 70,
			improved: false,
			change_description: "Bad change",
		});

		// Iteration 3: better, improved
		logExperimentResult({
			experiment_id: "exp-007",
			iteration: 3,
			score: 90,
			improved: true,
			change_description: "Good change",
		});

		const exp = getExperiment("exp-007");
		expect(exp?.best_score).toBe(90);
		expect(exp?.total_iterations).toBe(3);
		expect(exp?.successful_iterations).toBe(2);
	});

	it("accumulates cost across iterations", () => {
		createExperiment({
			id: "exp-008",
			spec: validSpec(),
			project_path: "/test",
		});

		logExperimentResult({
			experiment_id: "exp-008",
			iteration: 1,
			score: 50,
			improved: true,
			change_description: "A",
			cost_tokens: 100,
			cost_dollars: 0.01,
			duration_seconds: 5,
		});

		logExperimentResult({
			experiment_id: "exp-008",
			iteration: 2,
			score: 55,
			improved: true,
			change_description: "B",
			cost_tokens: 200,
			cost_dollars: 0.02,
			duration_seconds: 10,
		});

		const exp = getExperiment("exp-008");
		expect(exp?.cost_tokens).toBe(300);
		expect(exp?.cost_dollars).toBeCloseTo(0.03, 5);
		expect(exp?.cost_wall_seconds).toBe(15);
	});

	it("can retrieve results for an experiment", () => {
		createExperiment({
			id: "exp-009",
			spec: validSpec(),
			project_path: "/test",
		});

		logExperimentResult({
			experiment_id: "exp-009",
			iteration: 1,
			score: 60,
			improved: true,
			change_description: "First",
		});

		logExperimentResult({
			experiment_id: "exp-009",
			iteration: 2,
			score: 65,
			improved: true,
			change_description: "Second",
		});

		const results = getExperimentResults("exp-009");
		expect(results.length).toBe(2);
		expect(results[0].iteration).toBe(1);
		expect(results[0].change_description).toBe("First");
		expect(results[1].iteration).toBe(2);
		expect(results[1].change_description).toBe("Second");
	});

	it("returns empty results for experiment with no results", () => {
		createExperiment({
			id: "exp-010",
			spec: validSpec(),
			project_path: "/test",
		});

		const results = getExperimentResults("exp-010");
		expect(results.length).toBe(0);
	});
});

describe("listExperiments", () => {
	it("lists all experiments", () => {
		createExperiment({
			id: "exp-a",
			spec: validSpec(),
			project_path: "/project-a",
			project_name: "Project A",
		});
		createExperiment({
			id: "exp-b",
			spec: validSpec(),
			project_path: "/project-b",
			project_name: "Project B",
		});

		const exps = listExperiments();
		expect(exps.length).toBe(2);
	});

	it("filters by status", () => {
		createExperiment({
			id: "exp-c",
			spec: validSpec(),
			project_path: "/test",
			status: "scaffolded",
		});
		createExperiment({
			id: "exp-d",
			spec: validSpec(),
			project_path: "/test",
			status: "running",
		});

		const running = listExperiments({ status: "running" });
		expect(running.length).toBe(1);
		expect(running[0].id).toBe("exp-d");
	});

	it("filters by project name", () => {
		createExperiment({
			id: "exp-e",
			spec: validSpec(),
			project_path: "/foo/bar",
			project_name: "FooBar",
		});
		createExperiment({
			id: "exp-f",
			spec: validSpec(),
			project_path: "/baz/qux",
			project_name: "BazQux",
		});

		const foos = listExperiments({ project: "Foo" });
		expect(foos.length).toBe(1);
		expect(foos[0].id).toBe("exp-e");
	});

	it("filters by project path", () => {
		createExperiment({
			id: "exp-g",
			spec: validSpec(),
			project_path: "/projects/alpha",
		});
		createExperiment({
			id: "exp-h",
			spec: validSpec(),
			project_path: "/projects/beta",
		});

		const alphas = listExperiments({ project: "alpha" });
		expect(alphas.length).toBe(1);
		expect(alphas[0].id).toBe("exp-g");
	});

	it("respects limit", () => {
		createExperiment({
			id: "exp-i",
			spec: validSpec(),
			project_path: "/test",
		});
		createExperiment({
			id: "exp-j",
			spec: validSpec(),
			project_path: "/test",
		});
		createExperiment({
			id: "exp-k",
			spec: validSpec(),
			project_path: "/test",
		});

		const limited = listExperiments({ limit: 2 });
		expect(limited.length).toBe(2);
	});
});

describe("logTechniqueOutcome", () => {
	it("creates a technique outcome record", () => {
		const id = logTechniqueOutcome({
			technique_id: "hill-climbing",
			domain: "prompt-engineering",
			project_name: "TestProj",
			outcome: "success",
			notes: "Worked well for short prompts",
			score_improvement: 25.5,
			total_experiments: 10,
		});

		expect(id).toBeGreaterThan(0);
	});
});
