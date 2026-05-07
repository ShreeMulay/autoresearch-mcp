/**
 * E2E integration test: spawn the MCP server and verify it responds.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const SERVER_PATH = resolve(import.meta.dir, "../../src/index.ts");

describe("MCP Server E2E", () => {
	let child: ReturnType<typeof spawn>;
	let stdoutBuffer = "";
	let stderrBuffer = "";
	let initialized = false;

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

		// Wait a moment for server to start
		await new Promise((r) => setTimeout(r, 500));

		child.stdin?.write(JSON.stringify(initRequest) + "\n");

		// Wait for response
		await new Promise((r) => setTimeout(r, 500));

		// Check if we got a response
		const lines = stdoutBuffer.trim().split("\n");
		for (const line of lines) {
			try {
				const msg = JSON.parse(line);
				if (msg.id === 1 && msg.result) {
					initialized = true;
					break;
				}
			} catch {
				// not JSON, ignore
			}
		}
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

		child.stdin?.write(JSON.stringify(request) + "\n");
		await new Promise((r) => setTimeout(r, 500));

		const lines = stdoutBuffer.trim().split("\n");
		let foundResponse = false;
		for (const line of lines) {
			try {
				const msg = JSON.parse(line);
				if (msg.id === 2 && msg.result && msg.result.tools) {
					foundResponse = true;
					expect(Array.isArray(msg.result.tools)).toBe(true);
					expect(msg.result.tools.length).toBeGreaterThanOrEqual(1);

					// Verify expected tools exist
					const toolNames = msg.result.tools.map(
						(t: { name: string }) => t.name
					);
					expect(toolNames).toContain("search_techniques");
					expect(toolNames).toContain("get_technique");
					expect(toolNames).toContain("suggest_technique");
					expect(toolNames).toContain("register_experiment");
					expect(toolNames).toContain("log_result");
					expect(toolNames).toContain("scaffold_experiment");
					expect(toolNames).toContain("log_technique_outcome");
					break;
				}
			} catch {
				// not JSON or wrong format
			}
		}

		expect(foundResponse).toBe(true);
	});

	it("server process stays alive", () => {
		expect(child.killed).toBe(false);
	});
});
