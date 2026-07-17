import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const fixtureRoot = join(import.meta.dir, "fixtures");
const fixtureTarball = join(fixtureRoot, "autoresearch-mcp-0.4.0.tgz");
const manifestPath = join(root, "ci", "release-artifact.json");
const controlPath = join(root, "ci", "release-control.ts");
const smokePath = join(root, "ci", "package-smoke.sh");
const releaseSha = "1111111111111111111111111111111111111111";
const deprecation =
	"DEPRECATED: v0.4.0 failed post-publication integrity verification. Do not install. Await a corrected release.";
let sandbox = "";
let fakeBin = "";
let npmLog = "";
let gitLog = "";
let tarball = "";
let tarballSri = "";
let evidenceSequence = 0;
let runEvidenceSequence = 0;

setDefaultTimeout(120_000);

beforeAll(async () => {
	sandbox = await mkdtemp(join(tmpdir(), "release-closeout-contract-"));
	fakeBin = join(sandbox, "bin");
	await Bun.$`mkdir -p ${fakeBin}`.quiet();
	for (const name of ["npm", "git", "bash"]) {
		await copyFile(join(fixtureRoot, `fake-${name}.sh`), join(fakeBin, name));
		await chmod(join(fakeBin, name), 0o755);
	}
	npmLog = join(sandbox, "npm.log");
	gitLog = join(sandbox, "git.log");
	tarball = join(sandbox, "autoresearch-mcp-0.4.0.tgz");
	await copyFile(fixtureTarball, tarball);
	const tarballSha512 = createHash("sha512")
		.update(await readFile(tarball))
		.digest();
	tarballSri = `sha512-${tarballSha512.toString("base64")}`;
	await Promise.all([writeFile(npmLog, ""), writeFile(gitLog, "")]);
});

afterAll(async () => rm(sandbox, { recursive: true, force: true }));

async function logs() {
	return {
		git: await readFile(gitLog, "utf8"),
		npm: await readFile(npmLog, "utf8"),
	};
}

async function resetLogs() {
	await Promise.all([writeFile(npmLog, ""), writeFile(gitLog, "")]);
}

