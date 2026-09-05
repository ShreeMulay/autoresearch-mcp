import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Beads repository hardening", () => {
	test("disables daemon use and daemon auto-start", () => {
		const config = read(".beads/config.yaml");
		expect(config).toMatch(/^no-daemon:\s*true\s*(?:#.*)?$/m);
		expect(config).toMatch(/^auto-start-daemon:\s*false\s*(?:#.*)?$/m);
	});

	test("does not configure the Beads merge driver", () => {
		expect(read(".gitattributes")).not.toMatch(/(?:^|\s)merge=beads(?:\s|$)/m);
	});

	test("does not track a Beads-installed Git hook path", () => {
		const tracked = execFileSync("git", ["ls-files", "-z"], {
			cwd: root,
			encoding: "utf8",
		}).split("\0");
		expect(
			tracked.filter((path) =>
				/^(?:\.beads\/hooks|\.git-hooks)(?:\/|$)/.test(path),
			),
		).toEqual([]);
	});

	test("keeps issues JSONL valid with unique IDs", () => {
		const ids = read(".beads/issues.jsonl")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const record: unknown = JSON.parse(line);
				expect(record).toBeObject();
				const id = (record as { id?: unknown }).id;
				expect(typeof id).toBe("string");
				expect(id).not.toBe("");
				return id as string;
			});
		expect(new Set(ids).size).toBe(ids.length);
	});
});
