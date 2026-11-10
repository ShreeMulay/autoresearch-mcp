import { z } from "zod";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

/**
 * Convert a zod schema to a self-contained draft-07 JSON Schema using zod's
 * native converter, keeping the envelope previously produced by
 * zod-to-json-schema:
 *   - with a title: { $ref: "#/definitions/<title>", definitions: { <title> }, $schema }
 *   - without a title: { ...definition, $schema }
 * Reused sub-schemas are inlined so the definition has no internal refs.
 */
export default function zodToJsonSchema(
	schema: z.ZodType,
	title?: string,
): Record<string, unknown> {
	const { $schema: _dialect, ...definition } = z.toJSONSchema(schema, {
		target: "draft-7",
		io: "input",
		reused: "inline",
	}) as Record<string, unknown>;

	if (title === undefined) {
		return { ...definition, $schema: DRAFT_07 };
	}

	return {
		$ref: `#/definitions/${title}`,
		definitions: { [title]: definition },
		$schema: DRAFT_07,
	};
}
