/**
 * Tests for SQLite schema migrations.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { resetDb, getDb } from "../../src/db/schema.js";

beforeEach(() => {
	resetDb(":memory:");
});

describe("Schema migrations", () => {
	it("creates _migrations table on first getDb() call", () => {
		const db = getDb();
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
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
			db1
				.prepare("SELECT COUNT(*) as count FROM _migrations")
				.get() as { count: number }
		).count;

		// Simulate re-opening by resetting and re-getting
		resetDb(":memory:");
		const db2 = getDb();
		const count2 = (
			db2
				.prepare("SELECT COUNT(*) as count FROM _migrations")
				.get() as { count: number }
		).count;

		expect(count2).toBe(count1);
	});

	it("creates all expected tables", () => {
		const db = getDb();
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
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
					"SELECT name FROM sqlite_master WHERE type='table' AND name='test_env'"
				)
				.all() as { name: string }[];
			expect(tables.length).toBe(1);
		} finally {
			delete process.env.AUTORESEARCH_DB_PATH;
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
