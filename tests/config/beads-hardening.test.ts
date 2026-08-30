import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const baselineLineDigests = [
	"9b0a24d1344841a726a2e5e3f903ee03299443d2be3119c4cee9488d4b6ae16a",
	"7b702b9cd821839bd7142cb0526fab0900fbb7072a5137c86432633b57d0e9ea",
	"550121d05e9746a8d50ca677da52dabea5e3cec14375c2b98fc7c81241226cfd",
	"57ace1d727b7fcffc53d695a7aa98a9725cba68a36374fb73087716ee25b2348",
	"05608917763dc03a8a984c26b5f331ec7c982cabd9339a960e1653802e977ba4",
	"27a43e758c19c21b1c62a0b5974eec41647f9a3be9d6663a8bcdd73dce8ec46e",
	"54dfe7adb011a467af48901503f9b2301119f06ace124a0e7a1a134ec92e1e20",
	"f7126c158ba0ae8e6d6cb35e1971327511b50211789ff35a68808f0a4410117c",
	"34597c9c7d8ccbd66b93a3e96b235840247a83aee3b9f39ec2fd683cbc144bc5",
	"c97d4105d9a1146c04e05e176dadbaa33a6e9f06f7b832c226f926f90f181a67",
	"3f4b7c31489e87d39cf6c197be831c4f255d7b7961500bae1d34d8148738cbfb",
	"0a7dc4f442b10cc69c446a4e1bbc563aa5650dffa958adba44ac8e6309eda6dc",
	"0647446a63579bf1a36ac928d22678a54aaf1678f4f42993a10b965cf4be9d74",
];

describe("Beads repository hardening", () => {
	test("disables daemon use and daemon auto-start", () => {
		const config = read(".beads/config.yaml");
		expect(config).toMatch(/^no-daemon:\s*true\s*(?:#.*)?$/m);
		expect(config).toMatch(/^auto-start-daemon:\s*false\s*(?:#.*)?$/m);
	});

	test("does not configure the Beads merge driver", () => {
		expect(read(".gitattributes")).not.toMatch(/(?:^|\s)merge=beads(?:\s|$)/m);
	});

	test("does not track a Beads-installed Git hook path", () => {
		const tracked = execFileSync("git", ["ls-files", "-z"], {
			cwd: root,
			encoding: "utf8",
		}).split("\0");
		expect(
			tracked.filter((path) =>
				/^(?:\.beads\/hooks|\.git-hooks)(?:\/|$)/.test(path),
			),
		).toEqual([]);
	});

	test("keeps issues JSONL valid with unique IDs", () => {
		const ids = read(".beads/issues.jsonl")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const record: unknown = JSON.parse(line);
				expect(record).toBeObject();
				const id = (record as { id?: unknown }).id;
				expect(typeof id).toBe("string");
				expect(id).not.toBe("");
				return id as string;
			});
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("preserves every baseline ledger row byte-for-byte", () => {
		const lines =
			readFileSync(resolve(root, ".beads/issues.jsonl"))
				.toString("utf8")
				.match(/.*\n|.+$/g) ?? [];
		const actual = lines.slice(0, baselineLineDigests.length).map((line) => {
			const hasher = new Bun.CryptoHasher("sha256");
			hasher.update(line);
			return hasher.digest("hex");
		});
		expect(actual).toEqual(baselineLineDigests);
	});
});
