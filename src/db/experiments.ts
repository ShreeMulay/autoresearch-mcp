/**
 * Experiment CRUD operations for SQLite.
 */

import { getDb } from "./schema.js";
import type { Experiment, ExperimentResult } from "../types.js";

type Params = Record<string, string | number | null>;

// ============================================================
// Create / Register an experiment
// ============================================================

export function createExperiment(exp: {
  id: string;
  spec: string; // JSON stringified ExperimentSpec
  project_path: string;
  project_name?: string;
  status?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO experiments (id, spec, project_path, project_name, status, created_at, updated_at)
     VALUES ($id, $spec, $project_path, $project_name, $status, datetime('now'), datetime('now'))`
  ).run({
    $id: exp.id,
    $spec: exp.spec,
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
    status?: string;
    best_score?: number;
    total_iterations?: number;
    successful_iterations?: number;
    cost_tokens?: number;
    cost_dollars?: number;
    cost_wall_seconds?: number;
    started_at?: string;
    completed_at?: string;
    notes?: string;
  }
): boolean {
  const db = getDb();
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: Params = { $id: id };

  if (updates.status !== undefined) {
    setClauses.push("status = $status");
    params.$status = updates.status;
  }
  if (updates.best_score !== undefined) {
    setClauses.push("best_score = $best_score");
    params.$best_score = updates.best_score;
  }
  if (updates.total_iterations !== undefined) {
    setClauses.push("total_iterations = $total_iterations");
    params.$total_iterations = updates.total_iterations;
  }
  if (updates.successful_iterations !== undefined) {
    setClauses.push("successful_iterations = $successful_iterations");
    params.$successful_iterations = updates.successful_iterations;
  }
  if (updates.cost_tokens !== undefined) {
    setClauses.push("cost_tokens = $cost_tokens");
    params.$cost_tokens = updates.cost_tokens;
  }
  if (updates.cost_dollars !== undefined) {
    setClauses.push("cost_dollars = $cost_dollars");
    params.$cost_dollars = updates.cost_dollars;
  }
  if (updates.cost_wall_seconds !== undefined) {
    setClauses.push("cost_wall_seconds = $cost_wall_seconds");
    params.$cost_wall_seconds = updates.cost_wall_seconds;
  }
  if (updates.started_at !== undefined) {
    setClauses.push("started_at = $started_at");
    params.$started_at = updates.started_at;
  }
  if (updates.completed_at !== undefined) {
    setClauses.push("completed_at = $completed_at");
    params.$completed_at = updates.completed_at;
  }
  if (updates.notes !== undefined) {
    setClauses.push("notes = $notes");
    params.$notes = updates.notes;
  }

  const sql = `UPDATE experiments SET ${setClauses.join(", ")} WHERE id = $id`;
  const result = db.prepare(sql).run(params);
  return result.changes > 0;
}

// ============================================================
// Log a single experiment iteration result
// ============================================================

export function logExperimentResult(result: {
  experiment_id: string;
  iteration: number;
  score: number;
  improved: boolean;
  change_description: string;
  duration_seconds?: number;
  cost_tokens?: number;
  cost_dollars?: number;
  metadata?: Record<string, unknown>;
}): number {
  const db = getDb();

  const stmt = db.prepare(
    `INSERT INTO experiment_results (experiment_id, iteration, score, improved, change_description, duration_seconds, cost_tokens, cost_dollars, metadata, created_at)
     VALUES ($experiment_id, $iteration, $score, $improved, $change_description, $duration_seconds, $cost_tokens, $cost_dollars, $metadata, datetime('now'))`
  );
  const insertResult = stmt.run({
    $experiment_id: result.experiment_id,
    $iteration: result.iteration,
    $score: result.score,
    $improved: result.improved ? 1 : 0,
    $change_description: result.change_description,
    $duration_seconds: result.duration_seconds ?? null,
    $cost_tokens: result.cost_tokens ?? null,
    $cost_dollars: result.cost_dollars ?? null,
    $metadata: result.metadata ? JSON.stringify(result.metadata) : null,
  } as Params);

  // Update experiment aggregates
  const exp = getExperiment(result.experiment_id);
  if (exp) {
    const newTotal = exp.total_iterations + 1;
    const newSuccessful = exp.successful_iterations + (result.improved ? 1 : 0);
    const newBest =
      result.improved && (exp.best_score === undefined || exp.best_score === null)
        ? result.score
        : result.improved && exp.best_score !== undefined && exp.best_score !== null
          ? result.score
          : exp.best_score;

    updateExperiment(result.experiment_id, {
      total_iterations: newTotal,
      successful_iterations: newSuccessful,
      best_score: newBest ?? undefined,
      cost_tokens: exp.cost_tokens + (result.cost_tokens ?? 0),
      cost_dollars: exp.cost_dollars + (result.cost_dollars ?? 0),
      cost_wall_seconds: exp.cost_wall_seconds + (result.duration_seconds ?? 0),
    });
  }

  return insertResult.lastInsertRowid as number;
}

// ============================================================
// Get results for an experiment
// ============================================================

export function getExperimentResults(
  experimentId: string,
  limit?: number
): ExperimentResult[] {
  const db = getDb();
  let sql =
    "SELECT * FROM experiment_results WHERE experiment_id = $experiment_id ORDER BY iteration ASC";
  const params: Params = { $experiment_id: experimentId };

  if (limit) {
    sql += " LIMIT $limit";
    params.$limit = limit;
  }

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    experiment_id: r.experiment_id as string,
    iteration: r.iteration as number,
    score: r.score as number,
    improved: Boolean(r.improved),
    change_description: r.change_description as string,
    duration_seconds: (r.duration_seconds as number) ?? undefined,
    cost_tokens: (r.cost_tokens as number) ?? undefined,
    cost_dollars: (r.cost_dollars as number) ?? undefined,
    metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
    created_at: (r.created_at as string) ?? undefined,
  }));
}

// ============================================================
// Log technique outcome (meta-learning)
// ============================================================

export function logTechniqueOutcome(outcome: {
  technique_id: string;
  domain: string;
  project_name?: string;
  outcome: string;
  notes?: string;
  score_improvement?: number;
  total_experiments?: number;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO technique_outcomes (technique_id, domain, project_name, outcome, notes, score_improvement, total_experiments, created_at)
       VALUES ($technique_id, $domain, $project_name, $outcome, $notes, $score_improvement, $total_experiments, datetime('now'))`
    )
    .run({
      $technique_id: outcome.technique_id,
      $domain: outcome.domain,
      $project_name: outcome.project_name ?? null,
      $outcome: outcome.outcome,
      $notes: outcome.notes ?? null,
      $score_improvement: outcome.score_improvement ?? null,
      $total_experiments: outcome.total_experiments ?? null,
    } as Params);
  return result.lastInsertRowid as number;
}

// ============================================================
// Helper: row to Experiment
// ============================================================

function rowToExperiment(row: Record<string, unknown>): Experiment {
  return {
    id: row.id as string,
    spec: JSON.parse(row.spec as string),
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
