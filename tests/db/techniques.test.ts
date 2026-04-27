/**
 * Tests for catalog DB operations (src/db/techniques.ts)
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDb } from "../../src/db/schema.js";
import {
	getCatalogItem,
	getCatalogStats,
	getContentHash,
	listCatalogItems,
	searchCatalog,
	upsertCatalogItem,
} from "../../src/db/techniques.js";
import type { CatalogItem } from "../../src/types.js";

function makeItem(id: string, overrides?: Partial<CatalogItem>): CatalogItem {
	return {
		id,
		name: `Technique ${id}`,
		layer: "strategy",
		description: `Description for ${id}`,
		when_to_use: `When to use ${id}`,
		tags: ["test"],
		related: [],
		examples: [],
		requires_gpu: false,
		...overrides,
	};
}

beforeEach(() => {
	resetDb(":memory:");
});

describe("upsertCatalogItem + getCatalogItem", () => {
	it("creates and retrieves a catalog item", () => {
		const item = makeItem("hill-climbing");
		upsertCatalogItem(item, "hash1", "yaml content");

		const found = getCatalogItem("hill-climbing");
		expect(found).not.toBeNull();
		expect(found?.id).toBe("hill-climbing");
		expect(found?.name).toBe("Technique hill-climbing");
		expect(found?.layer).toBe("strategy");
	});

	it("returns null for missing item", () => {
		const found = getCatalogItem("nonexistent");
		expect(found).toBeNull();
	});

	it("updates existing item on conflict", () => {
		const item = makeItem("evolutionary");
		upsertCatalogItem(item, "hash1", "yaml v1");

		const updated = makeItem("evolutionary", { name: "Updated Name" });
		upsertCatalogItem(updated, "hash2", "yaml v2");

		const found = getCatalogItem("evolutionary");
		expect(found?.name).toBe("Updated Name");
	});
});

describe("listCatalogItems", () => {
	it("lists all items when no filters", () => {
		upsertCatalogItem(makeItem("s1"), "h1", "y1");
		upsertCatalogItem(makeItem("s2", { layer: "evaluator" }), "h2", "y2");
		upsertCatalogItem(makeItem("s3", { layer: "pattern" }), "h3", "y3");

		const items = listCatalogItems();
		expect(items.length).toBe(3);
	});

	it("filters by layer", () => {
		upsertCatalogItem(makeItem("s1"), "h1", "y1");
		upsertCatalogItem(makeItem("s2", { layer: "evaluator" }), "h2", "y2");

		const strategies = listCatalogItems({ layer: "strategy" });
		expect(strategies.length).toBe(1);
		expect(strategies[0].id).toBe("s1");
	});

	it("filters by tags (AND logic)", () => {
		upsertCatalogItem(makeItem("s1", { tags: ["fast", "simple"] }), "h1", "y1");
		upsertCatalogItem(
			makeItem("s2", { tags: ["fast", "complex"] }),
			"h2",
			"y2",
		);
		upsertCatalogItem(makeItem("s3", { tags: ["slow", "simple"] }), "h3", "y3");

		const fastSimple = listCatalogItems({ tags: ["fast", "simple"] });
		expect(fastSimple.length).toBe(1);
		expect(fastSimple[0].id).toBe("s1");
	});

	it("respects limit", () => {
		upsertCatalogItem(makeItem("s1"), "h1", "y1");
		upsertCatalogItem(makeItem("s2"), "h2", "y2");
		upsertCatalogItem(makeItem("s3"), "h3", "y3");

		const limited = listCatalogItems({ limit: 2 });
		expect(limited.length).toBe(2);
	});
});

describe("searchCatalog", () => {
	it("finds items by keyword in description", () => {
		upsertCatalogItem(
			makeItem("s1", { description: "optimize prompts with gradient descent" }),
			"h1",
			"y1",
		);
		upsertCatalogItem(
			makeItem("s2", { description: "evolve population over generations" }),
			"h2",
			"y2",
		);

		const results = searchCatalog("optimize prompts");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.some((r) => r.id === "s1")).toBe(true);
	});

	it("falls back to listing when query is empty", () => {
		upsertCatalogItem(makeItem("s1"), "h1", "y1");

		const results = searchCatalog("");
		expect(results.length).toBe(1);
	});

	it("filters by layer during search", () => {
		upsertCatalogItem(makeItem("s1", { layer: "strategy" }), "h1", "y1");
		upsertCatalogItem(
			makeItem("s2", { layer: "evaluator", description: "optimize prompts" }),
			"h2",
			"y2",
		);

		const results = searchCatalog("optimize", { layer: "evaluator" });
		expect(results.length).toBe(1);
		expect(results[0].id).toBe("s2");
	});

	it("returns empty array for no matches", () => {
		upsertCatalogItem(makeItem("s1"), "h1", "y1");

		const results = searchCatalog("xyznonexistent");
		expect(results.length).toBe(0);
	});
});

describe("getCatalogStats", () => {
	it("returns correct totals and layer breakdown", () => {
		upsertCatalogItem(makeItem("s1", { layer: "strategy" }), "h1", "y1");
		upsertCatalogItem(makeItem("s2", { layer: "strategy" }), "h2", "y2");
		upsertCatalogItem(makeItem("s3", { layer: "evaluator" }), "h3", "y3");

		const stats = getCatalogStats();
		expect(stats.total).toBe(3);
		expect(stats.by_layer.strategy).toBe(2);
		expect(stats.by_layer.evaluator).toBe(1);
	});
});

describe("getContentHash", () => {
	it("returns stored content hash", () => {
		upsertCatalogItem(makeItem("s1"), "hashabc", "y1");

		const hash = getContentHash("s1");
		expect(hash).toBe("hashabc");
	});

	it("returns null for missing item", () => {
		const hash = getContentHash("nonexistent");
		expect(hash).toBeNull();
	});
});
