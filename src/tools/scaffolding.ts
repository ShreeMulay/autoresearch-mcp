import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { createExperiment } from "../db/experiments.js";
import { getCatalogItem } from "../db/techniques.js";
import {
	BudgetSchema,
	type CatalogItem,
	ConstraintsSchema,
	type ExperimentSpec,
	RecipeId,
	RiskPolicySchema,
} from "../types.js";
import { inferArtifactType } from "./artifacts.js";

const ALLOWED_TEMPLATE_NAMES = new Set([
	"program.md",
	"eval.sh",
	"results.tsv",
]);

const activeScaffolds = new Set<string>();
const LOCK_REMOVE_ATTEMPTS = 3;
const TRANSACTION_REMOVE_ATTEMPTS = 2;
const MetricDirectionSchema = z
	.enum(["minimize", "maximize"])
	.default("maximize");

export type ScaffoldFaultPoint =
	| "lock-mkdir"
	| "lock-remove"
	| "stage-mkdir"
	| "backup-mkdir"
	| "stage-write"
	| "stage-chmod"
	| "scaffold-mkdir"
	| "backup-rename"
	| "install-rename"
	| "db-register"
	| "rollback-remove-installed"
	| "rollback-restore-backup"
	| "rollback-remove-directory"
	| "cleanup-transaction";

type ScaffoldFaultInjector = (
	point: ScaffoldFaultPoint,
	path: string,
) => void | Promise<void>;

let scaffoldFaultInjector: ScaffoldFaultInjector | undefined;

