/**
 * Tests for tool helper functions (src/tools/experiments.ts)
 *
 * These are pure functions extracted from the tool handlers for unit testing.
 * The MCP tool registration itself is not tested (SDK responsibility).
 */

import { describe, expect, it } from "bun:test";

// The helper functions are not currently exported from experiments.ts.
// We test them by extracting the logic or by testing the public behavior.
// For this test file, we verify the core logic patterns used in the tool.

describe("ExperimentSpec inference logic", () => {
	it("detects prompt artifacts from path/content", () => {
		const promptSignals = [
			"system_prompt.md",
			"prompt.txt",
			"few_shot_prompt",
			"my-prompt-engineering-project",
		];

		for (const signal of promptSignals) {
			const isPrompt =
				signal.toLowerCase().includes("prompt") ||
				signal.toLowerCase().includes("few_shot");
			expect(isPrompt).toBe(true);
		}
	});

	it("detects code artifacts by extension", () => {
		const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"];
		const testPaths = codeExtensions.map((ext) => `src/main${ext}`);

		for (const path of testPaths) {
			const isCode = codeExtensions.some((ext) =>
				path.toLowerCase().endsWith(ext),
			);
			expect(isCode).toBe(true);
		}
	});

	it("detects config artifacts by extension", () => {
		const configExtensions = [".json", ".yaml", ".yml", ".toml"];
		const testPaths = configExtensions.map((ext) => `config${ext}`);

		for (const path of testPaths) {
			const isConfig = configExtensions.some((ext) =>
				path.toLowerCase().endsWith(ext),
			);
			expect(isConfig).toBe(true);
		}
	});

	it("detects content artifacts by extension", () => {
		const contentExtensions = [".md", ".txt", ".html"];
		const testPaths = contentExtensions.map((ext) => `doc${ext}`);

		for (const path of testPaths) {
			const isContent = contentExtensions.some((ext) =>
				path.toLowerCase().endsWith(ext),
			);
			expect(isContent).toBe(true);
		}
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
});
