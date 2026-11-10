import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const manifest = JSON.parse(
	readFileSync(join(ROOT, "package.json"), "utf8"),
) as {
	dependencies: Record<string, string>;
	resolutions: Record<string, string>;
};
const smoke = readFileSync(join(ROOT, "ci/package-smoke.sh"), "utf8");

const EXPECTED_FLOORS: Record<string, string> = {
	"@hono/node-server": "2.1.6",
	"body-parser": "2.4.0",
	"fast-uri": "3.1.9",
	hono: "4.13.17",
	"ip-address": "10.7.6",
	qs: "6.16.1",
};

function smokeFloors(): Record<string, string> {
	const match = /const floors = (\{[^\n]*\});/.exec(smoke);
	if (!match?.[1]) throw new Error("package-smoke floors map not found");
	return JSON.parse(match[1].replace(/([{,]\s*)([a-z-]+):/g, '$1"$2":'));
}

describe("dependency floors", () => {
	it("pins this repository's graph with resolutions", () => {
		expect(manifest.resolutions).toEqual(EXPECTED_FLOORS);
	});

	it("asserts the same floors plus zod in the fresh consumer install", () => {
		expect(smokeFloors()).toEqual({ ...EXPECTED_FLOORS, zod: "4.6.7" });
		expect(smoke).toContain("npm audit --omit=dev");
		expect(smoke).toContain("scanInstalled(");
	});

	it("depends on zod 4 directly and no longer on zod-to-json-schema", () => {
		expect(manifest.dependencies.zod).toBe("^4.6.7");
		expect(manifest.dependencies["zod-to-json-schema"]).toBeUndefined();
	});

	it("never imports the vulnerable zod/v3 compatibility subpath", () => {
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) walk(path);
				else if (
					/\.ts$/.test(entry.name) &&
					/from\s+["']zod\/v3["']/.test(readFileSync(path, "utf8"))
				) {
					offenders.push(path);
				}
			}
		};
		walk(join(ROOT, "src"));
		expect(offenders).toEqual([]);
	});
});
