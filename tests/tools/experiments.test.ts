/**
 * Tests for experiment tools (src/tools/experiments.ts)
 *
 * Covers exported helpers, registered tool schemas, and real handler output.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	createExperiment,
	getExperiment,
	getExperimentResults,
	logExperimentResult,
} from "../../src/db/experiments.js";
import { resetDb } from "../../src/db/schema.js";
import { inferArtifactType } from "../../src/tools/artifacts.js";
import {
	buildExperimentSpec,
	escapeTableCell,
	formatCurrency,
	formatInteger,
	formatNumber,
	registerExperimentTools,
} from "../../src/tools/experiments.js";
import { type ExperimentSpec, ExperimentSpecSchema } from "../../src/types.js";

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

type LogResultHandler = (args: {
	experiment_id: string;
	iteration: number;
	score: number;
	improved?: boolean;
	change_description: string;
	duration_seconds?: number;
	cost_tokens?: number;
	cost_dollars?: number;
	is_baseline?: boolean;
}) => Promise<ToolResult>;

type GetExperimentHandler = (args: {
	experiment_id: string;
	include_results: boolean;
}) => Promise<ToolResult>;

type RegisterExperimentHandler = (args: {
	project_path: string;
	project_name?: string;
	metric_name: string;
	metric_direction: "minimize" | "maximize";
	target_artifact: string;
	evaluator_command: string;
	mutation_strategy: string;
	budget?: ExperimentSpec["budget"];
	risk_policy?: ExperimentSpec["risk_policy"];
	constraints?: Partial<ExperimentSpec["constraints"]>;
}) => Promise<ToolResult>;

interface RegisteredTool {
	description: string;
	shape: z.ZodRawShape;
	handler: unknown;
}

function registeredTools(): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const mcp = {
		tool: (...args: unknown[]) => {
			const [name, description, shape, handler] = args;
			tools.set(name as string, {
				description: description as string,
				shape: shape as z.ZodRawShape,
				handler,
			});
		},
	} as unknown as McpServer;

	registerExperimentTools(mcp);
	return tools;
}

function handler<T>(name: string): T {
	const tool = registeredTools().get(name);
	if (!tool) throw new Error(`${name} handler was not registered`);
	return tool.handler as T;
}

function logResultHandler(): LogResultHandler {
	return handler<LogResultHandler>("log_result");
}

function validSpec(): ExperimentSpec {
	return {
		target_artifact: "target.md",
		artifact_type: "content",
		mutation_strategy: "LLM edit",
		evaluator_command: "bash eval.sh",
		metric_name: "score",
		metric_direction: "maximize",
		acceptance_rule: "strict-improvement",
		budget: {},
		environment: {},
		stopping_conditions: ["budget-exhaustion"],
		risk_policy: {
			network_denied: true,
			requires_approval: false,
			sandbox_only: false,
			secrets_denied: true,
		},
		constraints: { metric_ceilings: {}, metric_floors: {} },
	};
}

beforeEach(() => resetDb(":memory:"));

describe("ExperimentSpec inference logic", () => {
	it("detects prompt artifacts from path/content", () => {
		expect(inferArtifactType("system_prompt.md")).toBe("prompt");
		expect(inferArtifactType("few_shot_prompt")).toBe("prompt");
	});

	it("detects code artifacts by extension", () => {
		expect(inferArtifactType("src/main.ts")).toBe("code");
		expect(inferArtifactType("src/main.py")).toBe("code");
	});

	it("detects config artifacts by extension", () => {
		expect(inferArtifactType("config.json")).toBe("config");
		expect(inferArtifactType("settings.toml")).toBe("config");
	});

	it("detects content artifacts by extension", () => {
		expect(inferArtifactType("doc.md")).toBe("content");
		expect(inferArtifactType("page.html")).toBe("content");
	});
});

describe("Experiment response formatting", () => {
	it("reports the exact late champion after more than 200 persisted results", async () => {
		const experimentId = "late-champion";
		createExperiment({
			id: experimentId,
			project_path: "/fixture",
			spec: validSpec(),
		});
		for (let iteration = 0; iteration <= 200; iteration++) {
			logExperimentResult({
				experiment_id: experimentId,
				iteration,
				score: iteration,
				change_description: `iteration ${iteration}`,
				...(iteration === 0 ? { is_baseline: true } : {}),
			});
		}

		const response = await logResultHandler()({
			experiment_id: experimentId,
			iteration: 201,
			score: 201,
			change_description: "late champion",
		});
		const persisted = getExperimentResults(experimentId, 202)[201];

		expect(response.isError).toBeUndefined();
		expect(response.content[0].text).toContain("Iteration: 201");
		expect(response.content[0].text).toContain("Improved: yes");
		expect(persisted).toMatchObject({
			iteration: 201,
			score: 201,
			improved: true,
		});
		expect(getExperiment(experimentId)?.best_score).toBe(persisted.score);
	});

	it("formats currency values with the exported formatter", () => {
		expect(formatCurrency(0.05)).toBe("$0.0500");
		expect(formatCurrency(1.5)).toBe("$1.5000");
		expect(formatCurrency(undefined)).toBe("-");
	});

	it("formats numbers and integers with the exported formatters", () => {
		expect(formatNumber(95.5)).toBe("95.5");
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(undefined)).toBe("-");
		expect(formatInteger(10.6)).toBe("11");
		expect(formatInteger(undefined)).toBe("-");
	});

	it("escapes table cell content with the exported helper", () => {
		expect(escapeTableCell("a|b|c")).toBe("a\\|b\\|c");
		expect(escapeTableCell("line1\nline2")).toBe("line1 line2");
	});

	it("escapes pipes and newlines in real get_experiment result rows", async () => {
		createExperiment({
			id: "escape",
			project_path: "/fixture",
			spec: validSpec(),
		});
		logExperimentResult({
			experiment_id: "escape",
			iteration: 0,
			score: 1,
			is_baseline: true,
			cost_dollars: 0.05,
			change_description: "a|b\nc",
		});
		const response = await handler<GetExperimentHandler>("get_experiment")({
			experiment_id: "escape",
			include_results: true,
		});
		expect(response.content[0].text.split("\n")).toContain(
			"| 0 | 1 | no | a\\|b c | - | - | $0.0500 |",
		);
	});
});

describe("Experiment spec building", () => {
	it("creates a valid ExperimentSpec with defaults", () => {
		const spec = buildExperimentSpec({
			targetArtifact: "test.md",
			metricName: "compression_ratio",
			metricDirection: "maximize",
			evaluatorCommand: "python eval.py",
			mutationStrategy: "LLM edit",
			recipeId: "prompt-optimization",
		});

		expect(ExperimentSpecSchema.parse(spec)).toEqual(spec);
		expect(spec).toEqual({
			target_artifact: "test.md",
			artifact_type: "content",
			recipe_id: "prompt-optimization",
			mutation_strategy: "LLM edit",
			evaluator_command: "python eval.py",
			metric_name: "compression_ratio",
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
		});
	});

	it("preserves caller-provided budget, risk policy, and constraints", () => {
		const spec = buildExperimentSpec({
			targetArtifact: "src/main.ts",
			metricName: "pass_rate",
			metricDirection: "maximize",
			evaluatorCommand: "bun test",
			mutationStrategy: "LLM edit",
			budget: { max_iterations: 5, max_dollars: 2.5 },
			riskPolicy: {
				sandbox_only: true,
				requires_approval: true,
				network_denied: true,
				secrets_denied: true,
			},
			constraints: { metric_floors: { pass_rate: 0.9 } },
		});

		expect(spec.budget.max_iterations).toBe(5);
		expect(spec.budget.max_dollars).toBe(2.5);
		expect(spec.risk_policy.sandbox_only).toBe(true);
		expect(spec.risk_policy.requires_approval).toBe(true);
		expect(spec.constraints.metric_floors.pass_rate).toBe(0.9);
		expect(spec.constraints.metric_ceilings).toEqual({});
	});
});

describe("get_experiment spec controls", () => {
	it("round-trips non-default controls from register_experiment to get_experiment", async () => {
		const registered = await handler<RegisterExperimentHandler>(
			"register_experiment",
		)({
			project_path: "/fixture",
			metric_name: "pass_rate",
			metric_direction: "maximize",
			target_artifact: "src/main.ts",
			evaluator_command: "bun test",
			mutation_strategy: "LLM edit",
			budget: {
				max_iterations: 7,
				max_time_seconds: 600,
				max_tokens: 12000,
				max_dollars: 3.5,
			},
			risk_policy: {
				sandbox_only: true,
				requires_approval: true,
				network_denied: false,
				secrets_denied: false,
			},
			constraints: {
				metric_floors: { pass_rate: 0.5 },
				metric_ceilings: { pass_rate: 0.99 },
			},
		});
		expect(registered.isError).toBeUndefined();
		const id = registered.content[0].text.match(
			/Experiment ID: `([^`]+)`/,
		)?.[1];
		expect(id).toBeDefined();

		const response = await handler<GetExperimentHandler>("get_experiment")({
			experiment_id: id as string,
			include_results: false,
		});
		expect(response.isError).toBeUndefined();
		const lines = response.content[0].text.split("\n");
		for (const expected of [
			"## Run Controls",
			"Acceptance Rule: strict-improvement",
			"Stopping Conditions: budget-exhaustion",
			"- max_iterations: 7",
			"- max_time_seconds: 600",
			"- max_tokens: 12000",
			"- max_dollars: 3.5",
			"- sandbox_only: true",
			"- requires_approval: true",
			"- network_denied: false",
			"- secrets_denied: false",
			'- metric_floors: {"pass_rate":0.5}',
			'- metric_ceilings: {"pass_rate":0.99}',
		]) {
			expect(lines).toContain(expected);
		}
	});

	it("renders unset budgets and default policy explicitly", async () => {
		createExperiment({
			id: "defaults",
			project_path: "/fixture",
			spec: validSpec(),
		});
		const response = await handler<GetExperimentHandler>("get_experiment")({
			experiment_id: "defaults",
			include_results: false,
		});
		const lines = response.content[0].text.split("\n");
		expect(lines).toContain("- max_iterations: not set");
		expect(lines).toContain("- max_dollars: not set");
		expect(lines).toContain("- requires_approval: false");
		expect(lines).toContain("- metric_floors: {}");
	});
});

describe("log_result tool boundary", () => {
	const iterationSchema = () => {
		const shape = registeredTools().get("log_result")?.shape;
		if (!shape) throw new Error("log_result schema missing");
		return z.object(shape).shape.iteration;
	};

	it.each([0, 1, Number.MAX_SAFE_INTEGER])(
		"accepts safe iteration %p",
		(value) => {
			expect(iterationSchema().safeParse(value).success).toBe(true);
		},
	);

	it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 2 ** 60, Number.NaN])(
		"rejects unsafe iteration %p",
		(value) => {
			expect(iterationSchema().safeParse(value).success).toBe(false);
		},
	);

	it("surfaces the DB safe-integer rejection through the real handler", async () => {
		createExperiment({
			id: "unsafe",
			project_path: "/fixture",
			spec: validSpec(),
		});
		const response = await logResultHandler()({
			experiment_id: "unsafe",
			iteration: 2 ** 60,
			score: 1,
			is_baseline: true,
			change_description: "baseline",
		});
		expect(response.isError).toBe(true);
		expect(response.content[0].text).toBe(
			"Failed to log result: iteration must be a nonnegative safe integer",
		);
		expect(getExperiment("unsafe")?.status).toBe("scaffolded");
	});

	it("documents the scaffolded auto-start in tool descriptions", () => {
		const tools = registeredTools();
		expect(tools.get("log_result")?.description).toContain(
			"automatically starts a scaffolded experiment",
		);
		expect(tools.get("update_experiment")?.description).toContain(
			"automatically moves a scaffolded experiment to running",
		);
	});
});
