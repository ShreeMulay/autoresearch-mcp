/**
 * Tests for SQLite schema migrations.
 */

import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	getExperiment,
	getExperimentResults,
	logExperimentResult,
} from "../../src/db/experiments.js";
import { getDb, resetDb } from "../../src/db/schema.js";

function legacySpec(metricDirection?: "maximize" | "minimize"): string {
	return JSON.stringify({
		target_artifact: "target.md",
		artifact_type: "content",
		mutation_strategy: "LLM edit",
		evaluator_command: "bash eval.sh",
		metric_name: "score",
		...(metricDirection === undefined
			? {}
			: { metric_direction: metricDirection }),
		acceptance_rule: "strict-improvement",
		budget: {},
		environment: {},
		stopping_conditions: ["budget-exhaustion"],
		risk_policy: {
			network_denied: true,
			requires_approval: false,
			sandbox_only: false,
			secrets_denied: true,
		},
		constraints: { metric_ceilings: {}, metric_floors: {} },
	});
}

function createPreV3Database(
	path: string,
	specs: { maximize: string; minimize: string; empty?: string },
): void {
	const db = new Database(path, { create: true });
	db.exec(`
		CREATE TABLE _migrations (
		  version INTEGER PRIMARY KEY,
		  name TEXT NOT NULL,
		  applied_at TEXT DEFAULT (datetime('now'))
		);
		INSERT INTO _migrations(version, name) VALUES
		  (1, 'initial_schema'),
		  (2, 'result_idempotency_and_fts_rebuild');
		CREATE TABLE experiments (
		  id TEXT PRIMARY KEY,
		  spec TEXT NOT NULL,
		  project_path TEXT NOT NULL,
		  project_name TEXT,
		  status TEXT NOT NULL DEFAULT 'scaffolded',
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
		CREATE UNIQUE INDEX idx_results_experiment_iteration
		ON experiment_results(experiment_id, iteration);
	`);
	const insertExperiment = db.prepare(
		`INSERT INTO experiments
		 (id, spec, project_path, best_score, total_iterations,
		  successful_iterations, cost_tokens, cost_dollars, cost_wall_seconds)
		 VALUES ($id, $spec, '/fixture', -999, 99, 99, 999, 999, 999)`,
	);
	insertExperiment.run({ $id: "maximize", $spec: specs.maximize });
	insertExperiment.run({ $id: "minimize", $spec: specs.minimize });
	insertExperiment.run({
		$id: "empty",
		$spec: specs.empty ?? legacySpec("maximize"),
	});
	const insertResult = db.prepare(
		`INSERT INTO experiment_results
		 (experiment_id, iteration, score, improved, change_description,
		  duration_seconds, cost_tokens, cost_dollars)
		 VALUES ($experiment_id, $iteration, $score, $improved, 'legacy',
		  $duration_seconds, $cost_tokens, $cost_dollars)`,
	);
	for (const row of [
		["maximize", 2, 15, 0, 3, 30, 0.3],
		["maximize", 0, 10, 1, 1, 10, 0.1],
		["maximize", 1, 12, 0, 2, 20, 0.2],
		["maximize", 3, 12, 1, null, null, null],
		["minimize", 1, 90, 0, 0.5, 5, 0.05],
		["minimize", 0, 100, 1, 0.25, 2, 0.02],
		["minimize", 2, 95, 1, 0.75, 8, 0.08],
		["minimize", 3, 80, 0, null, null, null],
	] as const) {
		insertResult.run({
			$experiment_id: row[0],
			$iteration: row[1],
			$score: row[2],
			$improved: row[3],
			$duration_seconds: row[4],
			$cost_tokens: row[5],
			$cost_dollars: row[6],
		});
	}
	db.close();
}

beforeEach(() => {
	resetDb(":memory:");
});

