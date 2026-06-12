/**
 * Regression tests for catalog search/tag hardening.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDb } from "../../src/db/schema.js";
import {
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

describe("FTS5 safe-token search", () => {
	it("returns no results for non-empty queries with no supported FTS terms", () => {
		upsertCatalogItem(
			makeItem("one", { description: "optimize prompts" }),
			"hash-one",
			"yaml-one",
		);
		upsertCatalogItem(
			makeItem("two", { description: "measure code" }),
			"hash-two",
			"yaml-two",
		);
		upsertCatalogItem(
			makeItem("three", { description: "revise content" }),
			"hash-three",
			"yaml-three",
		);

		expect(searchCatalog("C++")).toEqual([]);
		expect(searchCatalog("AND")).toEqual([]);
		expect(searchCatalog("")).toHaveLength(3);
		expect(searchCatalog("prompts").map((item) => item.id)).toContain("one");
	});

	it("handles punctuation-heavy user queries without throwing", () => {
		upsertCatalogItem(
			makeItem("safe", {
				description:
					"optimize prompts in TypeScript projects with C++ bindings",
			}),
			"hash-safe",
			"yaml-safe",
		);

		const queries = [
			"metric: latency",
			"https://example.com/prompts?q=test",
			"src/tools/discovery.ts",
			"C++ prompt optimizer",
			"{prompt} [optimizer] foo:bar",
		];

		for (const query of queries) {
			expect(() => searchCatalog(query)).not.toThrow();
		}
	});

	it("applies tag filters in FTS search mode", () => {
		upsertCatalogItem(
			makeItem("fast", {
				description: "optimize prompt latency",
				tags: ["fast", "prompt"],
			}),
			"hash-fast",
			"yaml-fast",
		);
		upsertCatalogItem(
			makeItem("slow", {
				description: "optimize prompt quality",
				tags: ["slow", "prompt"],
			}),
			"hash-slow",
			"yaml-slow",
		);

		const results = searchCatalog("optimize prompt", {
			limit: 10,
			tags: ["fast"],
		});

		expect(results.map((item) => item.id)).toEqual(["fast"]);
	});
});

describe("JSON tag filtering", () => {
	it("treats percent and underscore as literal tag characters", () => {
		upsertCatalogItem(
			makeItem("literal", { tags: ["cost_%"] }),
			"hash-literal",
			"yaml-literal",
		);
		upsertCatalogItem(
			makeItem("other", { tags: ["cost_10"] }),
			"hash-other",
			"yaml-other",
		);

		const results = listCatalogItems({ tags: ["cost_%"] });
		expect(results.map((item) => item.id)).toEqual(["literal"]);
	});
});
