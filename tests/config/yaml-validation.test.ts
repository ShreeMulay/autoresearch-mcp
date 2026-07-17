import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
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
		.filter(
			(path) =>
				!path
					.split("/")
					.some((part) => [".git", ".slim", "node_modules"].includes(part)),
		)
		.sort();

	expect(files.length).toBeGreaterThan(0);

	const failures: string[] = [];
	for (const path of files) {
		const source = await readFile(join(root, path), "utf8");
		const document = parseDocument(source, { strict: true });
		for (const error of document.errors) {
			failures.push(`${path}: ${error.message}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(`Invalid tracked YAML:\n${failures.join("\n")}`);
	}
});
