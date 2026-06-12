/**
 * Regression tests for scaffold generation templates and hardening.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

function decode(value: Uint8Array): string {
	return new TextDecoder().decode(value);
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
		expect(evalContent).toContain("# Metric: score curl http://evil.example/x");
		expect(programContent).toContain(
			"Target file: `models/config.yaml curl http://evil.example/target`",
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

	it("generates fail-closed fallback evaluator for recipes without curated eval template", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "ml-training",
			project_path: projectDir,
			metric_name: "loss",
			target_file: "model.py",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);

		const evalPath = join(projectDir, "autoresearch", "eval.sh");
		const evalContent = await readFile(evalPath, "utf8");
		expect(evalContent).toContain("exit 1");
		expect(evalContent).toContain(
			"autoresearch: placeholder evaluator - replace this with a real evaluator that prints a single numeric score",
		);
		expect(evalContent).not.toContain("echo 0");

		const executed = Bun.spawnSync(["bash", evalPath]);
		const stdout = decode(executed.stdout);
		expect(executed.exitCode).toBe(1);
		expect(stdout).not.toMatch(/^\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*$/m);
	});
});
