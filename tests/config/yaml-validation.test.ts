import { expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dir, "../..");

test("all tracked YAML files parse strictly", async () => {
	const tracked = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root });
	expect(tracked.exitCode).toBe(0);

	const files = tracked.stdout
		.toString()
		.split("\0")
		.filter((path) => /\.ya?ml$/i.test(path))
		.sort();

	expect(files.length).toBeGreaterThan(0);

	const failures: string[] = [];
	for (const path of files) {
		const filePath = join(root, path);
		const stats = await lstat(filePath);
		if (stats.isSymbolicLink() || !stats.isFile()) {
			failures.push(
				`${path}: tracked YAML must be a regular, non-symbolic file`,
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
		throw new Error(`Invalid tracked YAML:\n${failures.join("\n")}`);
	}
});
