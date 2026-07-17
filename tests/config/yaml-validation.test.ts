import { expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dir, "../..");

test("all repository YAML source files parse strictly", async () => {
	const yamlFiles = new Bun.Glob("**/*.{yaml,yml}");
	const excludedRoots = new Set([".git", ".slim", "node_modules"]);
	const files = Array.from(
		yamlFiles.scanSync({ cwd: root, dot: true, onlyFiles: false }),
	)
		.filter((path) => !excludedRoots.has(path.split("/")[0] ?? ""))
		.sort();

	expect(files.length).toBeGreaterThan(0);
	expect(files).toContain(".woodpecker.yml");
	expect(files).toContain(".github/ISSUE_TEMPLATE/new-technique.yml");

	const failures: string[] = [];
	for (const path of files) {
		const filePath = join(root, path);
		const stats = await lstat(filePath);
		if (stats.isSymbolicLink() || !stats.isFile()) {
			failures.push(
				`${path}: repository YAML source must be a regular, non-symbolic file`,
			);
			continue;
		}

		const source = await readFile(filePath, "utf8");
		const document = parseDocument(source, { strict: true });
		for (const error of document.errors) {
			failures.push(`${path}: ${error.message}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(`Invalid repository YAML source:\n${failures.join("\n")}`);
	}
});
