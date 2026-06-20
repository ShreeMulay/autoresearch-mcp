import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import {
	createExperiment,
	getExperiment,
	getExperimentResults,
	listExperiments,
	logExperimentResult,
	updateExperiment,
} from "../db/experiments.js";
import {
	BudgetSchema,
	ConstraintsSchema,
	type Experiment,
	type ExperimentResult,
	type ExperimentSpec,
	RecipeId,
	RiskPolicySchema,
} from "../types.js";
import { inferArtifactType } from "./artifacts.js";

const RESULT_DISPLAY_CAP = 200;

export function registerExperimentTools(mcp: McpServer): void {
	mcp.tool(
		"register_experiment",
		"Register a new experiment in the autoresearch tracker.",
		{
			project_path: z.string().describe("Absolute or relative project path"),
			project_name: z.string().optional().describe("Optional project name"),
			metric_name: z.string().describe("Primary metric name"),
			metric_direction: z
				.enum(["minimize", "maximize"])
				.default("maximize")
				.describe("Whether lower or higher scores are better"),
			target_artifact: z.string().describe("What the experiment is optimizing"),
			evaluator_command: z
				.string()
				.describe("Command that prints a single score to stdout"),
			mutation_strategy: z
				.string()
				.default("LLM edit")
				.describe("How mutations are proposed"),
			recipe_id: RecipeId.optional().describe("Optional recipe ID"),
			budget: BudgetSchema.optional().describe("Optional experiment budget"),
			risk_policy: RiskPolicySchema.optional().describe(
				"Optional execution risk policy",
			),
			constraints: ConstraintsSchema.optional().describe(
				"Optional metric floor and ceiling constraints",
			),
			notes: z.string().optional().describe("Optional experiment notes"),
		},
		async ({
			project_path,
			project_name,
			metric_name,
			metric_direction,
			target_artifact,
			evaluator_command,
			mutation_strategy,
			recipe_id,
			budget,
			risk_policy,
			constraints,
			notes,
		}) => {
			try {
				const experimentId = crypto.randomUUID();
				const spec = buildExperimentSpec({
					targetArtifact: target_artifact,
					metricName: metric_name,
					metricDirection: metric_direction,
					evaluatorCommand: evaluator_command,
					mutationStrategy: mutation_strategy,
					recipeId: recipe_id,
					budget,
					riskPolicy: risk_policy,
					constraints,
				});

				createExperiment({
					id: experimentId,
					spec,
					project_path,
					project_name,
					status: "scaffolded",
				});

				if (notes) {
					updateExperiment(experimentId, { notes });
				}

				const lines = [
					"# Experiment Registered",
					"",
					joinText("Experiment ID: ", inlineCode(experimentId)),
					joinText("Project Path: ", inlineCode(project_path)),
					joinText("Project Name: ", project_name ?? "-"),
					joinText("Metric: ", metric_name, " (", metric_direction, ")"),
					joinText("Target Artifact: ", inlineCode(target_artifact)),
					joinText("Evaluator Command: ", inlineCode(evaluator_command)),
					joinText("Mutation Strategy: ", mutation_strategy),
				];

				if (recipe_id) {
					lines.push(joinText("Recipe ID: ", inlineCode(recipe_id)));
				}

				if (notes) {
					lines.push(joinText("Notes: ", notes));
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			} catch (error) {
				return toolError(error, "Failed to register experiment");
			}
		},
	);

	mcp.tool(
		"update_experiment",
		"Update experiment status and notes.",
		{
			experiment_id: z.string().describe("Experiment ID"),
			status: z
				.enum(["scaffolded", "running", "paused", "completed", "failed"])
				.optional()
				.describe("Optional new experiment status"),
			notes: z.string().optional().describe("Optional replacement notes"),
		},
		async ({ experiment_id, status, notes }) => {
			try {
				const existing = getExperiment(experiment_id);

				if (!existing) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText(
									"Experiment not found: ",
									inlineCode(experiment_id),
								),
							},
						],
						isError: true,
					};
				}

				const updates: {
					status?: string;
					started_at?: string;
					completed_at?: string;
					notes?: string;
				} = {};

				if (status !== undefined) {
					updates.status = status;

					if (status !== existing.status) {
						if (status === "running") {
							updates.started_at = new Date().toISOString();
						}

						if (status === "completed" || status === "failed") {
							updates.completed_at = new Date().toISOString();
						}
					}
				}

				if (notes !== undefined) {
					updates.notes = notes;
				}

				const updated = updateExperiment(experiment_id, updates);

				if (!updated) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText(
									"No experiment updated for ID ",
									inlineCode(experiment_id),
								),
							},
						],
						isError: true,
					};
				}

				const refreshed = getExperiment(experiment_id);

				if (!refreshed) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText(
									"Experiment updated, but refresh failed for ",
									inlineCode(experiment_id),
								),
							},
						],
					};
				}

				const lines = [
					"# Experiment Updated",
					"",
					joinText("Experiment ID: ", inlineCode(refreshed.id)),
					joinText("Status: ", refreshed.status),
					joinText("Started At: ", refreshed.started_at ?? "-"),
					joinText("Completed At: ", refreshed.completed_at ?? "-"),
					joinText("Notes: ", refreshed.notes ?? "-"),
				];

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			} catch (error) {
				return toolError(error, "Failed to update experiment");
			}
		},
	);

	mcp.tool(
		"log_result",
		"Log a single experiment iteration result and return updated totals.",
		{
			experiment_id: z.string().describe("Experiment ID"),
			iteration: z.number().int().nonnegative().describe("Iteration number"),
			score: z.number().describe("Observed score"),
			improved: z
				.boolean()
				.describe("Whether this iteration improved the champion"),
			change_description: z
				.string()
				.describe("Human-readable description of the attempted change"),
			duration_seconds: z
				.number()
				.nonnegative()
				.optional()
				.describe("Optional wall time"),
			cost_tokens: z
				.number()
				.nonnegative()
				.optional()
				.describe("Optional token cost"),
			cost_dollars: z
				.number()
				.nonnegative()
				.optional()
				.describe("Optional dollar cost"),
			is_baseline: z
				.boolean()
				.optional()
				.describe(
					"Mark this result as the baseline measurement taken before any changes",
				),
		},
		async ({
			experiment_id,
			iteration,
			score,
			improved,
			change_description,
			duration_seconds,
			cost_tokens,
			cost_dollars,
			is_baseline,
		}) => {
			try {
				logExperimentResult({
					experiment_id,
					iteration,
					score,
					improved,
					change_description,
					duration_seconds,
					cost_tokens,
					cost_dollars,
					is_baseline,
				});

				const experiment = getExperiment(experiment_id);

				if (!experiment) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText(
									"Result logged, but experiment refresh failed for ",
									inlineCode(experiment_id),
								),
							},
						],
					};
				}

				const lines = [
					"# Result Logged",
					"",
					joinText("Experiment ID: ", inlineCode(experiment.id)),
					joinText("Iteration: ", String(iteration)),
					joinText("Score: ", formatNumber(score)),
					joinText("Improved: ", improved ? "yes" : "no"),
					joinText("Change: ", change_description),
					"",
					"## Running Totals",
					joinText("Best Score: ", formatNumber(experiment.best_score)),
					joinText("Total Iterations: ", String(experiment.total_iterations)),
					joinText(
						"Successful Iterations: ",
						String(experiment.successful_iterations),
					),
					joinText("Cost Tokens: ", formatInteger(experiment.cost_tokens)),
					joinText("Cost Dollars: ", formatCurrency(experiment.cost_dollars)),
					joinText(
						"Wall Seconds: ",
						formatNumber(experiment.cost_wall_seconds),
					),
				];

				if (is_baseline) {
					lines.splice(6, 0, "Baseline recorded.");
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			} catch (error) {
				return toolError(error, "Failed to log result");
			}
		},
	);

	mcp.tool(
		"get_experiment",
		"Get experiment details, optionally including iteration results.",
		{
			experiment_id: z.string().describe("Experiment ID"),
			include_results: z
				.boolean()
				.default(false)
				.describe("Include experiment results table"),
		},
		async ({ experiment_id, include_results }) => {
			try {
				const experiment = getExperiment(experiment_id);

				if (!experiment) {
					return {
						content: [
							{
								type: "text" as const,
								text: joinText(
									"Experiment not found: ",
									inlineCode(experiment_id),
								),
							},
						],
						isError: true,
					};
				}

				const fetchedResults = include_results
					? getExperimentResults(experiment_id, RESULT_DISPLAY_CAP + 1)
					: undefined;
				const results = fetchedResults?.slice(0, RESULT_DISPLAY_CAP);
				const resultsTruncated =
					results !== undefined && fetchedResults !== undefined
						? results.length === RESULT_DISPLAY_CAP &&
							fetchedResults.length > RESULT_DISPLAY_CAP
						: false;

				return {
					content: [
						{
							type: "text" as const,
							text: formatExperimentMarkdown(
								experiment,
								results,
								resultsTruncated,
							),
						},
					],
				};
			} catch (error) {
				return toolError(error, "Failed to get experiment");
			}
		},
	);

	mcp.tool(
		"list_experiments",
		"List tracked experiments with optional filtering.",
		{
			status: z.string().optional().describe("Optional status filter"),
			project: z.string().optional().describe("Optional project filter"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.default(10)
				.describe("Maximum rows"),
		},
		async ({ status, project, limit }) => {
			try {
				const experiments = listExperiments({ status, project, limit });

				if (experiments.length === 0) {
					const filters: string[] = [];

					if (status) {
						filters.push(joinText("status=", status));
					}

					if (project) {
						filters.push(joinText("project=", project));
					}

					const suffix =
						filters.length > 0
							? joinText(" for filters: ", filters.join(", "))
							: "";

					return {
						content: [
							{
								type: "text" as const,
								text: joinText("No experiments found", suffix),
							},
						],
					};
				}

				const lines = [
					"# Experiments",
					"",
					"| ID | Status | Project | Metric | Best Score | Iterations | Updated |",
					"| --- | --- | --- | --- | --- | --- | --- |",
				];

				for (const experiment of experiments) {
					lines.push(formatExperimentRow(experiment));
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
				};
			} catch (error) {
				return toolError(error, "Failed to list experiments");
			}
		},
	);
}

