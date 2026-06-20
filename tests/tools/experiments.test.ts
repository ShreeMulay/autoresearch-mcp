/**
 * Tests for tool helper functions (src/tools/experiments.ts)
 *
 * These are pure functions extracted from the tool handlers for unit testing.
 * The MCP tool registration itself is not tested (SDK responsibility).
 */

import { describe, expect, it } from "bun:test";
import { inferArtifactType } from "../../src/tools/artifacts.js";
import { buildExperimentSpec } from "../../src/tools/experiments.js";

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
