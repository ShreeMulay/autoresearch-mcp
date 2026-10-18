/**
 * Package/CLI release smoke tests.
 */

import { afterAll, describe, expect, it } from "bun:test";
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
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

async function runMainInstallSkill(args: string[], home?: string) {
	const tempHome =
		home ?? (await mkdtemp(join(tmpdir(), "autoresearch-main-home-")));
	if (!home) tempDirs.push(tempHome);
	const proc = Bun.spawn(
		["bun", "bin/autoresearch-mcp", "install-skill", ...args],
		{
			cwd: repoRoot,
			env: { ...process.env, HOME: tempHome },
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr, stdout };
}

async function runMainCli(args: string[]) {
	const proc = Bun.spawn(["bun", "bin/autoresearch-mcp", ...args], {
		cwd: repoRoot,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr, stdout };
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

		expect(bins["autoresearch-mcp"]).toBe("bin/autoresearch-mcp");
		expect(bins["autoresearch-install-skill"]).toBe(
			"bin/autoresearch-install-skill",
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

	it.each([["unknown-command"], ["--bogus"], ["-x"]])(
		"main CLI rejects unknown top-level input %s with usage",
		async (argument) => {
			const result = await runMainCli([argument]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain(`Unknown command or option: ${argument}`);
			expect(result.stderr).toContain("Usage:");
			expect(result.stdout).not.toContain("Server running on Stdio transport");
		},
	);

	it("standalone install-skill bin supports dry-run without writes", async () => {
		const { exitCode, stdout, tempHome } = await runInstallSkillBin([
			"--dry-run",
			"--target",
			"claude",
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("[DRY RUN]");
		expect(stdout).toContain("Claude Code");
		expect(stdout).toContain(tempHome);
		expect(await pathExists(join(tempHome, ".claude"))).toBe(false);
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

	it.each([
		["unknown flag", ["--dryrun"]],
		["invalid target", ["--target", "bogus"]],
	])(
		"main CLI propagates install-skill %s failure status",
		async (_case, args) => {
			const result = await runMainInstallSkill(args);
			expect(result.exitCode).not.toBe(0);
		},
	);

	it("main CLI propagates a forced installer filesystem failure", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "autoresearch-main-fs-failure-"),
		);
		tempDirs.push(tempRoot);
		const homeFile = join(tempRoot, "home-is-a-file");
		await Bun.write(homeFile, "not a directory");

		const result = await runMainInstallSkill(
			["--target", "opencode"],
			homeFile,
		);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toContain("[warn]");
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

const skillSrc = join(repoRoot, "skills", "autoresearch");

async function makeHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "autoresearch-overwrite-home-"));
	tempDirs.push(home);
	return home;
}

function skillsDir(home: string): string {
	return join(home, ".opencode", "skills");
}

function skillTarget(home: string): string {
	return join(skillsDir(home), "autoresearch");
}

async function runInstaller(
	home: string,
	args: string[],
	extraEnv: Record<string, string> = {},
) {
	// Never inherit a fault injection from the outer environment.
	const inherited = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => key !== "AUTORESEARCH_INSTALL_FAULT",
		),
	);
	const env: Record<string, string | undefined> = {
		...inherited,
		HOME: home,
		...extraEnv,
	};
	const proc = Bun.spawn(
		["node", "bin/autoresearch-install-skill", "--target", "opencode", ...args],
		{ cwd: repoRoot, env, stderr: "pipe", stdout: "pipe" },
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stderr, stdout };
}

async function seedExistingDir(home: string): Promise<string> {
	const target = skillTarget(home);
	await mkdir(target, { recursive: true });
	const marker = join(target, "ORIGINAL.md");
	await writeFile(marker, "original skill");
	return marker;
}

/** Sibling entries other than the target itself (staging/backup leftovers). */
async function leftoverSiblings(home: string): Promise<string[]> {
	const entries = await readdir(skillsDir(home));
	return entries.filter((entry) => entry !== "autoresearch");
}

describe("skill installer safe overwrite", () => {
	it("overwrites an existing directory with a copy and removes the backup", async () => {
		const home = await makeHome();
		const marker = await seedExistingDir(home);

		const result = await runInstaller(home, ["--overwrite", "--copy"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("[ok]");
		expect(await pathExists(marker)).toBe(false);
		const stat = await lstat(skillTarget(home));
		expect(stat.isDirectory()).toBe(true);
		expect(
			await readFile(join(skillTarget(home), "SKILL.md"), "utf8"),
		).toContain("autoresearch");
		expect(await leftoverSiblings(home)).toEqual([]);
	});

	it("overwrites an existing directory with a symlink", async () => {
		const home = await makeHome();
		await seedExistingDir(home);

		const result = await runInstaller(home, ["--overwrite", "--symlink"]);

		expect(result.exitCode).toBe(0);
		const stat = await lstat(skillTarget(home));
		expect(stat.isSymbolicLink()).toBe(true);
		expect(await readlink(skillTarget(home))).toBe(skillSrc);
		expect(await leftoverSiblings(home)).toEqual([]);
	});

	it("overwrites an existing dangling symlink", async () => {
		const home = await makeHome();
		await mkdir(skillsDir(home), { recursive: true });
		await symlink(join(home, "does-not-exist"), skillTarget(home), "dir");

		const result = await runInstaller(home, ["--overwrite", "--copy"]);

		expect(result.exitCode).toBe(0);
		const stat = await lstat(skillTarget(home));
		expect(stat.isDirectory()).toBe(true);
		expect(await pathExists(join(skillTarget(home), "SKILL.md"))).toBe(true);
		expect(await leftoverSiblings(home)).toEqual([]);
	});

	it("skips an existing dangling symlink without --overwrite", async () => {
		const home = await makeHome();
		await mkdir(skillsDir(home), { recursive: true });
		const dangling = join(home, "does-not-exist");
		await symlink(dangling, skillTarget(home), "dir");

		const result = await runInstaller(home, ["--copy"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("[skip]");
		expect(await readlink(skillTarget(home))).toBe(dangling);
	});

	it("preserves the original when staging the copy fails", async () => {
		const home = await makeHome();
		const marker = await seedExistingDir(home);

		const result = await runInstaller(home, ["--overwrite", "--copy"], {
			AUTORESEARCH_INSTALL_FAULT: "copy",
		});

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toContain("injected copy failure");
		expect(await readFile(marker, "utf8")).toBe("original skill");
		expect(await leftoverSiblings(home)).toEqual([]);
	});

	it("restores the original when promotion fails", async () => {
		const home = await makeHome();
		const marker = await seedExistingDir(home);

		for (const mode of ["--copy", "--symlink"]) {
			const result = await runInstaller(home, ["--overwrite", mode], {
				AUTORESEARCH_INSTALL_FAULT: "promote",
			});

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toContain("injected promote failure");
			expect((await lstat(skillTarget(home))).isDirectory()).toBe(true);
			expect(await readFile(marker, "utf8")).toBe("original skill");
			expect(await leftoverSiblings(home)).toEqual([]);
		}
	});

	it("keeps the backup and prints its path when restore also fails", async () => {
		const home = await makeHome();
		await seedExistingDir(home);

		const result = await runInstaller(home, ["--overwrite", "--copy"], {
			AUTORESEARCH_INSTALL_FAULT: "promote,restore",
		});

		expect(result.exitCode).not.toBe(0);
		const leftovers = await leftoverSiblings(home);
		expect(leftovers).toHaveLength(1);
		const backup = join(skillsDir(home), leftovers[0] ?? "");
		expect(leftovers[0]).toContain("backup");
		expect(result.stdout).toContain(backup);
		expect(await readFile(join(backup, "ORIGINAL.md"), "utf8")).toBe(
			"original skill",
		);
		expect(await pathExists(skillTarget(home))).toBe(false);
	});

	it("dry-run with --overwrite writes nothing", async () => {
		const home = await makeHome();
		const marker = await seedExistingDir(home);

		const result = await runInstaller(home, ["--overwrite", "--dry-run"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("[DRY RUN]");
		expect(await readFile(marker, "utf8")).toBe("original skill");
		expect(await leftoverSiblings(home)).toEqual([]);
	});
});