describe("Schema migrations", () => {
	it("creates _migrations table on first getDb() call", () => {
		const db = getDb();
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'",
			)
			.all() as { name: string }[];
		expect(tables.length).toBe(1);
		expect(tables[0].name).toBe("_migrations");
	});

	it("records migration v1 in _migrations table", () => {
		const db = getDb();
		const migrations = db
			.prepare("SELECT version, name FROM _migrations ORDER BY version")
			.all() as { version: number; name: string }[];
		expect(migrations.length).toBeGreaterThanOrEqual(1);
		expect(migrations[0].version).toBe(1);
		expect(migrations[0].name).toBe("initial_schema");
	});

	it("is idempotent — re-running getDb() does not duplicate migrations", () => {
		const db1 = getDb();
		const count1 = (
			db1.prepare("SELECT COUNT(*) as count FROM _migrations").get() as {
				count: number;
			}
		).count;

		// Simulate re-opening by resetting and re-getting
		resetDb(":memory:");
		const db2 = getDb();
		const count2 = (
			db2.prepare("SELECT COUNT(*) as count FROM _migrations").get() as {
				count: number;
			}
		).count;

		expect(count2).toBe(count1);
	});

	it("creates all expected tables", () => {
		const db = getDb();
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as { name: string }[];
		const tableNames = tables.map((t) => t.name);

		expect(tableNames).toContain("catalog_items");
		expect(tableNames).toContain("catalog_fts");
		expect(tableNames).toContain("experiments");
		expect(tableNames).toContain("experiment_results");
		expect(tableNames).toContain("technique_outcomes");
		expect(tableNames).toContain("_migrations");
	});

	it("sets WAL journal mode", () => {
		const db = getDb();
		const mode = db.prepare("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		// :memory: databases report "memory" and don't support WAL
		// File-based databases should be "wal"
		expect(["wal", "memory"]).toContain(mode.journal_mode.toLowerCase());
	});

	it("sets busy_timeout to 5000ms", () => {
		const db = getDb();
		const timeout = db.prepare("PRAGMA busy_timeout").get() as {
			timeout: number;
		};
		expect(timeout.timeout).toBe(5000);
	});

	it("sets foreign_keys to ON", () => {
		const db = getDb();
		const fk = db.prepare("PRAGMA foreign_keys").get() as {
			foreign_keys: number;
		};
		expect(fk.foreign_keys).toBe(1);
	});
});

describe("Configurable DB path", () => {
	it("uses AUTORESEARCH_DB_PATH env var when set", async () => {
		const customPath = "/tmp/autoresearch-test.db";
		process.env.AUTORESEARCH_DB_PATH = customPath;

		try {
			resetDb();
			const db = getDb();
			// Verify the DB is at the custom path by checking it exists
			// and can write
			db.prepare("CREATE TABLE IF NOT EXISTS test_env (id INTEGER)").run();
			const tables = db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name='test_env'",
				)
				.all() as { name: string }[];
			expect(tables.length).toBe(1);
		} finally {
			Reflect.deleteProperty(process.env, "AUTORESEARCH_DB_PATH");
			// Clean up
			try {
				const fs = await import("node:fs/promises");
				await fs.unlink(customPath);
			} catch {
				// ignore cleanup errors
			}
		}
	});
});

describe("concurrent migration initialization", () => {
	it("allows two processes to migrate the same new database", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autoresearch-migration-race-"));
		const dbPath = join(dir, "shared.db");
		const schemaUrl = new URL(
			resolve(import.meta.dir, "../../src/db/schema.ts"),
			"file://",
		).href;
		const script = `import { getDb, resetDb } from ${JSON.stringify(schemaUrl)}; resetDb(process.env.TEST_DB); getDb();`;
		try {
			const processes = [0, 1].map(() =>
				Bun.spawn(["bun", "--eval", script], {
					env: { ...process.env, TEST_DB: dbPath },
					stderr: "pipe",
					stdout: "pipe",
				}),
			);
			const results = await Promise.all(
				processes.map(async (process) => ({
					exitCode: await process.exited,
					stderr: await new Response(process.stderr).text(),
				})),
			);

			expect(results).toEqual([
				{ exitCode: 0, stderr: "" },
				{ exitCode: 0, stderr: "" },
			]);
		} finally {
			await rm(dir, { force: true, recursive: true });
		}
	});
});

