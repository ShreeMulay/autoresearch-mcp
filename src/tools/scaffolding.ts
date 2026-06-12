import {
	access,
	chmod,
	lstat,
	mkdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { createExperiment } from "../db/experiments.js";
import { getCatalogItem } from "../db/techniques.js";
import { type CatalogItem, type ExperimentSpec, RecipeId } from "../types.js";

const ALLOWED_TEMPLATE_NAMES = new Set([
	"program.md",
	"eval.sh",
	"results.tsv",
]);

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
			overwrite: z
				.boolean()
				.default(false)
				.describe("Overwrite existing autoresearch scaffold files"),
		},
		async ({
			recipe_id,
			project_path,
			metric_name,
			target_file,
			custom_instructions,
			overwrite,
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

				const targetArtifact = resolveTargetArtifact(
					resolvedProjectPath,
					target_file,
				);

				if (!targetArtifact) {
					return {
						content: [
							{
								type: "text" as const,
								text: "target_file must resolve inside project_path",
							},
						],
						isError: true,
					};
				}

				const autoresearchDir = join(resolvedProjectPath, "autoresearch");
				const programPath = join(autoresearchDir, "program.md");
				const evalPath = join(autoresearchDir, "eval.sh");
				const resultsPath = join(autoresearchDir, "results.tsv");

				await ensureSafeScaffoldDirectory(autoresearchDir);
				await mkdir(autoresearchDir, { recursive: true });
				await ensureScaffoldFilesWritable(
					[programPath, evalPath, resultsPath],
					overwrite,
				);

				const evaluatorCommand = "./autoresearch/eval.sh";
				const programContent = await buildScaffoldProgramContent({
					recipe,
					metricName: metric_name,
					targetFile: target_file,
					targetArtifact,
					customInstructions: custom_instructions,
					evaluatorCommand,
				});
				const evalContent = await buildScaffoldEvalContent(recipe.id, {
					metricName: metric_name,
				});
				const resultsContent = buildResultsTemplate();

				await writeFile(programPath, programContent, "utf8");
				await writeFile(evalPath, evalContent, "utf8");
				await writeFile(resultsPath, resultsContent, "utf8");
				await makeEvalExecutable(evalPath);

				const experimentId = crypto.randomUUID();
				const spec = buildScaffoldExperimentSpec({
					targetArtifact,
					metricName: metric_name,
					recipeId: recipe.id,
					evaluatorCommand,
				});

				createExperiment({
					id: experimentId,
					spec,
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

				const templatePath = resolveTemplatePath(recipe_id, template_name);

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

async function buildScaffoldProgramContent(args: {
	recipe: CatalogItem;
	metricName: string;
	targetFile?: string;
	targetArtifact: string;
	customInstructions?: string;
	evaluatorCommand: string;
}): Promise<string> {
	const templatePath = resolveTemplatePath(args.recipe.id, "program.md");

	try {
		await access(templatePath);
		const curated = await readFile(templatePath, "utf8");
		return appendExperimentMetadata(curated, {
			metricName: args.metricName,
			targetArtifact: args.targetFile ?? args.targetArtifact,
			evaluatorCommand: args.evaluatorCommand,
		});
	} catch {
		return buildProgramTemplate({
			recipe: args.recipe,
			metricName: args.metricName,
			targetFile: args.targetFile,
			customInstructions: args.customInstructions,
		});
	}
}

async function buildScaffoldEvalContent(
	recipeId: string,
	args: { metricName: string },
): Promise<string> {
	const templatePath = resolveTemplatePath(recipeId, "eval.sh");

	try {
		await access(templatePath);
		return await readFile(templatePath, "utf8");
	} catch {
		return buildFailClosedEvalTemplate(args);
	}
}

function appendExperimentMetadata(
	content: string,
	args: {
		metricName: string;
		targetArtifact: string;
		evaluatorCommand: string;
	},
): string {
	return joinText(
		[
			content.trimEnd(),
			"",
			"## Experiment Metadata",
			joinText("- Metric Name: ", sanitizeInline(args.metricName)),
			joinText("- Target Artifact: ", sanitizeInline(args.targetArtifact)),
			"- Metric Direction: maximize",
			joinText("- Evaluator Command: ", sanitizeInline(args.evaluatorCommand)),
		].join("\n"),
		"\n",
	);
}

function buildProgramTemplate(args: {
	recipe: CatalogItem;
	metricName: string;
	targetFile?: string;
	customInstructions?: string;
}): string {
	const metricName = sanitizeInline(args.metricName);
	const targetFile = args.targetFile
		? sanitizeInline(args.targetFile)
		: undefined;
	const customInstructions = args.customInstructions
		? sanitizeInline(args.customInstructions)
		: undefined;
	const strategyHints = getStrategyHints(args.recipe);
	const modifyTargets = targetFile
		? [
				joinText("- Focus edits on ", inlineCode(targetFile)),
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
			metricName,
			".",
		),
		"Use the evaluation harness to produce a single numeric score after each candidate change.",
		"",
		"## Target File Specification",
		targetFile
			? joinText("Target file: ", inlineCode(targetFile))
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

	if (customInstructions) {
		lines.push("", "## Custom Instructions", customInstructions);
	}

	lines.push(
		"",
		"## NEVER STOP",
		"Continue iterating until the metric improves or the explicit experiment budget is exhausted.",
		"Always record the result, preserve the best-known state, and keep the loop moving forward.",
	);

	return joinText(lines.join("\n"), "\n");
}

function buildFailClosedEvalTemplate(args: { metricName: string }): string {
	return joinText(
		[
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			"",
			"# Replace this stub with the real evaluator for the metric below.",
			joinText("# Metric: ", sanitizeInline(args.metricName)),
			"# Contract: print exactly one numeric score to stdout.",
			"",
			"printf '%s\\n' 'autoresearch: placeholder evaluator - replace this with a real evaluator that prints a single numeric score' >&2",
			"exit 1",
		].join("\n"),
		"\n",
	);
}

function buildDefaultEvalTemplate(args: { metricName: string }): string {
	return joinText(
		[
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			"",
			"# Replace this stub with the real evaluator for the metric below.",
			joinText("# Metric: ", sanitizeInline(args.metricName)),
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
		return buildDefaultEvalTemplate({ metricName: "PRIMARY_METRIC" });
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
		recipe_id: RecipeId.parse(args.recipeId),
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

export function assertAllowedTemplateName(templateName: string): void {
	if (!ALLOWED_TEMPLATE_NAMES.has(templateName)) {
		throw new Error(
			joinText(
				"Unsupported template: ",
				templateName,
				". Valid templates: ",
				Array.from(ALLOWED_TEMPLATE_NAMES).join(", "),
			),
		);
	}
}

export function resolveTemplatePath(
	recipeId: string,
	templateName: string,
): string {
	assertAllowedTemplateName(templateName);

	const templateRoot = resolve(
		import.meta.dir,
		"../../catalog/templates",
		recipeId,
	);
	const templatePath = resolve(templateRoot, templateName);

	if (templatePath !== join(templateRoot, templateName)) {
		throw new Error("Template path escapes recipe template directory");
	}

	if (!templatePath.startsWith(`${templateRoot}${sep}`)) {
		throw new Error("Template path escapes recipe template directory");
	}

	return templatePath;
}

export async function ensureScaffoldFilesWritable(
	paths: string[],
	overwrite: boolean,
): Promise<void> {
	for (const path of paths) {
		try {
			const stat = await lstat(path);
			if (stat.isSymbolicLink()) {
				throw new Error(
					joinText("Refusing to write scaffold file through symlink: ", path),
				);
			}

			if (overwrite) {
				continue;
			}

			throw new Error(
				joinText(
					"Scaffold file already exists: ",
					path,
					". Re-run with overwrite=true to replace it.",
				),
			);
		} catch (error) {
			if (isNotFoundError(error)) {
				continue;
			}

			if (
				error instanceof Error &&
				(error.message.includes("already exists") ||
					error.message.includes("through symlink"))
			) {
				throw error;
			}

			throw error;
		}
	}
}

export async function ensureSafeScaffoldDirectory(path: string): Promise<void> {
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			throw new Error(
				joinText("Refusing to scaffold through symlinked directory: ", path),
			);
		}

		if (!stat.isDirectory()) {
			throw new Error(joinText("Scaffold path is not a directory: ", path));
		}
	} catch (error) {
		if (isNotFoundError(error)) {
			return;
		}

		throw error;
	}
}

export async function makeEvalExecutable(evalPath: string): Promise<void> {
	await chmod(evalPath, 0o755);
}

function isNotFoundError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
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
): string | null {
	const resolvedProject = resolve(projectPath);

	if (!targetFile) {
		return resolvedProject;
	}

	const resolvedTarget = resolve(resolvedProject, targetFile);

	if (
		resolvedTarget !== resolvedProject &&
		!resolvedTarget.startsWith(joinText(resolvedProject, sep))
	) {
		return null;
	}

	return resolvedTarget;
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

function sanitizeInline(value: string): string {
	const withoutLineBreaks = value.replace(/[\r\n\u2028\u2029]+/g, " ");

	return Array.from(withoutLineBreaks)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.trim();
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
