import { beforeEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCatalog } from "../../src/db/load-catalog.js";
import { resetDb } from "../../src/db/schema.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

type SuggestHandler = (args: {
	problem: string;
	max_experiment_duration?: string;
}) => Promise<ToolResult>;

function suggestHandler(): SuggestHandler {
	const handlers = new Map<string, SuggestHandler>();
	const mcp = {
		tool: (...args: unknown[]) => {
			const [name, , , handler] = args;
			handlers.set(name as string, handler as SuggestHandler);
		},
	} as McpServer;
	registerDiscoveryTools(mcp);
	const handler = handlers.get("suggest_technique");
	if (!handler) throw new Error("suggest_technique handler was not registered");
	return handler;
}

beforeEach(async () => {
	resetDb(":memory:");
	await loadCatalog();
});

describe("maximum experiment duration grammar", () => {
	it.each([
		"1 sec",
		"1 secs",
		"1 second",
		"1 seconds",
		"0.5 m",
		"2 min",
		"2 mins",
		"2 minute",
		"2 minutes",
		"1 h",
		"1 hr",
		"1 hrs",
		"1 hour",
		"1 HOURS",
	])("accepts %s", async (duration) => {
		const result = await suggestHandler()({
			problem: "optimize a scalar fixture",
			max_experiment_duration: duration,
		});
		expect(result.isError).not.toBe(true);
	});

	it.each([
		"0 seconds",
		"-1 second",
		"+1 second",
		".5 seconds",
		"1. seconds",
		"1e3 seconds",
		"1second",
		"1s",
		"1 day",
		"NaN seconds",
		"Infinity seconds",
	])("rejects %s", async (duration) => {
		const result = await suggestHandler()({
			problem: "optimize a scalar fixture",
			max_experiment_duration: duration,
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/duration/i);
	});

	it("rejects overflow after converting the unit", async () => {
		const duration = `1${"0".repeat(308)} hours`;
		const result = await suggestHandler()({
			problem: "optimize a scalar fixture",
			max_experiment_duration: duration,
		});
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/duration|finite|range/i);
	});
});