describe("populated pre-v3 migration", () => {
	it("derives baselines, improvements, and aggregates before accepting new results", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autoresearch-populated-v2-"));
		const dbPath = join(dir, "legacy.db");
		try {
			createPreV3Database(dbPath, {
				// Legacy specs without this field used the schema's maximize default.
				maximize: legacySpec(),
				minimize: legacySpec("minimize"),
			});
			resetDb(dbPath);
			const migrated = getDb();
			const normalizedLegacySpec = JSON.parse(
				(
					migrated
						.prepare("SELECT spec FROM experiments WHERE id = 'maximize'")
						.get() as { spec: string }
				).spec,
			);
			expect(normalizedLegacySpec.metric_direction).toBe("maximize");

			expect(
				getExperimentResults("maximize").map(
					({ iteration, score, is_baseline, improved }) => ({
						iteration,
						score,
						is_baseline,
						improved,
					}),
				),
			).toEqual([
				{ iteration: 0, score: 10, is_baseline: true, improved: false },
				{ iteration: 1, score: 12, is_baseline: false, improved: true },
				{ iteration: 2, score: 15, is_baseline: false, improved: true },
				{ iteration: 3, score: 12, is_baseline: false, improved: false },
			]);
			expect(
				getExperimentResults("minimize").map(
					({ iteration, score, is_baseline, improved }) => ({
						iteration,
						score,
						is_baseline,
						improved,
					}),
				),
			).toEqual([
				{ iteration: 0, score: 100, is_baseline: true, improved: false },
				{ iteration: 1, score: 90, is_baseline: false, improved: true },
				{ iteration: 2, score: 95, is_baseline: false, improved: false },
				{ iteration: 3, score: 80, is_baseline: false, improved: true },
			]);
			expect(getExperiment("maximize")).toMatchObject({
				best_score: 15,
				total_iterations: 4,
				successful_iterations: 2,
				cost_tokens: 60,
				cost_dollars: 0.6,
				cost_wall_seconds: 6,
			});
			expect(getExperiment("minimize")).toMatchObject({
				best_score: 80,
				total_iterations: 4,
				successful_iterations: 2,
				cost_tokens: 15,
				cost_dollars: 0.15,
				cost_wall_seconds: 1.5,
			});
			expect(getExperiment("empty")).toMatchObject({
				best_score: undefined,
				total_iterations: 0,
				successful_iterations: 0,
				cost_tokens: 0,
				cost_dollars: 0,
				cost_wall_seconds: 0,
			});

			logExperimentResult({
				experiment_id: "maximize",
				iteration: 4,
				score: 16,
				change_description: "post-migration",
				cost_tokens: 40,
				cost_dollars: 0.4,
				duration_seconds: 4,
			});
			expect(getExperiment("maximize")).toMatchObject({
				best_score: 16,
				total_iterations: 5,
				successful_iterations: 3,
				cost_tokens: 100,
				cost_dollars: 1,
				cost_wall_seconds: 10,
			});

			resetDb(dbPath);
			const reopened = getDb();
			expect(
				(
					reopened
						.prepare(
							"SELECT COUNT(*) AS count FROM _migrations WHERE version = 3",
						)
						.get() as { count: number }
				).count,
			).toBe(1);
		} finally {
			resetDb(":memory:");
			await rm(dir, { force: true, recursive: true });
		}
	});

	it("rolls back v3 rather than guessing an invalid metric direction", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autoresearch-invalid-v2-"));
		const dbPath = join(dir, "legacy.db");
		try {
			createPreV3Database(dbPath, {
				maximize: JSON.stringify({
					...JSON.parse(legacySpec("maximize")),
					metric_direction: "sideways",
				}),
				minimize: legacySpec("minimize"),
			});
			resetDb(dbPath);
			expect(() => getDb()).toThrow(/metric_direction/i);
			resetDb(":memory:");

			const db = new Database(dbPath);
			expect(
				db.prepare("SELECT 1 FROM _migrations WHERE version = 3").get(),
			).toBeNull();
			expect(
				db
					.prepare("PRAGMA table_info(experiment_results)")
					.all()
					.some(
						(column) => (column as { name: string }).name === "is_baseline",
					),
			).toBe(false);
			db.close();
		} finally {
			resetDb(":memory:");
			await rm(dir, { force: true, recursive: true });
		}
	});

	for (const [label, incompleteSpec] of [
		["explicit valid direction", { metric_direction: "maximize" }],
		["default direction", {}],
	] as const) {
		it(`rolls back v3 for a populated incomplete spec with ${label}`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "autoresearch-incomplete-v2-"));
			const dbPath = join(dir, "legacy.db");
			try {
				createPreV3Database(dbPath, {
					maximize: JSON.stringify(incompleteSpec),
					minimize: legacySpec("minimize"),
				});
				resetDb(dbPath);
				expect(() => getDb()).toThrow(/invalid spec/i);
				resetDb(":memory:");

				const db = new Database(dbPath);
				expect(
					db.prepare("SELECT 1 FROM _migrations WHERE version = 3").get(),
				).toBeNull();
				expect(
					db
						.prepare("PRAGMA table_info(experiment_results)")
						.all()
						.some(
							(column) => (column as { name: string }).name === "is_baseline",
						),
				).toBe(false);
				db.close();
			} finally {
				resetDb(":memory:");
				await rm(dir, { force: true, recursive: true });
			}
		});
	}

	it("rolls back v3 for an invalid experiment without results", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autoresearch-invalid-empty-v2-"));
		const dbPath = join(dir, "legacy.db");
		try {
			createPreV3Database(dbPath, {
				maximize: legacySpec("maximize"),
				minimize: legacySpec("minimize"),
				empty: JSON.stringify({ metric_direction: "maximize" }),
			});
			resetDb(dbPath);
			expect(() => getDb()).toThrow(
				/Cannot migrate experiment empty: invalid spec/i,
			);
			resetDb(":memory:");

			const db = new Database(dbPath);
			expect(
				db.prepare("SELECT 1 FROM _migrations WHERE version = 3").get(),
			).toBeNull();
			expect(
				db
					.prepare("PRAGMA table_info(experiment_results)")
					.all()
					.some(
						(column) => (column as { name: string }).name === "is_baseline",
					),
			).toBe(false);
			db.close();
		} finally {
			resetDb(":memory:");
			await rm(dir, { force: true, recursive: true });
		}
	});
});
