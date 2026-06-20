/**
 * E2E integration test: spawn the MCP server and verify it responds.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const SERVER_PATH = resolve(import.meta.dir, "../../src/index.ts");

interface JsonRpcMessage {
	id?: number | string;
	result?: unknown;
	error?: unknown;
}

function parseJsonRpcMessages(buffer: string): JsonRpcMessage[] {
	return buffer
		.trim()
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as JsonRpcMessage];
			} catch {
				return [];
			}
		});
}

describe("MCP Server E2E", () => {
	let child: ReturnType<typeof spawn>;
	let stdoutBuffer = "";
	let stderrBuffer = "";
	let initialized = false;

	async function waitForJsonRpcResponse(
		id: number,
		timeoutMs = 3_000,
	): Promise<JsonRpcMessage> {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const message = parseJsonRpcMessages(stdoutBuffer).find(
				(candidate) => candidate.id === id,
			);

			if (message) {
				return message;
			}

			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		throw new Error(
			[
				`Timed out waiting for JSON-RPC response id ${id}`,
				"--- stdout ---",
				stdoutBuffer,
				"--- stderr ---",
				stderrBuffer,
			].join("\n"),
		);
	}

	beforeAll(async () => {
		child = spawn("bun", ["run", SERVER_PATH], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				AUTORESEARCH_DB_PATH: ":memory:",
			},
		});

		child.stdout?.on("data", (data: Buffer) => {
			stdoutBuffer += data.toString();
		});

		child.stderr?.on("data", (data: Buffer) => {
			stderrBuffer += data.toString();
		});

		// Send initialize request
		const initRequest = {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test-client", version: "1.0.0" },
			},
		};

		child.stdin?.write(`${JSON.stringify(initRequest)}\n`);
		const response = await waitForJsonRpcResponse(1);
		initialized = Boolean(response.result);
	});

	afterAll(() => {
		if (child) {
			child.kill();
		}
	});

	it("initializes successfully", () => {
		expect(initialized).toBe(true);
	});

	it("responds to tools/list request", async () => {
		if (!initialized) {
			console.log("Server not initialized, skipping tools/list test");
			return;
		}

		const request = {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		};

		child.stdin?.write(`${JSON.stringify(request)}\n`);
		const msg = await waitForJsonRpcResponse(2);
		const result = msg.result as { tools?: Array<{ name: string }> };

		expect(Array.isArray(result.tools)).toBe(true);
		expect(result.tools?.length).toBeGreaterThanOrEqual(1);

		// Verify expected tools exist
		const toolNames = result.tools?.map((t) => t.name) ?? [];
		expect(toolNames).toContain("search_techniques");
		expect(toolNames).toContain("get_technique");
		expect(toolNames).toContain("suggest_technique");
		expect(toolNames).toContain("register_experiment");
		expect(toolNames).toContain("log_result");
		expect(toolNames).toContain("scaffold_experiment");
		expect(toolNames).toContain("log_technique_outcome");
	});

	it("server process stays alive", () => {
		expect(child.killed).toBe(false);
	});
});
