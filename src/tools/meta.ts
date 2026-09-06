/**
 * Server metadata tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getActiveDbPath } from "../db/schema.js";
import { getCatalogStats } from "../db/techniques.js";
import { VERSION } from "../version.js";

export function registerMetaTools(mcp: McpServer): void {
	mcp.tool(
		"get_server_info",
		"Get autoresearch-mcp server metadata: version, catalog stats, and configuration.",
		{},
		async () => {
			try {
				const stats = getCatalogStats();
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									version: VERSION,
									catalog: stats,
									db_path: getActiveDbPath(),
								},
								null,
								2,
							),
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to get server info: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
