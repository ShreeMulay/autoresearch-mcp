import { createHash } from "node:crypto";
import {
	closeSync,
	fchmodSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

interface Artifact {
	schemaVersion: 1;
	package: "autoresearch-mcp";
	version: "0.4.0";
	registry: "https://registry.npmjs.org/";
	publisher: "shreemulay";
	sha256: string;
	sha512: string;
	integrity: string;
	registryReads: { attempts: number; backoffSeconds: number[] };
}

interface Evidence {
	schemaVersion: 1;
	package: string;
	version: string;
	registry: string;
	publisher: string;
	releaseSha: string;
	sha256: string;
	sha512: string;
	integrity: string;
	smokeCompletedAt: string;
}

type RegistryState =
	| { kind: "absent" }
	| { kind: "present-exact"; tarball: string }
	| { kind: "present-conflict"; reason: string }
	| { kind: "ambiguous"; reason: string };
type TagState =
	| { kind: "absent" }
	| { kind: "present-exact"; object: string }
	| { kind: "present-conflict" }
	| { kind: "ambiguous" };

const root = resolve(import.meta.dir, "..");
const artifactPath = join(import.meta.dir, "release-artifact.json");
const artifactKeys = [
	"integrity",
	"package",
	"publisher",
	"registry",
	"registryReads",
	"schemaVersion",
	"sha256",
	"sha512",
	"version",
].sort();
const registryReadKeys = ["attempts", "backoffSeconds"].sort();
const evidenceKeys = [
	"integrity",
	"package",
	"publisher",
	"registry",
	"releaseSha",
	"schemaVersion",
	"sha256",
	"sha512",
	"smokeCompletedAt",
	"version",
].sort();
const deprecation =
	"DEPRECATED: v0.4.0 failed post-publication integrity verification. Do not install. Await a corrected release.";

function fail(message: string): never {
	throw new Error(`release-control: ${message}`);
}

function loadArtifact(): Artifact {
	const value = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact;
	if (
		JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(artifactKeys)
	)
		fail("release artifact schema is not closed");
	if (
		value.schemaVersion !== 1 ||
		value.package !== "autoresearch-mcp" ||
		value.version !== "0.4.0" ||
		value.registry !== "https://registry.npmjs.org/" ||
		value.publisher !== "shreemulay"
	)
		fail("release artifact identity is not canonical");
	if (
		!/^[a-f0-9]{64}$/.test(value.sha256) ||
		!/^[a-f0-9]{128}$/.test(value.sha512)
	)
		fail("release artifact hex digest is invalid");
	if (
		value.integrity !==
		`sha512-${Buffer.from(value.sha512, "hex").toString("base64")}`
	)
		fail("release artifact SRI does not match SHA-512");
	const reads = value.registryReads;
	if (
		JSON.stringify(Object.keys(reads ?? {}).sort()) !==
			JSON.stringify(registryReadKeys) ||
		!Number.isInteger(reads?.attempts) ||
		reads.attempts < 2 ||
		reads.attempts > 5 ||
		!Array.isArray(reads.backoffSeconds) ||
		reads.backoffSeconds.length !== reads.attempts ||
		reads.backoffSeconds.some(
			(seconds) => !Number.isInteger(seconds) || seconds < 0 || seconds > 30,
		)
	)
		fail("registry read policy is not bounded");
	return value;
}

function safeReadEnvironment(home: string): Record<string, string> {
	const result: Record<string, string> = {
		HOME: home,
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		npm_config_userconfig: "/dev/null",
		npm_config_update_notifier: "false",
		npm_config_audit: "false",
		npm_config_fund: "false",
	};
	// Hermetic fixtures use FAKE_* only with an injected fake executable.
	for (const [key, value] of Object.entries(process.env))
		if (key.startsWith("FAKE_") && value !== undefined) result[key] = value;
	return result;
}

function execute(
	command: string,
	args: string[],
	options: { cwd?: string; env?: Record<string, string>; input?: string } = {},
) {
	const result = Bun.spawnSync([command, ...args], {
		cwd: options.cwd ?? root,
		env: options.env ?? process.env,
		stdin: options.input === undefined ? undefined : Buffer.from(options.input),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

function requireSuccess(
	command: string,
	args: string[],
	description: string,
	cwd = root,
	input?: string,
): string {
	const result = execute(command, args, { cwd, input });
	if (result.code !== 0) fail(`${description} failed`);
	return result.stdout.trim();
}

function digest(path: string, algorithm: "sha256" | "sha512"): string {
	return createHash(algorithm).update(readFileSync(path)).digest("hex");
}

function assertArtifact(path: string, artifact: Artifact): void {
	if (!isAbsolute(path) || !path.endsWith(".tgz"))
		fail("verified artifact must be an absolute .tgz");
	if (
		digest(path, "sha256") !== artifact.sha256 ||
		digest(path, "sha512") !== artifact.sha512
	)
		fail("artifact digest conflict");
}

function npmWhoami(artifact: Artifact): void {
	const result = execute("npm", ["whoami", `--registry=${artifact.registry}`]);
	if (result.code !== 0) fail("npm whoami authentication is ambiguous");
	if (result.stdout.trim() !== artifact.publisher)
		fail("npm publisher does not match expected whoami");
}

function gitMain(remote: "forgejo" | "origin"): string {
	const result = execute("git", ["ls-remote", remote, "refs/heads/main"]);
	if (result.code !== 0)
		fail(
			`${remote === "forgejo" ? "Forgejo" : "GitHub"} main ref query is ambiguous`,
		);
	const lines = result.stdout.trim().split("\n").filter(Boolean);
	if (lines.length !== 1) fail(`${remote} main ref response is invalid`);
	const [sha, ref, ...extra] = lines[0]?.split(/\s+/) ?? [];
	if (
		!/^[a-f0-9]{40}$/.test(sha ?? "") ||
		ref !== "refs/heads/main" ||
		extra.length
	)
		fail(`${remote} main ref response is invalid`);
	return sha as string;
}

function gitTag(remote: "forgejo" | "origin", releaseSha: string): TagState {
	const result = execute("git", [
		"ls-remote",
		remote,
		"refs/tags/v0.4.0",
		"refs/tags/v0.4.0^{}",
	]);
	if (result.code !== 0) return { kind: "ambiguous" };
	const lines = result.stdout.trim().split("\n").filter(Boolean);
	if (lines.length === 0) return { kind: "absent" };
	const refs = new Map<string, string>();
	for (const line of lines) {
		const fields = line.split(/\s+/);
		if (fields.length !== 2 || !/^[a-f0-9]{40}$/.test(fields[0] ?? ""))
			return { kind: "ambiguous" };
		if (refs.has(fields[1] as string)) return { kind: "ambiguous" };
		refs.set(fields[1] as string, fields[0] as string);
	}
	const object = refs.get("refs/tags/v0.4.0");
	const peeled = refs.get("refs/tags/v0.4.0^{}");
	if (
		!object ||
		!peeled ||
		refs.size !== 2 ||
		object === releaseSha ||
		peeled !== releaseSha
	)
		return { kind: "present-conflict" };
	return { kind: "present-exact", object };
}

function verifyLocalTagRef(
	ref: string,
	expectedObject: string,
	releaseSha: string,
): void {
	const object = requireSuccess(
		"git",
		["rev-parse", ref],
		"local tag object resolution",
	);
	const type = requireSuccess(
		"git",
		["cat-file", "-t", ref],
		"local tag object type verification",
	);
	const peeled = requireSuccess(
		"git",
		["rev-parse", `${ref}^{}`],
		"local tag peeled SHA verification",
	);
	if (object !== expectedObject || type !== "tag" || peeled !== releaseSha)
		fail("fetched local tag object identity is not exact");
}

function authority(releaseSha?: string, requireTagsAbsent = false): string {
	const dirty = requireSuccess(
		"git",
		["status", "--porcelain"],
		"git clean check",
	);
	if (dirty) fail("checkout is dirty; a clean release checkout is required");
	const head = requireSuccess("git", ["rev-parse", "HEAD"], "HEAD resolution");
	if (!/^[a-f0-9]{40}$/.test(head)) fail("HEAD is not a full commit SHA");
	const expected = releaseSha ?? head;
	if (head !== expected) fail("HEAD does not equal the bound release SHA");
	if (gitMain("forgejo") !== expected)
		fail("Forgejo main ref does not equal release SHA");
	if (gitMain("origin") !== expected)
		fail("GitHub main ref does not equal release SHA");
	if (requireTagsAbsent) {
		for (const remote of ["forgejo", "origin"] as const) {
			const state = gitTag(remote, expected);
			if (state.kind !== "absent")
				fail(`${remote} tag v0.4.0 is ${state.kind}`);
		}
	}
	return expected;
}

function freshDirectory(prefix: string): string {
	const result = Bun.spawnSync(["mktemp", "-d", "-t", `${prefix}.XXXXXX`], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) fail("mktemp failed");
	const path = result.stdout.toString().trim();
	if (path.length === 0 || !isAbsolute(path))
		fail("mktemp did not return a nonempty absolute external path");
	let canonical: string;
	try {
		canonical = realpathSync(path);
		if (!statSync(canonical).isDirectory())
			fail("mktemp path is not a created directory");
	} catch {
		fail("mktemp path is not a created directory");
	}
	if (canonical === root || canonical.startsWith(`${root}/`))
		fail("mktemp path must be external to the checkout");
	return canonical;
}

function registryOnce(artifact: Artifact): RegistryState {
	const work = freshDirectory("release-registry-read");
	const home = join(work, "home");
	const cache = join(work, "cache");
	const pack = join(work, "pack");
	requireSuccess(
		"mkdir",
		["-p", home, cache, pack],
		"fresh registry directory creation",
	);
	const env = safeReadEnvironment(home);
	const spec = `${artifact.package}@${artifact.version}`;
	const view = execute(
		"npm",
		[
			"view",
			spec,
			"--json",
			`--registry=${artifact.registry}`,
			`--cache=${cache}`,
		],
		{ env },
	);
	if (view.code !== 0) {
		const output = `${view.stdout}\n${view.stderr}`;
		const codes = [...output.matchAll(/\bE[A-Z0-9]+\b/g)].map(
			(match) => match[0],
		);
		if (
			/E401|E403|ETARGET|ETIMEDOUT|timeout|network|ENOTFOUND|EAI_AGAIN|429|5\d\d/i.test(
				output,
			)
		)
			return {
				kind: "ambiguous",
				reason: "registry authentication, timeout, network, or server error",
			};
		if (codes.length > 0 && codes.every((code) => code === "E404"))
			return { kind: "absent" };
		return { kind: "ambiguous", reason: "unclassified registry read failure" };
	}
	let metadata: { version?: string; dist?: { integrity?: string } };
	try {
		metadata = JSON.parse(view.stdout);
	} catch {
		return { kind: "ambiguous", reason: "malformed registry metadata" };
	}
	if (
		metadata.version !== artifact.version ||
		metadata.dist?.integrity !== artifact.integrity
	)
		return {
			kind: "present-conflict",
			reason: "registry version or SRI differs",
		};
	const packed = execute(
		"npm",
		[
			"pack",
			spec,
			"--pack-destination",
			pack,
			`--registry=${artifact.registry}`,
			`--cache=${cache}`,
			"--ignore-scripts",
			"--loglevel",
			"error",
		],
		{ env },
	);
	if (packed.code !== 0)
		return { kind: "ambiguous", reason: "registry tarball download failed" };
	const tarball = join(pack, `${artifact.package}-${artifact.version}.tgz`);
	try {
		assertArtifact(tarball, artifact);
	} catch {
		return {
			kind: "present-conflict",
			reason: "downloaded registry bytes differ",
		};
	}
	return { kind: "present-exact", tarball };
}

async function reconcile(artifact: Artifact): Promise<RegistryState> {
	let last: RegistryState = {
		kind: "ambiguous",
		reason: "no registry read completed",
	};
	let ambiguity: RegistryState | undefined;
	for (let attempt = 0; attempt < artifact.registryReads.attempts; attempt++) {
		const seconds = artifact.registryReads.backoffSeconds[attempt] ?? 0;
		if (seconds > 0) await Bun.sleep(seconds * 1000);
		last = registryOnce(artifact);
		if (last.kind === "present-exact" || last.kind === "present-conflict")
			return last;
		if (last.kind === "ambiguous") ambiguity = last;
	}
	return ambiguity ?? last;
}

function runInstalledSmoke(tarball: string, artifact: Artifact): void {
	assertArtifact(tarball, artifact);
	const work = freshDirectory("release-registry-smoke");
	const home = join(work, "home");
	const consumer = join(work, "consumer");
	requireSuccess(
		"mkdir",
		["-p", home, consumer],
		"registry smoke directory creation",
	);
	const env = safeReadEnvironment(home);
	const npm = (args: string[], description: string) => {
		const result = execute(
			"npm",
			[...args, `--registry=${artifact.registry}`],
			{ cwd: consumer, env },
		);
		if (result.code !== 0) fail(description);
		return result.stdout;
	};
	npm(["init", "--yes"], "registry smoke npm init failed");
	npm(
		["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
		"verified-byte install failed",
	);
	npm(["audit", "--omit=dev"], "production audit failed");
	const main = join(consumer, "node_modules", ".bin", "autoresearch-mcp");
	const installer = join(
		consumer,
		"node_modules",
		".bin",
		"autoresearch-install-skill",
	);
	for (const [bin, args] of [
		[main, ["--help"]],
		[installer, ["--help"]],
		[installer, ["--dry-run", "--target", "opencode"]],
	] as const) {
		if (execute(bin, [...args], { cwd: consumer, env }).code !== 0)
			fail("installed public bin smoke failed");
	}
	const requests = [
		{
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "registry-smoke", version: "1" },
			},
		},
		{ jsonrpc: "2.0", method: "notifications/initialized" },
		{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
		{
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "get_server_info", arguments: {} },
		},
	]
		.map((value) => JSON.stringify(value))
		.join("\n");
	const handshake = execute("timeout", ["20", main], {
		cwd: consumer,
		env: { ...env, AUTORESEARCH_DB_PATH: ":memory:" },
		input: `${requests}\n`,
	});
	if (handshake.code !== 0) fail("MCP handshake process failed");
	const messages = handshake.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const byId = new Map(
		messages
			.filter((message) => message.id)
			.map((message) => [message.id, message]),
	);
	const expectedTools = [
		"get_experiment",
		"get_server_info",
		"get_technique",
		"get_template",
		"list_experiments",
		"log_result",
		"log_technique_outcome",
		"register_experiment",
		"scaffold_experiment",
		"search_techniques",
		"suggest_technique",
		"update_experiment",
	];
	const actualTools = (byId.get(2)?.result?.tools ?? [])
		.map((tool: { name: string }) => tool.name)
		.sort();
	const info = JSON.parse(byId.get(3)?.result?.content?.[0]?.text ?? "null");
	if (
		byId.get(1)?.result?.serverInfo?.version !== artifact.version ||
		JSON.stringify(actualTools) !== JSON.stringify(expectedTools) ||
		info?.version !== artifact.version ||
		info?.catalog?.total !== 30
	)
		fail("exact MCP handshake contract failed");
}

function evidenceDestination(path: string): string {
	if (!isAbsolute(path)) fail("RELEASE_EVIDENCE_PATH must be absolute");
	try {
		lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			// The destination must be new; openSync("wx") enforces this again at write.
		} else throw error;
		let parent: string;
		try {
			parent = realpathSync(dirname(path));
			if (!statSync(parent).isDirectory())
				fail("RELEASE_EVIDENCE_PATH parent must be a directory");
		} catch (parentError) {
			if (
				parentError instanceof Error &&
				parentError.message.startsWith("release-control:")
			)
				throw parentError;
			fail("RELEASE_EVIDENCE_PATH parent must exist and resolve exactly");
		}
		const checkout = realpathSync(root);
		if (parent === checkout || parent.startsWith(`${checkout}/`))
			fail("RELEASE_EVIDENCE_PATH must resolve outside the git checkout");
		return join(parent, basename(path));
	}
	return fail("RELEASE_EVIDENCE_PATH destination must not exist");
}

function writeEvidence(
	path: string,
	artifact: Artifact,
	releaseSha: string,
): void {
	const destination = evidenceDestination(path);
	const evidence: Evidence = {
		schemaVersion: 1,
		package: artifact.package,
		version: artifact.version,
		registry: artifact.registry,
		publisher: artifact.publisher,
		releaseSha,
		sha256: artifact.sha256,
		sha512: artifact.sha512,
		integrity: artifact.integrity,
		smokeCompletedAt: new Date().toISOString(),
	};
	let descriptor: number;
	try {
		descriptor = openSync(destination, "wx", 0o444);
	} catch {
		fail("RELEASE_EVIDENCE_PATH destination must not exist");
	}
	try {
		writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`);
		fchmodSync(descriptor, 0o444);
	} finally {
		closeSync(descriptor);
	}
}

async function smoke(artifact: Artifact, releaseSha?: string): Promise<void> {
	for (const key of [
		"RELEASE_PACKAGE",
		"RELEASE_VERSION",
		"RELEASE_REGISTRY",
		"RELEASE_PUBLISHER",
	])
		if (process.env[key] !== undefined) fail(`${key} override is prohibited`);
	const boundReleaseSha = authority(releaseSha, false);
	const evidencePath = process.env.RELEASE_EVIDENCE_PATH ?? "";
	evidenceDestination(evidencePath);
	let tarball: string;
	if (process.env.LOCAL_ARTIFACT !== undefined) {
		tarball = process.env.LOCAL_ARTIFACT;
		assertArtifact(tarball, artifact);
	} else {
		const state = await reconcile(artifact);
		if (state.kind !== "present-exact")
			fail(`registry smoke requires present-exact; got ${state.kind}`);
		tarball = state.tarball;
	}
	runInstalledSmoke(tarball, artifact);
	writeEvidence(evidencePath, artifact, boundReleaseSha);
}

function exactConfirmation(expected: string): void {
	if (process.env.RELEASE_CONFIRMATION !== expected)
		fail("exact bound RELEASE_CONFIRMATION is required");
}

async function publish(artifact: Artifact): Promise<void> {
	const releaseSha = authority(undefined, true);
	exactConfirmation(
		`publish|${artifact.package}|${artifact.version}|${artifact.registry}|${artifact.publisher}|${releaseSha}|${artifact.sha256}`,
	);
	evidenceDestination(process.env.RELEASE_EVIDENCE_PATH ?? "");
	npmWhoami(artifact);
	const initial = await reconcile(artifact);
	if (initial.kind === "present-conflict" || initial.kind === "ambiguous")
		fail(`registry preflight ${initial.kind}`);
	if (initial.kind === "present-exact") {
		await smoke(artifact, releaseSha);
		return;
	}
	const output = freshDirectory("verified-release-artifact");
	const packageSmoke = execute("bash", [
		join(import.meta.dir, "package-smoke.sh"),
		"--artifact-output",
		output,
	]);
	if (packageSmoke.code !== 0)
		fail("canonical package smoke failed before publication");
	const tarball = join(output, `${artifact.package}-${artifact.version}.tgz`);
	assertArtifact(tarball, artifact);
	authority(releaseSha, true);
	// This check intentionally borders the mutation: no command may open the
	// approved tarball between its final SHA-256/SHA-512 verification and publish.
	assertArtifact(tarball, artifact);
	const mutation = execute("npm", [
		"publish",
		tarball,
		"--access",
		"public",
		`--registry=${artifact.registry}`,
	]);
	const state = await reconcile(artifact);
	if (state.kind !== "present-exact")
		fail(
			`publish reconciliation ended ${state.kind}; mutation exit was ${mutation.code}; automatic retry is prohibited`,
		);
	await smoke(artifact, releaseSha);
}

async function deprecateCommand(
	artifact: Artifact,
	clear: boolean,
): Promise<void> {
	const message = clear ? "" : deprecation;
	const action = clear ? "clear-deprecation" : "deprecate";
	exactConfirmation(
		`${action}|${artifact.publisher}|${artifact.package}|${artifact.version}|${artifact.registry}|${message}`,
	);
	npmWhoami(artifact);
	const before = await reconcile(artifact);
	if (before.kind !== "present-exact")
		fail(`${action} requires present-exact registry bytes before mutation`);
	const mutation = execute("npm", [
		"deprecate",
		`${artifact.package}@${artifact.version}`,
		message,
		`--registry=${artifact.registry}`,
	]);
	if (mutation.code !== 0) fail(`${action} mutation failed`);
	for (let attempt = 0; attempt < artifact.registryReads.attempts; attempt++) {
		const bytes = registryOnce(artifact);
		const work = freshDirectory("release-deprecation-read");
		const home = join(work, "home");
		requireSuccess(
			"mkdir",
			["-p", home],
			"deprecation read directory creation",
		);
		const result = execute(
			"npm",
			[
				"view",
				`${artifact.package}@${artifact.version}`,
				"deprecated",
				`--registry=${artifact.registry}`,
				`--cache=${join(work, "cache")}`,
			],
			{ env: safeReadEnvironment(home) },
		);
		if (
			bytes.kind === "present-exact" &&
			result.code === 0 &&
			(clear ? result.stdout.trim() === "" : result.stdout.trim() === message)
		)
			return;
		if (attempt + 1 < artifact.registryReads.attempts)
			await Bun.sleep(
				(artifact.registryReads.backoffSeconds[attempt + 1] ?? 0) * 1000,
			);
	}
	fail(`${action} resulting registry state was not verified`);
}

function loadEvidence(path: string, artifact: Artifact): Evidence {
	if (!isAbsolute(path)) fail("RELEASE_EVIDENCE_PATH must be absolute");
	const value = JSON.parse(readFileSync(path, "utf8")) as Evidence;
	if (
		JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(evidenceKeys)
	)
		fail("evidence schema is not closed");
	if (
		value.schemaVersion !== 1 ||
		value.package !== artifact.package ||
		value.version !== artifact.version ||
		value.registry !== artifact.registry ||
		value.publisher !== artifact.publisher ||
		value.sha256 !== artifact.sha256 ||
		value.sha512 !== artifact.sha512 ||
		value.integrity !== artifact.integrity ||
		!/^[a-f0-9]{40}$/.test(value.releaseSha) ||
		Number.isNaN(Date.parse(value.smokeCompletedAt))
	)
		fail("evidence identity does not match approved release artifact");
	return value;
}

async function tag(artifact: Artifact): Promise<void> {
	const path = process.env.RELEASE_EVIDENCE_PATH ?? "";
	const evidence = loadEvidence(path, artifact);
	const evidenceHash = digest(path, "sha256");
	exactConfirmation(
		`tag|${artifact.package}|${artifact.version}|${evidence.releaseSha}|${evidenceHash}`,
	);
	npmWhoami(artifact);
	const registry = await reconcile(artifact);
	if (registry.kind !== "present-exact")
		fail(`tag closeout requires registry present-exact; got ${registry.kind}`);
	authority(evidence.releaseSha, false);
	let forgejo = gitTag("forgejo", evidence.releaseSha);
	let origin = gitTag("origin", evidence.releaseSha);
	if (forgejo.kind === "ambiguous" || origin.kind === "ambiguous")
		fail("remote tag query is ambiguous");
	if (forgejo.kind === "present-conflict" || origin.kind === "present-conflict")
		fail("remote tag is conflicting or lightweight");
	if (forgejo.kind === "absent" && origin.kind === "present-exact")
		fail("GitHub exact while Forgejo is absent is not resumable");
	const temporaryRef = `refs/release-control/v0.4.0-${process.pid}`;
	if (forgejo.kind === "absent") {
		const tagger = requireSuccess(
			"git",
			["var", "GIT_COMMITTER_IDENT"],
			"tagger identity resolution",
		);
		const object = requireSuccess(
			"git",
			["mktag"],
			"annotated tag object creation",
			root,
			`object ${evidence.releaseSha}\ntype commit\ntag v0.4.0\ntagger ${tagger}\n\nv0.4.0\n`,
		);
		requireSuccess(
			"git",
			["update-ref", temporaryRef, object],
			"temporary tag ref creation",
		);
		verifyLocalTagRef(temporaryRef, object, evidence.releaseSha);
		requireSuccess(
			"git",
			["push", "forgejo", `${temporaryRef}:refs/tags/v0.4.0`],
			"Forgejo tag push",
		);
		forgejo = gitTag("forgejo", evidence.releaseSha);
		if (forgejo.kind !== "present-exact")
			fail("Forgejo tag did not verify present-exact");
	}
	if (origin.kind === "absent") {
		const fetchedRef = `${temporaryRef}-forgejo`;
		requireSuccess(
			"git",
			["fetch", "--no-tags", "forgejo", `refs/tags/v0.4.0:${fetchedRef}`],
			"Forgejo annotated tag fetch",
		);
		verifyLocalTagRef(fetchedRef, forgejo.object, evidence.releaseSha);
		requireSuccess(
			"git",
			["push", "origin", `${fetchedRef}:refs/tags/v0.4.0`],
			"GitHub tag push",
		);
		origin = gitTag("origin", evidence.releaseSha);
	}
	if (forgejo.kind !== "present-exact" || origin.kind !== "present-exact")
		fail("both remote tags must verify present-exact");
	if (forgejo.object !== origin.object)
		fail("remote annotated tag object IDs must be identical");
}

async function main(): Promise<void> {
	const artifact = loadArtifact();
	switch (process.argv[2]) {
		case "publish":
			await publish(artifact);
			break;
		case "smoke":
			await smoke(artifact);
			break;
		case "deprecate":
			await deprecateCommand(artifact, false);
			break;
		case "clear-deprecation":
			await deprecateCommand(artifact, true);
			break;
		case "tag":
			await tag(artifact);
			break;
		default:
			fail(
				"usage: release-control.ts publish|smoke|deprecate|clear-deprecation|tag",
			);
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : "unknown failure";
	console.error(message);
	process.exitCode = 1;
});
