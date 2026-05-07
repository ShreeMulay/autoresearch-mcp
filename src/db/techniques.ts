/**
 * Catalog CRUD operations for techniques stored in SQLite + FTS5.
 */

import { getDb } from "./schema.js";
import type { CatalogItem } from "../types.js";

// Bun's SQLite binding type
type Params = Record<string, string | number | null>;

// ============================================================
// Upsert a catalog item (used by YAML loader)
// ============================================================

export function upsertCatalogItem(
  item: CatalogItem,
  contentHash: string,
  rawYaml: string
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO catalog_items (id, name, layer, description, when_to_use, when_not_to_use, core_pattern, source, tags, related, examples, composes, estimated_cost, experiments_per_hour, requires_gpu, content_hash, raw_yaml, updated_at)
     VALUES ($id, $name, $layer, $description, $when_to_use, $when_not_to_use, $core_pattern, $source, $tags, $related, $examples, $composes, $estimated_cost, $experiments_per_hour, $requires_gpu, $content_hash, $raw_yaml, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       layer = excluded.layer,
       description = excluded.description,
       when_to_use = excluded.when_to_use,
       when_not_to_use = excluded.when_not_to_use,
       core_pattern = excluded.core_pattern,
       source = excluded.source,
       tags = excluded.tags,
       related = excluded.related,
       examples = excluded.examples,
       composes = excluded.composes,
       estimated_cost = excluded.estimated_cost,
       experiments_per_hour = excluded.experiments_per_hour,
       requires_gpu = excluded.requires_gpu,
       content_hash = excluded.content_hash,
       raw_yaml = excluded.raw_yaml,
       updated_at = datetime('now')`
  );
  stmt.run({
    $id: item.id,
    $name: item.name,
    $layer: item.layer,
    $description: item.description,
    $when_to_use: item.when_to_use,
    $when_not_to_use: item.when_not_to_use ?? null,
    $core_pattern: item.core_pattern ?? null,
    $source: item.source ?? null,
    $tags: JSON.stringify(item.tags),
    $related: JSON.stringify(item.related),
    $examples: JSON.stringify(item.examples),
    $composes: item.composes ? JSON.stringify(item.composes) : null,
    $estimated_cost: item.estimated_cost ?? null,
    $experiments_per_hour: item.experiments_per_hour ?? null,
    $requires_gpu: item.requires_gpu ? 1 : 0,
    $content_hash: contentHash,
    $raw_yaml: rawYaml,
  } as Params);
}

// ============================================================
// Get a catalog item by ID
// ============================================================

export function getCatalogItem(id: string): CatalogItem | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM catalog_items WHERE id = $id")
    .get({ $id: id } as Params) as Record<string, unknown> | null;

  if (!row) return null;
  return rowToCatalogItem(row);
}

// ============================================================
// List catalog items with optional filters
// ============================================================

export function listCatalogItems(filters?: {
  layer?: string;
  tags?: string[];
  limit?: number;
}): CatalogItem[] {
  const db = getDb();
  let sql = "SELECT * FROM catalog_items WHERE 1=1";
  const params: Record<string, unknown> = {};

  if (filters?.layer) {
    sql += " AND layer = $layer";
    params.$layer = filters.layer;
  }

  if (filters?.tags?.length) {
    for (let i = 0; i < filters.tags.length; i++) {
      sql += ` AND tags LIKE $tag${i}`;
      params[`$tag${i}`] = `%"${filters.tags[i]}"%`;
    }
  }

  sql += " ORDER BY layer, name";

  if (filters?.limit) {
    sql += " LIMIT $limit";
    params.$limit = filters.limit;
  }

  const rows = db.prepare(sql).all(params as Params) as Record<string, unknown>[];
  return rows.map(rowToCatalogItem);
}

// ============================================================
// Full-text search using FTS5
// ============================================================

export function searchCatalog(
  query: string,
  options?: { layer?: string; limit?: number }
): CatalogItem[] {
  const db = getDb();
  const limit = options?.limit ?? 10;

  // Sanitize query for FTS5 — escape special chars, wrap words with OR
  // FTS5 special chars that can break MATCH: " * ( ) AND OR NOT NEAR ^ - ~
  const sanitized = query
    .replace(/["*()^~\-]/g, " ")
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(" OR ");

  if (!sanitized) {
    return listCatalogItems({ layer: options?.layer, limit });
  }

  // Build FTS5 query — add layer filter if provided
  let sql = `
    SELECT ci.*, rank
    FROM catalog_fts fts
    JOIN catalog_items ci ON ci.rowid = fts.rowid
    WHERE catalog_fts MATCH $query
  `;
  const params: Params = { $query: sanitized };

  if (options?.layer) {
    sql += " AND ci.layer = $layer";
    params.$layer = options.layer;
  }

  sql += " ORDER BY rank LIMIT $limit";
  params.$limit = limit;

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
  return rows.map(rowToCatalogItem);
}

// ============================================================
// Get content hash for a catalog item (for change detection)
// ============================================================

export function getContentHash(id: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT content_hash FROM catalog_items WHERE id = $id")
    .get({ $id: id } as Params) as { content_hash: string } | null;
  return row?.content_hash ?? null;
}

// ============================================================
// Get catalog stats
// ============================================================

export function getCatalogStats(): {
  total: number;
  by_layer: Record<string, number>;
} {
  const db = getDb();
  const total = (
    db.prepare("SELECT COUNT(*) as count FROM catalog_items").get() as {
      count: number;
    }
  ).count;

  const layers = db
    .prepare(
      "SELECT layer, COUNT(*) as count FROM catalog_items GROUP BY layer"
    )
    .all() as { layer: string; count: number }[];

  const by_layer: Record<string, number> = {};
  for (const row of layers) {
    by_layer[row.layer] = row.count;
  }

  return { total, by_layer };
}

// ============================================================
// Helper: convert DB row to CatalogItem
// ============================================================

function rowToCatalogItem(row: Record<string, unknown>): CatalogItem {
  return {
    id: row.id as string,
    name: row.name as string,
    layer: row.layer as CatalogItem["layer"],
    description: row.description as string,
    when_to_use: row.when_to_use as string,
    when_not_to_use: (row.when_not_to_use as string) ?? undefined,
    core_pattern: (row.core_pattern as string) ?? undefined,
    source: (row.source as string) ?? undefined,
    tags: JSON.parse((row.tags as string) || "[]"),
    related: JSON.parse((row.related as string) || "[]"),
    examples: JSON.parse((row.examples as string) || "[]"),
    composes: row.composes ? JSON.parse(row.composes as string) : undefined,
    estimated_cost: (row.estimated_cost as string) ?? undefined,
    experiments_per_hour: (row.experiments_per_hour as number) ?? undefined,
    requires_gpu: Boolean(row.requires_gpu),
  };
}
