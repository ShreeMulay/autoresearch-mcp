import { describe, expect, it } from "bun:test";
import z from "zod";
import zodToJsonSchema from "../../src/schemas/zod-to-json.js";

describe("zodToJsonSchema", () => {
	it("emits real JSON Schema with required fields and nested object details", () => {
		const schema = z.object({
			name: z.string().describe("Display name"),
			count: z.number().optional(),
			flags: z.object({ enabled: z.boolean() }).default({ enabled: true }),
		});

		const jsonSchema = zodToJsonSchema(schema, "ExampleSchema");
		const definition = (
			jsonSchema.definitions as Record<string, Record<string, unknown>>
		).ExampleSchema;

		expect(jsonSchema.$schema).toBe("http://json-schema.org/draft-07/schema#");
		expect(jsonSchema.$ref).toBe("#/definitions/ExampleSchema");
		expect(jsonSchema.note).toBeUndefined();
		expect(definition).toMatchObject({
			type: "object",
			properties: {
				name: { type: "string", description: "Display name" },
				count: { type: "number" },
				flags: {
					type: "object",
					properties: { enabled: { type: "boolean" } },
				},
			},
			required: ["name"],
		});
	});
});
