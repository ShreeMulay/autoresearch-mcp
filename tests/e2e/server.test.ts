/**
 * E2E integration test: spawn the MCP server and verify it responds.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { VERSION } from "../../src/version.js";

const SERVER_PATH = resolve(import.meta.dir, "../../src/index.ts");

interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	result?: unknown;
	error?: unknown;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		candidate.jsonrpc === "2.0" &&
		("result" in candidate ||
			"error" in candidate ||
			typeof candidate.method === "string")
	);
}

/**
 * Parse only complete, newline-terminated stdout frames. A trailing partial
 * frame stays buffered until its newline arrives. Any complete line that is
 * not a JSON-RPC message is recorded as a protocol violation.
 */
class JsonRpcFrameReader {
	private pending = "";
	readonly messages: JsonRpcMessage[] = [];
	readonly invalidLines: string[] = [];

	push(chunk: string): void {
		this.pending += chunk;
		let newline = this.pending.indexOf("\n");
		while (newline !== -1) {
			const line = this.pending.slice(0, newline).replace(/\r$/, "");
			this.pending = this.pending.slice(newline + 1);
			this.accept(line);
			newline = this.pending.indexOf("\n");
		}
	}

	private accept(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			this.invalidLines.push(line);
			return;
		}
		if (isJsonRpcMessage(parsed)) {
			this.messages.push(parsed);
		} else {
			this.invalidLines.push(line);
		}
	}
}

describe("JsonRpcFrameReader", () => {
	it("waits for a newline before parsing a split frame", () => {
		const reader = new JsonRpcFrameReader();
		reader.push('{"jsonrpc":"2.0","id":1,');
		expect(reader.messages).toEqual([]);
		reader.push('"result":{}}\n');
		expect(reader.messages).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
		expect(reader.invalidLines).toEqual([]);
	});

	it("records complete non-JSON-RPC lines as violations", () => {
		const reader = new JsonRpcFrameReader();
		reader.push('log noise\n{"foo":1}\n\n');
		expect(reader.messages).toEqual([]);
		expect(reader.invalidLines).toEqual(["log noise", '{"foo":1}', ""]);
	});
});

describe("MCP Server E2E", () => {
	let child: ReturnType<typeof spawn>;
	const stdout = new JsonRpcFrameReader();
	let stderrBuffer = "";
	let initialized = false;

	function assertCleanStdout(): void {
		if (stdout.invalidLines.length > 0) {
			throw new Error(
				`MCP server wrote non-JSON-RPC stdout lines: ${JSON.stringify(stdout.invalidLines)}`,
			);
		}
	}

	async function waitForJsonRpcResponse(
		id: number,
		timeoutMs = 15_000,
	): Promise<JsonRpcMessage> {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			assertCleanStdout();
			const message = stdout.messages.find((candidate) => candidate.id === id);

			if (message) {
				return message;
			}

			if (child.exitCode !== null) {
				throw new Error(
					`MCP server exited with code ${child.exitCode} before response ${id}\n${stderrBuffer}`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		throw new Error(
			[
				`Timed out waiting for JSON-RPC response id ${id}`,
				"--- stdout messages ---",
				JSON.stringify(stdout.messages),
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

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (data: string) => {
			stdout.push(data);
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
	}, 20_000);

	afterAll(async () => {
		// Every complete frame the server wrote during the suite must be JSON-RPC.
		expect(stdout.invalidLines).toEqual([]);
		if (!child || child.exitCode !== null) {
			return;
		}

		await new Promise<void>((resolveExit) => {
			const forceKillTimer = setTimeout(() => {
				child.kill("SIGKILL");
				resolveExit();
			}, 2_000);
			child.once("exit", () => {
				clearTimeout(forceKillTimer);
				resolveExit();
			});
			child.kill();
		});
	}, 5_000);

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

		const toolNames = (result.tools?.map((tool) => tool.name) ?? []).sort();
		expect(toolNames).toEqual([
			"get_experiment",
			"get_server_info",
			"get_technique",
			"get_template",
			"list_experiments",
			"log_result",
			"register_experiment",
			"scaffold_experiment",
			"search_techniques",
			"suggest_technique",
			"update_experiment",
		]);
	});

	it("stays alive and answers get_server_info with its version", async () => {
		child.stdin?.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: { name: "get_server_info", arguments: {} },
			})}\n`,
		);
		const response = await waitForJsonRpcResponse(5);
		expect(response.error).toBeUndefined();
		const result = response.result as {
			content: Array<{ type: string; text: string }>;
			isError?: boolean;
		};
		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0].text)).toMatchObject({
			version: VERSION,
		});
		expect(child.exitCode).toBeNull();
	});

	it("rejects invalid list_experiments statuses during schema validation", async () => {
		child.stdin?.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "list_experiments",
					arguments: { status: "not-a-status" },
				},
			})}\n`,
		);
		const response = await waitForJsonRpcResponse(3);
		// SDK mcp.js catches InvalidParams and returns a tool error result.
		expect(response.error).toBeUndefined();
		expect(response.result).toMatchObject({ isError: true });
		const result = response.result as {
			content: Array<{ type: string; text: string }>;
		};
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain(
			"Input validation error: Invalid arguments for tool list_experiments",
		);
		expect(result.content[0].text).toContain("status");
		expect(result.content[0].text).toContain("not-a-status");

		child.stdin?.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: "list_experiments", arguments: { status: "running" } },
			})}\n`,
		);
		const valid = await waitForJsonRpcResponse(4);
		expect(valid.error).toBeUndefined();
		expect(valid.result).toBeDefined();
		expect(valid.result).not.toMatchObject({ isError: true });
	});
});