async function run(command: string, extra: Record<string, string> = {}) {
	await resetLogs();
	const proc = Bun.spawn(["bun", controlPath, command], {
		cwd: root,
		env: {
			PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
			FAKE_NPM_LOG: npmLog,
			FAKE_NPM_PROJECT_ROOT: root,
			FAKE_GIT_LOG: gitLog,
			FAKE_NPM_TARBALL_SOURCE: tarball,
			FAKE_NPM_SRI: tarballSri,
			RELEASE_EVIDENCE_PATH: join(
				sandbox,
				`run-evidence-${runEvidenceSequence++}.json`,
			),
			...extra,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, output: `${stdout}\n${stderr}` };
}

function publishConfirmation(digest: string) {
	return `publish|autoresearch-mcp|0.4.0|https://registry.npmjs.org/|shreemulay|${releaseSha}|${digest}`;
}

async function approvedPublishConfirmation() {
	const value = JSON.parse(await readFile(manifestPath, "utf8"));
	return publishConfirmation(value.sha256);
}

async function writeEvidence() {
	const artifact = JSON.parse(await readFile(manifestPath, "utf8"));
	const evidence = {
		schemaVersion: 1,
		package: "autoresearch-mcp",
		version: "0.4.0",
		registry: "https://registry.npmjs.org/",
		publisher: "shreemulay",
		releaseSha,
		sha256: artifact.sha256,
		sha512: artifact.sha512,
		integrity: artifact.integrity,
		smokeCompletedAt: "2026-07-17T00:00:00.000Z",
	};
	const path = join(sandbox, `evidence-${evidenceSequence++}.json`);
	await writeFile(path, `${JSON.stringify(evidence)}\n`, { mode: 0o444 });
	const hash = createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
	return {
		confirmation: `tag|autoresearch-mcp|0.4.0|${releaseSha}|${hash}`,
		path,
	};
}

describe("closed release artifact", () => {
	it("exists and has exactly the closed top-level schema", async () => {
		const value = JSON.parse(await readFile(manifestPath, "utf8"));
		expect(Object.keys(value).sort()).toEqual(
			[
				"integrity",
				"package",
				"publisher",
				"registry",
				"registryReads",
				"schemaVersion",
				"sha256",
				"sha512",
				"version",
			].sort(),
		);
		expect(value).toMatchObject({
			schemaVersion: 1,
			package: "autoresearch-mcp",
			version: "0.4.0",
			registry: "https://registry.npmjs.org/",
			publisher: "shreemulay",
		});
	});

	it("contains closed, correctly sized lowercase hex digests and matching SHA-512 SRI", async () => {
		const value = JSON.parse(await readFile(manifestPath, "utf8"));
		expect(value.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(value.sha512).toMatch(/^[a-f0-9]{128}$/);
		expect(value.integrity).toBe(
			`sha512-${Buffer.from(value.sha512, "hex").toString("base64")}`,
		);
	});

	it("binds the canonical fixture SHA-256, SHA-512, and SRI to the release artifact", async () => {
		const [value, fixture] = await Promise.all([
			readFile(manifestPath, "utf8").then(JSON.parse),
			readFile(fixtureTarball),
		]);
		const sha256 = createHash("sha256").update(fixture).digest("hex");
		const sha512 = createHash("sha512").update(fixture).digest("hex");
		expect(sha256).toBe(value.sha256);
		expect(sha512).toBe(value.sha512);
		expect(`sha512-${Buffer.from(sha512, "hex").toString("base64")}`).toBe(
			value.integrity,
		);
	});

	it("defines bounded fresh-cache reads", async () => {
		const value = JSON.parse(await readFile(manifestPath, "utf8"));
		expect(value.registryReads.attempts).toBeGreaterThanOrEqual(2);
		expect(value.registryReads.attempts).toBeLessThanOrEqual(5);
		expect(value.registryReads.backoffSeconds).toHaveLength(
			value.registryReads.attempts,
		);
		expect(Math.max(...value.registryReads.backoffSeconds)).toBeLessThanOrEqual(
			30,
		);
	});

	it("rejects unknown nested registryReads keys in TypeScript and shell validation", async () => {
		const copiedRoot = await mkdtemp(
			join(tmpdir(), "release-schema-closeout-"),
		);
		try {
			const ci = join(copiedRoot, "ci");
			await Bun.$`mkdir -p ${ci}`.quiet();
			const artifact = JSON.parse(await readFile(manifestPath, "utf8"));
			artifact.registryReads.unexpected = true;
			await Promise.all([
				copyFile(controlPath, join(ci, "release-control.ts")),
				copyFile(smokePath, join(ci, "package-smoke.sh")),
				writeFile(join(ci, "release-artifact.json"), JSON.stringify(artifact)),
				writeFile(
					join(copiedRoot, "package.json"),
					'{"name":"schema-test","version":"0.4.0"}\n',
				),
			]);
			const control = Bun.spawnSync([
				"bun",
				join(ci, "release-control.ts"),
				"smoke",
			]);
			expect(control.exitCode).not.toBe(0);
			expect(control.stderr.toString()).toMatch(/schema|registry read policy/i);

			const fakeGit = join(copiedRoot, "git");
			const fakeNode = join(copiedRoot, "node");
			const fakeNpm = join(copiedRoot, "npm");
			await Promise.all([
				writeFile(
					fakeGit,
					"#!/bin/sh\nprintf '1111111111111111111111111111111111111111\\n'\n",
					{ mode: 0o755 },
				),
				writeFile(
					fakeNode,
					`#!/bin/sh
if [ "\${1:-}" = --version ]; then printf 'v22.22.1\\n'; exit 0; fi
if [ "\${1:-}" = -p ] && [ "\${2:-}" = "require('${copiedRoot}/package.json').version" ]; then printf '0.4.0\\n'; exit 0; fi
if [ "\${1:-}" = - ]; then
  shift
  script="$(mktemp /tmp/release-node-shim.XXXXXX)" || exit $?
  trap 'rm -f "$script"' EXIT HUP INT TERM
  cat > "$script" || exit $?
  bun "$script" "$@"
  exit $?
fi
exit 64
`,
					{ mode: 0o755 },
				),
				writeFile(
					fakeNpm,
					`#!/bin/sh\nif [ "\${1:-}" = --version ]; then printf '10.9.4\\n'; exit 0; fi\nif [ "\${1:-}" = pack ]; then\n  destination=.\n  previous=\n  for argument in "$@"; do [ "$previous" = --pack-destination ] && destination="$argument"; previous="$argument"; done\n  cp "${fixtureTarball}" "$destination/autoresearch-mcp-0.4.0.tgz"\n  exit 0\nfi\nexit 64\n`,
					{ mode: 0o755 },
				),
			]);
			const smoke = Bun.spawnSync(["bash", join(ci, "package-smoke.sh")], {
				env: {
					...process.env,
					PATH: `${copiedRoot}:${process.env.PATH ?? ""}`,
					EXPECTED_BUN_VERSION: Bun.version,
					EXPECTED_NODE_VERSION: "v22.22.1",
					EXPECTED_NPM_VERSION: "10.9.4",
				},
			});
			expect(smoke.exitCode).not.toBe(0);
			expect(`${smoke.stdout}\n${smoke.stderr}`).toMatch(
				/registry-read policy/i,
			);
		} finally {
			await rm(copiedRoot, { recursive: true, force: true });
		}
	});
});

describe("package smoke artifact export", () => {
	it("rejects relative artifact output before creating a repository fallback", async () => {
		const proc = Bun.spawn(
			["bash", smokePath, "--artifact-output", "relative"],
			{
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stderr).text(),
		]);
		expect(code).not.toBe(0);
		expect(stderr).toMatch(/absolute/i);
		expect(await Bun.file(join(root, "relative")).exists()).toBe(false);
	});

	it("fails closed when mktemp fails", async () => {
		const bin = join(sandbox, "mktemp-failure-bin");
		await Bun.$`mkdir -p ${bin}`.quiet();
		await writeFile(join(bin, "mktemp"), "#!/bin/sh\nexit 73\n", {
			mode: 0o755,
		});
		const proc = Bun.spawn(["bash", smokePath], {
			cwd: root,
			env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [code, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stderr).text(),
		]);
		expect(code).toBe(1);
		expect(stderr).toMatch(/mktemp failed/i);
	});
});

describe("publish preflight is fail-closed before mutation", () => {
	it.each([
		["wrong publisher", { FAKE_NPM_PUBLISHER: "mallory" }, /publisher|whoami/i],
		[
			"auth ambiguity",
			{ FAKE_NPM_REGISTRY_STATE: "auth" },
			/ambiguous|E401|auth/i,
		],
		[
			"network ambiguity",
			{ FAKE_NPM_REGISTRY_STATE: "network" },
			/ambiguous|timeout|network/i,
		],
		["dirty checkout", { FAKE_GIT_DIRTY: "1" }, /dirty|clean/i],
		[
			"Forgejo main mismatch",
			{ FAKE_GIT_FORGEJO_MAIN_SHA: "2222222222222222222222222222222222222222" },
			/Forgejo|main|ref/i,
		],
		[
			"GitHub main mismatch",
			{ FAKE_GIT_ORIGIN_MAIN_SHA: "2222222222222222222222222222222222222222" },
			/GitHub|main|ref/i,
		],
		["existing tag", { FAKE_GIT_FORGEJO_TAG_STATE: "exact" }, /tag|v0\.4\.0/i],
	])("rejects %s without any npm mutation", async (_name, env, message) => {
		const result = await run("publish", {
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
			...env,
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(message);
		const { npm } = await logs();
		expect(npm).not.toMatch(/^publish |^deprecate |^unpublish /m);
	});

	it("requires exact confirmation binding including release SHA and SHA-256", async () => {
		const result = await run("publish", {
			RELEASE_CONFIRMATION: "publish|autoresearch-mcp|0.4.0",
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/confirmation/i);
		expect((await logs()).npm).not.toMatch(/^publish /m);
	});

	it("retries ambiguous reads in fresh caches and stops on exact", async () => {
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "ambiguous-then-exact",
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
		});
		expect(result.exitCode).toBe(0);
		const npm = (await logs()).npm;
		expect(npm).not.toMatch(/^publish /m);
		const caches = npm
			.split("\n")
			.filter((line) => line.startsWith("view ") && line.includes("--cache="))
			.map((line) => line.match(/--cache=([^ ]+)/)?.[1]);
		expect(caches.length).toBeGreaterThanOrEqual(2);
		expect(new Set(caches).size).toBe(caches.length);
	});

	it("never treats mixed E404 and server ambiguity as absent", async () => {
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "mixed-e404-500",
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/ambiguous/i);
		expect((await logs()).npm).not.toMatch(/^publish /m);
	});
});

describe("publication and reconciliation", () => {
	it("publishes exactly once using an absolute .tgz, never dot or a directory", async () => {
		const value = JSON.parse(await readFile(manifestPath, "utf8"));
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "absent",
			RELEASE_CONFIRMATION: publishConfirmation(value.sha256),
		});
		expect(result.exitCode).toBe(0);
		const publishes = (await logs()).npm
			.split("\n")
			.filter((line) => line.startsWith("publish "));
		expect(publishes).toHaveLength(1);
		const artifact = publishes[0]?.split(" ")[1] ?? "";
		expect(isAbsolute(artifact)).toBe(true);
		expect(artifact).toEndWith(".tgz");
		expect(artifact).not.toBe(".");
		expect(publishes[0]).toContain(
			"--access public --registry=https://registry.npmjs.org/",
		);
	});

	it("resumes present-exact without republish", async () => {
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "exact",
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
		});
		expect(result.exitCode).toBe(0);
		expect((await logs()).npm).not.toMatch(/^publish /m);
	});

	it("reconciles timeout-after-acceptance and never republishes", async () => {
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "absent-then-exact",
			FAKE_NPM_PUBLISH_STATUS: "124",
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
		});
		expect(result.exitCode).toBe(0);
		expect((await logs()).npm.match(/^publish /gm)).toHaveLength(1);
	});

	it("rechecks mirrored main after packaging and refuses remote advancement", async () => {
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "absent",
			FAKE_GIT_ORIGIN_ADVANCE_AFTER: "1",
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
		});
		expect(result.exitCode).not.toBe(0);
		expect((await logs()).npm).not.toMatch(/^publish /m);
	});

	it("reverifies packed bytes at the final pre-publish boundary", async () => {
		const result = await run("publish", {
			FAKE_NPM_REGISTRY_STATE: "absent",
			FAKE_GIT_TAMPER_AFTER_ORIGIN_READ: "1",
			RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/digest conflict/i);
		expect((await logs()).npm).not.toMatch(/^publish /m);
	});

	it.each(["absent", "conflict"])(
		"hard-stops persistent %s after bounded fresh-cache reads",
		async (state) => {
			const result = await run("publish", {
				FAKE_NPM_REGISTRY_STATE: state,
				FAKE_NPM_PUBLISH_STATUS: "124",
				RELEASE_CONFIRMATION: await approvedPublishConfirmation(),
			});
			expect(result.exitCode).not.toBe(0);
			const lines = (await logs()).npm.split("\n");
			expect(
				lines.filter((line) => line.startsWith("publish ")).length,
			).toBeLessThanOrEqual(1);
			const caches = lines
				.filter((line) => line.includes("--cache="))
				.map((line) => line.match(/--cache=([^ ]+)/)?.[1]);
			expect(new Set(caches).size).toBe(caches.length);
		},
	);
});

