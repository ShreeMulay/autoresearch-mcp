/**
 * SQLite schema + FTS5 for autoresearch-mcp.
 * Handles catalog storage, experiment tracking, and full-text search.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_DB_PATH = resolve(import.meta.dir, "../../data/autoresearch.db");

function getDbPath(): string {
  if (process.env.AUTORESEARCH_DB_PATH) {
    return resolve(process.env.AUTORESEARCH_DB_PATH);
  }
  return DEFAULT_DB_PATH;
}

let _db: Database | null = null;
let _dbPath: string = getDbPath();

export function getDb(): Database {
  if (!_db) {
    _db = new Database(_dbPath, { create: true });
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    _db.exec("PRAGMA busy_timeout = 5000");
    initSchema(_db);
    runMigrations(_db);
  }
  return _db;
}

/**
 * Reset the database connection. Used in tests to switch to :memory:.
 * @param path Optional new DB path. Defaults to the standard file path.
 */
export function resetDb(path?: string): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  _dbPath = path ?? getDbPath();
}

// ============================================================
// Migrations
// ============================================================

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `SELECT 1;`,
  },
];

function runMigrations(db: Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get current version
  const currentVersion = (
    db
      .prepare("SELECT MAX(version) as version FROM _migrations")
      .get() as { version: number | null }
  ).version ?? 0;

  // Apply pending migrations
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      const sql = migration.sql.trim();
      if (sql) {
        db.exec(sql);
      }
      db
        .prepare(
          "INSERT INTO _migrations (version, name) VALUES ($version, $name)"
        )
        .run({
          $version: migration.version,
          $name: migration.name,
        });
    }
  }
}

function initSchema(db: Database): void {
	db.exec(`
    -- Catalog items (techniques from all 4 layers)
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      layer TEXT NOT NULL CHECK(layer IN ('strategy', 'evaluator', 'pattern', 'recipe')),
      description TEXT NOT NULL,
      when_to_use TEXT NOT NULL,
      when_not_to_use TEXT,
      core_pattern TEXT,
      source TEXT,
      tags TEXT DEFAULT '[]',
      related TEXT DEFAULT '[]',
      examples TEXT DEFAULT '[]',
      composes TEXT,
      estimated_cost TEXT,
      experiments_per_hour REAL,
      requires_gpu INTEGER DEFAULT 0,
      content_hash TEXT NOT NULL,
      raw_yaml TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- FTS5 virtual table for full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
      id,
      name,
      layer,
      description,
      when_to_use,
      when_not_to_use,
      core_pattern,
      tags,
      content=catalog_items,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS catalog_ai AFTER INSERT ON catalog_items BEGIN
      INSERT INTO catalog_fts(rowid, id, name, layer, description, when_to_use, when_not_to_use, core_pattern, tags)
      VALUES (new.rowid, new.id, new.name, new.layer, new.description, new.when_to_use, new.when_not_to_use, new.core_pattern, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS catalog_ad AFTER DELETE ON catalog_items BEGIN
      INSERT INTO catalog_fts(catalog_fts, rowid, id, name, layer, description, when_to_use, when_not_to_use, core_pattern, tags)
      VALUES ('delete', old.rowid, old.id, old.name, old.layer, old.description, old.when_to_use, old.when_not_to_use, old.core_pattern, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS catalog_au AFTER UPDATE ON catalog_items BEGIN
      INSERT INTO catalog_fts(catalog_fts, rowid, id, name, layer, description, when_to_use, when_not_to_use, core_pattern, tags)
      VALUES ('delete', old.rowid, old.id, old.name, old.layer, old.description, old.when_to_use, old.when_not_to_use, old.core_pattern, old.tags);
      INSERT INTO catalog_fts(rowid, id, name, layer, description, when_to_use, when_not_to_use, core_pattern, tags)
      VALUES (new.rowid, new.id, new.name, new.layer, new.description, new.when_to_use, new.when_not_to_use, new.core_pattern, new.tags);
    END;

    -- Experiments (Phase 1+)
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      spec TEXT NOT NULL,
      project_path TEXT NOT NULL,
      project_name TEXT,
      status TEXT NOT NULL DEFAULT 'scaffolded'
        CHECK(status IN ('scaffolded', 'running', 'paused', 'completed', 'failed')),
      best_score REAL,
      total_iterations INTEGER DEFAULT 0,
      successful_iterations INTEGER DEFAULT 0,
      cost_tokens INTEGER DEFAULT 0,
      cost_dollars REAL DEFAULT 0,
      cost_wall_seconds REAL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Experiment results (iteration-level)
    CREATE TABLE IF NOT EXISTS experiment_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id TEXT NOT NULL REFERENCES experiments(id),
      iteration INTEGER NOT NULL,
      score REAL NOT NULL,
      improved INTEGER NOT NULL DEFAULT 0,
      change_description TEXT NOT NULL,
      duration_seconds REAL,
      cost_tokens INTEGER,
      cost_dollars REAL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Technique outcomes (meta-learning)
    CREATE TABLE IF NOT EXISTS technique_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      technique_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      project_name TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'partial', 'failed', 'abandoned')),
      notes TEXT,
      score_improvement REAL,
      total_experiments INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_catalog_layer ON catalog_items(layer);
    CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
    CREATE INDEX IF NOT EXISTS idx_results_experiment ON experiment_results(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_outcomes_technique ON technique_outcomes(technique_id);
  `);
}

export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}
