import { afterAll, describe, expect, it } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const tempDirs: string[] = [];
const numericScore = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "autoresearch-evaluator-"));
	tempDirs.push(dir);
	return dir;
}

async function runEvaluator(
	recipe: string,
	cwd: string,
	args: string[] = [],
	env: Record<string, string | undefined> = {},
) {
	const fixtureBin = join(cwd, ".fixture-bin");
	await mkdir(fixtureBin, { recursive: true });
	await symlink("/usr/bin/python3", join(fixtureBin, "python")).catch(() => {});
	const proc = Bun.spawn(
		[
			"bash",
			join(repoRoot, "catalog", "templates", recipe, "eval.sh"),
			...args,
		],
		{
			cwd,
			env: {
				...process.env,
				AUTORESEARCH_METRIC_DIRECTION: undefined,
				AUTORESEARCH_TARGET_FILE: undefined,
				PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
				...env,
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr, stdout: stdout.trim() };
}

function expectFiniteNumericScore(stdout: string): number {
	expect(stdout).toMatch(numericScore);
	const score = Number(stdout);
	expect(Number.isFinite(score)).toBe(true);
	return score;
}

afterAll(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
});

describe("curated evaluator contracts", () => {
	it("standalone ML defaults to maximize and rejects invalid directions and losses", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "metrics.json"), '{"validation_loss":2}\n');
		const defaultResult = await runEvaluator("ml-training", dir);
		expect(defaultResult.exitCode).toBe(0);
		expect(expectFiniteNumericScore(defaultResult.stdout)).toBe(-2);
		const minimize = await runEvaluator("ml-training", dir, [], {
			AUTORESEARCH_METRIC_DIRECTION: "minimize",
		});
		expect(minimize.exitCode).toBe(0);
		expect(expectFiniteNumericScore(minimize.stdout)).toBe(2);
		const invalid = await runEvaluator("ml-training", dir, [], {
			AUTORESEARCH_METRIC_DIRECTION: "sideways",
		});
		expect(invalid.exitCode).not.toBe(0);
		expect(invalid.stdout).toBe("");
		await writeFile(
			join(dir, "metrics.json"),
			'{"validation_loss":"not numeric"}\n',
		);
		const invalidLoss = await runEvaluator("ml-training", dir);
		expect(invalidLoss.exitCode).not.toBe(0);
		expect(invalidLoss.stdout).toBe("");
	});

	it("standalone literature defaults to synthesis.md and an explicit path overrides a binding", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "synthesis.md"), "Default [Citation 2026].");
		const target = join(dir, `alternate 'quoted' $literal.md`);
		await writeFile(target, "Alternate without a marker.");
		const defaultResult = await runEvaluator("literature-synthesis", dir);
		expect(defaultResult.exitCode).toBe(0);
		expect(expectFiniteNumericScore(defaultResult.stdout)).toBe(1);
		const explicit = await runEvaluator("literature-synthesis", dir, [target], {
			AUTORESEARCH_TARGET_FILE: "missing.md",
		});
		expect(explicit.exitCode).toBe(0);
		expect(expectFiniteNumericScore(explicit.stdout)).toBe(0);
	});

	it.each([
		"prompt-optimization",
		"code-performance",
		"config-tuning",
		"general-ratchet",
		"content-revision",
		"ml-training",
		"literature-synthesis",
		"test-amplification",
	])(
		"%s program uses direction-aware strict acceptance without tie exceptions",
		async (recipe) => {
			const program = await readFile(
				join(repoRoot, "catalog/templates", recipe, "program.md"),
				"utf8",
			);
			expect(program).toContain(
				"Follow the scaffolded metric direction and require strict improvement",
			);
			expect(program).toContain(
				"Reject ties and regressions; retain the earlier champion",
			);
			expect(program).not.toMatch(
				/score increases|maximize the evaluation score|If several variants tie, keep/,
			);
		},
	);
	it.each([
		"prompt-optimization",
		"code-performance",
		"config-tuning",
		"content-revision",
		"general-ratchet",
	])("%s fails closed without numeric stdout", async (recipe) => {
		const result = await runEvaluator(recipe, await tempDir());
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr.length).toBeGreaterThan(0);
	});

	it("test-amplification fails closed instead of treating a passing test command as a score", async () => {
		const dir = await tempDir();
		await writeFile(
			join(dir, "package.json"),
			'{"name":"fixture","type":"module"}\n',
		);
		await writeFile(
			join(dir, "fixture.test.ts"),
			'import { expect, test } from "bun:test"; test("passes", () => expect(1).toBe(1));\n',
		);

		const result = await runEvaluator("test-amplification", dir);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("configure");
	});

	it("ml-training emits finite scores that depend on the metrics fixture", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "metrics.json"), '{"score":0.25}\n');
		const first = await runEvaluator("ml-training", dir);
		await writeFile(join(dir, "metrics.json"), '{"score":0.75}\n');
		const second = await runEvaluator("ml-training", dir);

		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		expect(expectFiniteNumericScore(first.stdout)).not.toBe(
			expectFiniteNumericScore(second.stdout),
		);
	});

	it("literature-synthesis honestly labels a finite, fixture-sensitive citation-density smoke heuristic", async () => {
		const dir = await tempDir();
		const target = join(dir, "synthesis.md");
		const evaluator = await readFile(
			join(repoRoot, "catalog", "templates", "literature-synthesis", "eval.sh"),
			"utf8",
		);
		expect(evaluator).toContain("Citation-density smoke heuristic only");
		expect(evaluator).toContain(
			"does not validate sources, claims, or semantic",
		);
		await writeFile(target, "A claim without a citation.\n");
		const first = await runEvaluator("literature-synthesis", dir, [target]);
		await writeFile(target, "A supported claim [Source 2025].\n");
		const second = await runEvaluator("literature-synthesis", dir, [target]);

		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		expect(expectFiniteNumericScore(first.stdout)).not.toBe(
			expectFiniteNumericScore(second.stdout),
		);
	});
});
