/**
 * MCP Resources — static content served as Resources, not Tools.
 * Follows Council recommendation: use Resources for read-only catalog data.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import {
	getCatalogItem,
	getCatalogStats,
	listCatalogItems,
} from "../db/techniques.js";
import zodToJsonSchema from "../schemas/zod-to-json.js";
import { ExperimentSpecSchema, TechniqueSpecSchema } from "../types.js";

export function registerResources(mcp: McpServer): void {
	// ============================================================
	// Full catalog listing
	// ============================================================
	mcp.resource(
		"catalog",
		"autoresearch://catalog",
		{
			description:
				"Complete autoresearch technique catalog organized by layer (strategies, evaluators, patterns, recipes)",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const items = listCatalogItems();
			const stats = getCatalogStats();

			const grouped: Record<string, unknown[]> = {
				strategies: [],
				evaluators: [],
				patterns: [],
				recipes: [],
			};

			for (const item of items) {
				const key =
					item.layer === "strategy"
						? "strategies"
						: item.layer === "evaluator"
							? "evaluators"
							: item.layer === "pattern"
								? "patterns"
								: "recipes";
				grouped[key].push({
					id: item.id,
					name: item.name,
					description: item.description.trim().split("\n")[0],
					tags: item.tags,
					composes: item.composes,
				});
			}

			return {
				contents: [
					{
						uri: "autoresearch://catalog",
						mimeType: "application/json",
						text: JSON.stringify({ stats, catalog: grouped }, null, 2),
					},
				],
			};
		},
	);

	// ============================================================
	// Individual technique by ID
	// ============================================================
	mcp.resource(
		"technique",
		new ResourceTemplate("autoresearch://techniques/{id}", {
			list: async () => {
				const items = listCatalogItems();
				return {
					resources: items.map((item) => ({
						uri: `autoresearch://techniques/${item.id}`,
						name: `${item.name} (${item.layer})`,
						description: item.description.trim().split("\n")[0],
						mimeType: "application/json" as const,
					})),
				};
			},
		}),
		{
			description: "Individual autoresearch technique details",
			mimeType: "application/json",
		},
		async (uri, { id }): Promise<ReadResourceResult> => {
			const item = getCatalogItem(id as string);
			if (!item) {
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify({ error: `Technique not found: ${id}` }),
						},
					],
				};
			}
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: JSON.stringify(item, null, 2),
					},
				],
			};
		},
	);

	// ============================================================
	// ExperimentSpec JSON Schema
	// ============================================================
	mcp.resource(
		"experiment-spec-schema",
		"autoresearch://schemas/experiment-spec",
		{
			description:
				"JSON Schema for ExperimentSpec — the runnable experiment contract",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const schema = zodToJsonSchema(ExperimentSpecSchema, "ExperimentSpec");
			return {
				contents: [
					{
						uri: "autoresearch://schemas/experiment-spec",
						mimeType: "application/json",
						text: JSON.stringify(schema, null, 2),
					},
				],
			};
		},
	);

	// ============================================================
	// TechniqueSpec JSON Schema
	// ============================================================
	mcp.resource(
		"technique-spec-schema",
		"autoresearch://schemas/technique-spec",
		{
			description:
				"JSON Schema for TechniqueSpec — composable technique definition",
			mimeType: "application/json",
		},
		async (): Promise<ReadResourceResult> => {
			const schema = zodToJsonSchema(TechniqueSpecSchema, "TechniqueSpec");
			return {
				contents: [
					{
						uri: "autoresearch://schemas/technique-spec",
						mimeType: "application/json",
						text: JSON.stringify(schema, null, 2),
					},
				],
			};
		},
	);
}
