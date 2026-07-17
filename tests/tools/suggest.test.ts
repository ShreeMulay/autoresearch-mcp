import { describe, expect, it } from "bun:test";
import { rankRecipes } from "../../src/tools/discovery.js";
import type { CatalogItem } from "../../src/types.js";

function recipe(id: string, overrides?: Partial<CatalogItem>): CatalogItem {
	return {
		description: `Description for ${id}`,
		examples: [],
		id,
		layer: "recipe",
		name: id,
		related: [],
		requires_gpu: false,
		tags: [],
		when_to_use: `Use ${id}`,
		...overrides,
	};
}

describe("rankRecipes", () => {
	it("falls back to general-ratchet for non-matching problem text", () => {
		const ranked = rankRecipes(
			[
				recipe("prompt-optimization", {
					description: "Optimize prompts against eval sets",
				}),
				recipe("general-ratchet", {
					description: "General optimization ratchet",
				}),
			],
			"zzz qqq",
			{},
		);

		expect(ranked[0].recipe.id).toBe("general-ratchet");
		expect(ranked[0].reasons.join(" ")).toContain("fallback");
	});

	it("ranks prompt optimization above general ratchet for prompt eval-set problems", () => {
		const ranked = rankRecipes(
			[
				recipe("general-ratchet", {
					description: "General optimization ratchet",
				}),
				recipe("prompt-optimization", {
					description: "Optimize prompt variants against an eval set",
					tags: ["prompt", "eval"],
				}),
			],
			"prompt eval set",
			{},
		);

		expect(ranked[0].recipe.id).toBe("prompt-optimization");
	});

	it("penalizes benchmark and binary evaluators when no scalar metric exists", () => {
		const ranked = rankRecipes(
			[
				recipe("benchmark-recipe", {
					composes: { evaluator: "benchmark-harness" },
					description: "Prompt quality scoring",
				}),
				recipe("rubric-recipe", {
					composes: { evaluator: "rubric-scorer" },
					description: "Prompt quality scoring",
				}),
			],
			"prompt quality",
			{ hasScalarMetric: false },
		);

		expect(ranked[0].recipe.id).toBe("rubric-recipe");
		expect(ranked[1].recipe.id).toBe("benchmark-recipe");
	});

	it("a valid duration constraint can change ordering through compatibility filtering", () => {
		const recipes = [
			recipe("slow", { experiments_per_hour: 10 }),
			recipe("fast", { experiments_per_hour: 200 }),
		];
		const roomy = rankRecipes(recipes, "optimization", {
			maxExperimentDurationSeconds: 3600,
		} as Parameters<typeof rankRecipes>[2]);
		const constrained = rankRecipes(recipes, "optimization", {
			maxExperimentDurationSeconds: 30,
		} as Parameters<typeof rankRecipes>[2]);

		expect(roomy.map(({ recipe }) => recipe.id)).toEqual(["slow", "fast"]);
		expect(constrained.map(({ recipe }) => recipe.id)).toEqual(["fast"]);
	});

	it("marks missing throughput estimates as duration-unverified", () => {
		const [ranked] = rankRecipes([recipe("unknown-speed")], "optimization", {
			maxExperimentDurationSeconds: 30,
		});
		expect(ranked.reasons.join(" ")).toMatch(
			/duration compatibility unverified/i,
		);
	});
});
