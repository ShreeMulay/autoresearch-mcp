import { expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dir, "../..");

test("all repository YAML source files parse strictly", async () => {
	const yamlFiles = new Bun.Glob("**/*.{yaml,yml}");
	const excludedRoots = new Set([".git", ".slim", "node_modules"]);
	const files = Array.from(
		yamlFiles.scanSync({ cwd: root, dot: true, onlyFiles: false }),
	)
		.filter((path) => !excludedRoots.has(path.split("/")[0] ?? ""))
		.sort();

	expect(files.length).toBeGreaterThan(0);
	expect(files).toContain(".forgejo/workflows/ci.yml");
	expect(files).not.toContain(".woodpecker.yml");
	expect(files).toContain(".github/ISSUE_TEMPLATE/new-technique.yml");

	const failures: string[] = [];
	for (const path of files) {
		const filePath = join(root, path);
		const stats = await lstat(filePath);
		if (stats.isSymbolicLink() || !stats.isFile()) {
			failures.push(
				`${path}: repository YAML source must be a regular, non-symbolic file`,
			);
			continue;
		}

		const source = await readFile(filePath, "utf8");
		const document = parseDocument(source, { strict: true });
		for (const error of document.errors) {
			failures.push(`${path}: ${error.message}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(`Invalid repository YAML source:\n${failures.join("\n")}`);
	}
});

test("Forgejo Actions exposes one PR-only terminal CI context", async () => {
	const workflowSource = await readFile(
		join(root, ".forgejo/workflows/ci.yml"),
		"utf8",
	);
	const workflow = parseDocument(workflowSource, { strict: true }).toJS() as {
		name: string;
		on: Record<string, unknown>;
		permissions: Record<string, string>;
		jobs: Record<string, Record<string, unknown>>;
	};

	expect(workflow.name).toBe("Forgejo Actions CI");
	expect(workflow.on).toEqual({ pull_request: {} });
	expect(workflow.permissions).toEqual({ contents: "read" });
	expect(Object.keys(workflow.jobs)).toEqual([
		"bun",
		"node22",
		"node24",
		"package_smoke",
		"ci",
	]);

	const checkout =
		"https://data.forgejo.org/actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
	const images = {
		bun: "docker.io/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4",
		node22:
			"docker.io/library/node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436",
		node24:
			"docker.io/library/node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03",
		packageSmoke:
			"docker.io/library/node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d",
	};

	for (const jobName of ["bun", "node22", "node24", "package_smoke"] as const) {
		const job = workflow.jobs[jobName] as {
			"runs-on": string;
			container: { image: string };
			steps: Array<Record<string, unknown>>;
		};
		expect(job["runs-on"]).toBe("forgejo-ci");
		expect(job.container.image).toBe(
			jobName === "package_smoke" ? images.packageSmoke : images[jobName],
		);
		const setup = String(job.steps[0]?.run);
		expect(setup).toContain("apt-get update");
		expect(setup).toContain("ca-certificates git");
		expect(setup).toContain("rm -rf /var/lib/apt/lists/*");
		expect(setup).toContain("test -r /etc/ssl/certs/ca-certificates.crt");
		expect(setup).toContain("git --version");
		expect(setup).toContain("node --version");
		if (jobName === "bun") expect(setup).toContain("git nodejs");
		expect(job.steps[1]).toEqual({
			name: "Checkout",
			uses: checkout,
			with: { "persist-credentials": false },
		});
	}

	const allCommands = workflowSource;
	expect(workflow.jobs.package_smoke.needs).toEqual(["bun", "node22", "node24"]);
	const packageSetup = String(
		(workflow.jobs.package_smoke.steps as Array<Record<string, unknown>>)[0]?.run,
	);
	for (const diagnostic of ["df -h .", "df -i .", "ls -A ."]) {
		expect(packageSetup).toContain(diagnostic);
	}
	for (const command of [
		"bun install --frozen-lockfile",
		"bun audit",
		"bun run typecheck",
		"bun run lint",
		"bun test",
		"bun run build",
		"npm install --global bun@1.3.10",
		'test "$(bun --version)" = 1.3.10',
		'test "$(node --version)" = v22.22.1',
		'test "$(npm --version)" = 10.9.4',
		'PACKAGE_SMOKE_LOG_DIR="$CI_WORKSPACE/.ci-logs" bash ci/package-smoke.sh',
		"node --check scripts/install-skill.js",
		'HOME="$SANDBOX" node bin/autoresearch-install-skill --dry-run --target claude',
		'HOME="$SANDBOX" node bin/autoresearch-install-skill --dry-run --target opencode',
		'HOME="$SANDBOX" node bin/autoresearch-install-skill --help',
		'if HOME="$SANDBOX" node bin/autoresearch-install-skill --dryrun; then exit 1; fi',
		'if HOME="$SANDBOX" node bin/autoresearch-install-skill --target bogus; then exit 1; fi',
		'test ! -e "$SANDBOX/.claude/skills" && test ! -e "$SANDBOX/.opencode/skills"',
		'rm -rf "$SANDBOX"',
	]) {
		expect(allCommands).toContain(command);
	}

	for (const forbidden of [
		"bun:latest",
		"ai-review",
		"secrets.",
		"push:",
		"workflow_dispatch",
	]) {
		expect(allCommands).not.toContain(forbidden);
	}

	const terminal = workflow.jobs.ci as {
		"runs-on": string;
		needs: string[];
		if: string;
		container: { image: string };
		steps: Array<Record<string, unknown>>;
	};
	expect(terminal["runs-on"]).toBe("forgejo-ci");
	expect(terminal.needs).toEqual(["bun", "node22", "node24", "package_smoke"]);
	expect(terminal.if).toBe("always()");
	expect(terminal.container.image).toBe(images.bun);
	expect(terminal.steps).toHaveLength(1);
	const terminalRun = String(terminal.steps[0]?.run);
	for (const dependency of ["bun", "node22", "node24", "package_smoke"]) {
		expect(terminalRun).toContain(`needs.${dependency}.result`);
		expect(terminalRun).toContain("success");
	}
});

test("dependency remediation floors remain blocking package contracts", async () => {
	const packageJson = JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	) as { resolutions: Record<string, string> };
	expect(packageJson.resolutions).toEqual({
		"@hono/node-server": "1.19.15",
		"body-parser": "2.3.0",
		"fast-uri": "3.1.5",
		hono: "4.12.34",
		"ip-address": "10.4.0",
		qs: "6.15.3",
	});

	const smoke = await readFile(join(root, "ci/package-smoke.sh"), "utf8");
	const consumerFloors = {
		...packageJson.resolutions,
		"fast-uri": "3.1.3",
	};
	for (const [name, floor] of Object.entries(consumerFloors)) {
		expect(smoke).toContain(`"${name}": "${floor}"`);
	}
});
