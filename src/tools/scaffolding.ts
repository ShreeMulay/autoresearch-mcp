import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { createExperiment } from "../db/experiments.js";
import { getCatalogItem } from "../db/techniques.js";
import type { CatalogItem, ExperimentSpec } from "../types.js";

export function registerScaffoldingTools(mcp: McpServer): void {
	mcp.tool(
		"scaffold_experiment",
		"Create autoresearch scaffolding files for a recipe and register the experiment.",
		{
			recipe_id: z.string().describe("Recipe ID to scaffold"),
			project_path: z
				.string()
				.describe("Project directory where files should be created"),
			metric_name: z.string().describe("Primary metric for the experiment"),
			target_file: z
				.string()
				.optional()
				.describe("Optional target file or artifact path"),
			custom_instructions: z
				.string()
				.optional()
				.describe("Optional additional instructions for the program"),
		},
		async ({
			recipe_id,
			project_path,
			metric_name,
			target_file,
			custom_instructions,
		}) => {
			try {
				const recipe = getCatalogItem(recipe_id);

				if (!isRecipe(recipe)) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText("Recipe not found: ", inlineCode(recipe_id)),
							},
						],
						isError: true,
					};
				}

				const resolvedProjectPath = resolve(project_path);
				await access(resolvedProjectPath);

				const autoresearchDir = join(resolvedProjectPath, "autoresearch");
				const programPath = join(autoresearchDir, "program.md");
				const evalPath = join(autoresearchDir, "eval.sh");
				const resultsPath = join(autoresearchDir, "results.tsv");

				await mkdir(autoresearchDir, { recursive: true });

				const targetArtifact = resolveTargetArtifact(
					resolvedProjectPath,
					target_file,
				);
				const programContent = buildProgramTemplate({
					recipe,
					metricName: metric_name,
					targetFile: target_file,
					customInstructions: custom_instructions,
				});
				const evalContent = buildEvalTemplate({ metricName: metric_name });
				const resultsContent = buildResultsTemplate();

				await writeFile(programPath, programContent, "utf8");
				await writeFile(evalPath, evalContent, "utf8");
				await writeFile(resultsPath, resultsContent, "utf8");

				const experimentId = crypto.randomUUID();
				const spec = buildScaffoldExperimentSpec({
					targetArtifact,
					metricName: metric_name,
					recipeId: recipe.id,
					evaluatorCommand: "./autoresearch/eval.sh",
				});

				createExperiment({
					id: experimentId,
					spec: JSON.stringify(spec),
					project_path: resolvedProjectPath,
					project_name: getProjectName(resolvedProjectPath),
					status: "scaffolded",
				});

				const lines = [
					"# Experiment Scaffolded",
					"",
					joinText("Experiment ID: ", inlineCode(experimentId)),
					joinText("Recipe: ", inlineCode(recipe.id)),
					joinText("Project Path: ", inlineCode(resolvedProjectPath)),
					joinText("Metric: ", metric_name),
					"",
					"Created Files:",
					joinText("- ", programPath),
					joinText("- ", evalPath),
					joinText("- ", resultsPath),
				];

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			} catch (error) {
				return toolError(error, "Failed to scaffold experiment");
			}
		},
	);

	mcp.tool(
		"get_template",
		"Return a recipe template file or generate a default template when none exists.",
		{
			recipe_id: z.string().describe("Recipe ID"),
			template_name: z
				.string()
				.describe("Template filename, for example program.md or eval.sh"),
		},
		async ({ recipe_id, template_name }) => {
			try {
				const recipe = getCatalogItem(recipe_id);

				if (!isRecipe(recipe)) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText("Recipe not found: ", inlineCode(recipe_id)),
							},
						],
						isError: true,
					};
				}

				const templatePath = resolve(
					import.meta.dir,
					"../../catalog/templates",
					recipe_id,
					template_name,
				);

				try {
					await access(templatePath);
					const content = await readFile(templatePath, "utf8");

					return {
						content: [{ type: "text" as const, text: content }],
					};
				} catch {
					const generated = buildDefaultTemplate(recipe, template_name);

					return {
						content: [{ type: "text" as const, text: generated }],
					};
				}
			} catch (error) {
				return toolError(error, "Failed to get template");
			}
		},
	);
}

