/**
 * Tests for FTS5 input sanitization in searchCatalog.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { resetDb } from "../../src/db/schema.js";
import { upsertCatalogItem, searchCatalog } from "../../src/db/techniques.js";
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

describe("FTS5 sanitization", () => {
	it("handles double quotes without crashing", () => {
		upsertCatalogItem(
			makeItem("s1", { description: 'optimize "prompts" with quotes' }),
			"h1",
			"y1"
		);
		const results = searchCatalog('"prompts"');
		// Should not throw — may return 0 results due to stripping
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles asterisks without crashing", () => {
		upsertCatalogItem(
			makeItem("s2", { description: "optimize prompts* with wildcard" }),
			"h2",
			"y2"
		);
		const results = searchCatalog("prompts*");
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles parentheses without crashing", () => {
		upsertCatalogItem(
			makeItem("s3", { description: "optimize (prompts) with parens" }),
			"h3",
			"y3"
		);
		const results = searchCatalog("(prompts)");
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles AND/OR/NOT keywords without crashing", () => {
		upsertCatalogItem(
			makeItem("s4", { description: "optimize prompts AND code" }),
			"h4",
			"y4"
		);
		const results = searchCatalog("prompts AND code");
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles NEAR keyword without crashing", () => {
		upsertCatalogItem(
			makeItem("s5", { description: "optimize prompts NEAR code" }),
			"h5",
			"y5"
		);
		const results = searchCatalog("prompts NEAR code");
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles caret and tilde without crashing", () => {
		upsertCatalogItem(
			makeItem("s6", { description: "optimize ^prompts~ with special" }),
			"h6",
			"y6"
		);
		const results = searchCatalog("^prompts~");
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles hyphen without crashing", () => {
		upsertCatalogItem(
			makeItem("s7", { description: "optimize prompts-with-hyphens" }),
			"h7",
			"y7"
		);
		const results = searchCatalog("prompts-with-hyphens");
		expect(Array.isArray(results)).toBe(true);
	});

	it("handles mixed special characters", () => {
		upsertCatalogItem(
			makeItem("s8", { description: "optimize *ALL* (prompts) AND code" }),
			"h8",
			"y8"
		);
		const results = searchCatalog("*ALL* (prompts) AND code");
		expect(Array.isArray(results)).toBe(true);
	});

	it("still finds results after sanitization", () => {
		upsertCatalogItem(
			makeItem("s9", { description: "optimize prompts for better results" }),
			"h9",
			"y9"
		);
		const results = searchCatalog("optimize prompts");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.some((r) => r.id === "s9")).toBe(true);
	});
});