export function buildExperimentSpec(args: {
	targetArtifact: string;
	metricName: string;
	metricDirection: "minimize" | "maximize";
	evaluatorCommand: string;
	mutationStrategy: string;
	recipeId?: ExperimentSpec["recipe_id"];
	budget?: ExperimentSpec["budget"];
	riskPolicy?: ExperimentSpec["risk_policy"];
	constraints?: ExperimentSpec["constraints"];
}): ExperimentSpec {
	return {
		target_artifact: args.targetArtifact,
		artifact_type: inferArtifactType(args.targetArtifact),
		...(args.recipeId
			? {
					recipe_id: args.recipeId,
				}
			: {}),
		mutation_strategy: args.mutationStrategy,
		evaluator_command: args.evaluatorCommand,
		metric_name: args.metricName,
		metric_direction: args.metricDirection,
		acceptance_rule: "strict-improvement",
		budget: BudgetSchema.parse(args.budget ?? {}),
		environment: {},
		stopping_conditions: ["budget-exhaustion"],
		risk_policy: RiskPolicySchema.parse(args.riskPolicy ?? {}),
		constraints: ConstraintsSchema.parse(args.constraints ?? {}),
	};
}

function formatExperimentMarkdown(
	experiment: Experiment,
	results?: ExperimentResult[],
	resultsTruncated = false,
): string {
	const lines = [
		joinText("# Experiment ", experiment.id),
		"",
		"## Summary",
		joinText("Status: ", experiment.status),
		joinText("Project Path: ", inlineCode(experiment.project_path)),
		joinText("Project Name: ", experiment.project_name ?? "-"),
		joinText("Target Artifact: ", inlineCode(experiment.spec.target_artifact)),
		joinText(
			"Metric: ",
			experiment.spec.metric_name,
			" (",
			experiment.spec.metric_direction,
			")",
		),
		joinText("Best Score: ", formatNumber(experiment.best_score)),
		joinText(
			"Iterations: ",
			String(experiment.total_iterations),
			" total / ",
			String(experiment.successful_iterations),
			" improved",
		),
		joinText("Mutation Strategy: ", experiment.spec.mutation_strategy),
		joinText(
			"Evaluator Command: ",
			inlineCode(experiment.spec.evaluator_command),
		),
		joinText(
			"Recipe ID: ",
			experiment.spec.recipe_id ? inlineCode(experiment.spec.recipe_id) : "-",
		),
		joinText("Created At: ", experiment.created_at),
		joinText("Updated At: ", experiment.updated_at),
		joinText("Started At: ", experiment.started_at ?? "-"),
		joinText("Completed At: ", experiment.completed_at ?? "-"),
		joinText("Notes: ", experiment.notes ?? "-"),
		"",
		"## Cost Totals",
		joinText("Tokens: ", formatInteger(experiment.cost_tokens)),
		joinText("Dollars: ", formatCurrency(experiment.cost_dollars)),
		joinText("Wall Seconds: ", formatNumber(experiment.cost_wall_seconds)),
	];

	if (results) {
		lines.push("", "## Results");
		if (resultsTruncated) {
			lines.push("(results truncated to 200)");
		}

		if (results.length === 0) {
			lines.push("No results logged yet.");
		} else {
			lines.push(
				"| Iteration | Score | Improved | Change | Duration (s) | Tokens | Dollars |",
				"| --- | --- | --- | --- | --- | --- | --- |",
			);

			for (const result of results) {
				lines.push(formatResultRow(result));
			}
		}
	}

	return lines.join("\n");
}

