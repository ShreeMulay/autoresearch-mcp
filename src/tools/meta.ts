/**
 * Meta tools for technique outcome logging and cross-project learning.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { logTechniqueOutcome } from "../db/experiments.js";
import { getDbPath } from "../db/schema.js";
import { getCatalogStats } from "../db/techniques.js";
import { VERSION } from "../version.js";

export function registerMetaTools(mcp: McpServer): void {
	mcp.tool(
		"get_server_info",
		"Get autoresearch-mcp server metadata: version, catalog stats, and configuration.",
		{},
		async () => {
			try {
				const stats = getCatalogStats();
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									version: VERSION,
									catalog: stats,
									db_path: getDbPath(),
								},
								null,
								2,
							),
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to get server info: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	mcp.tool(
		"log_technique_outcome",
		"Log the observed outcome of using a technique in a domain or project. " +
			"Use this to accumulate meta-learning data about which approaches work, partially work, fail, or get abandoned.",
		{
			technique_id: z
				.string()
				.describe("Technique ID used in the experiment or project"),
			domain: z.string().describe("Domain where the technique was applied"),
			outcome: z
				.enum(["success", "partial", "failed", "abandoned"])
				.describe("Observed outcome of the technique"),
			project_name: z
				.string()
				.optional()
				.describe("Optional project name for additional context"),
			notes: z
				.string()
				.optional()
				.describe("Optional notes about what happened and why"),
			score_improvement: z
				.number()
				.optional()
				.describe("Optional percentage improvement in score"),
			total_experiments: z
				.number()
				.optional()
				.describe("Optional number of experiments run with this technique"),
		},
		async ({
			technique_id,
			domain,
			outcome,
			project_name,
			notes,
			score_improvement,
			total_experiments,
		}) => {
			try {
				const outcomeId = logTechniqueOutcome({
					technique_id,
					domain,
					outcome,
					project_name,
					notes,
					score_improvement,
					total_experiments,
				});

				const lines = [
					"Technique outcome logged.",
					`Record ID: ${outcomeId}`,
					`Technique: ${technique_id}`,
					`Domain: ${domain}`,
					`Outcome: ${outcome}`,
				];

				if (project_name) {
					lines.push(`Project: ${project_name}`);
				}

				if (score_improvement !== undefined) {
					lines.push(`Score improvement: ${score_improvement}%`);
				}

				if (total_experiments !== undefined) {
					lines.push(`Total experiments: ${total_experiments}`);
				}

				if (notes) {
					lines.push(`Notes: ${notes}`);
				}

				return {
					content: [
						{
							type: "text" as const,
							text: lines.join("\n"),
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to log technique outcome: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
