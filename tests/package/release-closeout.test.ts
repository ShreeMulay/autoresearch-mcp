import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const control = join(root, "ci", "release-control.ts");
const smoke = join(root, "ci", "package-smoke.sh");
const packageJson = await Bun.file(join(root, "package.json")).json();
let work = "";
let bin = "";
let artifact = "";
let conflict = "";
let npmLog = "";
let gitLog = "";
let smokeLog = "";
let stateFile = "";

async function executable(path: string, contents: string) {
	await writeFile(path, contents);
	await chmod(path, 0o755);
}

beforeEach(async () => {
	work = await mkdtemp(join(tmpdir(), "lean-release-"));
	bin = join(work, "bin");
	await mkdir(bin);
	artifact = join(work, `${packageJson.name}-${packageJson.version}.tgz`);
	conflict = join(work, "conflict.tgz");
	npmLog = join(work, "npm.log");
	gitLog = join(work, "git.log");
	smokeLog = join(work, "smoke.log");
	stateFile = join(work, "state");
	await Promise.all([
		writeFile(artifact, "approved release bytes\n"),
		writeFile(conflict, "different registry bytes\n"),
		writeFile(npmLog, ""),
		writeFile(gitLog, ""),
		writeFile(smokeLog, ""),
		executable(
			join(bin, "git"),
			`#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
case "$1 $2" in
  'status --porcelain') [ "\${FAKE_GIT_DIRTY:-0}" != 1 ] || printf ' M dirty\\n';;
  'rev-parse HEAD') printf '%s\\n' "\${FAKE_HEAD:-1111111111111111111111111111111111111111}";;
  'ls-remote forgejo') printf '%s\\trefs/heads/main\\n' "\${FAKE_MAIN:-1111111111111111111111111111111111111111}";;
  *) exit 64;;
esac
`,
		),
		executable(
			join(bin, "bash"),
			`#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_SMOKE_LOG"
[ "$3" != "$FAKE_ARTIFACT" ] || [ "\${FAKE_LOCAL_SMOKE_STATUS:-0}" = 0 ] || exit "$FAKE_LOCAL_SMOKE_STATUS"
[ "$1" = "${smoke}" ] && [ "$2" = --artifact-input ] && [ -f "$3" ]
`,
		),
		executable(
			join(bin, "npm"),
			`#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
case "$1" in
  whoami)
    [ "\${FAKE_WHOAMI_STATUS:-0}" = 0 ] || exit "$FAKE_WHOAMI_STATUS"
    printf '%s\\n' "\${FAKE_PUBLISHER:-shreemulay}"
    ;;
  pack)
    count=0; [ ! -f "$FAKE_STATE_FILE" ] || count=$(cat "$FAKE_STATE_FILE")
    count=$((count + 1)); printf '%s' "$count" > "$FAKE_STATE_FILE"
    state=\${FAKE_REGISTRY_STATE:-exact}
    [ "$state" != absent-then-exact ] || { [ "$count" -eq 1 ] && state=absent || state=exact; }
    [ "$state" != absent-then-ambiguous ] || { [ "$count" -eq 1 ] && state=absent || state=ambiguous; }
    case "$state" in absent) printf 'npm error code E404\\n' >&2; exit 1;; ambiguous) printf 'npm error code E500\\n' >&2; exit 1;; esac
    destination=.; previous=
    for argument in "$@"; do [ "$previous" = --pack-destination ] && destination=$argument; previous=$argument; done
    source="$FAKE_ARTIFACT"; [ "$state" != conflict ] || source="$FAKE_CONFLICT"
    cp "$source" "$destination/download.tgz"
    printf '[{"filename":"download.tgz"}]\\n'
    ;;
  publish) exit "\${FAKE_PUBLISH_STATUS:-0}";;
  *) exit 64;;
esac
`,
		),
	]);
});

afterEach(async () => rm(work, { recursive: true, force: true }));

