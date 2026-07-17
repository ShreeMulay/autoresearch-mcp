import { describe, expect, it } from "bun:test";
import {
	BudgetSchema,
	CatalogItemSchema,
	ConstraintsSchema,
} from "../../src/types.js";

describe("budget and constraint numeric integrity", () => {
	it.each([
		{ max_iterations: -1 },
		{ max_iterations: 1.5 },
		{ max_tokens: -1 },
		{ max_tokens: 1.5 },
		{ max_time_seconds: -1 },
		{ max_dollars: -0.01 },
		{ max_dollars: Number.POSITIVE_INFINITY },
		{ max_time_seconds: Number.NaN },
	])("rejects invalid budget %#", (budget) => {
		expect(BudgetSchema.safeParse(budget).success).toBe(false);
	});

	it.each([
		{
			metric_floors: { score: 2 },
			metric_ceilings: { score: 1 },
		},
		{
			metric_floors: { score: Number.NaN },
			metric_ceilings: {},
		},
		{
			metric_floors: {},
			metric_ceilings: { score: Number.POSITIVE_INFINITY },
		},
	])("rejects invalid constraints %#", (constraints) => {
		expect(ConstraintsSchema.safeParse(constraints).success).toBe(false);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects invalid experiments_per_hour %p",
		(experimentsPerHour) => {
			expect(
				CatalogItemSchema.safeParse({
					id: "recipe",
					name: "Recipe",
					layer: "recipe",
					description: "Fixture",
					when_to_use: "Tests",
					experiments_per_hour: experimentsPerHour,
				}).success,
			).toBe(false);
		},
	);
});
