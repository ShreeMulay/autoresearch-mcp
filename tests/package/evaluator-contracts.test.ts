import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

async function runEvaluator(recipe: string, cwd: string, args: string[] = []) {
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
			env: { ...process.env, PATH: `${fixtureBin}:${process.env.PATH ?? ""}` },
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

	it("literature-synthesis emits finite scores that depend on the document fixture", async () => {
		const dir = await tempDir();
		const target = join(dir, "synthesis.md");
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
