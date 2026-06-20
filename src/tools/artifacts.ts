import type { ExperimentSpec } from "../types.js";

export function inferArtifactType(
	targetArtifact: string,
): ExperimentSpec["artifact_type"] {
	const normalized = targetArtifact.toLowerCase();

	if (normalized.includes("prompt") || normalized.includes("few_shot")) {
		return "prompt";
	}

	if (
		normalized.endsWith(".ts") ||
		normalized.endsWith(".tsx") ||
		normalized.endsWith(".js") ||
		normalized.endsWith(".jsx") ||
		normalized.endsWith(".py") ||
		normalized.endsWith(".rs") ||
		normalized.endsWith(".go")
	) {
		return "code";
	}

	if (
		normalized.endsWith(".json") ||
		normalized.endsWith(".yaml") ||
		normalized.endsWith(".yml") ||
		normalized.endsWith(".toml")
	) {
		return "config";
	}

	if (
		normalized.endsWith(".md") ||
		normalized.endsWith(".txt") ||
		normalized.endsWith(".html")
	) {
		return "content";
	}

	return "other";
}
