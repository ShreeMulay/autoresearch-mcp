import { beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "../../src/db/load-catalog.js";
import { resetDb } from "../../src/db/schema.js";
import { getCatalogItem, getCatalogStats } from "../../src/db/techniques.js";

const layerDirs = ["strategies", "evaluators", "patterns", "recipes"];

beforeEach(() => {
	resetDb(":memory:");
});

async function makeCatalogDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "autoresearch-catalog-"));
	await Promise.all(layerDirs.map((layerDir) => mkdir(join(dir, layerDir))));
	return dir;
}

async function cleanup(dir: string): Promise<void> {
	await rm(dir, { force: true, recursive: true });
}

function yamlItem(id: string, layer: string): string {
	return [
		`id: ${id}`,
		`name: ${id}`,
		`layer: ${layer}`,
		`description: Description for ${id}`,
		`when_to_use: Use ${id}`,
	].join("\n");
}

describe("loadCatalog strictness", () => {
	it("reports duplicate catalog IDs and skips the second upsert", async () => {
		const dir = await makeCatalogDir();
		try {
			await writeFile(
				join(dir, "strategies", "one.yaml"),
				yamlItem("dup-x", "strategy"),
			);
			await writeFile(
				join(dir, "strategies", "two.yaml"),
				yamlItem("dup-x", "strategy").replace("Description", "Duplicate"),
			);

			const result = await loadCatalog(dir);

			expect(
				result.errors.some((error) =>
					error.includes("duplicate catalog id dup-x"),
				),
			).toBe(true);
			expect(getCatalogStats().total).toBe(1);
			expect(getCatalogItem("dup-x")?.description).toBe(
				"Description for dup-x",
			);
		} finally {
			await cleanup(dir);
		}
	});

	it("reports files whose declared layer differs from their directory", async () => {
		const dir = await makeCatalogDir();
		try {
			await writeFile(
				join(dir, "strategies", "wrong-layer.yaml"),
				yamlItem("wrong-layer", "recipe"),
			);

			const result = await loadCatalog(dir);

			expect(
				result.errors.some((error) =>
					error.includes("declares layer recipe but is in strategy"),
				),
			).toBe(true);
			expect(getCatalogItem("wrong-layer")).toBeNull();
		} finally {
			await cleanup(dir);
		}
	});

	it("loads the bundled catalog without errors", async () => {
		const result = await loadCatalog();

		expect(result.errors).toEqual([]);
		expect(getCatalogStats().total).toBe(30);
	});
});