describe("smoke, deprecation, and tag authorization boundaries", () => {
	it("local artifact smoke cannot override identity or authorize any mutation", async () => {
		const result = await run("smoke", {
			LOCAL_ARTIFACT: tarball,
			RELEASE_PACKAGE: "evil",
			RELEASE_VERSION: "9.9.9",
			RELEASE_CONFIRMATION: publishConfirmation("x"),
		});
		expect(result.exitCode).not.toBe(0);
		const all = `${(await logs()).npm}\n${(await logs()).git}`;
		expect(all).not.toMatch(/publish |deprecate |unpublish |push /);
	});

	it("standalone smoke binds live clean mirrored release SHA and writes absolute evidence", async () => {
		const evidencePath = join(
			sandbox,
			`standalone-evidence-${evidenceSequence++}.json`,
		);
		const result = await run("smoke", {
			LOCAL_ARTIFACT: tarball,
			RELEASE_EVIDENCE_PATH: evidencePath,
		});
		expect(result.exitCode).toBe(0);
		const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
		expect(evidence.releaseSha).toBe(releaseSha);
		expect(isAbsolute(evidencePath)).toBe(true);
		expect((await logs()).git).toContain("ls-remote origin refs/heads/main");
	});

	it("rejects an existing evidence destination without overwriting it", async () => {
		const path = join(sandbox, `existing-evidence-${evidenceSequence++}.json`);
		await writeFile(path, "preserve-me\n");
		const result = await run("smoke", {
			LOCAL_ARTIFACT: tarball,
			RELEASE_EVIDENCE_PATH: path,
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/must not exist/i);
		expect(await readFile(path, "utf8")).toBe("preserve-me\n");
	});

	it("rejects evidence paths resolving inside the checkout", async () => {
		const path = join(root, `forbidden-evidence-${process.pid}.json`);
		const result = await run("smoke", {
			LOCAL_ARTIFACT: tarball,
			RELEASE_EVIDENCE_PATH: path,
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/outside the git checkout/i);
		expect(await Bun.file(path).exists()).toBe(false);
	});

	it("rejects symlink evidence destinations and parents resolving into checkout", async () => {
		const destination = join(
			sandbox,
			`evidence-link-${evidenceSequence++}.json`,
		);
		await symlink(join(sandbox, "missing-evidence-target.json"), destination);
		const linkedDestination = await run("smoke", {
			LOCAL_ARTIFACT: tarball,
			RELEASE_EVIDENCE_PATH: destination,
		});
		expect(linkedDestination.exitCode).not.toBe(0);
		expect(linkedDestination.output).toMatch(/must not exist/i);

		const parent = join(sandbox, `checkout-link-${evidenceSequence++}`);
		await symlink(root, parent);
		const linkedParent = await run("smoke", {
			LOCAL_ARTIFACT: tarball,
			RELEASE_EVIDENCE_PATH: join(parent, "evidence.json"),
		});
		expect(linkedParent.exitCode).not.toBe(0);
		expect(linkedParent.output).toMatch(/outside the git checkout/i);
	});

	it.each([
		[
			"deprecate",
			`deprecate|shreemulay|autoresearch-mcp|0.4.0|https://registry.npmjs.org/|${deprecation}`,
		],
		[
			"clear-deprecation",
			"clear-deprecation|shreemulay|autoresearch-mcp|0.4.0|https://registry.npmjs.org/|",
		],
	])(
		"%s requires its distinct exact confirmation and verifies resulting state",
		async (command, confirmation) => {
			const denied = await run(command, {
				RELEASE_CONFIRMATION: publishConfirmation("x"),
			});
			expect(denied.exitCode).not.toBe(0);
			expect((await logs()).npm).not.toMatch(/^deprecate /m);
			const allowed = await run(command, {
				RELEASE_CONFIRMATION: confirmation,
				FAKE_NPM_REGISTRY_STATE: "exact",
			});
			expect(allowed.exitCode).toBe(0);
			expect((await logs()).npm.match(/^deprecate /gm)).toHaveLength(1);
		},
	);

	it("rejects mirrored annotated tags with divergent object IDs", async () => {
		const evidence = await writeEvidence();
		const result = await run("tag", {
			FAKE_NPM_REGISTRY_STATE: "exact",
			FAKE_GIT_FORGEJO_TAG_STATE: "exact",
			FAKE_GIT_ORIGIN_TAG_STATE: "exact",
			FAKE_GIT_ORIGIN_TAG_OBJECT: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			RELEASE_EVIDENCE_PATH: evidence.path,
			RELEASE_CONFIRMATION: evidence.confirmation,
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/object IDs must be identical/i);
		expect((await logs()).git).not.toMatch(/^push /m);
	});

	it("tag confirmation binds immutable external evidence SHA-256", async () => {
		const evidence = await writeEvidence();
		const result = await run("tag", {
			FAKE_NPM_REGISTRY_STATE: "exact",
			RELEASE_EVIDENCE_PATH: evidence.path,
			RELEASE_CONFIRMATION: evidence.confirmation,
		});
		expect(result.exitCode).toBe(0);
	});

	it("resumes Forgejo exact through a fetched verified temporary ref, ignoring a conflicting local tag", async () => {
		const evidence = await writeEvidence();
		const result = await run("tag", {
			FAKE_NPM_REGISTRY_STATE: "exact",
			FAKE_GIT_FORGEJO_TAG_STATE: "exact",
			FAKE_GIT_ORIGIN_TAG_STATE: "absent",
			FAKE_GIT_LOCAL_TAG_STATE: "conflict",
			RELEASE_EVIDENCE_PATH: evidence.path,
			RELEASE_CONFIRMATION: evidence.confirmation,
		});
		expect(result.exitCode).toBe(0);
		const git = (await logs()).git;
		expect(git).toMatch(
			/^fetch --no-tags forgejo refs\/tags\/v0\.4\.0:refs\/release-control\//m,
		);
		expect(git).toMatch(/^cat-file -t refs\/release-control\//m);
		expect(git).toMatch(
			/^push origin refs\/release-control\/.*:refs\/tags\/v0\.4\.0$/m,
		);
		expect(git).not.toMatch(/^push origin refs\/tags\/v0\.4\.0/m);
	});

	it.each([
		["both exact resume", "exact", "exact", 0],
		["Forgejo exact then GitHub absent", "exact", "absent", 0],
		["GitHub exact while Forgejo absent", "absent", "exact", 1],
		["peeled conflict", "conflict", "absent", 1],
		["lightweight conflict", "lightweight", "absent", 1],
		["ambiguous remote", "ambiguous", "absent", 1],
	])(
		"classifies independent annotated+peeled tag state: %s",
		async (_name, forgejo, github, failure) => {
			const evidence = await writeEvidence();
			const result = await run("tag", {
				FAKE_NPM_REGISTRY_STATE: "exact",
				FAKE_GIT_FORGEJO_TAG_STATE: forgejo,
				FAKE_GIT_ORIGIN_TAG_STATE: github,
				RELEASE_EVIDENCE_PATH: evidence.path,
				RELEASE_CONFIRMATION: evidence.confirmation,
			});
			expect(result.exitCode === 0).toBe(failure === 0);
			if (forgejo !== "exact" && forgejo !== "absent")
				expect((await logs()).git).not.toMatch(/^push /m);
		},
	);

	it("never performs delete, force, unpublish, or implicit deprecation mutations", async () => {
		const evidence = await writeEvidence();
		await run("tag", {
			FAKE_NPM_REGISTRY_STATE: "exact",
			RELEASE_EVIDENCE_PATH: evidence.path,
			RELEASE_CONFIRMATION: evidence.confirmation,
		});
		const all = `${(await logs()).git}\n${(await logs()).npm}`;
		expect(all).not.toMatch(
			/unpublish|push .*--force|push -f|tag -d|deprecate /,
		);
	});
});
