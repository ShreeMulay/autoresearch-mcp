/**
 * JSON-Schema comparison normalizations for the zod 3 → zod 4 oracle.
 * Every rule here is listed in CHANGELOG/PR notes; nothing else is ignored.
 *
 *  N1. Local `$ref` pointers (zod-to-json-schema 3 emitted
 *      `#/properties/...` refs for reused sub-schemas) are inlined; sibling
 *      keys of the `$ref` (e.g. `description`) are kept.
 *  N2. `additionalProperties: false` is dropped. zod 3's converter emitted it
 *      for non-strict objects; zod 4 omits it in `io: "input"` mode. Runtime
 *      behavior is unchanged: both versions strip unknown keys.
 *  N3. `propertyNames: { type: "string" }` is dropped (zod 4 adds it for
 *      `z.record(z.string(), …)`; JSON object keys are always strings).
 *  N4. Object key order is ignored.
 *  N5. `maximum: Number.MAX_SAFE_INTEGER` on `type: "integer"` is removed and
 *      its location recorded, so callers can assert it appears only where the
 *      approved safe-integer narrowing applies.
 */

type Json = unknown;

function pointer(root: Json, ref: string): Json {
	if (!ref.startsWith("#/")) throw new Error(`non-local $ref ${ref}`);
	let node: Json = root;
	for (const raw of ref.slice(2).split("/")) {
		const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		node = (node as Record<string, Json>)[key];
		if (node === undefined) throw new Error(`unresolvable $ref ${ref}`);
	}
	return node;
}

export function normalizeSchema(
	schema: Json,
	safeIntegerMaxima: string[] = [],
): Json {
	const root = schema;
	const walk = (node: Json, path: string, depth: number): Json => {
		if (depth > 64) throw new Error("schema too deep or cyclic");
		if (Array.isArray(node)) {
			return node.map((item, i) => walk(item, `${path}/${i}`, depth + 1));
		}
		if (node === null || typeof node !== "object") return node;
		let record = node as Record<string, Json>;
		if (typeof record.$ref === "string") {
			const { $ref, ...siblings } = record;
			record = {
				...(pointer(root, $ref) as Record<string, Json>),
				...siblings,
			};
		}
		const out: Record<string, Json> = {};
		for (const key of Object.keys(record).sort()) {
			const value = record[key];
			if (key === "additionalProperties" && value === false) continue;
			if (
				key === "propertyNames" &&
				JSON.stringify(value) === JSON.stringify({ type: "string" })
			) {
				continue;
			}
			if (
				key === "maximum" &&
				value === Number.MAX_SAFE_INTEGER &&
				record.type === "integer"
			) {
				safeIntegerMaxima.push(path);
				continue;
			}
			out[key] = walk(value, `${path}/${key}`, depth + 1);
		}
		return out;
	};
	return walk(schema, "#", 0);
}
