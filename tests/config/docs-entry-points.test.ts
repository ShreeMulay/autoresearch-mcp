/**
 * Honest documentation entry points.
 *
 * `autoresearch-mcp` is not yet published to npm, so every registry-based
 * command in user-facing docs must sit inside an
 * `<!-- after-npm-publication -->` ... `<!-- /after-npm-publication -->`
 * block whose first visible line is the "After npm publication only" caveat,
 * and the README must offer a working install-from-source quick start.
 *
 * NOTE: the 7qa publication closeout must remove these markers (and their
 * caveats) once `autoresearch-mcp` is published and smoke-tested, and must
 * delete or rewrite this test in the same change.
 */

import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

const OPEN_MARKER = "<!-- after-npm-publication -->";
const CLOSE_MARKER = "<!-- /after-npm-publication -->";
const CAVEAT_PREFIX = "> **After npm publication only**";
const CAVEAT_REQUIRED_TEXT = "`autoresearch-mcp` is not yet on npm";

/** Patterns that only work once the package exists on the npm registry. */
const REGISTRY_PATTERNS: RegExp[] = [
	/\bnpx\s+(?:-p\s+|--package[=\s]+)?autoresearch-mcp\b/,
	/\bbunx\s+autoresearch-mcp\b/,
	/\bnpm\s+(?:install|i|add)\s+(?:-g\s+|--global\s+)?autoresearch-mcp\b/,
	/\bbun\s+(?:add|install)\s+(?:-g\s+|--global\s+)?autoresearch-mcp\b/,
	/"(?:bunx|npx)"/,
	/"args"\s*:\s*\[\s*"autoresearch-mcp"/,
	/`bunx`/,
	/npm root -g\)\/autoresearch-mcp/,
	/^\s*autoresearch-mcp\s+install-skill\b/,
];

interface Violation {
	file: string;
	line: number;
	message: string;
}

function checkEntryPoints(file: string, text: string): Violation[] {
	const violations: Violation[] = [];
	const lines = text.split("\n");
	let inBlock = false;
	let blockStart = 0;
	let awaitingCaveat = false;

	lines.forEach((line, index) => {
		const lineNo = index + 1;
		const trimmed = line.trim();

		if (trimmed === OPEN_MARKER) {
			if (inBlock) {
				violations.push({ file, line: lineNo, message: "nested marker block" });
			}
			inBlock = true;
			blockStart = lineNo;
			awaitingCaveat = true;
			return;
		}

		if (trimmed === CLOSE_MARKER) {
			if (!inBlock) {
				violations.push({
					file,
					line: lineNo,
					message: "unmatched close marker",
				});
			} else if (awaitingCaveat) {
				violations.push({
					file,
					line: blockStart,
					message: "marker block has no caveat",
				});
			}
			inBlock = false;
			awaitingCaveat = false;
			return;
		}

		if (inBlock && awaitingCaveat && trimmed !== "") {
			if (
				!trimmed.startsWith(CAVEAT_PREFIX) ||
				!trimmed.includes(CAVEAT_REQUIRED_TEXT)
			) {
				violations.push({
					file,
					line: lineNo,
					message: "first visible line of marker block is not the caveat",
				});
			}
			awaitingCaveat = false;
		}

		if (!inBlock && REGISTRY_PATTERNS.some((pattern) => pattern.test(line))) {
			violations.push({
				file,
				line: lineNo,
				message: `registry command outside an after-npm-publication block: ${trimmed}`,
			});
		}
	});

	if (inBlock) {
		violations.push({
			file,
			line: blockStart,
			message: "unclosed marker block",
		});
	}

	return violations;
}

async function docFiles(): Promise<string[]> {
	const files = ["README.md", "CONTRIBUTING.md"];
	const glob = new Bun.Glob("skills/autoresearch/**/*.md");
	for await (const path of glob.scan({ cwd: repoRoot })) {
		files.push(path);
	}
	return files.sort();
}

describe("documentation entry points", () => {
	it("scans the skill documentation", async () => {
		const files = await docFiles();
		expect(files).toContain("skills/autoresearch/SKILL.md");
		expect(files.length).toBeGreaterThan(3);
	});

	it("keeps every registry command inside a caveated after-npm-publication block", async () => {
		const violations: Violation[] = [];
		for (const file of await docFiles()) {
			const text = await readFile(join(repoRoot, file), "utf8");
			violations.push(...checkEntryPoints(file, text));
		}
		expect(violations).toEqual([]);
	});

	it("README marks at least one registry block", async () => {
		const readme = await readFile(join(repoRoot, "README.md"), "utf8");
		expect(readme).toContain(OPEN_MARKER);
		expect(readme).toContain(CLOSE_MARKER);
	});

	it("README offers a working install-from-source quick start before registry commands", async () => {
		const readme = await readFile(join(repoRoot, "README.md"), "utf8");
		const sourceHeading = "### Install from source (works today)";
		expect(readme).toContain(sourceHeading);
		expect(readme.indexOf(sourceHeading)).toBeLessThan(
			readme.indexOf(OPEN_MARKER),
		);
		expect(readme).toContain("git clone");
		expect(readme).toContain("git checkout <reviewed-commit-or-tag>");
		expect(readme).toContain("bun install --frozen-lockfile");
		expect(readme).toContain('"command": "bun"');
		expect(readme).toContain(
			'"args": ["run", "/absolute/path/to/autoresearch-mcp/src/index.ts"]',
		);
		expect(readme).toContain(
			'"command": ["bun", "run", "/absolute/path/to/autoresearch-mcp/src/index.ts"]',
		);
		expect(readme).toContain(
			"node /absolute/path/to/autoresearch-mcp/bin/autoresearch-install-skill --target opencode",
		);
		expect(readme).toContain(
			"node /absolute/path/to/autoresearch-mcp/bin/autoresearch-install-skill --target claude",
		);
		expect(readme).toMatch(/Bun\]\(https:\/\/bun\.sh\) >= 1\.3\.10/);
		expect(readme).toContain("Node.js 22 and 24");
	});

	describe("checker self-test", () => {
		const caveat = `${CAVEAT_PREFIX} — ${CAVEAT_REQUIRED_TEXT}; these commands will fail until then.`;

		it("flags an unmarked registry command", () => {
			const violations = checkEntryPoints(
				"fixture.md",
				"```bash\nbunx autoresearch-mcp\n```\n",
			);
			expect(violations).toHaveLength(1);
		});

		it("flags an unmarked MCP config using bunx", () => {
			const violations = checkEntryPoints(
				"fixture.md",
				'{ "command": "bunx", "args": ["autoresearch-mcp"] }\n',
			);
			expect(violations.length).toBeGreaterThan(0);
		});

		it("accepts a caveated block", () => {
			const text = [
				OPEN_MARKER,
				caveat,
				"",
				"npx -p autoresearch-mcp autoresearch-install-skill",
				CLOSE_MARKER,
			].join("\n");
			expect(checkEntryPoints("fixture.md", text)).toEqual([]);
		});

		it("rejects a block without the caveat", () => {
			const text = [
				OPEN_MARKER,
				"npm install -g autoresearch-mcp",
				CLOSE_MARKER,
			].join("\n");
			expect(checkEntryPoints("fixture.md", text).length).toBeGreaterThan(0);
		});

		it("rejects an unclosed block", () => {
			const text = [OPEN_MARKER, caveat, "bunx autoresearch-mcp"].join("\n");
			expect(checkEntryPoints("fixture.md", text)).toHaveLength(1);
		});
	});
});
