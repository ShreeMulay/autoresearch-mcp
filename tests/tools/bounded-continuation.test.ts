/**
 * Bounded-continuation wording: catalog templates, generated default program,
 * and the program-md-generator prompt must never demand unconditional looping.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCatalog } from "../../src/db/load-catalog.js";
import { resetDb } from "../../src/db/schema.js";
import { upsertCatalogItem } from "../../src/db/techniques.js";
import { registerPrompts } from "../../src/prompts/advisor.js";
import {
	CONTINUATION_RULE_LINES,
	registerScaffoldingTools,
} from "../../src/tools/scaffolding.js";
import type { CatalogItem } from "../../src/types.js";

const TEMPLATE_ROOT = resolve(import.meta.dir, "../../catalog/templates");

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

type PromptCallback = (args: Record<string, string>) => {
	messages: Array<{ content: { type: string; text: string } }>;
};

function promptCallback(name: string): PromptCallback {
	const prompts = new Map<string, PromptCallback>();
	registerPrompts({
		prompt: (...args: unknown[]) => {
			prompts.set(args[0] as string, args[3] as PromptCallback);
		},
	} as unknown as McpServer);
	const callback = prompts.get(name);
	if (!callback) throw new Error(`${name} prompt missing`);
	return callback;
}

function getTemplateHandler() {
	type Handler = (args: {
		recipe_id: string;
		template_name: string;
	}) => Promise<ToolResult>;
	let handler: Handler | undefined;
	registerScaffoldingTools({
		tool: (...args: unknown[]) => {
			if (args[0] === "get_template") handler = args[3] as Handler;
		},
	} as unknown as McpServer);
	if (!handler) throw new Error("get_template missing");
	return handler;
}

function assertBounded(content: string): void {
	expect(content).not.toMatch(/never stop/i);
	expect(content).not.toMatch(/^##\s*NEVER STOP/im);
	const lines = content.split("\n");
	const start = lines.indexOf(CONTINUATION_RULE_LINES[0]);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(lines.slice(start, start + CONTINUATION_RULE_LINES.length)).toEqual([
		...CONTINUATION_RULE_LINES,
	]);
	expect(
		lines.filter((line) => line === CONTINUATION_RULE_LINES[0]),
	).toHaveLength(1);
}

describe("bounded continuation wording", () => {
	beforeEach(async () => {
		resetDb(":memory:");
		expect((await loadCatalog()).errors).toEqual([]);
	});

	it("covers every curated recipe template", async () => {
		const recipes = (await readdir(TEMPLATE_ROOT)).sort();
		expect(recipes.length).toBeGreaterThanOrEqual(8);
		for (const recipe of recipes) {
			const content = await readFile(
				join(TEMPLATE_ROOT, recipe, "program.md"),
				"utf8",
			);
			assertBounded(content);
		}
	});

	it("names each required stop condition and the non-enforcement caveat", () => {
		const text = CONTINUATION_RULE_LINES.join("\n");
		expect(text).toContain("finite bound");
		expect(text).toContain("budget is exhausted");
		expect(text).toContain("requires_approval");
		expect(text).toContain("safety or validity failure");
		expect(text).toContain("supervisor says stop");
		expect(text).toContain("does not enforce them");
	});

	it("uses bounded continuation in the generated default program template", async () => {
		const recipe: CatalogItem = {
			id: "missing-template-recipe",
			name: "Missing Template Recipe",
			layer: "recipe",
			description: "Recipe fixture with no bundled templates.",
			when_to_use: "Use only in tests.",
			tags: ["test"],
			related: [],
			examples: [],
			requires_gpu: false,
			composes: {
				search_strategy: "hill-climbing",
				evaluator: "benchmark-harness",
				execution_pattern: "single-ratchet",
			},
		};
		upsertCatalogItem(recipe, "fixture-hash", "id: missing-template-recipe");
		const response = await getTemplateHandler()({
			recipe_id: recipe.id,
			template_name: "program.md",
		});
		expect(response.isError).toBeUndefined();
		expect(response.content[0].text).toContain("# Autoresearch Program");
		assertBounded(response.content[0].text);
	});

	it("asks program-md-generator for bounded continuation instead of NEVER STOP", () => {
		const text = promptCallback("program-md-generator")({
			task: "improve accuracy",
			target_file: "prompt.md",
			metric: "accuracy",
		}).messages[0].content.text;
		expect(text).not.toMatch(/never stop/i);
		expect(text).toContain(
			"9. Bounded continuation: before any repeated execution, obtain and record a finite bound (iterations, time, tokens, or dollars); persist through plateaus, but stop when the budget is exhausted, when human approval is required (before each candidate evaluation/acceptance when the risk policy sets requires_approval), on any safety or validity failure, or when the supervisor says stop",
		);
		expect(text).toContain(
			"10. A note that these limits are operator instructions, not server-enforced controls",
		);
	});
});
