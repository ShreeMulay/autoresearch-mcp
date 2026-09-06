import { beforeEach, describe, expect, it } from "bun:test";
import {
	createExperiment,
	getExperiment,
	getExperimentResults,
	logExperimentResult,
} from "../../src/db/experiments.js";
import { resetDb } from "../../src/db/schema.js";
import type { ExperimentResult, ExperimentSpec } from "../../src/types.js";

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

function create(id: string, overrides: Partial<ExperimentSpec> = {}): void {
	createExperiment({ id, project_path: "/fixture", spec: spec(overrides) });
}

function log(args: {
	experiment_id: string;
	iteration: number;
	score: number;
	is_baseline?: boolean;
	improved?: boolean;
	change_description?: string;
}): ExperimentResult {
	return logExperimentResult({
		change_description:
			args.change_description ?? `iteration ${args.iteration}`,
		...args,
	} as Parameters<typeof logExperimentResult>[0]);
}

beforeEach(() => resetDb(":memory:"));

describe("server-derived result integrity", () => {
	it("requires exactly one earlier baseline before any candidate write", () => {
		create("baseline-order");
		expect(() =>
			log({ experiment_id: "baseline-order", iteration: 1, score: 2 }),
		).toThrow(
			"Before logging candidates, log exactly one earlier result with is_baseline=true",
		);
		expect(getExperimentResults("baseline-order")).toEqual([]);

		log({
			experiment_id: "baseline-order",
			iteration: 0,
			score: 1,
			is_baseline: true,
		});
		expect(() =>
			log({
				experiment_id: "baseline-order",
				iteration: 2,
				score: 3,
				is_baseline: true,
			}),
		).toThrow(/baseline/i);
		expect(getExperimentResults("baseline-order")).toHaveLength(1);
	});

	it.each([
		["maximize", 10, 12, true],
		["minimize", 10, 8, true],
		["maximize", 10, 8, false],
		["minimize", 10, 12, false],
	] as const)(
		"derives %s improvement from metric direction",
		(direction, baseline, candidate, improved) => {
			create(`direction-${direction}-${candidate}`, {
				metric_direction: direction,
			});
			const id = `direction-${direction}-${candidate}`;
			log({
				experiment_id: id,
				iteration: 0,
				score: baseline,
				is_baseline: true,
			});
			log({ experiment_id: id, iteration: 1, score: candidate });

			expect(getExperimentResults(id)[1].improved).toBe(improved);
			expect(getExperiment(id)?.best_score).toBe(
				improved ? candidate : baseline,
			);
		},
	);

	it("rejects a mismatched optional improved assertion without writes", () => {
		create("assertion");
		log({
			experiment_id: "assertion",
			iteration: 0,
			score: 10,
			is_baseline: true,
		});

		expect(() =>
			log({
				experiment_id: "assertion",
				iteration: 1,
				score: 20,
				improved: false,
			}),
		).toThrow(/improved|assertion/i);
		expect(getExperimentResults("assertion")).toHaveLength(1);
		expect(getExperiment("assertion")?.best_score).toBe(10);
	});

	it("rejects out-of-bounds candidates without writes while admitting the baseline", () => {
		create("bounds", {
			constraints: {
				metric_floors: { score: 5 },
				metric_ceilings: { score: 20 },
			},
		});
		log({ experiment_id: "bounds", iteration: 0, score: 2, is_baseline: true });

		expect(() =>
			log({ experiment_id: "bounds", iteration: 1, score: 21 }),
		).toThrow(/ceiling|bounds/i);
		expect(getExperimentResults("bounds")).toHaveLength(1);
	});

	it("recomputes all derived improvements and champion state after upsert", () => {
		create("upsert");
		log({
			experiment_id: "upsert",
			iteration: 0,
			score: 10,
			is_baseline: true,
		});
		log({ experiment_id: "upsert", iteration: 1, score: 20 });
		log({ experiment_id: "upsert", iteration: 2, score: 15 });
		log({ experiment_id: "upsert", iteration: 1, score: 12 });

		const results = getExperimentResults("upsert");
		expect(results.map((result) => result.improved)).toEqual([
			false,
			true,
			true,
		]);
		expect(getExperiment("upsert")?.best_score).toBe(15);
		expect(getExperiment("upsert")?.successful_iterations).toBe(2);
	});

	it("does not count ties as strict improvements", () => {
		create("tie");
		log({ experiment_id: "tie", iteration: 0, score: 10, is_baseline: true });
		log({ experiment_id: "tie", iteration: 1, score: 10 });
		expect(getExperimentResults("tie")[1].improved).toBe(false);
		expect(getExperiment("tie")?.successful_iterations).toBe(0);
	});

	it("recomputes minimize champion state after upsert", () => {
		create("minimize-upsert", { metric_direction: "minimize" });
		log({
			experiment_id: "minimize-upsert",
			iteration: 0,
			score: 10,
			is_baseline: true,
		});
		log({ experiment_id: "minimize-upsert", iteration: 1, score: 5 });
		log({ experiment_id: "minimize-upsert", iteration: 2, score: 7 });
		log({ experiment_id: "minimize-upsert", iteration: 1, score: 8 });
		expect(
			getExperimentResults("minimize-upsert").map(({ improved }) => improved),
		).toEqual([false, true, true]);
		expect(getExperiment("minimize-upsert")?.best_score).toBe(7);
	});

	it("rolls back attempts to move or duplicate the baseline", () => {
		create("baseline-topology");
		log({
			experiment_id: "baseline-topology",
			iteration: 0,
			score: 10,
			is_baseline: true,
		});
		log({ experiment_id: "baseline-topology", iteration: 1, score: 11 });
		expect(() =>
			log({
				experiment_id: "baseline-topology",
				iteration: 1,
				score: 11,
				is_baseline: true,
			}),
		).toThrow(/baseline/i);
		expect(() =>
			log({
				experiment_id: "baseline-topology",
				iteration: 0,
				score: 10,
				is_baseline: false,
			}),
		).toThrow(/baseline/i);
		expect(
			getExperimentResults("baseline-topology").map(
				({ is_baseline }) => is_baseline,
			),
		).toEqual([true, false]);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects non-finite metadata number %p without writes",
		(nonFinite) => {
			create(`metadata-${String(nonFinite)}`);
			expect(() =>
				logExperimentResult({
					experiment_id: `metadata-${String(nonFinite)}`,
					iteration: 0,
					score: 1,
					is_baseline: true,
					change_description: "baseline",
					metadata: { nested: [nonFinite] },
				}),
			).toThrow(/metadata.*finite/i);
			expect(getExperimentResults(`metadata-${String(nonFinite)}`)).toEqual([]);
		},
	);
});
