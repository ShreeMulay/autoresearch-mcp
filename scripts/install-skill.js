#!/usr/bin/env node
/**
 * Explicit skill installation CLI for autoresearch-mcp.
 *
 * Usage:
 *   npx -p autoresearch-mcp autoresearch-install-skill [--target <platform>] [--dry-run]
 *   autoresearch-mcp install-skill [--target <platform>] [--dry-run]
 *
 * Platforms: opencode, claude, all (default: all)
 * --dry-run: print what would be done without making changes
 * --overwrite: replace an existing skill directory/link
 * --symlink: create a symlink instead of copying files
 */

import { access, cp, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const skillSrc = resolve(__dirname, "../skills/autoresearch");

const PLATFORMS = {
	opencode: {
		name: "OpenCode",
		dir: join(homedir(), ".opencode", "skills"),
		link: join(homedir(), ".opencode", "skills", "autoresearch"),
	},
	claude: {
		name: "Claude Code",
		dir: join(homedir(), ".claude", "skills"),
		link: join(homedir(), ".claude", "skills", "autoresearch"),
	},
};

function parseArgs(argv = process.argv.slice(2)) {
	let target = "all";
	let dryRun = false;
	let overwrite = false;
	let mode = "copy";

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--target" || argv[i] === "-t") {
			target = argv[i + 1] ?? "all";
			i++;
		} else if (argv[i] === "--dry-run" || argv[i] === "-d") {
			dryRun = true;
		} else if (argv[i] === "--overwrite") {
			overwrite = true;
		} else if (argv[i] === "--symlink") {
			mode = "symlink";
		} else if (argv[i] === "--copy") {
			mode = "copy";
		}
	}

	return { dryRun, mode, overwrite, target };
}

function getTargets(target) {
	if (target === "all") {
		return Object.values(PLATFORMS);
	}

	return [PLATFORMS[target]].filter(Boolean);
}

async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function installSkill(argv = process.argv.slice(2)) {
	const { dryRun, mode, overwrite, target } = parseArgs(argv);
	const targets = getTargets(target);

	if (targets.length === 0) {
		console.error(`Unknown target: ${target}`);
		console.error(`Valid targets: ${Object.keys(PLATFORMS).join(", ")}, all`);
		process.exitCode = 1;
		return;
	}

	if (dryRun) {
		console.log(`[DRY RUN] Would install skill using ${mode} mode:`);
		for (const currentTarget of targets) {
			console.log(
				`  ${currentTarget.name}: ${currentTarget.link} <- ${skillSrc}`,
			);
		}
		return;
	}

	console.log("autoresearch-mcp: installing skill...\n");

	let installed = 0;
	let skipped = 0;
	let failed = 0;

	for (const currentTarget of targets) {
		try {
			await mkdir(currentTarget.dir, { recursive: true });

			if (await pathExists(currentTarget.link)) {
				if (!overwrite) {
					try {
						const existing = await readlink(currentTarget.link);
						if (existing === skillSrc) {
							console.log(`  [skip] ${currentTarget.name}: already linked`);
						} else {
							console.log(
								`  [skip] ${currentTarget.name}: existing path at ${currentTarget.link}`,
							);
						}
					} catch {
						console.log(
							`  [skip] ${currentTarget.name}: existing path at ${currentTarget.link}`,
						);
					}
					skipped++;
					continue;
				}

				await rm(currentTarget.link, { force: true, recursive: true });
			}

			if (mode === "symlink") {
				await symlink(skillSrc, currentTarget.link, "dir");
				console.log(
					`  [ok]   ${currentTarget.name}: linked ${currentTarget.link}`,
				);
			} else {
				await cp(skillSrc, currentTarget.link, { recursive: true });
				console.log(
					`  [ok]   ${currentTarget.name}: copied ${currentTarget.link}`,
				);
			}

			installed++;
		} catch (err) {
			console.log(
				`  [warn] ${currentTarget.name}: ${err instanceof Error ? err.message : String(err)}`,
			);
			failed++;
		}
	}

	console.log("");
	if (installed > 0) {
		console.log(
			`autoresearch skill installed for ${installed} platform(s). Restart your AI client to load it.`,
		);
	} else if (skipped > 0 && failed === 0) {
		console.log("autoresearch skill already installed. No changes needed.");
	}

	if (failed > 0) {
		console.log(
			"\nTo install manually, copy the bundled skill directory to one of:\n" +
				"  ~/.opencode/skills/autoresearch\n" +
				"  ~/.claude/skills/autoresearch",
		);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	installSkill().catch((err) => {
		console.error("Install failed:", err);
		process.exit(1);
	});
}
