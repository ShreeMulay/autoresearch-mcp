/**
 * SQLite schema + FTS5 for autoresearch-mcp.
 * Handles catalog storage, experiment tracking, and full-text search.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ExperimentSpecSchema } from "../types.js";

function getDefaultDbPath(): string {
	return join(
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
		"autoresearch-mcp",
		"autoresearch.db",
	);
}

const INITIAL_SCHEMA_SQL = `
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
`;

// ============================================================
// Migrations
// ============================================================

interface Migration {
	version: number;
	name: string;
	sql: string;
	apply?: (db: Database) => void;
}

function migrateLegacyResultSemantics(db: Database): void {
	const experiments = db
		.prepare(
			`SELECT id, spec
			 FROM experiments
			 ORDER BY id`,
		)
		.all() as { id: string; spec: string }[];
	const updateSpec = db.prepare(
		"UPDATE experiments SET spec = $spec WHERE id = $id",
	);
	const updateResult = db.prepare(
		"UPDATE experiment_results SET is_baseline = $is_baseline, improved = $improved WHERE id = $id",
	);
	const updateBestScore = db.prepare(
		"UPDATE experiments SET best_score = $best_score WHERE id = $id",
	);

	for (const experiment of experiments) {
		let spec: unknown;
		try {
			spec = JSON.parse(experiment.spec);
		} catch {
			throw new Error(
				`Cannot migrate experiment ${experiment.id}: invalid spec JSON`,
			);
		}
		let directionMissing = false;
		let candidate = spec;
		if (typeof spec === "object" && spec !== null && !Array.isArray(spec)) {
			directionMissing = !Object.hasOwn(spec, "metric_direction");
			if (directionMissing) {
				candidate = { ...spec, metric_direction: "maximize" };
			}
		}
		const parsed = ExperimentSpecSchema.safeParse(candidate);
		if (!parsed.success) {
			throw new Error(
				`Cannot migrate experiment ${experiment.id}: invalid spec: ${parsed.error.message}`,
			);
		}
		if (directionMissing) {
			updateSpec.run({
				$id: experiment.id,
				$spec: JSON.stringify(parsed.data),
			});
		}
		const direction = parsed.data.metric_direction;

		const results = db
			.prepare(
				"SELECT id, score FROM experiment_results WHERE experiment_id = $experiment_id ORDER BY iteration ASC, id ASC",
			)
			.all({ $experiment_id: experiment.id }) as {
			id: number;
			score: number;
		}[];
		if (results.length === 0) {
			continue;
		}
		const baseline = results[0];
		if (!baseline || !Number.isFinite(baseline.score)) {
			throw new Error(
				`Cannot migrate experiment ${experiment.id}: result scores must be finite numbers`,
			);
		}

		let champion = baseline.score;
		for (const [index, result] of results.entries()) {
			if (!Number.isFinite(result.score)) {
				throw new Error(
					`Cannot migrate experiment ${experiment.id}: result scores must be finite numbers`,
				);
			}
			const improved =
				index > 0 &&
				(direction === "maximize"
					? result.score > champion
					: result.score < champion);
			updateResult.run({
				$id: result.id,
				$improved: improved ? 1 : 0,
				$is_baseline: index === 0 ? 1 : 0,
			});
			if (improved) champion = result.score;
		}
		updateBestScore.run({ $best_score: champion, $id: experiment.id });
	}

	db.exec(`
		UPDATE experiments
		SET
		  total_iterations = (
		    SELECT COUNT(*) FROM experiment_results
		    WHERE experiment_id = experiments.id
		  ),
		  successful_iterations = (
		    SELECT COALESCE(SUM(improved), 0) FROM experiment_results
		    WHERE experiment_id = experiments.id
		  ),
		  cost_tokens = (
		    SELECT COALESCE(SUM(cost_tokens), 0) FROM experiment_results
		    WHERE experiment_id = experiments.id
		  ),
		  cost_dollars = (
		    SELECT COALESCE(SUM(cost_dollars), 0) FROM experiment_results
		    WHERE experiment_id = experiments.id
		  ),
		  cost_wall_seconds = (
		    SELECT COALESCE(SUM(duration_seconds), 0) FROM experiment_results
		    WHERE experiment_id = experiments.id
		  ),
		  best_score = CASE
		    WHEN EXISTS (
		      SELECT 1 FROM experiment_results
		      WHERE experiment_id = experiments.id
		    ) THEN best_score
		    ELSE NULL
		  END
	`);
}

const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "initial_schema",
		sql: INITIAL_SCHEMA_SQL,
	},
	{
		version: 2,
		name: "result_idempotency_and_fts_rebuild",
		sql: `
      DELETE FROM experiment_results
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM experiment_results
        GROUP BY experiment_id, iteration
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_results_experiment_iteration
      ON experiment_results(experiment_id, iteration);

      UPDATE experiments
      SET
        total_iterations = (
          SELECT COUNT(*)
          FROM experiment_results
          WHERE experiment_id = experiments.id
        ),
        successful_iterations = (
          SELECT COALESCE(SUM(improved), 0)
          FROM experiment_results
          WHERE experiment_id = experiments.id
        ),
        cost_tokens = (
          SELECT COALESCE(SUM(cost_tokens), 0)
          FROM experiment_results
          WHERE experiment_id = experiments.id
        ),
        cost_dollars = (
          SELECT COALESCE(SUM(cost_dollars), 0)
          FROM experiment_results
          WHERE experiment_id = experiments.id
        ),
        cost_wall_seconds = (
          SELECT COALESCE(SUM(duration_seconds), 0)
          FROM experiment_results
          WHERE experiment_id = experiments.id
        ),
        best_score = (
          SELECT score
          FROM experiment_results
          WHERE experiment_id = experiments.id AND improved = 1
          ORDER BY iteration DESC, id DESC
          LIMIT 1
        );

      INSERT INTO catalog_fts(catalog_fts) VALUES('rebuild');
    `,
	},
	{
		version: 3,
		name: "result_baseline_semantics",
		sql: `
      ALTER TABLE experiment_results
      ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0;
    `,
		apply: migrateLegacyResultSemantics,
	},
];

let _db: Database | null = null;
let _dbPath: string = getDbPath();

export function getDbPath(): string {
	const configured = process.env.AUTORESEARCH_DB_PATH;

	if (configured === ":memory:") {
		return ":memory:";
	}

	if (configured && configured.trim() !== "") {
		return resolve(configured);
	}

	return getDefaultDbPath();
}

export function getActiveDbPath(): string {
	return _dbPath;
}

export function getDb(): Database {
	if (!_db) {
		ensureDbParent(_dbPath);
		_db = new Database(_dbPath, { create: true });
		_db.exec("PRAGMA busy_timeout = 5000");
		_db.exec("PRAGMA journal_mode = WAL");
		_db.exec("PRAGMA foreign_keys = ON");
		runMigrations(_db);
	}

	return _db;
}

/**
 * Reset the database connection. Used in tests to switch to :memory:.
 * @param path Optional new DB path. Defaults to the configured/default file path.
 */
export function resetDb(path?: string): void {
	if (_db) {
		_db.close();
		_db = null;
	}

	_dbPath = path ?? getDbPath();
}

export function closeDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}

function ensureDbParent(dbPath: string): void {
	if (dbPath === ":memory:") {
		return;
	}

	mkdirSync(dirname(dbPath), { recursive: true });
}

function runMigrations(db: Database): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

	for (const migration of MIGRATIONS) {
		db.exec("BEGIN IMMEDIATE");
		try {
			const alreadyApplied = db
				.prepare("SELECT 1 FROM _migrations WHERE version = $version")
				.get({ $version: migration.version });
			if (alreadyApplied) {
				db.exec("COMMIT");
				continue;
			}

			const sql = migration.sql.trim();
			if (sql) {
				db.exec(sql);
			}
			migration.apply?.(db);

			db.prepare(
				"INSERT INTO _migrations (version, name) VALUES ($version, $name)",
			).run({
				$version: migration.version,
				$name: migration.name,
			});
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
}
