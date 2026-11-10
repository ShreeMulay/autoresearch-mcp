/**
 * Synthetic pre-migration-3 database builder for persisted-data compatibility
 * tests. Mirrors the experiments/experiment_results tables created by
 * migration 1 plus migration 2's unique index, records migrations 1 and 2 as
 * applied, and leaves migrations 3 and 4 for the real runner.
 */

import { Database } from "bun:sqlite";
import type { LegacyRow } from "./zod3-baseline/cases.js";

const LEGACY_SQL = `
  CREATE TABLE _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO _migrations (version, name, applied_at) VALUES
    (1, 'initial_schema', '2026-01-01 00:00:00'),
    (2, 'result_idempotency_and_fts_rebuild', '2026-01-01 00:00:00');
  CREATE TABLE experiments (
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
  CREATE TABLE experiment_results (
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
  CREATE INDEX idx_experiments_status ON experiments(status);
  CREATE INDEX idx_results_experiment ON experiment_results(experiment_id);
  CREATE UNIQUE INDEX idx_results_experiment_iteration
    ON experiment_results(experiment_id, iteration);
`;

const FIXED_TIME = "2026-01-02 03:04:05";

export function createLegacyDatabase(path: string, rows: LegacyRow[]): void {
	const db = new Database(path, { create: true });
	try {
		db.exec(LEGACY_SQL);
		const insertExperiment = db.prepare(
			`INSERT INTO experiments (id, spec, project_path, status, created_at, updated_at)
			 VALUES ($id, $spec, '/tmp/project', 'running', $time, $time)`,
		);
		const insertResult = db.prepare(
			`INSERT INTO experiment_results
			   (experiment_id, iteration, score, improved, change_description, created_at)
			 VALUES ($experiment_id, $iteration, $score, $improved, 'change', $time)`,
		);
		for (const row of rows) {
			insertExperiment.run({ $id: row.id, $spec: row.spec, $time: FIXED_TIME });
			for (const result of row.results ?? []) {
				insertResult.run({
					$experiment_id: row.id,
					$iteration: result.iteration,
					$score: result.score,
					$improved: result.improved,
					$time: FIXED_TIME,
				});
			}
		}
	} finally {
		db.close();
	}
}

export interface DatabaseState {
	migrated: boolean;
	storedSpecs?: Record<string, string>;
	experiments?: Record<string, string | null>;
	results?: Record<string, string>;
	getExperimentErrors?: string[];
}

export interface DatabaseSnapshot {
	firstOpen: DatabaseState;
	reopen: DatabaseState;
}

async function readState(
	path: string,
	rows: LegacyRow[],
): Promise<DatabaseState> {
	const schema = await import("../../src/db/schema.js");
	const experiments = await import("../../src/db/experiments.js");
	schema.resetDb(path);
	try {
		let db: ReturnType<typeof schema.getDb>;
		try {
			db = schema.getDb();
		} catch {
			return { migrated: false };
		}
		const storedSpecs: Record<string, string> = {};
		for (const row of db
			.prepare("SELECT id, spec FROM experiments ORDER BY id")
			.all() as { id: string; spec: string }[]) {
			storedSpecs[row.id] = row.spec;
		}
		const normalized: Record<string, string | null> = {};
		const results: Record<string, string> = {};
		const getExperimentErrors: string[] = [];
		for (const row of rows) {
			try {
				normalized[row.id] = JSON.stringify(experiments.getExperiment(row.id));
			} catch {
				normalized[row.id] = null;
				getExperimentErrors.push(row.id);
			}
			results[row.id] = JSON.stringify(
				db
					.prepare(
						"SELECT iteration, score, improved, is_baseline FROM experiment_results WHERE experiment_id = $id ORDER BY iteration",
					)
					.all({ $id: row.id }),
			);
		}
		return {
			migrated: true,
			storedSpecs,
			experiments: normalized,
			results,
			getExperimentErrors,
		};
	} finally {
		schema.closeDb();
	}
}

/** Open (running real migrations), read, close, reopen, and read again. */
export async function snapshotDatabase(
	path: string,
	rows: LegacyRow[],
): Promise<DatabaseSnapshot> {
	const firstOpen = await readState(path, rows);
	const reopen = await readState(path, rows);
	return { firstOpen, reopen };
}