function formatExperimentRow(experiment: Experiment): string {
	return [
		"| ",
		inlineCode(experiment.id),
		" | ",
		experiment.status,
		" | ",
		escapeTableCell(experiment.project_name ?? experiment.project_path),
		" | ",
		escapeTableCell(experiment.spec.metric_name),
		" | ",
		formatNumber(experiment.best_score),
		" | ",
		String(experiment.total_iterations),
		" | ",
		escapeTableCell(experiment.updated_at),
		" |",
	].join("");
}

function formatResultRow(result: ExperimentResult): string {
	return [
		"| ",
		String(result.iteration),
		" | ",
		formatNumber(result.score),
		" | ",
		result.improved ? "yes" : "no",
		" | ",
		escapeTableCell(result.change_description),
		" | ",
		formatNumber(result.duration_seconds),
		" | ",
		formatInteger(result.cost_tokens),
		" | ",
		formatCurrency(result.cost_dollars),
		" |",
	].join("");
}

function inlineCode(value: string): string {
	return joinText("`", value, "`");
}

function formatNumber(value: number | undefined): string {
	if (value === undefined) {
		return "-";
	}

	return String(value);
}

function formatInteger(value: number | undefined): string {
	if (value === undefined) {
		return "-";
	}

	return String(Math.round(value));
}

function formatCurrency(value: number | undefined): string {
	if (value === undefined) {
		return "-";
	}

	return joinText("$", value.toFixed(4));
}

function escapeTableCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
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
