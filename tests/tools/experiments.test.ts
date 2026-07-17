/**
 * Tests for tool helper functions (src/tools/experiments.ts)
 *
 * Covers pure helpers and focused tool-handler response behavior.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
	registerExperimentTools,
} from "../../src/tools/experiments.js";
import type { ExperimentSpec } from "../../src/types.js";

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

function logResultHandler(): LogResultHandler {
	const handlers = new Map<string, LogResultHandler>();
	const mcp = {
		tool: (...args: unknown[]) => {
			const [name, , , handler] = args;
			handlers.set(name as string, handler as LogResultHandler);
		},
	} as McpServer;

	registerExperimentTools(mcp);
	const handler = handlers.get("log_result");
	if (!handler) throw new Error("log_result handler was not registered");
	return handler;
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

	it("formats currency values correctly", () => {
		const formatCurrency = (value: number | undefined): string => {
			if (value === undefined) return "-";
			return `$${value.toFixed(4)}`;
		};

		expect(formatCurrency(0.05)).toBe("$0.0500");
		expect(formatCurrency(1.5)).toBe("$1.5000");
		expect(formatCurrency(undefined)).toBe("-");
	});

	it("formats numbers correctly", () => {
		const formatNumber = (value: number | undefined): string => {
			if (value === undefined) return "-";
			return String(value);
		};

		expect(formatNumber(95.5)).toBe("95.5");
		expect(formatNumber(0)).toBe("0");
		expect(formatNumber(undefined)).toBe("-");
	});

	it("escapes table cell content", () => {
		const escapeTableCell = (value: string): string => {
			return value.replaceAll("|", "\\|").replaceAll("\n", " ");
		};

		expect(escapeTableCell("a|b|c")).toBe("a\\|b\\|c");
		expect(escapeTableCell("line1\nline2")).toBe("line1 line2");
	});
});

describe("Experiment spec building", () => {
	it("creates a valid ExperimentSpec with defaults", () => {
		const spec = {
			target_artifact: "test.md",
			artifact_type: "content" as const,
			recipe_id: "prompt-optimization" as const,
			mutation_strategy: "LLM edit",
			evaluator_command: "python eval.py",
			metric_name: "compression_ratio",
			metric_direction: "maximize" as const,
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

		expect(spec.target_artifact).toBe("test.md");
		expect(spec.metric_direction).toBe("maximize");
		expect(spec.acceptance_rule).toBe("strict-improvement");
		expect(spec.stopping_conditions).toContain("budget-exhaustion");
		expect(spec.risk_policy.network_denied).toBe(true);
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
