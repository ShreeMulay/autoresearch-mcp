/**
 * Discovery tools: search_techniques, get_technique, suggest_technique
 * Phase 0.5 — the core catalog interaction tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	getCatalogItem,
	getCatalogStats,
	listCatalogItems,
	searchCatalog,
} from "../db/techniques.js";
import type { CatalogItem } from "../types.js";

export function registerDiscoveryTools(mcp: McpServer): void {
	// ============================================================
	// search_techniques — FTS5 search with optional list mode
	// ============================================================
	mcp.tool(
		"search_techniques",
		"Search autoresearch techniques by natural language query. If query is empty, lists all techniques. " +
			"Returns ranked results from the composable catalog (strategies, evaluators, patterns, recipes).",
		{
			query: z
				.string()
				.default("")
				.describe(
					"Search query. Empty = list all. Examples: 'optimize prompts overnight', 'measure code performance'",
				),
			layer: z
				.enum(["strategy", "evaluator", "pattern", "recipe"])
				.optional()
				.describe("Filter by catalog layer"),
			tags: z
				.array(z.string())
				.optional()
				.describe("Filter by tags (AND logic)"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.default(10)
				.describe("Max results to return"),
		},
		async ({ query, layer, tags, limit }) => {
			try {
				let items: CatalogItem[] = [];

				if (!query || query.trim() === "") {
					// List mode
					items = listCatalogItems({ layer, tags, limit });
				} else {
					// Search mode — use FTS5
					items = searchCatalog(query, { layer, tags, limit });

					// If FTS returns nothing, fallback to exact tag/layer listing.
					if (items.length === 0 && tags?.length) {
						items = listCatalogItems({ layer, tags, limit });
					}
				}

				if (items.length === 0) {
					return {
						content: [
							{
								type: "text" as const,
								text: `No techniques found for query: "${query}"${layer ? ` (layer: ${layer})` : ""}. Try broader terms or list all with an empty query.`,
							},
						],
					};
				}

				const stats = getCatalogStats();
				const summary = items
					.map((item: CatalogItem) => {
						const lines = [
							`### ${item.name} (\`${item.id}\`)`,
							`Layer: ${item.layer} | Tags: ${item.tags.join(", ") || "none"}`,
							item.description.trim(),
							`When to use: ${item.when_to_use.trim().split("\n")[0]}`,
						];

						if (item.estimated_cost || item.experiments_per_hour) {
							const detailParts: string[] = [];

							if (item.estimated_cost) {
								detailParts.push(`Cost: ${item.estimated_cost}`);
							}

							if (item.experiments_per_hour) {
								detailParts.push(`~${item.experiments_per_hour} exp/hr`);
							}

							lines.push(detailParts.join(" | "));
						}

						return lines.join("\n");
					})
					.join("\n\n---\n\n");

				const queryText = query || "(list all)";
				const queryLine = layer
					? `Query: "${queryText}" | Layer: ${layer}`
					: `Query: "${queryText}"`;

				return {
					content: [
						{
							type: "text" as const,
							text: [
								"## Autoresearch Catalog Search",
								queryLine,
								`Results: ${items.length} of ${stats.total} total techniques`,
								"",
								"---",
								"",
								summary,
								"",
								"---",
								"",
								"Use `get_technique` with an ID for full details including templates and examples.",
							].join("\n"),
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Search error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ============================================================
	// get_technique — full details by ID
	// ============================================================
	mcp.tool(
		"get_technique",
		"Get full details for a specific autoresearch technique by ID. " +
			"Returns description, when to use, core pattern, examples, related techniques, and composition info.",
		{
			id: z
				.string()
				.describe(
					"Technique ID (e.g., 'hill-climbing', 'prompt-optimization', 'single-ratchet')",
				),
		},
		async ({ id }) => {
			try {
				const item = getCatalogItem(id);

				if (!item) {
					// Try fuzzy match
					const suggestions = searchCatalog(id, { limit: 3 });
					const suggestionText =
						suggestions.length > 0
							? `\n\nDid you mean: ${suggestions.map((suggestion: CatalogItem) => `\`${suggestion.id}\``).join(", ")}?`
							: "";
					return {
						content: [
							{
								type: "text" as const,
								text: `Technique not found: "${id}"${suggestionText}`,
							},
						],
						isError: true,
					};
				}

				const lines: string[] = [`# ${item.name}`, ""];
				const metadataLine = item.source
					? `ID: \`${item.id}\` | Layer: ${item.layer} | Source: ${item.source}`
					: `ID: \`${item.id}\` | Layer: ${item.layer}`;
				lines.push(metadataLine);

				if (item.tags.length) {
					lines.push(`Tags: ${item.tags.join(", ")}`);
				}

				const itemDetails: string[] = [];
				if (item.estimated_cost) {
					itemDetails.push(`Estimated Cost: ${item.estimated_cost}`);
				}
				if (item.experiments_per_hour) {
					itemDetails.push(`~${item.experiments_per_hour} experiments/hour`);
				}
				if (item.requires_gpu) {
					itemDetails.push("GPU Required");
				}
				if (itemDetails.length > 0) {
					lines.push(itemDetails.join(" | "));
				}

				lines.push(
					"",
					"## Description",
					item.description,
					"",
					"## When to Use",
					item.when_to_use,
					"",
				);

				if (item.when_not_to_use) {
					lines.push("## When NOT to Use", item.when_not_to_use, "");
				}
				if (item.core_pattern) {
					lines.push("## Core Pattern", item.core_pattern, "");
				}

				if (item.composes) {
					lines.push("## Composition", "This recipe composes:");
					if (item.composes.search_strategy) {
						lines.push(
							`- Search Strategy: \`${item.composes.search_strategy}\``,
						);
					}
					if (item.composes.evaluator) {
						lines.push(`- Evaluator: \`${item.composes.evaluator}\``);
					}
					if (item.composes.execution_pattern) {
						lines.push(
							`- Execution Pattern: \`${item.composes.execution_pattern}\``,
						);
					}
					lines.push("");
				}

				if (item.examples.length > 0) {
					lines.push("## Examples");
					for (const example of item.examples) {
						const metricText = example.metric
							? ` (metric: ${example.metric})`
							: "";
						const resultText = example.result ? ` — ${example.result}` : "";
						lines.push(
							`- ${example.domain}: ${example.description}${metricText}${resultText}`,
						);
					}
					lines.push("");
				}

				if (item.related.length > 0) {
					lines.push(
						"## Related Techniques",
						item.related
							.map((relatedId: string) => `\`${relatedId}\``)
							.join(", "),
					);
				}

				const text = lines.join("\n");

				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ============================================================
	// suggest_technique — AI-powered recommendation
	// ============================================================
	mcp.tool(
		"suggest_technique",
		"Describe your optimization problem and get a recommendation for which autoresearch " +
			"technique to use. Returns a composed recipe (strategy + evaluator + pattern) with rationale.",
		{
			problem: z
				.string()
				.describe(
					"What you are trying to optimize or research. Be specific about your domain, metric, and constraints.",
				),
			has_scalar_metric: z
				.boolean()
				.optional()
				.describe("Do you have a single number that defines success?"),
			max_experiment_duration: z
				.string()
				.optional()
				.describe(
					"How long can a single experiment take? (e.g., '5 minutes', '1 hour')",
				),
			needs_overnight: z
				.boolean()
				.optional()
				.describe("Do you want this to run autonomously while you sleep?"),
			domain: z
				.string()
				.optional()
				.describe(
					"Domain (e.g., 'prompt-engineering', 'ml-training', 'code-optimization')",
				),
		},
		async ({
			problem,
			has_scalar_metric,
			max_experiment_duration,
			needs_overnight,
			domain,
		}) => {
			try {
				// Search for relevant techniques using the problem description
				const searchResults = searchCatalog(problem, { limit: 15 });
				const recipes = listCatalogItems({ layer: "recipe" });
				const strategies = listCatalogItems({ layer: "strategy" });
				const evaluators = listCatalogItems({ layer: "evaluator" });
				const patterns = listCatalogItems({ layer: "pattern" });

				// Score recipes based on constraints
				const scoredRecipes = recipes.map((recipe: CatalogItem) => {
					let score = 0;
					const reasons: string[] = [];

					// Check if recipe appeared in search results
					if (
						searchResults.some((result: CatalogItem) => result.id === recipe.id)
					) {
						score += 3;
						reasons.push("Matches your problem description");
					}

					// Domain match
					if (
						domain &&
						recipe.tags.some((tag: string) =>
							tag.toLowerCase().includes(domain.toLowerCase()),
						)
					) {
						score += 2;
						reasons.push(`Matches domain: ${domain}`);
					}

					// Metric availability
					if (has_scalar_metric === true) {
						score += 1;
						reasons.push(
							"You have a scalar metric (good for ratchet patterns)",
						);
					}

					// Overnight needs
					if (
						needs_overnight &&
						recipe.tags.some((tag: string) =>
							["autonomous", "overnight", "batch"].includes(tag),
						)
					) {
						score += 2;
						reasons.push("Supports overnight autonomous operation");
					}

					// GPU check
					if (recipe.requires_gpu) {
						score -= 1; // Slight penalty unless explicitly needed
					}

					return { recipe, score, reasons };
				});

				// Sort by score
				scoredRecipes.sort((a, b) => b.score - a.score);
				const top3 = scoredRecipes.slice(0, 3);

				const lines: string[] = [
					"# Autoresearch Technique Recommendation",
					"",
					`Your Problem: ${problem}`,
				];
				if (has_scalar_metric !== undefined) {
					lines.push(`Scalar Metric: ${has_scalar_metric ? "Yes" : "No"}`);
				}
				if (max_experiment_duration) {
					lines.push(`Max Duration: ${max_experiment_duration}`);
				}
				if (needs_overnight) {
					lines.push("Overnight: Yes");
				}
				if (domain) {
					lines.push(`Domain: ${domain}`);
				}
				lines.push("", "---", "");

				for (let i = 0; i < top3.length; i++) {
					const { recipe, reasons } = top3[i];
					const label = i === 0 ? "Recommended" : `Option ${i + 1}`;
					lines.push(
						`## ${label}: ${recipe.name} (\`${recipe.id}\`)`,
						"",
						recipe.description.trim(),
						"",
					);

					if (recipe.composes) {
						lines.push("Composition:");
						if (recipe.composes.search_strategy) {
							const strat = strategies.find(
								(strategy: CatalogItem) =>
									strategy.id === recipe.composes?.search_strategy,
							);
							lines.push(
								strat
									? `- Search: \`${recipe.composes.search_strategy}\` — ${strat.name}`
									: `- Search: \`${recipe.composes.search_strategy}\``,
							);
						}
						if (recipe.composes.evaluator) {
							const eval_ = evaluators.find(
								(evaluator: CatalogItem) =>
									evaluator.id === recipe.composes?.evaluator,
							);
							lines.push(
								eval_
									? `- Evaluator: \`${recipe.composes.evaluator}\` — ${eval_.name}`
									: `- Evaluator: \`${recipe.composes.evaluator}\``,
							);
						}
						if (recipe.composes.execution_pattern) {
							const pat = patterns.find(
								(pattern: CatalogItem) =>
									pattern.id === recipe.composes?.execution_pattern,
							);
							lines.push(
								pat
									? `- Pattern: \`${recipe.composes.execution_pattern}\` — ${pat.name}`
									: `- Pattern: \`${recipe.composes.execution_pattern}\``,
							);
						}
						lines.push("");
					}

					if (reasons.length > 0) {
						lines.push(`Why this fits: ${reasons.join("; ")}`);
					}

					const recipeDetails: string[] = [];
					if (recipe.estimated_cost) {
						recipeDetails.push(`Cost: ${recipe.estimated_cost}`);
					}
					if (recipe.experiments_per_hour) {
						recipeDetails.push(`~${recipe.experiments_per_hour} exp/hr`);
					}
					if (recipeDetails.length > 0) {
						lines.push(recipeDetails.join(" | "));
					}
					lines.push("");

					if (!has_scalar_metric && has_scalar_metric !== undefined) {
						lines.push(
							"> Note: Without a scalar metric, consider using `llm-as-judge` or `rubric-scorer` as your evaluator.",
							"",
						);
					}

					lines.push("---", "");
				}

				lines.push(
					"Use `get_technique` to dive deeper into any recommended technique. Use `scaffold_experiment` (Phase 1) to generate starter files.",
				);

				const text = lines.join("\n");

				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Suggestion error: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
