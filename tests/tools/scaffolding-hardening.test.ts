/**
 * Regression tests for scaffolding safety helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { constants } from "node:fs";
import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertAllowedTemplateName,
	ensureSafeScaffoldDirectory,
	ensureScaffoldFilesWritable,
	makeEvalExecutable,
	readTemplateFileOrNull,
	resolveTemplatePath,
} from "../../src/tools/scaffolding.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "autoresearch-scaffold-"));
	tempDirs.push(dir);
	return dir;
}

describe("template path safety", () => {
	it("allows only known template filenames", () => {
		expect(() => assertAllowedTemplateName("program.md")).not.toThrow();
		expect(() => assertAllowedTemplateName("eval.sh")).not.toThrow();
		expect(() => assertAllowedTemplateName("results.tsv")).not.toThrow();

		expect(() => assertAllowedTemplateName("../package.json")).toThrow(
			/Unsupported template/,
		);
		expect(() => assertAllowedTemplateName("/etc/passwd")).toThrow(
			/Unsupported template/,
		);
	});

	it("resolved template paths stay under the requested recipe template directory", () => {
		const templatePath = resolveTemplatePath(
			"prompt-optimization",
			"program.md",
		);

		expect(
			templatePath.endsWith("catalog/templates/prompt-optimization/program.md"),
		).toBe(true);
		expect(() =>
			resolveTemplatePath("prompt-optimization", "../../package.json"),
		).toThrow(/Unsupported template/);
	});

	it("returns null only for missing template files", async () => {
		const dir = await tempDir();
		const missingPath = join(dir, "missing-template.md");
		const directoryPath = join(dir, "not-a-file");
		await mkdir(directoryPath);

		await expect(readTemplateFileOrNull(missingPath)).resolves.toBeNull();
		await expect(readTemplateFileOrNull(directoryPath)).rejects.toThrow();
	});
});

describe("scaffold file safety", () => {
	it("refuses to overwrite existing files by default", async () => {
		const dir = await tempDir();
		const filePath = join(dir, "program.md");
		await writeFile(filePath, "existing", "utf8");

		await expect(
			ensureScaffoldFilesWritable([filePath], false),
		).rejects.toThrow(/already exists/);
	});

	it("allows overwrite only when explicitly requested", async () => {
		const dir = await tempDir();
		const filePath = join(dir, "program.md");
		await writeFile(filePath, "existing", "utf8");

		await expect(
			ensureScaffoldFilesWritable([filePath], true),
		).resolves.toBeUndefined();
	});

	it("refuses to write through scaffold file symlinks even with overwrite", async () => {
		const dir = await tempDir();
		const outside = await tempDir();
		const outsideFile = join(outside, "outside.md");
		const filePath = join(dir, "program.md");
		await writeFile(outsideFile, "outside", "utf8");
		await symlink(outsideFile, filePath);

		await expect(ensureScaffoldFilesWritable([filePath], true)).rejects.toThrow(
			/through symlink/,
		);
	});

	it("refuses to scaffold through a symlinked autoresearch directory", async () => {
		const dir = await tempDir();
		const outside = await tempDir();
		const scaffoldDir = join(dir, "autoresearch");
		await symlink(outside, scaffoldDir);

		await expect(ensureSafeScaffoldDirectory(scaffoldDir)).rejects.toThrow(
			/symlinked directory/,
		);
	});

	it("makes scaffolded evaluator executable", async () => {
		const dir = await tempDir();
		const evalPath = join(dir, "eval.sh");
		await writeFile(evalPath, "#!/usr/bin/env bash\nprintf '0\\n'", "utf8");
		await chmod(evalPath, 0o644);

		await makeEvalExecutable(evalPath);
		await expect(access(evalPath, constants.X_OK)).resolves.toBeNull();
	});
});
