/**
 * zod 4 compatibility oracle: compares the live schemas against the fixtures
 * captured from the zod 3.25.76 code (tests/fixtures/zod3-baseline/).
 * Normalizations are defined and documented in normalize.ts (N1–N5) and in
 * `normalizePaths` below (N6). Nothing else is ignored.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { closeDb, resetDb } from "../../src/db/schema.js";
import { main } from "../../src/index.js";
import zodToJsonSchema from "../../src/schemas/zod-to-json.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { registerExperimentTools } from "../../src/tools/experiments.js";
import { registerScaffoldingTools } from "../../src/tools/scaffolding.js";
import {
	BudgetSchema,
	ExperimentSpecSchema,
	StoredBudgetSchema,
	StoredExperimentSpecSchema,
} from "../../src/types.js";
import buildBaseline from "../fixtures/zod3-baseline/build-cases.json";
import { BUILD_CASES, PARSE_CASES } from "../fixtures/zod3-baseline/cases.js";
import { normalizeSchema } from "../fixtures/zod3-baseline/normalize.js";
import {
	type BuildOutcome,
	type Outcome,
	SCHEMAS,
	buildOutcomeOf,
	outcomeOf,
} from "../fixtures/zod3-baseline/outcomes.js";
import parseBaseline from "../fixtures/zod3-baseline/parse-cases.json";
import resourceBaseline from "../fixtures/zod3-baseline/resources.json";
import toolsBaseline from "../fixtures/zod3-baseline/tools-list.json";

const parseFixtures = parseBaseline as Record<string, Outcome>;
const buildFixtures = buildBaseline as Record<string, BuildOutcome>;

/** Approved difference: zod 4 `.int()` rejects new input above MAX_SAFE_INTEGER. */
const isApprovedUnsafeInteger = (name: string): boolean =>
	/(2\*\*53|1e300)/.test(name) &&
	(name.startsWith("spec budget.") || name.startsWith("BudgetSchema "));

/** Locations where the approved narrowing shows up as `maximum` in schemas. */
const BUDGET_INT_MAXIMA = [
	"#/properties/budget/properties/max_iterations",
	"#/properties/budget/properties/max_tokens",
];

/**
 * N6: collapse consecutive duplicate issue paths. zod 3 reported one issue per
 * failed check on the same value (e.g. Infinity failed both `.finite()` and
 * `.int()`); zod 4 reports a single issue at the same path. The set and order
 * of distinct paths must still match exactly.
 */
function normalizePaths(paths: (string | number)[][]): string[] {
	const out: string[] = [];
	for (const path of paths) {
		const key = JSON.stringify(path);
		if (out.at(-1) !== key) out.push(key);
	}
	return out;
}

function expectSameOutcome(actual: Outcome, expected: Outcome): void {
	expect(actual.success).toBe(expected.success);
	if (actual.success && expected.success) {
		expect(actual.output).toBe(expected.output);
	} else if (!actual.success && !expected.success) {
		expect(normalizePaths(actual.paths)).toEqual(
			normalizePaths(expected.paths),
		);
	}
}

describe("zod 3 baseline: parse outcomes", () => {
	it("covers every recorded case", () => {
		expect(PARSE_CASES.map((c) => c.name).sort()).toEqual(
			Object.keys(parseFixtures).sort(),
		);
	});

	for (const testCase of PARSE_CASES) {
		const expected = parseFixtures[testCase.name] as Outcome;
		if (isApprovedUnsafeInteger(testCase.name)) {
			it(`${testCase.name}: rejected for new input, preserved for stored specs`, () => {
				expect(expected.success).toBe(true);
				const strict = outcomeOf(SCHEMAS[testCase.schema], testCase.input);
				expect(strict.success).toBe(false);
				if (!strict.success) {
					expect(strict.paths).toHaveLength(1);
					expect(String(strict.paths[0]?.at(-1))).toMatch(
						/^max_(iterations|tokens)$/,
					);
				}
				const stored =
					testCase.schema === "BudgetSchema"
						? StoredBudgetSchema
						: StoredExperimentSpecSchema;
				expectSameOutcome(outcomeOf(stored, testCase.input), expected);
			});
			continue;
		}
		it(testCase.name, () => {
			expectSameOutcome(
				outcomeOf(SCHEMAS[testCase.schema], testCase.input),
				expected,
			);
		});
		if (testCase.schema === "ExperimentSpecSchema") {
			it(`${testCase.name} (stored-spec schema)`, () => {
				expectSameOutcome(
					outcomeOf(StoredExperimentSpecSchema, testCase.input),
					expected,
				);
			});
		}
	}
});

describe("zod 3 baseline: buildExperimentSpec", () => {
	for (const testCase of BUILD_CASES) {
		const expected = buildFixtures[testCase.name] as BuildOutcome;
		it(testCase.name, () => {
			const actual = buildOutcomeOf(testCase.args);
			if (testCase.name === "build unsafe 2**53 budget") {
				expect(expected.success).toBe(true);
				expect(actual.success).toBe(false);
				return;
			}
			expect(actual).toEqual(expected);
		});
	}
});

