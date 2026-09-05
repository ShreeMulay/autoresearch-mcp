import { createHash } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

type Result = { code: number; stdout: string; stderr: string };
type RegistryState =
	| { kind: "absent" | "ambiguous" | "conflict" }
	| { kind: "exact"; tarball: string; work: string };

const root = resolve(import.meta.dir, "..");
const manifest = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
) as {
	name?: unknown;
	version?: unknown;
};
if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
	throw new Error(
		"release-control: package.json requires string name and version",
	);
}
const packageName = manifest.name;
const packageVersion = manifest.version;
const packageSpec = `${packageName}@${packageVersion}`;
const registry = "https://registry.npmjs.org/";
const publisher = "shreemulay";

function fail(message: string): never {
	throw new Error(`release-control: ${message}`);
}

function run(command: string, args: string[], cwd = root): Result {
	const result = Bun.spawnSync([command, ...args], {
		cwd,
		env: process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

function successful(
	command: string,
	args: string[],
	description: string,
): string {
	const result = run(command, args);
	if (result.code !== 0) fail(`${description} failed`);
	return result.stdout.trim();
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkedArtifact(path: string): { path: string; sha256: string } {
	if (!isAbsolute(path) || !path.endsWith(".tgz")) {
		fail("artifact must be an absolute .tgz");
	}
	let canonical: string;
	try {
		if (!lstatSync(path).isFile()) fail("artifact must be a regular .tgz");
		canonical = realpathSync(path);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("release-control:"))
			throw error;
		fail("artifact must be an existing regular .tgz");
	}
	return {
		path: canonical,
		sha256: sha256(canonical),
	};
}

function requirePublishAuthority(): void {
	if (successful("git", ["status", "--porcelain"], "git clean check")) {
		fail("checkout is dirty; publish requires a clean checkout");
	}
	const head = successful("git", ["rev-parse", "HEAD"], "HEAD resolution");
	if (!/^[a-f0-9]{40}$/.test(head)) fail("HEAD is not a full commit SHA");
	const remote = run("git", ["ls-remote", "forgejo", "refs/heads/main"]);
	if (remote.code !== 0) fail("Forgejo main query failed");
	const fields = remote.stdout.trim().split(/\s+/);
	if (
		fields.length !== 2 ||
		fields[0] !== head ||
		fields[1] !== "refs/heads/main"
	) {
		fail("HEAD must equal live Forgejo main");
	}
}

function requirePublisher(): void {
	const whoami = run("npm", ["whoami", `--registry=${registry}`]);
	if (whoami.code !== 0) fail("npm whoami authentication failed");
	if (whoami.stdout.trim() !== publisher)
		fail("npm publisher does not match expected whoami");
}

function classify(expectedSha256: string): RegistryState {
	const work = mkdtempSync(join(tmpdir(), "release-registry-"));
	const destination = join(work, "package");
	mkdirSync(destination);
	const result = run("npm", [
		"pack",
		packageSpec,
		"--pack-destination",
		destination,
		"--ignore-scripts",
		"--json",
		`--registry=${registry}`,
	]);
	if (result.code !== 0) {
		rmSync(work, { recursive: true, force: true });
		const output = `${result.stdout}\n${result.stderr}`;
		if (
			/\b(?:E404|ETARGET)\b/.test(output) &&
			!/\b(?:E401|E403|E5\d\d|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/i.test(output)
		) {
			return { kind: "absent" };
		}
		return { kind: "ambiguous" };
	}
	try {
		const value = JSON.parse(result.stdout) as Array<{ filename?: unknown }>;
		const filename = value.length === 1 ? value[0]?.filename : undefined;
		if (
			typeof filename !== "string" ||
			basename(filename) !== filename ||
			!filename.endsWith(".tgz")
		) {
			throw new Error("invalid npm pack response");
		}
		const tarball = join(destination, filename);
		if (!lstatSync(tarball).isFile())
			throw new Error("download is not regular");
		const actual = sha256(tarball);
		if (actual !== expectedSha256) {
			rmSync(work, { recursive: true, force: true });
			return { kind: "conflict" };
		}
		return { kind: "exact", tarball, work };
	} catch {
		rmSync(work, { recursive: true, force: true });
		return { kind: "ambiguous" };
	}
}

async function reconcile(expectedSha256: string): Promise<RegistryState> {
	for (const delay of [0, 250, 750]) {
		if (delay) await Bun.sleep(delay);
		const state = classify(expectedSha256);
		if (state.kind === "exact" || state.kind === "conflict") return state;
	}
	return { kind: "ambiguous" };
}

function packageSmoke(tarball: string): void {
	const result = run("bash", [
		join(import.meta.dir, "package-smoke.sh"),
		"--artifact-input",
		tarball,
	]);
	if (result.code !== 0) fail("package smoke failed");
}

function smokeExact(state: Extract<RegistryState, { kind: "exact" }>): void {
	try {
		packageSmoke(state.tarball);
	} finally {
		rmSync(state.work, { recursive: true, force: true });
	}
}

async function smoke(expectedSha256: string): Promise<void> {
	const state = classify(expectedSha256);
	if (state.kind !== "exact") fail(`registry bytes are ${state.kind}`);
	smokeExact(state);
}

async function publish(artifact: {
	path: string;
	sha256: string;
}): Promise<void> {
	requirePublishAuthority();
	requirePublisher();
	const before = classify(artifact.sha256);
	if (before.kind === "exact") {
		smokeExact(before);
		return;
	}
	if (before.kind !== "absent") fail(`registry state is ${before.kind}`);
	packageSmoke(artifact.path);
	if (sha256(artifact.path) !== artifact.sha256) {
		fail("tested artifact bytes changed before publication");
	}

	const mutation = run("npm", [
		"publish",
		artifact.path,
		"--access",
		"public",
		`--registry=${registry}`,
	]);
	const after = await reconcile(artifact.sha256);
	if (after.kind !== "exact") {
		fail(
			`publish reconciliation is ${after.kind}; npm exited ${mutation.code}; automatic retry is prohibited`,
		);
	}
	smokeExact(after);
}

async function main(): Promise<void> {
	const [command, path, ...extra] = process.argv.slice(2);
	if ((command !== "publish" && command !== "smoke") || !path || extra.length) {
		fail("usage: release-control.ts publish|smoke /absolute/tested.tgz");
	}
	const artifact = checkedArtifact(path);
	if (command === "publish") await publish(artifact);
	else await smoke(artifact.sha256);
}

main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "release-control: unknown failure",
	);
	process.exitCode = 1;
});
