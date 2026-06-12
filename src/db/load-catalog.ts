/**
 * YAML catalog loader with content hashing.
 * Loads YAML files from catalog/ directories into SQLite.
 * Only re-indexes files that have changed (content hash comparison).
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CatalogItemSchema } from "../types.js";
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
	let loaded = 0;
	let skipped = 0;
	const errors: string[] = [];
	const seenIds = new Set<string>();

	// Ensure DB is initialized
	getDb();

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
				const raw = parseYaml(content) as Record<string, unknown>;
				const id = raw.id as string;

				if (!id) {
					errors.push(`Missing 'id' field in ${filePath}`);
					continue;
				}
				if (seenIds.has(id)) {
					errors.push(`duplicate catalog id ${id} in ${filePath}`);
					continue;
				}

				const declaredLayer = raw.layer;
				if (typeof declaredLayer === "string" && declaredLayer !== layer) {
					errors.push(
						`Catalog item ${id} declares layer ${declaredLayer} but is in ${layer}: ${filePath}`,
					);
					continue;
				}
				seenIds.add(id);

				const existingHash = getContentHash(id);
				if (existingHash === hash) {
					skipped++;
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
				const parsed = CatalogItemSchema.safeParse({ ...raw, layer });
				if (!parsed.success) {
					errors.push(
						`Validation error in ${filePath}: ${parsed.error.message}`,
					);
					continue;
				}

				// Upsert into DB
				upsertCatalogItem(parsed.data, hash, content);
				loaded++;
			} catch (err) {
				errors.push(
					`Error loading ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	if (errors.length === 0) {
		deleteCatalogItemsNotIn(Array.from(seenIds));
	}
	rebuildCatalogFts();

	return { loaded, skipped, errors };
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