describe("stored-spec schema parity", () => {
	it("has the same fields as the strict schemas", () => {
		expect(Object.keys(StoredExperimentSpecSchema.shape).sort()).toEqual(
			Object.keys(ExperimentSpecSchema.shape).sort(),
		);
		expect(Object.keys(StoredBudgetSchema.shape).sort()).toEqual(
			Object.keys(BudgetSchema.shape).sort(),
		);
	});

	it("differs from the strict schema only by the safe-integer bound", () => {
		const strictMaxima: string[] = [];
		const strict = normalizeSchema(
			zodToJsonSchema(ExperimentSpecSchema),
			strictMaxima,
		);
		const stored = normalizeSchema(
			zodToJsonSchema(StoredExperimentSpecSchema),
		) as {
			properties: {
				budget: { properties: Record<string, Record<string, unknown>> };
			};
		};
		expect(strictMaxima).toEqual(BUDGET_INT_MAXIMA);
		// The stored schema's integer refinement is not representable in JSON
		// Schema, so its budget integers are plain numbers; restore `integer`
		// and compare everything else exactly.
		for (const field of ["max_iterations", "max_tokens"]) {
			const property = stored.properties.budget.properties[field];
			expect(property?.type).toBe("number");
			if (property) property.type = "integer";
		}
		expect(stored).toEqual(strict as typeof stored);
	});
});

describe("zod 3 baseline: tools/list and schema resources", () => {
	let client: Client;
	let tools: { name: string; inputSchema: unknown }[];

	beforeAll(async () => {
		resetDb(":memory:");
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await main({
			connect: async (server) => {
				await server.connect(serverTransport);
			},
		});
		client = new Client({ name: "zod4-compat", version: "0" });
		await client.connect(clientTransport);
		tools = (await client.listTools()).tools;
	});

	afterAll(async () => {
		await client.close();
		closeDb();
	});

	it("exposes the same 11 tool names", () => {
		expect(tools.map((t) => t.name).sort()).toEqual(
			toolsBaseline.map((t) => t.name).sort(),
		);
		expect(tools).toHaveLength(11);
	});

	for (const baseline of toolsBaseline) {
		it(`${baseline.name}: same description and input schema`, () => {
			const tool = tools.find((t) => t.name === baseline.name) as
				| (typeof tools)[number]
				| undefined;
			expect(tool).toBeDefined();
			if (!tool) return;
			expect((tool as { description?: string }).description).toBe(
				baseline.description,
			);
			const maxima: string[] = [];
			const baselineMaxima: string[] = [];
			expect(normalizeSchema(tool.inputSchema, maxima)).toEqual(
				normalizeSchema(baseline.inputSchema, baselineMaxima),
			);
			// Safe-integer maxima already present under zod 3 (log_result
			// iteration) must stay; new ones may appear only on budget integers.
			const approved = ["register_experiment", "scaffold_experiment"].includes(
				baseline.name,
			)
				? BUDGET_INT_MAXIMA
				: [];
			expect(maxima.sort()).toEqual([...baselineMaxima, ...approved].sort());
		});
	}

	for (const [uri, baselineText] of Object.entries(
		resourceBaseline as Record<string, string>,
	)) {
		it(`${uri}: same envelope and definition`, async () => {
			const read = await client.readResource({ uri });
			const first = read.contents[0];
			const text = first && "text" in first ? String(first.text) : "";
			const actual = JSON.parse(text) as Record<string, unknown>;
			const expected = JSON.parse(baselineText) as Record<string, unknown>;
			expect(Object.keys(actual)).toEqual(Object.keys(expected));
			expect(actual.$schema).toBe(expected.$schema);
			expect(actual.$ref).toBe(expected.$ref);
			const title = String(expected.$ref).split("/").at(-1) as string;
			const definitions = (value: Record<string, unknown>) =>
				value.definitions as Record<string, unknown>;
			expect(Object.keys(definitions(actual))).toEqual([title]);
			const maxima: string[] = [];
			const baselineMaxima: string[] = [];
			expect(normalizeSchema(definitions(actual)[title], maxima)).toEqual(
				normalizeSchema(definitions(expected)[title], baselineMaxima),
			);
			expect(baselineMaxima).toEqual([]);
			expect(maxima).toEqual(
				title === "ExperimentSpec" ? BUDGET_INT_MAXIMA : [],
			);
		});
	}
});

type Shape = Record<string, z.ZodType>;

function toolShapes(register: (mcp: McpServer) => void): Map<string, Shape> {
	const shapes = new Map<string, Shape>();
	register({
		tool: (...args: unknown[]) => {
			shapes.set(args[0] as string, args[2] as Shape);
		},
	} as unknown as McpServer);
	return shapes;
}

describe("tool-boundary behavior under zod 4", () => {
	it("rejects an oversized invalid tags array with a single size issue (GHSA-mrhx-c7xc-m3w5)", () => {
		const shape = toolShapes(registerDiscoveryTools).get("search_techniques");
		if (!shape) throw new Error("search_techniques not registered");
		const result = z
			.object(shape)
			.safeParse({ tags: Array.from({ length: 21 + 200 }, () => 5) });
		expect(result.success).toBe(false);
		expect(result.error?.issues).toHaveLength(1);
		expect(result.error?.issues[0]).toMatchObject({
			code: "too_big",
			path: ["tags"],
			maximum: 20,
		});
	});

	for (const [register, name] of [
		[registerExperimentTools, "register_experiment"],
		[registerScaffoldingTools, "scaffold_experiment"],
	] as const) {
		it(`${name} rejects new budget integers above MAX_SAFE_INTEGER`, () => {
			const shape = toolShapes(register).get(name);
			if (!shape?.budget) throw new Error(`${name} budget missing`);
			for (const value of [2 ** 53, 1e300]) {
				expect(shape.budget.safeParse({ max_iterations: value }).success).toBe(
					false,
				);
				expect(shape.budget.safeParse({ max_tokens: value }).success).toBe(
					false,
				);
			}
			expect(
				shape.budget.safeParse({ max_tokens: Number.MAX_SAFE_INTEGER }).success,
			).toBe(true);
		});
	}
});
