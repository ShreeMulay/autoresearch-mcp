/**
 * Core types for the autoresearch-mcp system.
 * These are the foundational schemas that everything else builds on.
 */

import { z } from "zod";

// ============================================================
// Layer Enums — the 4 composable layers
// ============================================================

export const SearchStrategyId = z.enum([
	"hill-climbing",
	"evolutionary",
	"bayesian-optimization",
	"beam-search",
	"multi-armed-bandit",
	"simulated-annealing",
	"ablation-elimination",
	"self-refine",
]);
export type SearchStrategyId = z.infer<typeof SearchStrategyId>;

export const EvaluatorId = z.enum([
	"benchmark-harness",
	"binary-evaluator",
	"rubric-scorer",
	"llm-as-judge",
	"pairwise-comparison",
	"cost-latency-evaluator",
	"human-approval-gate",
	"regression-detector",
]);
export type EvaluatorId = z.infer<typeof EvaluatorId>;

export const ExecutionPatternId = z.enum([
	"single-ratchet",
	"two-loop",
	"bounded-episode",
	"branch-and-merge",
	"champion-challenger",
	"checkpoint-and-resume",
]);
export type ExecutionPatternId = z.infer<typeof ExecutionPatternId>;

export const RecipeId = z.enum([
	"prompt-optimization",
	"code-performance",
	"config-tuning",
	"content-revision",
	"test-amplification",
	"ml-training",
	"literature-synthesis",
	"general-ratchet",
]);
export type RecipeId = z.infer<typeof RecipeId>;

export const CatalogLayer = z.enum([
	"strategy",
	"evaluator",
	"pattern",
	"recipe",
]);
export type CatalogLayer = z.infer<typeof CatalogLayer>;

// ============================================================
// CatalogItem — a single entry in any layer
// ============================================================

