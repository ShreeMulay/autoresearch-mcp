import { beforeEach, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	loadCatalog,
	loadCatalogWithDependencies,
} from "../../src/db/load-catalog.js";
import { getDb, resetDb } from "../../src/db/schema.js";
import {
	deleteCatalogItemsNotIn,
	getCatalogItem,
	getCatalogStats,
	searchCatalog,
	upsertCatalogItem,
} from "../../src/db/techniques.js";

const layerDirs = ["strategies", "evaluators", "patterns", "recipes"];
const bundledCatalog = resolve(import.meta.dir, "../../catalog");

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

function catalogSnapshot(): { fts: string; rows: string } {
	const rows = getDb()
		.prepare("SELECT rowid, * FROM catalog_items ORDER BY rowid")
		.all();
	const fts = getDb()
		.prepare("SELECT rowid, * FROM catalog_fts ORDER BY rowid")
		.all();
	return {
		fts: JSON.stringify(fts),
		rows: JSON.stringify(rows),
	};
}

async function copiedBundledCatalog(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "autoresearch-catalog-copy-"));
	await cp(bundledCatalog, dir, { recursive: true });
	return dir;
}

describe("loadCatalog strictness", () => {
	it("rejects duplicate catalog IDs without applying either item", async () => {
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

			await expect(loadCatalog(dir)).rejects.toThrow(
				/duplicate catalog id dup-x/,
			);
			expect(getCatalogStats().total).toBe(0);
			expect(getCatalogItem("dup-x")).toBeNull();
		} finally {
			await cleanup(dir);
		}
	});

	it("rejects files whose declared layer differs from their directory", async () => {
		const dir = await makeCatalogDir();
		try {
			await writeFile(
				join(dir, "strategies", "wrong-layer.yaml"),
				yamlItem("wrong-layer", "recipe"),
			);

			await expect(loadCatalog(dir)).rejects.toThrow(
				/declares layer recipe but is in strategy/,
			);
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

	it("parse errors reject the load and preserve the catalog plus FTS snapshot", async () => {
		await loadCatalog();
		const before = catalogSnapshot();
		const dir = await copiedBundledCatalog();
		try {
			await writeFile(
				join(dir, "strategies", "hill-climbing.yaml"),
				yamlItem("hill-climbing", "strategy").replace(
					"Description",
					"Mutated description",
				),
			);
			await writeFile(
				join(dir, "evaluators", "broken.yaml"),
				"id: [unterminated",
			);

			let rejection: unknown;
			try {
				await loadCatalog(dir);
			} catch (error) {
				rejection = error;
			}

			expect(catalogSnapshot()).toEqual(before);
			expect(rejection).toBeInstanceOf(Error);
		} finally {
			await cleanup(dir);
		}
	});

	it("invalid composition references reject the load and preserve the snapshot", async () => {
		await loadCatalog();
		const before = catalogSnapshot();
		const dir = await copiedBundledCatalog();
		try {
			await writeFile(
				join(dir, "recipes", "broken-reference.yaml"),
				[
					"id: broken-reference",
					"name: Broken Reference",
					"layer: recipe",
					"description: References a missing evaluator",
					"when_to_use: Never",
					"composes:",
					"  search_strategy: hill-climbing",
					"  evaluator: evaluator-that-does-not-exist",
					"  execution_pattern: single-ratchet",
				].join("\n"),
			);

			let rejection: unknown;
			try {
				await loadCatalog(dir);
			} catch (error) {
				rejection = error;
			}

			expect(catalogSnapshot()).toEqual(before);
			expect(rejection).toBeInstanceOf(Error);
		} finally {
			await cleanup(dir);
		}
	});

	it("rejects a missing layer directory", async () => {
		const dir = await makeCatalogDir();
		try {
			await rm(join(dir, "recipes"), { recursive: true });
			await expect(loadCatalog(dir)).rejects.toThrow(
				/directory not found.*recipes/i,
			);
			expect(getCatalogStats().total).toBe(0);
		} finally {
			await cleanup(dir);
		}
	});

	it("requires an explicit string layer", async () => {
		const dir = await makeCatalogDir();
		try {
			await writeFile(
				join(dir, "strategies", "missing-layer.yaml"),
				yamlItem("missing-layer", "strategy").replace("layer: strategy\n", ""),
			);
			await expect(loadCatalog(dir)).rejects.toThrow(
				/must declare a string layer/i,
			);
		} finally {
			await cleanup(dir);
		}
	});

	it("rejects invalid related references", async () => {
		const dir = await makeCatalogDir();
		try {
			await writeFile(
				join(dir, "strategies", "invalid-related.yaml"),
				`${yamlItem("invalid-related", "strategy")}\nrelated:\n  - missing-id`,
			);
			await expect(loadCatalog(dir)).rejects.toThrow(
				/related technique missing-id/i,
			);
		} finally {
			await cleanup(dir);
		}
	});

	it("rejects composition references to the wrong layer", async () => {
		const dir = await makeCatalogDir();
		try {
			await writeFile(
				join(dir, "strategies", "strategy-target.yaml"),
				yamlItem("strategy-target", "strategy"),
			);
			await writeFile(
				join(dir, "recipes", "wrong-composition.yaml"),
				`${yamlItem("wrong-composition", "recipe")}\ncomposes:\n  evaluator: strategy-target`,
			);
			await expect(loadCatalog(dir)).rejects.toThrow(/expected evaluator/i);
		} finally {
			await cleanup(dir);
		}
	});

	it("rolls back catalog and FTS writes when FTS rebuild fails", async () => {
		await loadCatalog();
		const before = catalogSnapshot();
		const dir = await copiedBundledCatalog();
		try {
			await writeFile(
				join(dir, "strategies", "hill-climbing.yaml"),
				yamlItem("hill-climbing", "strategy").replace(
					"Description",
					"Transactional mutation",
				),
			);
			await expect(
				loadCatalogWithDependencies(dir, {
					rebuildFts: () => {
						throw new Error("injected FTS failure");
					},
				}),
			).rejects.toThrow(/injected FTS failure/i);
			expect(catalogSnapshot()).toEqual(before);
		} finally {
			await cleanup(dir);
		}
	});

	it("rolls back the full catalog row and FTS update when an upsert fails", async () => {
		await loadCatalog();
		const before = catalogSnapshot();
		const dir = await copiedBundledCatalog();
		try {
			await writeFile(
				join(dir, "strategies", "hill-climbing.yaml"),
				yamlItem("hill-climbing", "strategy").replace(
					"Description",
					"Injectedupsertrollbacktoken",
				),
			);
			await expect(
				loadCatalogWithDependencies(dir, {
					upsertCatalogItem: (item, hash, rawYaml) => {
						upsertCatalogItem(item, hash, rawYaml);
						throw new Error("injected catalog upsert failure");
					},
				}),
			).rejects.toThrow(/injected catalog upsert failure/i);

			expect(catalogSnapshot()).toEqual(before);
			expect(searchCatalog("injectedupsertrollbacktoken")).toEqual([]);
		} finally {
			await cleanup(dir);
		}
	});

	it("rolls back the full catalog row and FTS deletion when delete fails", async () => {
		await loadCatalog();
		const source = getCatalogItem("hill-climbing");
		if (!source) throw new Error("expected bundled catalog item");
		upsertCatalogItem(
			{
				...source,
				id: "delete-rollback-sentinel",
				name: "Delete Rollback Sentinel",
				description: "Injected delete rollback sentinel",
				related: [],
			},
			"delete-rollback-hash",
			"id: delete-rollback-sentinel",
		);
		const before = catalogSnapshot();

		await expect(
			loadCatalogWithDependencies(bundledCatalog, {
				deleteCatalogItemsNotIn: (ids) => {
					deleteCatalogItemsNotIn(ids);
					throw new Error("injected catalog delete failure");
				},
			}),
		).rejects.toThrow(/injected catalog delete failure/i);

		expect(catalogSnapshot()).toEqual(before);
		expect(
			searchCatalog("delete rollback sentinel").map(({ id }) => id),
		).toContain("delete-rollback-sentinel");
	});
});
