#!/usr/bin/env node
/**
 * Post-install script: optionally symlink the autoresearch skill
 * to the user's skill directories for OpenCode and Claude Code.
 *
 * Idempotent: skips if already installed.
 * Non-blocking: warns but does not error on permission issues.
 */

import { symlink, mkdir, access, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const skillSrc = resolve(__dirname, "../skills/autoresearch");

const targets = [
	{
		name: "OpenCode",
		dir: join(homedir(), ".opencode", "skills"),
		link: join(homedir(), ".opencode", "skills", "autoresearch"),
	},
	{
		name: "Claude Code",
		dir: join(homedir(), ".claude", "skills"),
		link: join(homedir(), ".claude", "skills", "autoresearch"),
	},
];

async function installSkill() {
	console.log("autoresearch-mcp: checking skill installation...\n");

	let installed = 0;
	let skipped = 0;
	let failed = 0;

	for (const target of targets) {
		try {
			// Ensure parent directory exists
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
		console.log(
			"autoresearch skill already installed. No changes needed."
		);
	}

	if (failed > 0) {
		console.log(
			"\nTo install manually, run one of:\n" +
				`  ln -s ${skillSrc} ~/.opencode/skills/autoresearch\n` +
				`  ln -s ${skillSrc} ~/.claude/skills/autoresearch`
		);
	}
}

installSkill().catch(() => {
	// Silently ignore top-level errors — install should never block npm install
});
