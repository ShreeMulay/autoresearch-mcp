#!/usr/bin/env node
/**
 * Explicit skill installation CLI for autoresearch-mcp.
 *
 * Usage:
 *   npx autoresearch-install-skill [--target <platform>] [--dry-run]
 *   npx autoresearch-mcp install-skill [--target <platform>] [--dry-run]
 *
 * Platforms: opencode, claude, all (default: all)
 * --dry-run: print what would be done without making changes
 */

import { symlink, mkdir, access, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const skillSrc = resolve(__dirname, "../skills/autoresearch");

const PLATFORMS: Record<string, { name: string; dir: string; link: string }> = {
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

function parseArgs(): { target: string; dryRun: boolean } {
	const args = process.argv.slice(2);
	let target = "all";
	let dryRun = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--target" || args[i] === "-t") {
			target = args[i + 1] ?? "all";
			i++;
		} else if (args[i] === "--dry-run" || args[i] === "-d") {
			dryRun = true;
		}
	}

	return { target, dryRun };
}

async function installSkill(): Promise<void> {
	const { target, dryRun } = parseArgs();

	const targets =
		target === "all"
			? Object.values(PLATFORMS)
			: [PLATFORMS[target]].filter(Boolean);

	if (targets.length === 0) {
		console.error(`Unknown target: ${target}`);
		console.error(`Valid targets: ${Object.keys(PLATFORMS).join(", ")}, all`);
		process.exit(1);
	}

	if (dryRun) {
		console.log("[DRY RUN] Would install skill to:");
		for (const t of targets) {
			console.log(`  ${t.name}: ${t.link} -> ${skillSrc}`);
		}
		return;
	}

	console.log("autoresearch-mcp: installing skill...\n");

	let installed = 0;
	let skipped = 0;
	let failed = 0;

	for (const target of targets) {
		try {
			await mkdir(target.dir, { recursive: true });

			// Check if already installed
			try {
				const existing = await readlink(target.link);
				if (existing === skillSrc) {
					console.log(`  [skip] ${target.name}: already linked`);
					skipped++;
					continue;
				}
				console.log(
					`  [skip] ${target.name}: different link exists (${existing})`
				);
				skipped++;
				continue;
			} catch {
				// Not a symlink or doesn't exist — proceed
			}

			// Check if something else exists at the path
			try {
				await access(target.link);
				console.log(
					`  [skip] ${target.name}: file/directory exists at ${target.link}`
				);
				skipped++;
				continue;
			} catch {
				// Path is free — create symlink
			}

			await symlink(skillSrc, target.link, "dir");
			console.log(`  [ok]   ${target.name}: linked ${target.link}`);
			installed++;
		} catch (err) {
			console.log(
				`  [warn] ${target.name}: ${err instanceof Error ? err.message : String(err)}`
			);
			failed++;
		}
	}

	console.log("");
	if (installed > 0) {
		console.log(
			`autoresearch skill installed for ${installed} platform(s). Restart your AI client to load it.`
		);
	} else if (skipped > 0 && failed === 0) {
		console.log("autoresearch skill already installed. No changes needed.");
	}

	if (failed > 0) {
		console.log(
			"\nTo install manually, run one of:\n" +
				`  ln -s ${skillSrc} ~/.opencode/skills/autoresearch\n` +
				`  ln -s ${skillSrc} ~/.claude/skills/autoresearch`
		);
	}
}

installSkill().catch((err) => {
	console.error("Install failed:", err);
	process.exit(1);
});
