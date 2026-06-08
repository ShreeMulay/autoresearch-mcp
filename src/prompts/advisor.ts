/**
 * MCP Prompts — guided interaction flows for autoresearch.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export function registerPrompts(mcp: McpServer): void {
	// ============================================================
	// autoresearch-advisor
	// ============================================================
	mcp.prompt(
		"autoresearch-advisor",
		"Describe your optimization problem and get guided help choosing the right autoresearch technique",
		{ problem: z.string().describe("What you want to optimize or research") },
		({ problem }): GetPromptResult => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I want to apply the autoresearch pattern (Karpathy's autonomous experiment loop) to the following problem:

${problem}

Please help me:
1. Identify the right search strategy, evaluator, and execution pattern from the autoresearch catalog
2. Define my ExperimentSpec (target artifact, metric, budget, stopping conditions)
3. Suggest a concrete implementation plan

Use the autoresearch MCP tools to search the catalog and recommend a composed recipe. Start with \`suggest_technique\` and then \`get_technique\` for the recommended items.`,
					},
				},
			],
		}),
	);

	// ============================================================
	// experiment-review
	// ============================================================
	mcp.prompt(
		"experiment-review",
		"Review autoresearch experiment results and get suggestions for next steps",
		{
			experiment_summary: z
				.string()
				.describe("Summary of experiment results so far"),
		},
		({ experiment_summary }): GetPromptResult => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Review these autoresearch experiment results and help me decide next steps:

${experiment_summary}

Please analyze:
1. Is the metric converging or still improving?
2. Are there signs of overfitting to the eval?
3. Should I change my search strategy, evaluator, or budget?
4. Are there secondary metrics I should be watching (regression detection)?
5. What specific changes should I try next?

Use the autoresearch catalog to suggest alternative techniques if the current approach is stalling.`,
					},
				},
			],
		}),
	);

	// ============================================================
	// program-md-generator
	// ============================================================
	mcp.prompt(
		"program-md-generator",
		"Generate a program.md file (Karpathy-style agent instructions) for a specific autoresearch task",
		{
			task: z.string().describe("What the agent should optimize"),
			target_file: z.string().describe("The file the agent will modify"),
			metric: z.string().describe("The metric to optimize"),
			constraints: z.string().optional().describe("Any constraints or rules"),
		},
		({ task, target_file, metric, constraints }): GetPromptResult => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Generate a program.md file (Karpathy autoresearch style) for the following task:

**Task:** ${task}
**Target File:** ${target_file}
**Metric:** ${metric}
${constraints ? `**Constraints:** ${constraints}` : ""}

The program.md should include:
1. Clear objective and metric definition
2. What the agent CAN modify (target file)
3. What the agent must NOT modify (evaluation, data prep)
4. Strategy hints for the agent (what kinds of changes to try)
5. Danger zones and anti-patterns to avoid
6. The instruction "NEVER STOP" (continue until budget exhausted)

Follow the Karpathy convention: program.md is the human-agent interface, written by the human, read by the agent. It should be a lightweight "skill" definition.`,
					},
				},
			],
		}),
	);
}
