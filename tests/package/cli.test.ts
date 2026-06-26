/**
 * Package/CLI release smoke tests.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import packageJson from "../../package.json";

const repoRoot = resolve(import.meta.dir, "../..");
const tempDirs: string[] = [];

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function runInstallSkillBin(args: string[]) {
	const tempHome = await mkdtemp(join(tmpdir(), "autoresearch-home-"));
	tempDirs.push(tempHome);

	const proc = Bun.spawn(["node", "bin/autoresearch-install-skill", ...args], {
		cwd: repoRoot,
		env: { ...process.env, HOME: tempHome },
		stderr: "pipe",
		stdout: "pipe",
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	return { exitCode, stderr, stdout, tempHome };
}

afterAll(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
});

describe("published package bins", () => {
	it("ships only runtime package content and excludes local artifacts", () => {
		const files = packageJson.files as string[];

		expect(files).toContain("bin/");
		expect(files).toContain("src/");
		expect(files).toContain("catalog/");
		expect(files).toContain("skills/");
		expect(files).toContain("scripts/");
		expect(files).not.toContain("data/");
		expect(files).not.toContain("autoresearch/");
		expect(files).not.toContain("examples/");
		expect(files).not.toContain(".slim/");
	});

	it("uses real executable wrapper files for both public bins", async () => {
		const bins = packageJson.bin as Record<string, string>;

		expect(bins["autoresearch-mcp"]).toBe("./bin/autoresearch-mcp");
		expect(bins["autoresearch-install-skill"]).toBe(
			"./bin/autoresearch-install-skill",
		);

		for (const binPath of Object.values(bins)) {
			const fullPath = join(repoRoot, binPath);
			const contents = await readFile(fullPath, "utf8");
			expect(contents.startsWith("#!")).toBe(true);
			await access(fullPath);
		}
	});

	it("install-skill implementation is valid JavaScript", async () => {
		const proc = Bun.spawn(["node", "--check", "scripts/install-skill.js"], {
			cwd: repoRoot,
			stderr: "pipe",
			stdout: "pipe",
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);
	});

	it("main CLI dispatches install-skill dry-runs without starting the MCP server", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "autoresearch-home-"));
		tempDirs.push(tempHome);

		const proc = Bun.spawn(
			[
				"bun",
				"bin/autoresearch-mcp",
				"install-skill",
				"--dry-run",
				"--target",
				"opencode",
			],
			{
				cwd: repoRoot,
				env: { ...process.env, HOME: tempHome },
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		const [exitCode, stdout] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("[DRY RUN]");
		expect(stdout).toContain("OpenCode");
		expect(stdout).not.toContain("Server running on Stdio transport");
	});

	it("standalone install-skill bin supports dry-run", async () => {
		const proc = Bun.spawn(
			[
				"node",
				"bin/autoresearch-install-skill",
				"--dry-run",
				"--target",
				"claude",
			],
			{
				cwd: repoRoot,
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		const [exitCode, stdout] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("[DRY RUN]");
		expect(stdout).toContain("Claude Code");
	});

	it("standalone install-skill bin rejects unknown options without writes", async () => {
		const { exitCode, stderr, tempHome } = await runInstallSkillBin([
			"--dryrun",
		]);

		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Unknown option: --dryrun");
		expect(await pathExists(join(tempHome, ".opencode", "skills"))).toBe(false);
		expect(await pathExists(join(tempHome, ".claude", "skills"))).toBe(false);
	});

	it("standalone install-skill bin rejects target without a value", async () => {
		const { exitCode, stderr } = await runInstallSkillBin(["--target"]);

		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("--target requires a value");
	});

	it("standalone install-skill bin rejects invalid targets", async () => {
		const { exitCode, stderr } = await runInstallSkillBin([
			"--target",
			"bogus",
		]);

		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("Valid targets: opencode, claude, all");
	});

	it("standalone install-skill bin prints help", async () => {
		const { exitCode, stdout } = await runInstallSkillBin(["--help"]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage");
	});
});

describe("skill installer persistence", () => {
	it("copies skill files into the target directory by default", async () => {
		const tempHome = await mkdtemp(join(tmpdir(), "autoresearch-home-"));
		tempDirs.push(tempHome);

		await mkdir(join(tempHome, ".opencode"), { recursive: true });

		const proc = Bun.spawn(
			["node", "scripts/install-skill.js", "--target", "opencode", "--copy"],
			{
				cwd: repoRoot,
				env: { ...process.env, HOME: tempHome },
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);

		const skillPath = join(
			tempHome,
			".opencode",
			"skills",
			"autoresearch",
			"SKILL.md",
		);
		const skillText = await readFile(skillPath, "utf8");
		expect(skillText).toContain("autoresearch");
		expect(basename(skillPath)).toBe("SKILL.md");
	});
});
