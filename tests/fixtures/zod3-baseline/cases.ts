/**
 * Parse-case inputs for the zod 3 → zod 4 compatibility oracle.
 *
 * The recorded outcomes live in `parse-cases.json`, produced by
 * `tests/fixtures/capture-zod3-baseline.ts` while the repository still
 * depended on zod 3.25.76. Inputs are kept in TypeScript (not JSON) so they
 * can express `undefined`, non-finite numbers, and integers beyond 2**53.
 */

export type SchemaName =
	| "ExperimentSpecSchema"
	| "BudgetSchema"
	| "RiskPolicySchema"
	| "ConstraintsSchema"
	| "CatalogItemSchema"
	| "TechniqueSpecSchema"
	| "RecipeId";

export interface ParseCase {
	name: string;
	schema: SchemaName;
	input: unknown;
}

export interface BuildCase {
	name: string;
	args: {
		targetArtifact: string;
		metricName: string;
		metricDirection: "minimize" | "maximize";
		evaluatorCommand: string;
		mutationStrategy: string;
		recipeId?: "prompt-optimization" | "code-performance";
		budget?: Record<string, unknown>;
		riskPolicy?: Record<string, unknown>;
		constraints?: Record<string, unknown>;
	};
}

const minimalSpec = {
	target_artifact: "prompt.md",
	mutation_strategy: "LLM edit",
	evaluator_command: "bun eval.ts",
	metric_name: "score",
};

const fullSpec = {
	target_artifact: "src/hot.ts",
	artifact_type: "code",
	technique: {
		search_strategy: "evolutionary",
		evaluator: "benchmark-harness",
		execution_pattern: "two-loop",
		domain_template: "code-performance",
	},
	recipe_id: "code-performance",
	mutation_strategy: "random",
	evaluator_command: "bun bench.ts",
	metric_name: "latency_ms",
	metric_direction: "minimize",
	acceptance_rule: "strict-improvement",
	budget: {
		max_iterations: 7,
		max_time_seconds: 12.5,
		max_tokens: 1000,
		max_dollars: 0.25,
	},
	environment: {
		repo_sha: "abc123",
		dataset_version: "v2",
		model_version: "m1",
		dependency_lock: "bun.lock",
	},
	stopping_conditions: ["plateau", "max-iterations"],
	risk_policy: {
		sandbox_only: true,
		requires_approval: true,
		network_denied: false,
		secrets_denied: false,
	},
	constraints: {
		metric_floors: { accuracy: 0.5 },
		metric_ceilings: { latency_ms: 100, accuracy: 0.9 },
	},
};

function withField(field: string, value: unknown): Record<string, unknown> {
	return { ...minimalSpec, [field]: value };
}

const nestedVariants: Record<string, Record<string, unknown>> = {
	budget: { max_iterations: 3 },
	risk_policy: { sandbox_only: true },
	constraints: { metric_floors: { accuracy: 0.1 } },
};

const nestedOmissionCases: ParseCase[] = Object.entries(nestedVariants).flatMap(
	([field, partial]) => [
		{
			name: `spec ${field} omitted`,
			schema: "ExperimentSpecSchema" as const,
			input: { ...minimalSpec },
		},
		{
			name: `spec ${field} empty object`,
			schema: "ExperimentSpecSchema" as const,
			input: withField(field, {}),
		},
		{
			name: `spec ${field} partial`,
			schema: "ExperimentSpecSchema" as const,
			input: withField(field, partial),
		},
		{
			name: `spec ${field} explicit undefined`,
			schema: "ExperimentSpecSchema" as const,
			input: withField(field, undefined),
		},
	],
);