function isRecipe(recipe: CatalogItem | null): recipe is CatalogItem {
	return recipe !== null && recipe.layer === "recipe";
}

function buildProgramTemplate(args: {
	recipe: CatalogItem;
	metricName: string;
	targetFile?: string;
	customInstructions?: string;
}): string {
	const strategyHints = getStrategyHints(args.recipe);
	const modifyTargets = args.targetFile
		? [
				joinText("- Focus edits on ", inlineCode(args.targetFile)),
				"- Keep changes tightly coupled to the metric objective",
			]
		: [
				"- Focus edits on the files most likely to move the target metric",
				"- Keep the scope narrow and measurable for each iteration",
			];
	const protectedTargets = [
		"- Do not modify autoresearch/eval.sh except to wire in the real evaluator command",
		"- Do not rewrite autoresearch/results.tsv history entries",
		"- Do not touch unrelated files, secrets, or deployment configuration without explicit justification",
	];

	const lines = [
		"# Autoresearch Program",
		"",
		"## Objective and Metric",
		joinText(
			"Optimize the target artifact to improve the metric named ",
			args.metricName,
			".",
		),
		"Use the evaluation harness to produce a single numeric score after each candidate change.",
		"",
		"## Target File Specification",
		args.targetFile
			? joinText("Target file: ", inlineCode(args.targetFile))
			: "Target file: decide based on the recipe and the metric objective.",
		"",
		"## What to Modify",
		...modifyTargets,
		"",
		"## What Not to Modify",
		...protectedTargets,
		"",
		"## Strategy Hints",
		...strategyHints,
	];

	if (args.customInstructions) {
		lines.push("", "## Custom Instructions", args.customInstructions);
	}

	lines.push(
		"",
		"## NEVER STOP",
		"Continue iterating until the metric improves or the explicit experiment budget is exhausted.",
		"Always record the result, preserve the best-known state, and keep the loop moving forward.",
	);

	return joinText(lines.join("\n"), "\n");
}

function buildEvalTemplate(args: { metricName: string }): string {
	return joinText(
		[
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			"",
			"# Replace this stub with the real evaluator for the metric below.",
			joinText("# Metric: ", args.metricName),
			"# Contract: print exactly one numeric score to stdout.",
			"",
			"printf '%s\\n' '0'",
		].join("\n"),
		"\n",
	);
}

function buildResultsTemplate(): string {
	return joinText(
		[
			"iteration\tscore\timproved\tchange_description\tduration_seconds\tcost_tokens\tcost_dollars",
		].join("\n"),
		"\n",
	);
}

function buildDefaultTemplate(
	recipe: CatalogItem,
	templateName: string,
): string {
	if (templateName === "program.md") {
		return buildProgramTemplate({
			recipe,
			metricName: "PRIMARY_METRIC",
		});
	}

	if (templateName === "eval.sh") {
		return buildEvalTemplate({ metricName: "PRIMARY_METRIC" });
	}

	if (templateName === "results.tsv") {
		return buildResultsTemplate();
	}

	return joinText(
		[
			"# Template",
			"",
			joinText("Recipe: ", recipe.name),
			joinText("Template Name: ", templateName),
			"",
			"Use this file to support the recipe workflow and keep the evaluator contract intact.",
		].join("\n"),
		"\n",
	);
}

function buildScaffoldExperimentSpec(args: {
	targetArtifact: string;
	metricName: string;
	recipeId: string;
	evaluatorCommand: string;
}): ExperimentSpec {
	return {
		target_artifact: args.targetArtifact,
		artifact_type: inferArtifactType(args.targetArtifact),
		recipe_id: args.recipeId as ExperimentSpec["recipe_id"],
		mutation_strategy: "LLM edit",
		evaluator_command: args.evaluatorCommand,
		metric_name: args.metricName,
		metric_direction: "maximize",
		acceptance_rule: "strict-improvement",
		budget: {},
		environment: {},
		stopping_conditions: ["budget-exhaustion"],
		risk_policy: {
			sandbox_only: false,
			requires_approval: false,
			network_denied: true,
			secrets_denied: true,
		},
		constraints: {
			metric_floors: {},
			metric_ceilings: {},
		},
	};
}

