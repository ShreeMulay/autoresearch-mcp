/**
 * Experiment CRUD operations for SQLite.
 */

import {
	type Experiment,
	type ExperimentResult,
	type ExperimentSpec,
	ExperimentSpecSchema,
	type ExperimentStatus,
} from "../types.js";
import { getDb } from "./schema.js";

type Params = Record<string, string | number | null>;

// ============================================================
// Create / Register an experiment
// ============================================================

export function createExperiment(exp: {
	id: string;
	spec: string | ExperimentSpec;
	project_path: string;
	project_name?: string;
	status?: string;
}): void {
	const db = getDb();
	const spec = parseExperimentSpec(exp.spec);
	db.prepare(
		`INSERT INTO experiments (id, spec, project_path, project_name, status, created_at, updated_at)
     VALUES ($id, $spec, $project_path, $project_name, $status, datetime('now'), datetime('now'))`,
	).run({
		$id: exp.id,
		$spec: JSON.stringify(spec),
		$project_path: exp.project_path,
		$project_name: exp.project_name ?? null,
		$status: exp.status ?? "scaffolded",
	} as Params);
}

// ============================================================
// Get experiment by ID
// ============================================================

export function getExperiment(id: string): Experiment | null {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM experiments WHERE id = $id")
		.get({ $id: id } as Params) as Record<string, unknown> | null;
	if (!row) return null;
	return rowToExperiment(row);
}

// ============================================================
// List experiments with optional filters
// ============================================================

export function listExperiments(filters?: {
	status?: string;
	project?: string;
	limit?: number;
}): Experiment[] {
	const db = getDb();
	let sql = "SELECT * FROM experiments WHERE 1=1";
	const params: Params = {};

	if (filters?.status) {
		sql += " AND status = $status";
		params.$status = filters.status;
	}
	if (filters?.project) {
		sql += " AND (project_name LIKE $project OR project_path LIKE $project)";
		params.$project = `%${filters.project}%`;
	}

	sql += " ORDER BY updated_at DESC";

	if (filters?.limit) {
		sql += " LIMIT $limit";
		params.$limit = filters.limit;
	}

	const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
	return rows.map(rowToExperiment);
}

// ============================================================
// Update experiment status and fields
// ============================================================