async function run(
	command: "publish" | "smoke",
	path = artifact,
	extra: Record<string, string> = {},
) {
	const proc = Bun.spawn(["bun", control, command, path], {
		cwd: root,
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH ?? ""}`,
			FAKE_ARTIFACT: artifact,
			FAKE_CONFLICT: conflict,
			FAKE_GIT_LOG: gitLog,
			FAKE_NPM_LOG: npmLog,
			FAKE_SMOKE_LOG: smokeLog,
			FAKE_STATE_FILE: stateFile,
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
	return { exitCode, output: `${stdout}${stderr}` };
}

const lines = async (path: string) =>
	(await readFile(path, "utf8")).trim().split("\n").filter(Boolean);

describe("lean package smoke", () => {
	it("has no committed artifact/digest dependency and supports absolute artifact input", async () => {
		const source = await readFile(smoke, "utf8");
		expect(source).toContain("--artifact-input");
		expect(source).not.toContain("release-artifact.json");
		expect(source).not.toMatch(/EXPECTED_(BUN|NODE|NPM)_VERSION/);
	});

	it("rejects relative artifact input and output", async () => {
		for (const args of [
			["--artifact-input", "relative.tgz"],
			["--artifact-output", "relative"],
		]) {
			const result = Bun.spawnSync(["bash", smoke, ...args], { cwd: root });
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toMatch(/absolute/i);
		}
	});
});

describe("publish", () => {
	it("requires an absolute regular .tgz", async () => {
		for (const path of ["relative.tgz", work, join(work, "artifact.zip")]) {
			const result = await run("publish", path);
			expect(result.exitCode).not.toBe(0);
		}
		expect(await lines(npmLog)).toHaveLength(0);
	});

	it.each([
		["publisher mismatch", { FAKE_PUBLISHER: "mallory" }, /publisher|whoami/i],
		["authentication failure", { FAKE_WHOAMI_STATUS: "1" }, /auth|whoami/i],
		["dirty checkout", { FAKE_GIT_DIRTY: "1" }, /clean|dirty/i],
		[
			"main mismatch",
			{ FAKE_MAIN: "2222222222222222222222222222222222222222" },
			/Forgejo|main/i,
		],
	] as const)("rejects %s before publication", async (_name, env, message) => {
		const result = await run("publish", artifact, { ...env });
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(message);
		expect(await lines(npmLog)).not.toContainEqual(
			expect.stringMatching(/^publish /),
		);
	});

	it("publishes one absolute tarball when absent, reconciles exact, then smokes", async () => {
		const result = await run("publish", artifact, {
			FAKE_REGISTRY_STATE: "absent-then-exact",
		});
		expect(result.exitCode).toBe(0);
		const npm = await lines(npmLog);
		const publishes = npm.filter((line) => line.startsWith("publish "));
		expect(publishes).toHaveLength(1);
		expect(publishes[0]).toBe(
			`publish ${artifact} --access public --registry=https://registry.npmjs.org/`,
		);
		expect(isAbsolute(publishes[0]?.split(" ")[1] ?? "")).toBe(true);
		const smokes = await lines(smokeLog);
		expect(smokes).toHaveLength(2);
		expect(smokes[0]).toBe(`${smoke} --artifact-input ${artifact}`);
		expect(smokes[1]).toMatch(/--artifact-input .*\.tgz$/);
	});

	it("rejects a locally invalid tarball before npm publish", async () => {
		const result = await run("publish", artifact, {
			FAKE_REGISTRY_STATE: "absent-then-exact",
			FAKE_LOCAL_SMOKE_STATUS: "71",
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toMatch(/package smoke/i);
		expect(await lines(smokeLog)).toEqual([
			`${smoke} --artifact-input ${artifact}`,
		]);
		expect(await lines(npmLog)).not.toContainEqual(
			expect.stringMatching(/^publish /),
		);
	});

	it("never republishes after a nonzero publish with ambiguous reconciliation", async () => {
		const result = await run("publish", artifact, {
			FAKE_REGISTRY_STATE: "absent-then-ambiguous",
			FAKE_PUBLISH_STATUS: "73",
		});
		expect(result.exitCode).not.toBe(0);
		expect(
			(await lines(npmLog)).filter((line) => line.startsWith("publish ")),
		).toHaveLength(1);
		expect(await lines(smokeLog)).toHaveLength(1);
	});

	it("accepts a nonzero publish only when reconciliation finds exact bytes", async () => {
		const result = await run("publish", artifact, {
			FAKE_REGISTRY_STATE: "absent-then-exact",
			FAKE_PUBLISH_STATUS: "73",
		});
		expect(result.exitCode).toBe(0);
		expect(
			(await lines(npmLog)).filter((line) => line.startsWith("publish ")),
		).toHaveLength(1);
		expect(await lines(smokeLog)).toHaveLength(2);
	});

	it("skips publication for existing exact bytes and smokes them", async () => {
		expect(
			(await run("publish", artifact, { FAKE_REGISTRY_STATE: "exact" }))
				.exitCode,
		).toBe(0);
		expect(await lines(npmLog)).not.toContainEqual(
			expect.stringMatching(/^publish /),
		);
		expect(await lines(smokeLog)).toHaveLength(1);
	});

	it("fails on conflicting or ambiguous registry state without publication", async () => {
		for (const state of ["conflict", "ambiguous"]) {
			await writeFile(npmLog, "");
			await writeFile(stateFile, "0");
			const result = await run("publish", artifact, {
				FAKE_REGISTRY_STATE: state,
			});
			expect(result.exitCode).not.toBe(0);
			expect(await lines(npmLog)).not.toContainEqual(
				expect.stringMatching(/^publish /),
			);
		}
	});
});

describe("smoke", () => {
	it("downloads equal registry bytes and invokes existing-artifact package smoke", async () => {
		expect(
			(await run("smoke", artifact, { FAKE_REGISTRY_STATE: "exact" })).exitCode,
		).toBe(0);
		expect(await lines(smokeLog)).toHaveLength(1);
		expect(await lines(npmLog)).not.toContainEqual(
			expect.stringMatching(/^(publish|deprecate|unpublish) /),
		);
	});

	it("rejects registry bytes unequal to the caller's tested tarball", async () => {
		const result = await run("smoke", artifact, {
			FAKE_REGISTRY_STATE: "conflict",
		});
		expect(result.exitCode).not.toBe(0);
		expect(await lines(smokeLog)).toHaveLength(0);
	});

	it("contains none of the removed confirmation, evidence, deprecation, or tag protocols", async () => {
		const source = await readFile(control, "utf8");
		expect(source).not.toMatch(
			/RELEASE_CONFIRMATION|RELEASE_EVIDENCE|deprecat|clear-deprecation|\btag\b|unpublish|push/,
		);
		expect(source).toContain(
			"const packageSpec = `${packageName}@${packageVersion}`",
		);
	});
});
