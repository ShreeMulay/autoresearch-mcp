/**
 * Zod-version-agnostic outcome recorder shared by the baseline capture script
 * and the zod 4 compatibility tests. Only `success`, the serialized output
 * string, and issue paths are recorded — never message text.
 */

import { buildExperimentSpec } from "../../../src/tools/experiments.js";
import {
	BudgetSchema,
	CatalogItemSchema,
	ConstraintsSchema,
	ExperimentSpecSchema,
	RecipeId,
	RiskPolicySchema,
	TechniqueSpecSchema,
} from "../../../src/types.js";
import type { BuildCase, SchemaName } from "./cases.js";

interface SafeParser {
	safeParse(input: unknown):
		| { success: true; data: unknown }
		| {
				success: false;
				error: { issues: { path: PropertyKey[] }[] };
		  };
}

export const SCHEMAS: Record<SchemaName, SafeParser> = {
	ExperimentSpecSchema,
	BudgetSchema,
	RiskPolicySchema,
	ConstraintsSchema,
	CatalogItemSchema,
	TechniqueSpecSchema,
	RecipeId,
} as unknown as Record<SchemaName, SafeParser>;

export type Outcome =
	| { success: true; output: string }
	| { success: false; paths: (string | number)[][] };

function normalizePath(path: PropertyKey[]): (string | number)[] {
	return path.map((key) => (typeof key === "symbol" ? String(key) : key));
}

export function outcomeOf(schema: SafeParser, input: unknown): Outcome {
	const result = schema.safeParse(input);
	if (result.success) {
		return { success: true, output: JSON.stringify(result.data) };
	}
	return {
		success: false,
		paths: result.error.issues.map((issue) => normalizePath(issue.path)),
	};
}

export type BuildOutcome =
	| { success: true; output: string }
	| { success: false };

export function buildOutcomeOf(args: BuildCase["args"]): BuildOutcome {
	try {
		return {
			success: true,
			output: JSON.stringify(
				buildExperimentSpec(args as Parameters<typeof buildExperimentSpec>[0]),
			),
		};
	} catch {
		return { success: false };
	}
}