export function updateExperiment(
	id: string,
	updates: {
		status?: ExperimentStatus;
		notes?: string;
	},
): boolean {
	const db = getDb();
	db.exec("BEGIN IMMEDIATE");
	try {
		const existing = getExperiment(id);
		if (!existing) {
			db.exec("COMMIT");
			return false;
		}
		const setClauses: string[] = ["updated_at = datetime('now')"];
		const params: Params = { $id: id };

		if (updates.status !== undefined) {
			assertStatusTransition(existing.status, updates.status);
			setClauses.push("status = $status");
			params.$status = updates.status;
			if (updates.status === "running" && existing.started_at === undefined) {
				setClauses.push("started_at = datetime('now')");
			}
			if (
				(updates.status === "completed" || updates.status === "failed") &&
				existing.completed_at === undefined
			) {
				setClauses.push("completed_at = datetime('now')");
			}
		}
		if (updates.notes !== undefined) {
			setClauses.push("notes = $notes");
			params.$notes = updates.notes;
		}

		const sql = `UPDATE experiments SET ${setClauses.join(", ")} WHERE id = $id`;
		const changed = db.prepare(sql).run(params).changes > 0;
		db.exec("COMMIT");
		return changed;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

// ============================================================
// Log a single experiment iteration result
// ============================================================

export function logExperimentResult(result: {
	experiment_id: string;
	iteration: number;
	score: number;
	improved?: boolean;
	is_baseline?: boolean;
	change_description: string;
	duration_seconds?: number;
	cost_tokens?: number;
	cost_dollars?: number;
	metadata?: Record<string, unknown>;
}): ExperimentResult {
	const db = getDb();
	assertFiniteNonnegative("duration_seconds", result.duration_seconds);
	assertFiniteNonnegative("cost_tokens", result.cost_tokens);
	assertFiniteNonnegative("cost_dollars", result.cost_dollars);
	if (!Number.isInteger(result.iteration) || result.iteration < 0) {
		throw new Error("iteration must be a nonnegative integer");
	}
	if (!Number.isFinite(result.score)) {
		throw new Error("score must be finite");
	}
	assertFiniteMetadata(result.metadata);

	db.exec("BEGIN IMMEDIATE");
	try {
		const experiment = getExperiment(result.experiment_id);
		if (!experiment) {
			throw new Error(`Experiment not found: ${result.experiment_id}`);
		}
		db.prepare(
			`INSERT INTO experiment_results (experiment_id, iteration, score, improved, is_baseline, change_description, duration_seconds, cost_tokens, cost_dollars, metadata, created_at)
       VALUES ($experiment_id, $iteration, $score, $improved, $is_baseline, $change_description, $duration_seconds, $cost_tokens, $cost_dollars, $metadata, datetime('now'))
       ON CONFLICT(experiment_id, iteration) DO UPDATE SET
         score = excluded.score,
         improved = excluded.improved,
         is_baseline = excluded.is_baseline,
         change_description = excluded.change_description,
         duration_seconds = excluded.duration_seconds,
         cost_tokens = excluded.cost_tokens,
         cost_dollars = excluded.cost_dollars,
         metadata = excluded.metadata`,
		).run({
			$experiment_id: result.experiment_id,
			$iteration: result.iteration,
			$score: result.score,
			$improved: 0,
			$is_baseline: result.is_baseline ? 1 : 0,
			$change_description: result.change_description,
			$duration_seconds: result.duration_seconds ?? null,
			$cost_tokens: result.cost_tokens ?? null,
			$cost_dollars: result.cost_dollars ?? null,
			$metadata: result.metadata ? JSON.stringify(result.metadata) : null,
		} as Params);

		const ordered = getAllExperimentResults(result.experiment_id);
		const baselineResults = ordered.filter((entry) => entry.is_baseline);
		if (baselineResults.length !== 1) {
			throw new Error(
				"Before logging candidates, log exactly one earlier result with is_baseline=true",
			);
		}
		const baseline = baselineResults[0];
		if (
			ordered.some(
				(entry) => !entry.is_baseline && entry.iteration <= baseline.iteration,
			)
		) {
			throw new Error(
				"The baseline must be earlier than every candidate result",
			);
		}

		let champion = baseline.score;
		let assertedImprovement: boolean | undefined;
		const updateImprovement = db.prepare(
			"UPDATE experiment_results SET improved = $improved WHERE id = $id",
		);
		for (const entry of ordered) {
			let improved = false;
			if (!entry.is_baseline) {
				assertWithinMetricBounds(experiment.spec, entry.score);
				improved = isBetter(
					entry.score,
					champion,
					experiment.spec.metric_direction,
				);
				if (improved) champion = entry.score;
			}
			updateImprovement.run({
				$id: entry.id ?? null,
				$improved: improved ? 1 : 0,
			} as Params);
			if (entry.iteration === result.iteration) assertedImprovement = improved;
		}

		if (
			result.improved !== undefined &&
			result.improved !== assertedImprovement
		) {
			throw new Error(
				`Improved assertion ${result.improved} does not match server-derived value ${assertedImprovement}`,
			);
		}

		refreshExperimentAggregates(result.experiment_id, champion);

		const row = db
			.prepare(
				"SELECT * FROM experiment_results WHERE experiment_id = $experiment_id AND iteration = $iteration",
			)
			.get({
				$experiment_id: result.experiment_id,
				$iteration: result.iteration,
			} as Params) as Record<string, unknown>;
		const logged = rowToExperimentResult(row);

		db.exec("COMMIT");
		return logged;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

// ============================================================
// Get results for an experiment
// ============================================================

export function getExperimentResults(
	experimentId: string,
	limit = 200,
): ExperimentResult[] {
	const db = getDb();
	const sql =
		"SELECT * FROM experiment_results WHERE experiment_id = $experiment_id ORDER BY iteration ASC LIMIT $limit";
	const params: Params = {
		$experiment_id: experimentId,
		$limit: Math.max(1, Math.trunc(limit)),
	};

	const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
	return rows.map((r) => ({
		id: r.id as number,
		experiment_id: r.experiment_id as string,
		iteration: r.iteration as number,
		score: r.score as number,
		improved: Boolean(r.improved),
		is_baseline: Boolean(r.is_baseline),
		change_description: r.change_description as string,
		duration_seconds: (r.duration_seconds as number) ?? undefined,
		cost_tokens: (r.cost_tokens as number) ?? undefined,
		cost_dollars: (r.cost_dollars as number) ?? undefined,
		metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
		created_at: (r.created_at as string) ?? undefined,
	}));
}

function assertFiniteNonnegative(
	field: string,
	value: number | undefined,
): void {
	if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
		throw new Error(`${field} must be nonnegative and finite`);
	}
}

function assertFiniteMetadata(value: unknown, seen = new Set<object>()): void {
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new Error("metadata numbers must be finite");
	}
	if (typeof value !== "object" || value === null) return;
	if (seen.has(value)) return;
	seen.add(value);
	for (const entry of Array.isArray(value) ? value : Object.values(value)) {
		assertFiniteMetadata(entry, seen);
	}
}

// ============================================================
// Helper: row to Experiment
// ============================================================

function parseExperimentSpec(spec: string | ExperimentSpec): ExperimentSpec {
	let raw: unknown = spec;

	if (typeof spec === "string") {
		try {
			raw = JSON.parse(spec);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid experiment spec JSON: ${message}`);
		}
	}

	const parsed = ExperimentSpecSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Invalid experiment spec: ${parsed.error.message}`);
	}

	return parsed.data;
}

function refreshExperimentAggregates(
	experimentId: string,
	championScore?: number,
): void {
	const db = getDb();
	const totals = db
		.prepare(
			`SELECT
        COUNT(*) as total_iterations,
        COALESCE(SUM(improved), 0) as successful_iterations,
        COALESCE(SUM(cost_tokens), 0) as cost_tokens,
        COALESCE(SUM(cost_dollars), 0) as cost_dollars,
        COALESCE(SUM(duration_seconds), 0) as cost_wall_seconds
       FROM experiment_results
       WHERE experiment_id = $experiment_id`,
		)
		.get({ $experiment_id: experimentId } as Params) as {
		cost_dollars: number;
		cost_tokens: number;
		cost_wall_seconds: number;
		successful_iterations: number;
		total_iterations: number;
	};

	db.prepare(
		`UPDATE experiments SET
      best_score = $best_score,
      total_iterations = $total_iterations,
      successful_iterations = $successful_iterations,
      cost_tokens = $cost_tokens,
      cost_dollars = $cost_dollars,
      cost_wall_seconds = $cost_wall_seconds,
      updated_at = datetime('now')
     WHERE id = $experiment_id`,
	).run({
		$best_score: championScore ?? null,
		$cost_dollars: totals.cost_dollars,
		$cost_tokens: totals.cost_tokens,
		$cost_wall_seconds: totals.cost_wall_seconds,
		$experiment_id: experimentId,
		$successful_iterations: totals.successful_iterations,
		$total_iterations: totals.total_iterations,
	} as Params);
}

function getAllExperimentResults(experimentId: string): ExperimentResult[] {
	const rows = getDb()
		.prepare(
			"SELECT * FROM experiment_results WHERE experiment_id = $experiment_id ORDER BY iteration ASC, id ASC",
		)
		.all({ $experiment_id: experimentId } as Params) as Record<
		string,
		unknown
	>[];
	return rows.map(rowToExperimentResult);
}

function rowToExperimentResult(row: Record<string, unknown>): ExperimentResult {
	return {
		id: row.id as number,
		experiment_id: row.experiment_id as string,
		iteration: row.iteration as number,
		score: row.score as number,
		improved: Boolean(row.improved),
		is_baseline: Boolean(row.is_baseline),
		change_description: row.change_description as string,
		duration_seconds: (row.duration_seconds as number) ?? undefined,
		cost_tokens: (row.cost_tokens as number) ?? undefined,
		cost_dollars: (row.cost_dollars as number) ?? undefined,
		metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
		created_at: (row.created_at as string) ?? undefined,
	};
}

function isBetter(
	score: number,
	champion: number,
	direction: ExperimentSpec["metric_direction"],
): boolean {
	return direction === "maximize" ? score > champion : score < champion;
}

function assertWithinMetricBounds(spec: ExperimentSpec, score: number): void {
	const floor = spec.constraints.metric_floors[spec.metric_name];
	const ceiling = spec.constraints.metric_ceilings[spec.metric_name];
	if (floor !== undefined && score < floor) {
		throw new Error(`Score ${score} is below metric floor ${floor}`);
	}
	if (ceiling !== undefined && score > ceiling) {
		throw new Error(`Score ${score} exceeds metric ceiling ${ceiling}`);
	}
}

function assertStatusTransition(current: string, next: string): void {
	if (current === next) return;
	const transitions: Record<string, readonly string[]> = {
		scaffolded: ["running", "failed"],
		running: ["paused", "completed", "failed"],
		paused: ["running", "completed", "failed"],
		completed: [],
		failed: [],
	};
	if (!transitions[current]?.includes(next)) {
		throw new Error(
			`Invalid experiment status transition: ${current} -> ${next}`,
		);
	}
}

function rowToExperiment(row: Record<string, unknown>): Experiment {
	const spec = parseExperimentSpec(row.spec as string);

	return {
		id: row.id as string,
		spec,
		project_path: row.project_path as string,
		project_name: (row.project_name as string) ?? undefined,
		status: row.status as Experiment["status"],
		best_score: (row.best_score as number) ?? undefined,
		total_iterations: (row.total_iterations as number) ?? 0,
		successful_iterations: (row.successful_iterations as number) ?? 0,
		cost_tokens: (row.cost_tokens as number) ?? 0,
		cost_dollars: (row.cost_dollars as number) ?? 0,
		cost_wall_seconds: (row.cost_wall_seconds as number) ?? 0,
		started_at: (row.started_at as string) ?? undefined,
		completed_at: (row.completed_at as string) ?? undefined,
		notes: (row.notes as string) ?? undefined,
		created_at: row.created_at as string,
		updated_at: row.updated_at as string,
	};
}
