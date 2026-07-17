/**
 * YAML catalog loader with content hashing.
 * Loads YAML files from catalog/ directories into SQLite.
 * Only re-indexes files that have changed (content hash comparison).
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CatalogItemSchema } from "../types.js";
import type { CatalogItem } from "../types.js";
import { getDb } from "./schema.js";
import {
	deleteCatalogItemsNotIn,
	getContentHash,
	rebuildCatalogFts,
	upsertCatalogItem,
} from "./techniques.js";

const CATALOG_ROOT = resolve(import.meta.dir, "../../catalog");

const LAYER_DIRS: Record<string, string> = {
	strategy: "strategies",
	evaluator: "evaluators",
	pattern: "patterns",
	recipe: "recipes",
};

/**
 * Compute a simple content hash using Bun's built-in hashing.
 */
function hashContent(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

/**
 * Load all YAML catalog files into SQLite.
 * Uses content hashing to skip unchanged files.
 */
export async function loadCatalog(catalogDir = CATALOG_ROOT): Promise<{
	loaded: number;
	skipped: number;
	errors: string[];
}> {
	return loadCatalogWithDependencies(catalogDir);
}

export async function loadCatalogWithDependencies(
	catalogDir = CATALOG_ROOT,
	dependencies: {
		upsertCatalogItem?: typeof upsertCatalogItem;
		deleteCatalogItemsNotIn?: typeof deleteCatalogItemsNotIn;
		rebuildFts?: () => void;
	} = {},
): Promise<{ loaded: number; skipped: number; errors: string[] }> {
	const errors: string[] = [];
	const staged: Array<{
		item: CatalogItem;
		hash: string;
		rawYaml: string;
		filePath: string;
	}> = [];
	const filesById = new Map<string, string[]>();

	for (const [layer, dirName] of Object.entries(LAYER_DIRS)) {
		const dirPath = join(catalogDir, dirName);

		let files: string[];
		try {
			files = await readdir(dirPath);
		} catch {
			errors.push(`Directory not found: ${dirPath}`);
			continue;
		}

		const yamlFiles = files
			.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
			.sort();

		for (const file of yamlFiles) {
			const filePath = join(dirPath, file);
			try {
				const content = await Bun.file(filePath).text();
				const hash = hashContent(content);

				// Check if content has changed
				const document = parseYaml(content);
				if (
					typeof document !== "object" ||
					document === null ||
					Array.isArray(document)
				) {
					throw new Error("catalog document must be a YAML mapping");
				}
				const raw = document as Record<string, unknown>;
				const id = typeof raw.id === "string" ? raw.id : "";

				if (!id) {
					errors.push(`Missing 'id' field in ${filePath}`);
					continue;
				}
				filesById.set(id, [...(filesById.get(id) ?? []), filePath]);

				const declaredLayer = raw.layer;
				if (typeof declaredLayer !== "string") {
					errors.push(
						`Catalog item ${id} must declare a string layer matching ${layer}: ${filePath}`,
					);
					continue;
				}
				if (declaredLayer !== layer) {
					errors.push(
						`Catalog item ${id} declares layer ${declaredLayer} but is in ${layer}: ${filePath}`,
					);
					continue;
				}

				// Coerce numeric example results to strings (YAML parses "95" as number)
				if (Array.isArray(raw.examples)) {
					for (const ex of raw.examples) {
						if (typeof ex === "object" && ex !== null && "result" in ex) {
							const e = ex as Record<string, unknown>;
							if (typeof e.result === "number") {
								e.result = String(e.result);
							}
						}
					}
				}

				// Validate and parse
				const parsed = CatalogItemSchema.safeParse(raw);
				if (!parsed.success) {
					errors.push(
						`Validation error in ${filePath}: ${parsed.error.message}`,
					);
					continue;
				}

				staged.push({
					filePath,
					hash,
					item: { ...parsed.data, tags: normalizeTags(parsed.data.tags) },
					rawYaml: content,
				});
			} catch (err) {
				errors.push(
					`Error loading ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	for (const [id, paths] of filesById) {
		if (paths.length > 1) {
			errors.push(`duplicate catalog id ${id} in ${paths.join(", ")}`);
		}
	}

	validateReferences(staged, errors);
	if (errors.length > 0) {
		throw new Error(`Catalog validation failed:\n${errors.join("\n")}`);
	}

	let loaded = 0;
	let skipped = 0;
	const db = getDb();
	db.exec("BEGIN IMMEDIATE");
	try {
		for (const entry of staged) {
			if (getContentHash(entry.item.id) === entry.hash) {
				skipped++;
				continue;
			}
			(dependencies.upsertCatalogItem ?? upsertCatalogItem)(
				entry.item,
				entry.hash,
				entry.rawYaml,
			);
			loaded++;
		}
		(dependencies.deleteCatalogItemsNotIn ?? deleteCatalogItemsNotIn)(
			staged.map(({ item }) => item.id),
		);
		(dependencies.rebuildFts ?? rebuildCatalogFts)();
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}

	return { loaded, skipped, errors: [] };
}

function normalizeTags(tags: string[]): string[] {
	return Array.from(
		new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
	);
}

function validateReferences(
	staged: Array<{ item: CatalogItem; filePath: string }>,
	errors: string[],
): void {
	const itemsById = new Map(staged.map((entry) => [entry.item.id, entry.item]));
	for (const { item, filePath } of staged) {
		for (const relatedId of item.related) {
			if (!itemsById.has(relatedId)) {
				errors.push(
					`${filePath}: related technique ${relatedId} does not exist`,
				);
			}
		}

		const references = [
			["search_strategy", item.composes?.search_strategy, "strategy"],
			["evaluator", item.composes?.evaluator, "evaluator"],
			["execution_pattern", item.composes?.execution_pattern, "pattern"],
		] as const;
		for (const [field, id, expectedLayer] of references) {
			if (!id) continue;
			const target = itemsById.get(id);
			if (!target) {
				errors.push(
					`${filePath}: composition ${field} references missing ${id}`,
				);
			} else if (target.layer !== expectedLayer) {
				errors.push(
					`${filePath}: composition ${field} references ${id} in layer ${target.layer}, expected ${expectedLayer}`,
				);
			}
		}
	}
}

/**
 * Standalone script entry: `bun run src/db/load-catalog.ts`
 */
if (import.meta.main) {
	const result = await loadCatalog();
	console.log(
		`Catalog loaded: ${result.loaded} new/updated, ${result.skipped} unchanged`,
	);
	if (result.errors.length > 0) {
		console.error("Errors:");
		for (const err of result.errors) {
			console.error(`  - ${err}`);
		}
	}
}
