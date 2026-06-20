import type { z } from "zod";
import { zodToJsonSchema as convertZodToJsonSchema } from "zod-to-json-schema";

export default function zodToJsonSchema(
	schema: z.ZodTypeAny,
	title?: string,
): Record<string, unknown> {
	const converted = convertZodToJsonSchema(schema, {
		$refStrategy: "none",
		name: title,
	});

	return converted as Record<string, unknown>;
}
