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
 *
 * Overwrite never deletes the existing target before its replacement is
 * ready: new content is staged in a unique sibling path, the existing target
 * is renamed to a unique sibling backup, the staged content is renamed into
 * place, and only then is the backup removed. On promotion failure the backup
 * is restored. This protects against ordinary failures; it is not
 * crash-atomic (a crash between renames can leave a staging or backup path).
 */

import { randomUUID } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	readlink,
	rename,
	rm,
	symlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const skillSrc = resolve(__dirname, "../skills/autoresearch");

const USAGE = `Usage:
  npx -p autoresearch-mcp autoresearch-install-skill [--target <platform>] [--dry-run]
  autoresearch-mcp install-skill [--target <platform>] [--dry-run]

Options:
  --target, -t <platform>  Install for opencode, claude, or all (default: all)
  --dry-run, -d            Print what would be done without making changes
  --overwrite              Replace an existing skill directory/link
  --symlink                Create a symlink instead of copying files
  --copy                   Copy files instead of creating a symlink
  --help, -h               Show this help message`;

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
	let help = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === "--target" || arg === "-t") {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("-")) {
				return {
					error: "--target requires a value (opencode, claude, all)",
					ok: false,
				};
			}

			target = value;
			i++;
		} else if (arg === "--dry-run" || arg === "-d") {
			dryRun = true;
		} else if (arg === "--overwrite") {
			overwrite = true;
		} else if (arg === "--symlink") {
			mode = "symlink";
		} else if (arg === "--copy") {
			mode = "copy";
		} else if (arg === "--help" || arg === "-h") {
			help = true;
		} else {
			return { error: `Unknown option: ${arg}`, ok: false };
		}
	}

	return { ok: true, opts: { dryRun, help, mode, overwrite, target } };
}

function getTargets(target) {
	if (target === "all") {
		return Object.values(PLATFORMS);
	}

	return [PLATFORMS[target]].filter(Boolean);
}

/**
 * True if anything (including a dangling symlink) exists at `path`.
 * Uses lstat so symlinks are inspected without following them.
 */
async function entryExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (err) {
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			err.code === "ENOENT"
		) {
			return false;
		}
		throw err;
	}
}

/**
 * Test-only fault seam. AUTORESEARCH_INSTALL_FAULT may contain a
 * comma-separated list of: "copy" (fail while staging), "promote" (fail
 * moving staged content into place), "restore" (fail restoring the backup).
 */
function faultEnabled(stage) {
	const raw = process.env.AUTORESEARCH_INSTALL_FAULT;
	if (!raw) return false;
	return raw
		.split(",")
		.map((value) => value.trim())
		.includes(stage);
}

function injectFault(stage) {
	if (faultEnabled(stage)) {
		throw new Error(`injected ${stage} failure (AUTORESEARCH_INSTALL_FAULT)`);
	}
}

function uniqueSibling(target, label) {
	return join(
		dirname(target),
		`.autoresearch.${label}-${process.pid}-${randomUUID()}`,
	);
}

async function stageContent(mode, staging) {
	if (mode === "symlink") {
		await symlink(skillSrc, staging, "dir");
	} else {
		await cp(skillSrc, staging, { recursive: true });
	}
	injectFault("copy");
}

/**
 * Stage the skill beside `target` and promote it, keeping any existing target
 * as a backup until the replacement is in place.
 */
async function replaceTarget(mode, target, hasExisting) {
	const staging = uniqueSibling(target, "staging");
	try {
		await stageContent(mode, staging);
	} catch (err) {
		await rm(staging, { force: true, recursive: true }).catch(() => {});
		throw err;
	}

	if (!hasExisting) {
		try {
			injectFault("promote");
			await rename(staging, target);
		} catch (err) {
			await rm(staging, { force: true, recursive: true }).catch(() => {});
			throw err;
		}
		return;
	}

	const backup = uniqueSibling(target, "backup");
	try {
		await rename(target, backup);
	} catch (err) {
		await rm(staging, { force: true, recursive: true }).catch(() => {});
		throw err;
	}

	try {
		injectFault("promote");
		await rename(staging, target);
	} catch (err) {
		await rm(staging, { force: true, recursive: true }).catch(() => {});
		try {
			injectFault("restore");
			await rename(backup, target);
		} catch (restoreErr) {
			console.log(
				`  [warn] could not restore the original skill (${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}); it is preserved at ${backup}`,
			);
		}
		throw err;
	}

	try {
		await rm(backup, { force: true, recursive: true });
	} catch (err) {
		console.log(
			`  [warn] installed, but could not remove backup ${backup}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export async function installSkill(argv = process.argv.slice(2)) {
	const parsed = parseArgs(argv);
	if (!parsed.ok) {
		console.error(parsed.error);
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}

	const { dryRun, help, mode, overwrite, target } = parsed.opts;
	if (help) {
		console.log(USAGE);
		process.exitCode = 0;
		return;
	}

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

			const hasExisting = await entryExists(currentTarget.link);
			if (hasExisting) {
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
			}

			await replaceTarget(mode, currentTarget.link, hasExisting);

			if (mode === "symlink") {
				console.log(
					`  [ok]   ${currentTarget.name}: linked ${currentTarget.link}`,
				);
			} else {
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