/** Test seam for deterministic filesystem-boundary failures. */
export function setScaffoldFaultInjectorForTests(
	injector?: ScaffoldFaultInjector,
): void {
	scaffoldFaultInjector = injector;
}

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
			metric_direction: MetricDirectionSchema.describe(
				"Whether lower or higher scores are better",
			),
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
			budget: BudgetSchema.optional().describe("Optional experiment budget"),
			risk_policy: RiskPolicySchema.optional().describe(
				"Optional execution risk policy",
			),
			constraints: ConstraintsSchema.optional().describe(
				"Optional metric floor and ceiling constraints",
			),
		},
		async ({
			recipe_id,
			project_path,
			metric_name,
			metric_direction,
			target_file,
			custom_instructions,
			overwrite,
			budget,
			risk_policy,
			constraints,
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

				const resolvedProjectPath = await canonicalProjectRoot(project_path);
				const projectIdentity = identityOf(await stat(resolvedProjectPath));
				if (activeScaffolds.has(resolvedProjectPath)) {
					throw new Error(
						joinText(
							"A scaffold operation is already in progress for project: ",
							resolvedProjectPath,
						),
					);
				}
				activeScaffolds.add(resolvedProjectPath);
				const projectLockPath = join(
					resolvedProjectPath,
					".autoresearch-scaffold.lock",
				);
				let projectLockAcquired = false;
				let projectLockIdentity: PathIdentity | null = null;

				try {
					try {
						await guardedMutation(
							"lock-mkdir",
							projectLockPath,
							[[resolvedProjectPath, projectIdentity]],
							async () => mkdir(projectLockPath),
						);
						projectLockAcquired = true;
						projectLockIdentity = identityOf(await stat(projectLockPath));
					} catch (error) {
						if (isAlreadyExistsError(error)) {
							throw new Error(
								joinText(
									"A scaffold operation is already in progress for project: ",
									resolvedProjectPath,
								),
							);
						}
						throw error;
					}

					const targetArtifact = await resolveTargetArtifact(
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
					const destinationPaths: [string, string, string] = [
						programPath,
						evalPath,
						resultsPath,
					];

					await ensureSafeScaffoldDirectory(autoresearchDir);
					await ensureScaffoldFilesWritable(destinationPaths, overwrite);

					const evaluatorCommand = "./autoresearch/eval.sh";
					const spec = buildScaffoldExperimentSpec({
						targetArtifact,
						metricName: metric_name,
						metricDirection: metric_direction,
						recipeId: recipe.id,
						evaluatorCommand,
						budget,
						riskPolicy: risk_policy,
						constraints,
					});
					const programContent = await buildScaffoldProgramContent({
						recipe,
						metricName: metric_name,
						targetFile: target_file,
						targetArtifact,
						customInstructions: custom_instructions,
						spec,
					});
					const evalContent = await buildScaffoldEvalContent(recipe.id, {
						metricName: metric_name,
					});
					const resultsContent = buildResultsTemplate();

					const experimentId = crypto.randomUUID();
					const { cleanupRecoveryPath } = await installScaffoldTransaction({
						autoresearchDir,
						contents: [programContent, evalContent, resultsContent],
						destinationPaths,
						experimentId,
						overwrite,
						projectIdentity,
						projectPath: resolvedProjectPath,
						spec,
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
					if (cleanupRecoveryPath) {
						lines.push(
							"",
							"Warning: transaction cleanup failed after commit; the scaffold and experiment row are committed. Do not retry this scaffold operation.",
							joinText("Recovery Path: ", inlineCode(cleanupRecoveryPath)),
						);
					}

					return {
						content: [{ type: "text" as const, text: lines.join("\n") }],
					};
				} finally {
					try {
						if (projectLockAcquired && projectLockIdentity) {
							await releaseProjectLock({
								lockIdentity: projectLockIdentity,
								lockPath: projectLockPath,
								projectIdentity,
								projectPath: resolvedProjectPath,
							});
						}
					} finally {
						activeScaffolds.delete(resolvedProjectPath);
					}
				}
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

				const content = await readTemplateFileOrNull(templatePath);

				if (content !== null) {
					return {
						content: [{ type: "text" as const, text: content }],
					};
				}

				const generated = buildDefaultTemplate(recipe, template_name);

				return {
					content: [{ type: "text" as const, text: generated }],
				};
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
	spec: ExperimentSpec;
}): Promise<string> {
	const templatePath = resolveTemplatePath(args.recipe.id, "program.md");

	const curated = await readTemplateFileOrNull(templatePath);

	if (curated !== null) {
		return normalizeGeneratedProgram(curated, {
			customInstructions: args.customInstructions,
			metricName: args.metricName,
			spec: args.spec,
			targetArtifact: args.targetFile ?? args.targetArtifact,
		});
	}

	return normalizeGeneratedProgram(
		buildProgramTemplate({
			recipe: args.recipe,
			metricName: args.metricName,
			targetFile: args.targetFile,
		}),
		{
			customInstructions: args.customInstructions,
			metricName: args.metricName,
			spec: args.spec,
			targetArtifact: args.targetFile ?? args.targetArtifact,
		},
	);
}

async function buildScaffoldEvalContent(
	recipeId: string,
	args: { metricName: string },
): Promise<string> {
	const templatePath = resolveTemplatePath(recipeId, "eval.sh");

	const curated = await readTemplateFileOrNull(templatePath);

	if (curated !== null) {
		return curated;
	}

	return buildFailClosedEvalTemplate(args);
}

export async function readTemplateFileOrNull(
	templatePath: string,
): Promise<string | null> {
	try {
		return await readFile(templatePath, "utf8");
	} catch (error) {
		if (isNotFoundError(error)) {
			return null;
		}

		throw error;
	}
}

function normalizeGeneratedProgram(
	content: string,
	args: {
		customInstructions?: string;
		metricName: string;
		spec: ExperimentSpec;
		targetArtifact: string;
	},
): string {
	const withoutGeneratedSections = removeGeneratedSection(
		removeGeneratedSection(content, "Run Controls"),
		"Experiment Metadata",
	);
	const budget = args.spec.budget;
	const risk = args.spec.risk_policy;
	const constraints = args.spec.constraints;

	return joinText(
		[
			withoutGeneratedSections.trimEnd(),
			"",
			"## Experiment Metadata",
			joinText("- Metric Name: ", sanitizeInline(args.metricName)),
			joinText("- Target Artifact: ", sanitizeInline(args.targetArtifact)),
			"",
			"## Run Controls",
			joinText(
				"- Custom Instructions: ",
				args.customInstructions
					? sanitizeInline(args.customInstructions)
					: "none",
			),
			"- Budget:",
			joinText(
				"  - max_iterations: ",
				formatControlValue(budget.max_iterations),
			),
			joinText(
				"  - max_time_seconds: ",
				formatControlValue(budget.max_time_seconds),
			),
			joinText("  - max_tokens: ", formatControlValue(budget.max_tokens)),
			joinText("  - max_dollars: ", formatControlValue(budget.max_dollars)),
			"- Risk Policy:",
			joinText("  - sandbox_only: ", String(risk.sandbox_only)),
			joinText("  - requires_approval: ", String(risk.requires_approval)),
			joinText("  - network_denied: ", String(risk.network_denied)),
			joinText("  - secrets_denied: ", String(risk.secrets_denied)),
			"- Constraints:",
			joinText(
				"  - metric_floors: ",
				formatConstraintMap(constraints.metric_floors),
			),
			joinText(
				"  - metric_ceilings: ",
				formatConstraintMap(constraints.metric_ceilings),
			),
			joinText(
				"- Stopping Conditions: ",
				args.spec.stopping_conditions.join(", "),
			),
			joinText("- Metric Direction: ", args.spec.metric_direction),
			joinText(
				"- Evaluator Command: ",
				sanitizeInline(args.spec.evaluator_command),
			),
		].join("\n"),
		"\n",
	);
}

function removeGeneratedSection(content: string, heading: string): string {
	const lines = content.split(/\r?\n/);
	const sectionHeading = joinText("## ", heading);
	const retained: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (line.trim() === sectionHeading) {
			skipping = true;
			continue;
		}
		if (skipping && /^##\s+/.test(line)) skipping = false;
		if (!skipping) retained.push(line);
	}
	return retained.join("\n");
}

function formatControlValue(value: number | undefined): string {
	return value === undefined ? "not set" : String(value);
}

function formatConstraintMap(values: Record<string, number>): string {
	const ordered = Object.fromEntries(
		Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
	);
	return JSON.stringify(ordered);
}

function buildProgramTemplate(args: {
	recipe: CatalogItem;
	metricName: string;
	targetFile?: string;
}): string {
	const metricName = sanitizeInline(args.metricName);
	const targetFile = args.targetFile
		? sanitizeInline(args.targetFile)
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
		return buildFailClosedEvalTemplate({ metricName: "PRIMARY_METRIC" });
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
	metricDirection?: ExperimentSpec["metric_direction"];
	recipeId: string;
	evaluatorCommand: string;
	budget?: ExperimentSpec["budget"];
	riskPolicy?: ExperimentSpec["risk_policy"];
	constraints?: ExperimentSpec["constraints"];
}): ExperimentSpec {
	return {
		target_artifact: args.targetArtifact,
		artifact_type: inferArtifactType(args.targetArtifact),
		recipe_id: RecipeId.parse(args.recipeId),
		mutation_strategy: "LLM edit",
		evaluator_command: args.evaluatorCommand,
		metric_name: args.metricName,
		metric_direction: MetricDirectionSchema.parse(args.metricDirection),
		acceptance_rule: "strict-improvement",
		budget: BudgetSchema.parse(args.budget ?? {}),
		environment: {},
		stopping_conditions: ["budget-exhaustion"],
		risk_policy: RiskPolicySchema.parse(args.riskPolicy ?? {}),
		constraints: ConstraintsSchema.parse(args.constraints ?? {}),
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

async function canonicalProjectRoot(projectPath: string): Promise<string> {
	const canonical = await realpath(resolve(projectPath));
	const projectStat = await stat(canonical);
	if (!projectStat.isDirectory()) {
		throw new Error(joinText("Project path is not a directory: ", canonical));
	}
	return canonical;
}

interface PathIdentity {
	dev: number | bigint;
	ino: number | bigint;
}

function identityOf(value: Awaited<ReturnType<typeof stat>>): PathIdentity {
	return { dev: value.dev, ino: value.ino };
}

async function assertIdentity(
	path: string,
	expected: PathIdentity,
): Promise<void> {
	const actual = await lstat(path);
	if (
		actual.isSymbolicLink() ||
		actual.dev !== expected.dev ||
		actual.ino !== expected.ino
	) {
		throw new Error(
			`Scaffold path identity changed or became a symlink: ${path}`,
		);
	}
}

async function guardedMutation(
	point: ScaffoldFaultPoint,
	path: string,
	identities: Array<readonly [string, PathIdentity]>,
	mutation: () => Promise<void>,
): Promise<void> {
	for (const [identityPath, identity] of identities) {
		await assertIdentity(identityPath, identity);
	}
	await scaffoldFaultInjector?.(point, path);
	for (const [identityPath, identity] of identities) {
		await assertIdentity(identityPath, identity);
	}
	await mutation();
}

async function releaseProjectLock(args: {
	lockIdentity: PathIdentity;
	lockPath: string;
	projectIdentity: PathIdentity;
	projectPath: string;
}): Promise<void> {
	for (let attempt = 0; attempt < LOCK_REMOVE_ATTEMPTS; attempt++) {
		try {
			await guardedMutation(
				"lock-remove",
				args.lockPath,
				[
					[args.projectPath, args.projectIdentity],
					[args.lockPath, args.lockIdentity],
				],
				async () => rmdir(args.lockPath),
			);
			return;
		} catch {
			// Retry a bounded number of times before preserving the lock as recovery data.
		}
	}

	const recoveryPath = join(
		args.projectPath,
		`.autoresearch-scaffold-lock-recovery-${crypto.randomUUID()}`,
	);
	try {
		await assertIdentity(args.projectPath, args.projectIdentity);
		await assertIdentity(args.lockPath, args.lockIdentity);
		await rename(args.lockPath, recoveryPath);
	} catch {
		// Lock cleanup is post-commit. A final identity-checked removal avoids turning a
		// committed scaffold into an error or leaving a stale lock that blocks recovery.
		try {
			await assertIdentity(args.projectPath, args.projectIdentity);
			await assertIdentity(args.lockPath, args.lockIdentity);
			await rm(args.lockPath, { force: true, recursive: true });
		} catch {
			// There is no safe post-commit rollback. In-process exclusion remains active
			// until the caller's finally block completes.
		}
	}
}

async function cleanupTransaction(
	transactionDir: string,
	identities: Array<readonly [string, PathIdentity]>,
): Promise<string | null> {
	for (let attempt = 0; attempt < TRANSACTION_REMOVE_ATTEMPTS; attempt++) {
		try {
			await guardedMutation(
				"cleanup-transaction",
				transactionDir,
				identities,
				async () => rm(transactionDir, { force: true, recursive: true }),
			);
			return null;
		} catch {
			// Retry before quarantining committed transaction artifacts as recovery data.
		}
	}

	const projectPath = identities[0]?.[0];
	if (!projectPath) return transactionDir;
	const recoveryPath = join(
		projectPath,
		`.autoresearch-scaffold-transaction-recovery-${crypto.randomUUID()}`,
	);
	try {
		for (const [identityPath, identity] of identities) {
			await assertIdentity(identityPath, identity);
		}
		await rename(transactionDir, recoveryPath);
		return recoveryPath;
	} catch {
		// The original unique transaction path remains the safest available evidence.
		return transactionDir;
	}
}

async function installScaffoldTransaction(args: {
	autoresearchDir: string;
	contents: [string, string, string];
	destinationPaths: [string, string, string];
	experimentId: string;
	overwrite: boolean;
	projectIdentity: PathIdentity;
	projectPath: string;
	spec: ExperimentSpec;
}): Promise<{ cleanupRecoveryPath: string | null }> {
	const projectIdentity = args.projectIdentity;
	let transactionDir = "";
	await guardedMutation(
		"stage-mkdir",
		args.projectPath,
		[[args.projectPath, projectIdentity]],
		async () => {
			transactionDir = await mkdtemp(
				join(args.projectPath, ".autoresearch-scaffold-"),
			);
		},
	);
	const transactionIdentity = identityOf(await stat(transactionDir));
	const stageDir = join(transactionDir, "stage");
	const backupDir = join(transactionDir, "backup");
	const stagedPaths = args.destinationPaths.map((path) =>
		join(stageDir, path.split(sep).at(-1) ?? ""),
	) as [string, string, string];
	const backups = new Map<string, string>();
	const installed = new Set<string>();
	let createdAutoresearchDir = false;
	let scaffoldIdentity: PathIdentity | null = null;
	let stageIdentity: PathIdentity;
	let backupIdentity: PathIdentity = transactionIdentity;

	try {
		await guardedMutation(
			"stage-mkdir",
			stageDir,
			[
				[args.projectPath, projectIdentity],
				[transactionDir, transactionIdentity],
			],
			async () => mkdir(stageDir),
		);
		stageIdentity = identityOf(await stat(stageDir));
		await guardedMutation(
			"backup-mkdir",
			backupDir,
			[
				[args.projectPath, projectIdentity],
				[transactionDir, transactionIdentity],
			],
			async () => mkdir(backupDir),
		);
		backupIdentity = identityOf(await stat(backupDir));
		for (let index = 0; index < stagedPaths.length; index++) {
			const stagedPath = stagedPaths[index];
			const content = args.contents[index];
			if (!stagedPath || content === undefined || content.length === 0) {
				throw new Error("Invalid empty scaffold staging entry");
			}
			await guardedMutation(
				"stage-write",
				stagedPath,
				[
					[args.projectPath, projectIdentity],
					[transactionDir, transactionIdentity],
					[stageDir, stageIdentity],
				],
				async () =>
					writeFile(stagedPath, content, { encoding: "utf8", mode: 0o644 }),
			);
		}
		await guardedMutation(
			"stage-chmod",
			stagedPaths[1],
			[
				[args.projectPath, projectIdentity],
				[transactionDir, transactionIdentity],
				[stageDir, stageIdentity],
			],
			async () => makeEvalExecutable(stagedPaths[1]),
		);

		await ensureSafeScaffoldDirectory(args.autoresearchDir);
		await ensureScaffoldFilesWritable(args.destinationPaths, args.overwrite);
		const existingDirectory = await lstatOrNull(args.autoresearchDir);
		if (existingDirectory === null) {
			await guardedMutation(
				"scaffold-mkdir",
				args.autoresearchDir,
				[[args.projectPath, projectIdentity]],
				async () => mkdir(args.autoresearchDir),
			);
			createdAutoresearchDir = true;
			scaffoldIdentity = identityOf(await stat(args.autoresearchDir));
		} else {
			scaffoldIdentity = identityOf(existingDirectory);
		}

		const [transactionStat, destinationStat] = await Promise.all([
			stat(transactionDir),
			stat(args.autoresearchDir),
		]);
		if (transactionStat.dev !== destinationStat.dev) {
			throw new Error(
				"Scaffold staging and destination must be on the same filesystem",
			);
		}

		for (const destinationPath of args.destinationPaths) {
			const destinationStat = await lstatOrNull(destinationPath);
			if (destinationStat === null) continue;
			if (!args.overwrite || !destinationStat.isFile()) {
				throw new Error(
					joinText("Unsafe scaffold overwrite destination: ", destinationPath),
				);
			}
			const backupPath = join(
				backupDir,
				destinationPath.split(sep).at(-1) ?? "backup",
			);
			await guardedMutation(
				"backup-rename",
				destinationPath,
				[
					[args.projectPath, projectIdentity],
					[args.autoresearchDir, scaffoldIdentity],
					[transactionDir, transactionIdentity],
					[backupDir, backupIdentity],
				],
				async () => rename(destinationPath, backupPath),
			);
			backups.set(destinationPath, backupPath);
		}

		for (let index = 0; index < stagedPaths.length; index++) {
			const stagedPath = stagedPaths[index];
			const destinationPath = args.destinationPaths[index];
			if (!stagedPath || !destinationPath) {
				throw new Error("Invalid scaffold installation entry");
			}
			if ((await lstatOrNull(destinationPath)) !== null) {
				throw new Error(
					joinText(
						"Scaffold destination changed during install: ",
						destinationPath,
					),
				);
			}
			await guardedMutation(
				"install-rename",
				destinationPath,
				[
					[args.projectPath, projectIdentity],
					[args.autoresearchDir, scaffoldIdentity],
					[transactionDir, transactionIdentity],
					[stageDir, stageIdentity],
				],
				async () => rename(stagedPath, destinationPath),
			);
			installed.add(destinationPath);
		}

		await scaffoldFaultInjector?.("db-register", args.projectPath);
		await assertIdentity(args.projectPath, projectIdentity);
		await assertIdentity(args.autoresearchDir, scaffoldIdentity);
		createExperiment({
			id: args.experimentId,
			spec: args.spec,
			project_path: args.projectPath,
			project_name: getProjectName(args.projectPath),
			status: "scaffolded",
		});
	} catch (error) {
		const rollbackErrors: string[] = [];
		for (const destinationPath of [...installed].reverse()) {
			try {
				await guardedMutation(
					"rollback-remove-installed",
					destinationPath,
					[
						[args.projectPath, projectIdentity],
						[args.autoresearchDir, scaffoldIdentity as PathIdentity],
						[transactionDir, transactionIdentity],
						[backupDir, backupIdentity],
					],
					async () => rm(destinationPath, { force: true }),
				);
			} catch (rollbackError) {
				rollbackErrors.push(String(rollbackError));
			}
		}
		for (const [destinationPath, backupPath] of [...backups].reverse()) {
			try {
				await guardedMutation(
					"rollback-restore-backup",
					backupPath,
					[
						[args.projectPath, projectIdentity],
						[args.autoresearchDir, scaffoldIdentity as PathIdentity],
						[transactionDir, transactionIdentity],
						[backupDir, backupIdentity],
					],
					async () => rename(backupPath, destinationPath),
				);
			} catch (rollbackError) {
				rollbackErrors.push(String(rollbackError));
			}
		}
		if (createdAutoresearchDir) {
			try {
				await guardedMutation(
					"rollback-remove-directory",
					args.autoresearchDir,
					[
						[args.projectPath, projectIdentity],
						[args.autoresearchDir, scaffoldIdentity as PathIdentity],
					],
					async () => rmdir(args.autoresearchDir),
				);
			} catch (rollbackError) {
				rollbackErrors.push(String(rollbackError));
			}
		}
		if (rollbackErrors.length > 0) {
			throw new Error(
				joinText(
					error instanceof Error ? error.message : String(error),
					"; rollback failed: ",
					rollbackErrors.join("; "),
					"; recovery backups preserved at: ",
					backupDir,
				),
			);
		}
		await cleanupTransaction(transactionDir, [
			[args.projectPath, projectIdentity],
			[transactionDir, transactionIdentity],
		]);
		throw error;
	}

	const cleanupRecoveryPath = await cleanupTransaction(transactionDir, [
		[args.projectPath, projectIdentity],
		[transactionDir, transactionIdentity],
	]);
	return { cleanupRecoveryPath };
}

async function lstatOrNull(
	path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
	try {
		return await lstat(path);
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
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
			if (!stat.isFile()) {
				throw new Error(
					joinText("Scaffold destination is not a regular file: ", path),
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
					error.message.includes("through symlink") ||
					error.message.includes("not a regular file"))
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

function isAlreadyExistsError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { code?: unknown }).code === "EEXIST"
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

async function resolveTargetArtifact(
	projectPath: string,
	targetFile?: string,
): Promise<string | null> {
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

	let candidate = resolvedTarget;
	while (candidate !== resolvedProject) {
		try {
			const canonicalCandidate = await realpath(candidate);
			if (
				canonicalCandidate !== resolvedProject &&
				!canonicalCandidate.startsWith(joinText(resolvedProject, sep))
			) {
				return null;
			}
			break;
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
			candidate = resolve(candidate, "..");
		}
	}

	return resolvedTarget;
}

function getProjectName(projectPath: string): string {
	const segments = projectPath.split("/").filter(Boolean);
	return segments.at(-1) ?? projectPath;
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