function getStrategyHints(recipe: CatalogItem): string[] {
	const hints: string[] = [];
	const searchStrategy = recipe.composes?.search_strategy;
	const evaluator = recipe.composes?.evaluator;
	const executionPattern = recipe.composes?.execution_pattern;

	if (searchStrategy === "hill-climbing") {
		hints.push(
			"- Use small local edits and keep only candidates that improve the score.",
		);
	} else if (searchStrategy === "evolutionary") {
		hints.push(
			"- Maintain several candidates, recombine the strongest traits, and prune weak branches.",
		);
	} else if (searchStrategy === "bayesian-optimization") {
		hints.push(
			"- Prefer high-information experiments and update the search plan from observed scores.",
		);
	} else if (searchStrategy === "beam-search") {
		hints.push(
			"- Keep a small beam of top candidates and expand only the most promising branches.",
		);
	} else if (searchStrategy === "multi-armed-bandit") {
		hints.push(
			"- Balance exploration and exploitation across several promising change families.",
		);
	} else if (searchStrategy === "simulated-annealing") {
		hints.push(
			"- Allow occasional riskier moves early, then tighten acceptance as the run progresses.",
		);
	} else if (searchStrategy === "ablation-elimination") {
		hints.push(
			"- Remove or simplify components methodically to find what actually matters.",
		);
	} else if (searchStrategy === "self-refine") {
		hints.push(
			"- Alternate between proposing a candidate, critiquing it, and refining the best idea.",
		);
	} else {
		hints.push(
			"- Use the recipe description to choose a narrow, metric-driven search loop.",
		);
	}

	if (evaluator) {
		hints.push(
			joinText(
				"- Evaluator: keep the scoring harness aligned with ",
				evaluator,
				".",
			),
		);
	}

	if (executionPattern) {
		hints.push(
			joinText(
				"- Execution Pattern: structure the loop around ",
				executionPattern,
				".",
			),
		);
	}

	return hints;
}

function resolveTargetArtifact(
	projectPath: string,
	targetFile?: string,
): string {
	if (!targetFile) {
		return projectPath;
	}

	return resolve(projectPath, targetFile);
}

function getProjectName(projectPath: string): string {
	const segments = projectPath.split("/").filter(Boolean);
	return segments.at(-1) ?? projectPath;
}

function inferArtifactType(
	targetArtifact: string,
): ExperimentSpec["artifact_type"] {
	const normalized = targetArtifact.toLowerCase();

	if (normalized.includes("prompt")) {
		return "prompt";
	}

	if (
		normalized.endsWith(".ts") ||
		normalized.endsWith(".tsx") ||
		normalized.endsWith(".js") ||
		normalized.endsWith(".jsx") ||
		normalized.endsWith(".py") ||
		normalized.endsWith(".rs") ||
		normalized.endsWith(".go")
	) {
		return "code";
	}

	if (
		normalized.endsWith(".json") ||
		normalized.endsWith(".yaml") ||
		normalized.endsWith(".yml") ||
		normalized.endsWith(".toml")
	) {
		return "config";
	}

	if (
		normalized.endsWith(".md") ||
		normalized.endsWith(".txt") ||
		normalized.endsWith(".html")
	) {
		return "content";
	}

	return "other";
}

function inlineCode(value: string): string {
	return joinText("`", value, "`");
}

function toolError(
	error: unknown,
	prefix: string,
): {
	content: [{ type: "text"; text: string }];
	isError: true;
} {
	const message = error instanceof Error ? error.message : String(error);

	return {
		content: [{ type: "text" as const, text: joinText(prefix, ": ", message) }],
		isError: true,
	};
}

function joinText(...parts: string[]): string {
	return parts.join("");
}
