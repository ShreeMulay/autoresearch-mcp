/**
 * Tests for database path handling and migration persistence.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	closeDb,
	getActiveDbPath,
	getDb,
	getDbPath,
	resetDb,
} from "../../src/db/schema.js";

let previousDbPath: string | undefined;
let previousXdgDataHome: string | undefined;
let tempDirs: string[] = [];

beforeEach(() => {
	previousDbPath = process.env.AUTORESEARCH_DB_PATH;
	previousXdgDataHome = process.env.XDG_DATA_HOME;
	tempDirs = [];
	closeDb();
});

afterEach(async () => {
	closeDb();
	restoreEnv("AUTORESEARCH_DB_PATH", previousDbPath);
	restoreEnv("XDG_DATA_HOME", previousXdgDataHome);
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
});

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		Reflect.deleteProperty(process.env, key);
		return;
	}

	process.env[key] = value;
}

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "autoresearch-db-"));
	tempDirs.push(dir);
	return dir;
}

describe("database path handling", () => {
	it("keeps :memory: as SQLite in-memory sentinel", () => {
		process.env.AUTORESEARCH_DB_PATH = ":memory:";
		resetDb();

		expect(getDbPath()).toBe(":memory:");
		getDb();
		expect(existsSync(resolve(":memory:"))).toBe(false);
		expect(existsSync(resolve(":memory:-wal"))).toBe(false);
		expect(existsSync(resolve(":memory:-shm"))).toBe(false);
	});

	it("reports the active DB path after connection initialization", () => {
		resetDb(":memory:");
		getDb();

		process.env.AUTORESEARCH_DB_PATH = "/tmp/changed-after-open.db";

		expect(getActiveDbPath()).toBe(":memory:");
	});

	it("defaults to a user data directory outside the package tree", async () => {
		const xdgDataHome = await makeTempDir();
		process.env.XDG_DATA_HOME = xdgDataHome;
		Reflect.deleteProperty(process.env, "AUTORESEARCH_DB_PATH");
		resetDb();

		const dbPath = getDbPath();
		expect(dbPath).toBe(
			join(xdgDataHome, "autoresearch-mcp", "autoresearch.db"),
		);
		expect(dbPath).not.toContain(join("autoresearch-mcp", "data"));

		getDb();
		expect(existsSync(dirname(dbPath))).toBe(true);
		expect(existsSync(dbPath)).toBe(true);
	});

	it("reopens a file-backed DB without duplicating migrations", async () => {
		const tempDir = await makeTempDir();
		const dbPath = join(tempDir, "state", "autoresearch.db");
		process.env.AUTORESEARCH_DB_PATH = dbPath;

		resetDb();
		let db = getDb();
		const firstCount = (
			db.prepare("SELECT COUNT(*) as count FROM _migrations").get() as {
				count: number;
			}
		).count;

		closeDb();
		resetDb();
		db = getDb();
		const secondCount = (
			db.prepare("SELECT COUNT(*) as count FROM _migrations").get() as {
				count: number;
			}
		).count;

		expect(secondCount).toBe(firstCount);
		expect(secondCount).toBeGreaterThanOrEqual(2);
	});
});