const specBudgetIntCases: ParseCase[] = (
	["max_iterations", "max_tokens"] as const
).flatMap((field) =>
	(
		[
			["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
			["2**53", 2 ** 53],
			["1e300", 1e300],
			["fraction", 1.5],
			["negative", -1],
		] as const
	).map(([label, value]) => ({
		name: `spec budget.${field} ${label}`,
		schema: "ExperimentSpecSchema" as const,
		input: withField("budget", { [field]: value }),
	})),
);

const budgetIntCases: ParseCase[] = [
	...specBudgetIntCases,
	...(["max_iterations", "max_tokens"] as const).flatMap((field) =>
		(
			[
				["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
				["2**53", 2 ** 53],
				["1e300", 1e300],
			] as const
		).map(([label, value]) => ({
			name: `BudgetSchema ${field} ${label}`,
			schema: "BudgetSchema" as const,
			input: { [field]: value },
		})),
	),
];

const nonFiniteCases: ParseCase[] = (
	[
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["-Infinity", Number.NEGATIVE_INFINITY],
	] as const
).flatMap(([label, value]) => [
	{
		name: `spec budget.max_iterations ${label}`,
		schema: "ExperimentSpecSchema" as const,
		input: withField("budget", { max_iterations: value }),
	},
	{
		name: `spec budget.max_time_seconds ${label}`,
		schema: "ExperimentSpecSchema" as const,
		input: withField("budget", { max_time_seconds: value }),
	},
	{
		name: `spec budget.max_dollars ${label}`,
		schema: "ExperimentSpecSchema" as const,
		input: withField("budget", { max_dollars: value }),
	},
	{
		name: `spec constraints floor ${label}`,
		schema: "ExperimentSpecSchema" as const,
		input: withField("constraints", { metric_floors: { m: value } }),
	},
	{
		name: `catalog experiments_per_hour ${label}`,
		schema: "CatalogItemSchema" as const,
		input: {
			id: "x",
			name: "X",
			layer: "strategy",
			description: "d",
			when_to_use: "w",
			experiments_per_hour: value,
		},
	},
]);

const refineCases: ParseCase[] = [
	{
		name: "spec constraints floor above ceiling",
		schema: "ExperimentSpecSchema",
		input: withField("constraints", {
			metric_floors: { accuracy: 0.9 },
			metric_ceilings: { accuracy: 0.5 },
		}),
	},
	{
		name: "spec constraints two floors above ceilings",
		schema: "ExperimentSpecSchema",
		input: withField("constraints", {
			metric_floors: { a: 2, b: 3 },
			metric_ceilings: { a: 1, b: 1 },
		}),
	},
	{
		name: "spec constraints floor equals ceiling",
		schema: "ExperimentSpecSchema",
		input: withField("constraints", {
			metric_floors: { a: 1 },
			metric_ceilings: { a: 1 },
		}),
	},
	{
		name: "spec constraints floor without ceiling",
		schema: "ExperimentSpecSchema",
		input: withField("constraints", { metric_floors: { a: 5 } }),
	},
	{
		name: "ConstraintsSchema floor above ceiling",
		schema: "ConstraintsSchema",
		input: { metric_floors: { a: 2 }, metric_ceilings: { a: 1 } },
	},
	{
		name: "ConstraintsSchema invalid floor type and refine",
		schema: "ConstraintsSchema",
		input: { metric_floors: { a: "x" }, metric_ceilings: { a: 1 } },
	},
];

const specMiscCases: ParseCase[] = [
	{ name: "spec minimal", schema: "ExperimentSpecSchema", input: minimalSpec },
	{
		name: "spec full non-default",
		schema: "ExperimentSpecSchema",
		input: fullSpec,
	},
	{
		name: "spec unknown extra key",
		schema: "ExperimentSpecSchema",
		input: { ...minimalSpec, surprise: { nested: 1 } },
	},
	{
		name: "spec unknown nested key in budget and risk_policy",
		schema: "ExperimentSpecSchema",
		input: {
			...minimalSpec,
			budget: { max_iterations: 1, extra: true },
			risk_policy: { sandbox_only: true, extra: true },
		},
	},
	{
		name: "spec missing required fields",
		schema: "ExperimentSpecSchema",
		input: { target_artifact: "x" },
	},
	{
		name: "spec legacy acceptance_rule pareto",
		schema: "ExperimentSpecSchema",
		input: { ...minimalSpec, acceptance_rule: "pareto" },
	},
	{
		name: "spec invalid enums",
		schema: "ExperimentSpecSchema",
		input: {
			...minimalSpec,
			artifact_type: "binary",
			metric_direction: "up",
			recipe_id: "nope",
			stopping_conditions: ["never"],
		},
	},
	{
		name: "spec invalid technique",
		schema: "ExperimentSpecSchema",
		input: { ...minimalSpec, technique: { search_strategy: "x" } },
	},
	{
		name: "spec null budget",
		schema: "ExperimentSpecSchema",
		input: withField("budget", null),
	},
	{
		name: "spec risk_policy wrong types",
		schema: "ExperimentSpecSchema",
		input: withField("risk_policy", { sandbox_only: "yes" }),
	},
	{
		name: "spec empty stopping_conditions and environment partial",
		schema: "ExperimentSpecSchema",
		input: {
			...minimalSpec,
			stopping_conditions: [],
			environment: { repo_sha: "x" },
		},
	},
	{ name: "spec not an object", schema: "ExperimentSpecSchema", input: "x" },
	{ name: "spec array", schema: "ExperimentSpecSchema", input: [] },
	{ name: "RiskPolicySchema empty", schema: "RiskPolicySchema", input: {} },
	{
		name: "RiskPolicySchema partial",
		schema: "RiskPolicySchema",
		input: { requires_approval: true },
	},
	{ name: "ConstraintsSchema empty", schema: "ConstraintsSchema", input: {} },
	{ name: "BudgetSchema empty", schema: "BudgetSchema", input: {} },
	{
		name: "BudgetSchema negative time",
		schema: "BudgetSchema",
		input: { max_time_seconds: -1 },
	},
	{ name: "RecipeId valid", schema: "RecipeId", input: "ml-training" },
	{ name: "RecipeId invalid", schema: "RecipeId", input: "bogus" },
];

const catalogBase = {
	id: "hill-climbing",
	name: "Hill Climbing",
	layer: "strategy",
	description: "d",
	when_to_use: "w",
};

const catalogCases: ParseCase[] = [
	{
		name: "catalog arrays omitted",
		schema: "CatalogItemSchema",
		input: catalogBase,
	},
	{
		name: "catalog arrays present",
		schema: "CatalogItemSchema",
		input: {
			...catalogBase,
			when_not_to_use: "n",
			core_pattern: "c",
			source: "s",
			tags: ["a", "b"],
			related: ["x"],
			examples: [{ domain: "d", description: "e", metric: "m", result: "r" }],
			composes: { search_strategy: "hill-climbing" },
			estimated_cost: "low",
			experiments_per_hour: 12,
			requires_gpu: true,
		},
	},
	{
		name: "catalog arrays empty",
		schema: "CatalogItemSchema",
		input: { ...catalogBase, tags: [], related: [], examples: [] },
	},
	{
		name: "catalog invalid layer and example",
		schema: "CatalogItemSchema",
		input: { ...catalogBase, layer: "other", examples: [{ domain: 1 }] },
	},
	{
		name: "catalog nonpositive experiments_per_hour",
		schema: "CatalogItemSchema",
		input: { ...catalogBase, experiments_per_hour: 0 },
	},
	{
		name: "catalog unknown key",
		schema: "CatalogItemSchema",
		input: { ...catalogBase, extra: 1 },
	},
	{
		name: "technique minimal",
		schema: "TechniqueSpecSchema",
		input: {
			search_strategy: "hill-climbing",
			evaluator: "binary-evaluator",
			execution_pattern: "single-ratchet",
		},
	},
	{
		name: "technique with domain template",
		schema: "TechniqueSpecSchema",
		input: {
			search_strategy: "beam-search",
			evaluator: "llm-as-judge",
			execution_pattern: "bounded-episode",
			domain_template: "prompt-optimization",
		},
	},
	{
		name: "technique invalid",
		schema: "TechniqueSpecSchema",
		input: { search_strategy: "x", evaluator: "y" },
	},
];

export const PARSE_CASES: ParseCase[] = [
	...specMiscCases,
	...nestedOmissionCases,
	...budgetIntCases,
	...nonFiniteCases,
	...refineCases,
	...catalogCases,
];

const buildBase = {
	targetArtifact: "prompts/system.md",
	metricName: "score",
	metricDirection: "maximize" as const,
	evaluatorCommand: "bun eval.ts",
	mutationStrategy: "LLM edit",
};

export const BUILD_CASES: BuildCase[] = [
	{ name: "build defaults", args: buildBase },
	{
		name: "build empty nested",
		args: { ...buildBase, budget: {}, riskPolicy: {}, constraints: {} },
	},
	{
		name: "build partial nested",
		args: {
			...buildBase,
			metricDirection: "minimize",
			recipeId: "code-performance",
			budget: { max_iterations: 5, max_dollars: 1 },
			riskPolicy: { requires_approval: true },
			constraints: { metric_ceilings: { latency: 10 } },
		},
	},
	{
		name: "build safe max budget",
		args: { ...buildBase, budget: { max_tokens: Number.MAX_SAFE_INTEGER } },
	},
	{
		name: "build unsafe 2**53 budget",
		args: { ...buildBase, budget: { max_iterations: 2 ** 53 } },
	},
];

/**
 * Legacy experiment rows inserted into a database at the pre-migration-3
 * shape (migrations 1 and 2 applied, no `is_baseline` column).
 */
export interface LegacyRow {
	id: string;
	spec: string;
	results?: { iteration: number; score: number; improved: number }[];
}

export const LEGACY_SAFE_ROWS: LegacyRow[] = [
	{
		id: "legacy-a-pareto-no-direction",
		spec: JSON.stringify({
			target_artifact: "prompt.md",
			mutation_strategy: "LLM edit",
			evaluator_command: "bun eval.ts",
			metric_name: "score",
			acceptance_rule: "pareto",
			risk_policy: { sandbox_only: true },
		}),
		results: [
			{ iteration: 1, score: 0.5, improved: 1 },
			{ iteration: 2, score: 0.7, improved: 0 },
			{ iteration: 3, score: 0.6, improved: 1 },
		],
	},
	{
		id: "legacy-b-minimal",
		spec: JSON.stringify({
			target_artifact: "config.yaml",
			mutation_strategy: "random",
			evaluator_command: "./eval.sh",
			metric_name: "loss",
			metric_direction: "minimize",
		}),
		results: [
			{ iteration: 1, score: 3, improved: 0 },
			{ iteration: 2, score: 2, improved: 0 },
		],
	},
	{
		id: "legacy-c-full",
		spec: JSON.stringify({
			target_artifact: "src/hot.ts",
			artifact_type: "code",
			recipe_id: "code-performance",
			mutation_strategy: "LLM edit",
			evaluator_command: "bun bench.ts",
			metric_name: "latency_ms",
			metric_direction: "minimize",
			acceptance_rule: "confidence-threshold",
			budget: {
				max_iterations: 10,
				max_tokens: Number.MAX_SAFE_INTEGER,
				max_dollars: 2.5,
			},
			environment: { repo_sha: "deadbeef" },
			stopping_conditions: ["plateau"],
			risk_policy: {},
			constraints: { metric_floors: { accuracy: 0.8 } },
		}),
	},
	{
		id: "legacy-d-extra-key-gated",
		spec: JSON.stringify({
			target_artifact: "notes.md",
			mutation_strategy: "LLM edit",
			evaluator_command: "bun judge.ts",
			metric_name: "quality",
			metric_direction: "maximize",
			acceptance_rule: "gated-constraints",
			legacy_field: "dropped",
			constraints: {},
			budget: {},
		}),
	},
];

/**
 * A row whose budget integer exceeds Number.MAX_SAFE_INTEGER. zod 3 accepted
 * and persisted such values through register_experiment/scaffold_experiment.
 * Kept in a separate database so the safe rows stay independently testable.
 */
export const LEGACY_UNSAFE_INT_ROWS: LegacyRow[] = [
	{
		id: "legacy-e-unsafe-int",
		spec: JSON.stringify({
			target_artifact: "prompt.md",
			mutation_strategy: "LLM edit",
			evaluator_command: "bun eval.ts",
			metric_name: "score",
			metric_direction: "maximize",
			acceptance_rule: "strict-improvement",
			budget: { max_iterations: 2 ** 53, max_tokens: 1e300 },
		}),
	},
];
