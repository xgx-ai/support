import { describe, expect, test } from "bun:test";
import type { SupportRoute } from "./contracts";
import { evaluateRepositoryChanges, pathMatches } from "./policy";

const route: SupportRoute = {
	id: "product",
	targetRepository: "example/product",
	baseBranch: "main",
	qmScope: "team:support",
	automationMode: "full",
	allowedPaths: ["src/**", "tests/**"],
	forbiddenPaths: ["src/owned-by-security/**"],
	testCommands: ["bun test"],
};

describe("repository change policy", () => {
	test("supports repository allowlist globs", () => {
		expect(pathMatches("src/features/export.ts", "src/**")).toBe(true);
		expect(pathMatches("package.json", "src/**")).toBe(false);
		expect(pathMatches("src/index.test.ts", "**/*.test.ts")).toBe(true);
		expect(pathMatches("/src/export.ts", "src/**")).toBe(false);
		expect(pathMatches("src/../export.ts", "src/**")).toBe(false);
	});

	test("allows ordinary source and test changes", () => {
		expect(
			evaluateRepositoryChanges(
				{
					baseSha: "base",
					headSha: "head",
					changedPaths: ["src/export.ts", "tests/export.test.ts"],
				},
				route,
			),
		).toEqual([]);
	});

	test("rejects absolute, drive-qualified, and dot-segment paths", () => {
		const unsafePaths = [
			"/src/export.ts",
			"C:\\src\\export.ts",
			"C:src\\export.ts",
			"src/./export.ts",
			"src/../export.ts",
			"./src/export.ts",
			"\\\\server\\share\\export.ts",
		];
		const findings = evaluateRepositoryChanges(
			{
				baseSha: "base",
				headSha: "head",
				changedPaths: unsafePaths,
			},
			route,
		);

		expect(findings).toHaveLength(unsafePaths.length);
		expect(findings.every((finding) => finding.category === "unexpected")).toBe(
			true,
		);
		expect(findings.map((finding) => finding.path)).toEqual(unsafePaths);
	});

	test("blocks standard dependency and CI manifests", () => {
		const findings = evaluateRepositoryChanges(
			{
				baseSha: "base",
				headSha: "head",
				changedPaths: [
					"go.mod",
					"Gemfile.lock",
					"pom.xml",
					"src/Product.csproj",
					".gitlab-ci.yml",
					"azure-pipelines.yaml",
					".github/actions/setup/action.yml",
				],
			},
			{ ...route, allowedPaths: ["**"] },
		);

		expect(findings.map(({ category, path }) => ({ category, path }))).toEqual([
			{ category: "dependencies", path: "go.mod" },
			{ category: "dependencies", path: "Gemfile.lock" },
			{ category: "dependencies", path: "pom.xml" },
			{ category: "dependencies", path: "src/Product.csproj" },
			{ category: "ci", path: ".gitlab-ci.yml" },
			{ category: "ci", path: "azure-pipelines.yaml" },
			{ category: "ci", path: ".github/actions/setup/action.yml" },
		]);
	});

	test("blocks package, database, CI, infrastructure and out-of-scope changes", () => {
		const findings = evaluateRepositoryChanges(
			{
				baseSha: "base",
				headSha: "head",
				changedPaths: [
					"package.json",
					"db/migrations/0001.sql",
					".github/workflows/deploy.yml",
					"infra/main.tf",
					"src/owned-by-security/auth.ts",
					"docs/unplanned.md",
				],
				addedDependencies: ["left-pad"],
				patch: "+ALTER TABLE customer ADD COLUMN unsafe text;",
			},
			route,
		);
		const categories = new Set(findings.map((finding) => finding.category));
		expect(categories).toEqual(
			new Set([
				"dependencies",
				"database",
				"ci",
				"infrastructure",
				"authentication",
				"unexpected",
			]),
		);
	});
});
