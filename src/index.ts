/**
 * autoresearch-mcp server entry point.
 * Phase 1: Catalog + Experiment Tracking + Scaffolding via Stdio transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCatalog } from "./db/load-catalog.js";
import { registerPrompts } from "./prompts/advisor.js";
import { registerResources } from "./resources/catalog.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerExperimentTools } from "./tools/experiments.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerScaffoldingTools } from "./tools/scaffolding.js";
import { VERSION } from "./version.js";

export async function main(
	dependencies: {
		loadCatalog?: typeof loadCatalog;
		connect?: (server: McpServer) => Promise<void>;
	} = {},
): Promise<void> {
	// Load catalog from YAML into SQLite
	const catalogResult = await (dependencies.loadCatalog ?? loadCatalog)();
	console.error(
		`[autoresearch-mcp] Catalog loaded: ${catalogResult.loaded} new/updated, ${catalogResult.skipped} unchanged`,
	);
	if (catalogResult.errors.length > 0) {
		throw new Error(`Catalog load failed: ${catalogResult.errors.join("; ")}`);
	}

	// Create MCP server
	const server = new McpServer({
		name: "autoresearch-mcp",
		version: VERSION,
	});

	// Register all components
	// Phase 0.5: Discovery
	registerDiscoveryTools(server);
	// Phase 1: Experiment management + scaffolding + server metadata
	registerExperimentTools(server);
	registerScaffoldingTools(server);
	registerMetaTools(server);
	// Resources + Prompts
	registerResources(server);
	registerPrompts(server);

	// Connect via Stdio transport
	if (dependencies.connect) {
		await dependencies.connect(server);
	} else {
		const transport = new StdioServerTransport();
		await server.connect(transport);
	}

	console.error(
		"[autoresearch-mcp] Server running on Stdio transport (Phase 1)",
	);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("[autoresearch-mcp] Fatal error:", err);
		process.exit(1);
	});
}
