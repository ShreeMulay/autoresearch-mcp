/**
 * Simple Zod to JSON Schema converter.
 * Handles the core types used in autoresearch-mcp without external dependency.
 */

import type { z } from "zod";

export default function zodToJsonSchema(
	schema: z.ZodTypeAny,
	title?: string,
): Record<string, unknown> {
	// Use Zod's built-in description as a simple representation
	const result: Record<string, unknown> = {
		$schema: "http://json-schema.org/draft-07/schema#",
		title: title ?? "Schema",
		description: `Auto-generated schema for ${title ?? "unknown type"}. Use get_technique or the catalog resource for detailed field descriptions.`,
		note: "This is a simplified schema. See the full Zod definitions in src/types.ts for complete validation.",
	};

	try {
		// Walk the Zod schema to extract shape
		if ("shape" in schema && typeof schema.shape === "object") {
			result.type = "object";
			const properties: Record<string, unknown> = {};
			const shape = schema.shape as Record<string, z.ZodTypeAny>;

			for (const [key, value] of Object.entries(shape)) {
				properties[key] = extractFieldInfo(value);
			}
			result.properties = properties;
		}
	} catch {
		result.type = "object";
		result.note = "Schema extraction failed — see src/types.ts for definitions";
	}

	return result;
}

function extractFieldInfo(field: z.ZodTypeAny): Record<string, unknown> {
	const info: Record<string, unknown> = {};

	// Get description if available
	if (field.description) {
		info.description = field.description;
	}

	// Determine type from Zod type name
	const typeName = field._def?.typeName as string | undefined;

	switch (typeName) {
		case "ZodString":
			info.type = "string";
			break;
		case "ZodNumber":
			info.type = "number";
			break;
		case "ZodBoolean":
			info.type = "boolean";
			break;
		case "ZodArray":
			info.type = "array";
			break;
		case "ZodEnum":
			info.type = "string";
			info.enum = field._def?.values;
			break;
		case "ZodObject":
			info.type = "object";
			break;
		case "ZodOptional":
			return { ...extractFieldInfo(field._def?.innerType), optional: true };
		case "ZodDefault":
			return {
				...extractFieldInfo(field._def?.innerType),
				default: field._def?.defaultValue?.(),
			};
		case "ZodRecord":
			info.type = "object";
			info.additionalProperties = true;
			break;
		default:
			info.type = "unknown";
	}

	return info;
}