export const CatalogItemSchema = z.object({
	id: z.string().describe("Unique identifier (e.g., 'hill-climbing')"),
	name: z.string().describe("Human-readable name"),
	layer: CatalogLayer.describe("Which catalog layer this belongs to"),
	description: z.string().describe("What this technique/component does"),
	when_to_use: z.string().describe("Decision criteria for choosing this"),
	when_not_to_use: z.string().optional().describe("Anti-patterns / wrong fits"),
	core_pattern: z
		.string()
		.optional()
		.describe("The fundamental loop or pattern"),
	source: z
		.string()
		.optional()
		.describe("Origin (karpathy/autoresearch, community, etc.)"),
	tags: z.array(z.string()).default([]).describe("Searchable tags"),
	related: z.array(z.string()).default([]).describe("Related technique IDs"),
	examples: z
		.array(
			z.object({
				domain: z.string(),
				description: z.string(),
				metric: z.string().optional(),
				result: z.string().optional(),
			}),
		)
		.default([]),
	// Recipe-specific: composition references
	composes: z
		.object({
			search_strategy: z.string().optional(),
			evaluator: z.string().optional(),
			execution_pattern: z.string().optional(),
		})
		.optional()
		.describe("For recipes: what this composes from other layers"),
	estimated_cost: z.string().optional(),
	experiments_per_hour: z.number().finite().positive().optional(),
	requires_gpu: z.boolean().default(false),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

// ============================================================
// TechniqueSpec — composable technique definition
// ============================================================

export const TechniqueSpecSchema = z.object({
	search_strategy: SearchStrategyId.describe(
		"How to explore the solution space",
	),
	evaluator: EvaluatorId.describe("How to measure results"),
	execution_pattern: ExecutionPatternId.describe("How to orchestrate the loop"),
	domain_template: RecipeId.optional().describe(
		"Optional domain recipe for scaffolding",
	),
});
export type TechniqueSpec = z.infer<typeof TechniqueSpecSchema>;

// ============================================================
// ExperimentSpec — the runnable experiment contract
// ============================================================

const NonnegativeFiniteNumber = z.number().finite().nonnegative();

export const BudgetSchema = z.object({
	max_iterations: z
		.number()
		.finite()
		.int()
		.nonnegative()
		.optional()
		.describe("Maximum experiment iterations"),
	max_time_seconds: NonnegativeFiniteNumber.optional().describe(
		"Maximum wall-clock time",
	),
	max_tokens: z
		.number()
		.finite()
		.int()
		.nonnegative()
		.optional()
		.describe("Maximum LLM tokens to spend"),
	max_dollars: NonnegativeFiniteNumber.optional().describe(
		"Maximum dollar cost",
	),
});

export const RiskPolicySchema = z.object({
	sandbox_only: z
		.boolean()
		.default(false)
		.describe("Must run in sandboxed environment"),
	requires_approval: z
		.boolean()
		.default(false)
		.describe("Human approval needed per iteration"),
	network_denied: z
		.boolean()
		.default(true)
		.describe("No network access during execution"),
	secrets_denied: z
		.boolean()
		.default(true)
		.describe("No access to env secrets"),
});

export const ConstraintsSchema = z
	.object({
		metric_floors: z
			.record(z.string(), z.number().finite())
			.default({})
			.describe("Minimum acceptable values for metrics"),
		metric_ceilings: z
			.record(z.string(), z.number().finite())
			.default({})
			.describe("Maximum acceptable values for metrics"),
	})
	.superRefine(({ metric_ceilings, metric_floors }, ctx) => {
		for (const [metric, floor] of Object.entries(metric_floors)) {
			const ceiling = metric_ceilings[metric];
			if (ceiling !== undefined && floor > ceiling) {
				ctx.addIssue({
					code: "custom",
					message: `Metric floor for ${metric} must not exceed its ceiling`,
					path: ["metric_floors", metric],
				});
			}
		}
	});

export const AcceptanceRule = z.enum([
	"strict-improvement",
	"confidence-threshold",
	"pareto",
	"gated-constraints",
]);
export type AcceptanceRule = z.infer<typeof AcceptanceRule>;

export const StoppingCondition = z.enum([
	"max-iterations",
	"plateau",
	"convergence",
	"budget-exhaustion",
]);
export type StoppingCondition = z.infer<typeof StoppingCondition>;

export const ExperimentSpecSchema = z.object({
	target_artifact: z
		.string()
		.describe("What is being optimized (prompt, code file, config, etc.)"),
	artifact_type: z
		.enum(["prompt", "code", "config", "content", "other"])
		.default("other"),
	technique: TechniqueSpecSchema.optional().describe(
		"Composed technique specification",
	),
	recipe_id: RecipeId.optional().describe("Shorthand: use a predefined recipe"),
	mutation_strategy: z
		.string()
		.describe(
			"How changes are proposed (LLM edit, random, evolutionary, etc.)",
		),
	evaluator_command: z
		.string()
		.describe(
			"Command or script that returns a score (single float to stdout)",
		),
	metric_name: z
		.string()
		.describe("Name of the primary metric (e.g., val_bpb, test_pass_rate)"),
	metric_direction: z.enum(["minimize", "maximize"]).default("maximize"),
	acceptance_rule: AcceptanceRule.default("strict-improvement"),
	budget: BudgetSchema.default({}),
	environment: z
		.object({
			repo_sha: z.string().optional(),
			dataset_version: z.string().optional(),
			model_version: z.string().optional(),
			dependency_lock: z.string().optional(),
		})
		.default({}),
	stopping_conditions: z
		.array(StoppingCondition)
		.default(["budget-exhaustion"]),
	risk_policy: RiskPolicySchema.default({}),
	constraints: ConstraintsSchema.default({}),
});
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;

// ============================================================
// Experiment — a tracked experiment instance
// ============================================================

export const ExperimentStatus = z.enum([
	"scaffolded",
	"running",
	"paused",
	"completed",
	"failed",
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const ExperimentSchema = z.object({
	id: z.string().describe("Unique experiment ID"),
	spec: ExperimentSpecSchema.describe("The experiment specification"),
	project_path: z.string().describe("Absolute path to the project directory"),
	project_name: z.string().optional(),
	status: ExperimentStatus.default("scaffolded"),
	best_score: z.number().optional(),
	total_iterations: z.number().default(0),
	successful_iterations: z.number().default(0),
	cost_tokens: z.number().default(0),
	cost_dollars: z.number().default(0),
	cost_wall_seconds: z.number().default(0),
	started_at: z.string().optional(),
	completed_at: z.string().optional(),
	notes: z.string().optional(),
	created_at: z.string(),
	updated_at: z.string(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

// ============================================================
// ExperimentResult — a single iteration result
// ============================================================

export const ExperimentResultSchema = z.object({
	id: z.number().optional(),
	experiment_id: z.string(),
	iteration: z.number(),
	score: z.number(),
	improved: z.boolean(),
	is_baseline: z.boolean().default(false),
	change_description: z.string().describe("What was tried in this iteration"),
	duration_seconds: z.number().optional(),
	cost_tokens: z.number().optional(),
	cost_dollars: z.number().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	created_at: z.string().optional(),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

// ============================================================
// TechniqueOutcome — meta-learning record
// ============================================================

export const TechniqueOutcomeSchema = z.object({
	id: z.number().optional(),
	technique_id: z.string(),
	domain: z.string(),
	project_name: z.string().optional(),
	outcome: z.enum(["success", "partial", "failed", "abandoned"]),
	notes: z.string().optional(),
	score_improvement: z.number().optional(),
	total_experiments: z.number().optional(),
	created_at: z.string().optional(),
});
export type TechniqueOutcome = z.infer<typeof TechniqueOutcomeSchema>;
