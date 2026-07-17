import { describe, expect, it } from "bun:test";
import { main } from "../../src/index.js";

describe("startup integrity", () => {
	it("does not connect transport when catalog loading fails", async () => {
		let connected = false;
		await expect(
			main({
				loadCatalog: async () => {
					throw new Error("injected catalog failure");
				},
				connect: async () => {
					connected = true;
				},
			}),
		).rejects.toThrow(/injected catalog failure/i);
		expect(connected).toBe(false);
	});
});
