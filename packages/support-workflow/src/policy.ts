import type {
	RestrictedChange,
	RestrictedChangeCategory,
	SupportRoute,
} from "./contracts";
import type { RepositoryChangeSet } from "./ports";

const packageFiles = new Set([
	"package.json",
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"deno.lock",
	"composer.json",
	"composer.lock",
	"requirements.txt",
	"poetry.lock",
	"pyproject.toml",
	"pipfile",
	"pipfile.lock",
	"uv.lock",
	"setup.py",
	"setup.cfg",
	"environment.yml",
	"environment.yaml",
	"go.mod",
	"go.sum",
	"gemfile",
	"gemfile.lock",
	"cargo.toml",
	"cargo.lock",
	"pom.xml",
	"build.gradle",
	"build.gradle.kts",
	"settings.gradle",
	"settings.gradle.kts",
	"gradle.lockfile",
	"packages.lock.json",
	"directory.packages.props",
	"package.swift",
	"package.resolved",
	"mix.exs",
	"mix.lock",
	"deps.edn",
	"project.clj",
]);

const packageExtensions = new Set([".csproj", ".fsproj", ".vbproj", ".sln"]);

const ciFiles = new Set([
	".gitlab-ci.yml",
	".gitlab-ci.yaml",
	".travis.yml",
	".travis.yaml",
	"azure-pipelines.yml",
	"azure-pipelines.yaml",
	"bitbucket-pipelines.yml",
	"bitbucket-pipelines.yaml",
	"buildkite.yml",
	"buildkite.yaml",
	"appveyor.yml",
	"appveyor.yaml",
	".drone.yml",
	".drone.yaml",
	".woodpecker.yml",
	".woodpecker.yaml",
	"jenkinsfile",
	"action.yml",
	"action.yaml",
]);

const generatedExtensions = new Set([
	".bin",
	".exe",
	".dll",
	".dylib",
	".so",
	".wasm",
	".jar",
	".zip",
	".tar",
	".gz",
]);

function normalisePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function isUnsafeRepositoryPath(path: string): boolean {
	if (!path || path.includes("\0") || /^[a-z]:/i.test(path)) return true;
	const normalised = path.replaceAll("\\", "/");
	if (normalised.startsWith("/")) return true;
	return normalised
		.split("/")
		.some((segment) => segment === "." || segment === "..");
}

function globPattern(pattern: string): RegExp {
	const normalised = normalisePath(pattern);
	let expression = "^";
	for (let index = 0; index < normalised.length; index += 1) {
		const character = normalised[index];
		const next = normalised[index + 1];
		if (character === "*" && next === "*") {
			if (normalised[index + 2] === "/") {
				expression += "(?:.*/)?";
				index += 2;
			} else {
				expression += ".*";
				index += 1;
			}
		} else if (character === "*") {
			expression += "[^/]*";
		} else if (character === "?") {
			expression += "[^/]";
		} else {
			expression += character?.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
		}
	}
	return new RegExp(`${expression}$`);
}

export function pathMatches(path: string, pattern: string): boolean {
	if (isUnsafeRepositoryPath(path)) return false;
	return globPattern(pattern).test(normalisePath(path));
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) => pathMatches(path, pattern));
}

function categoryForPath(path: string): RestrictedChangeCategory | null {
	const normalised = normalisePath(path);
	const segments = normalised.split("/");
	const fileName = segments.at(-1) ?? normalised;
	const extension = fileName.includes(".")
		? `.${fileName.split(".").at(-1)}`
		: "";

	if (packageFiles.has(fileName) || packageExtensions.has(extension)) {
		return "dependencies";
	}
	if (
		fileName.endsWith(".sql") ||
		segments.some((segment) =>
			["migrations", "migration", "drizzle", "prisma", "database"].includes(
				segment,
			),
		) ||
		fileName === "schema.prisma" ||
		fileName.startsWith("drizzle.config")
	) {
		return "database";
	}
	if (
		normalised.startsWith(".github/workflows/") ||
		normalised.startsWith(".github/actions/") ||
		normalised.startsWith(".circleci/") ||
		ciFiles.has(fileName)
	) {
		return "ci";
	}
	if (
		segments.some((segment) =>
			[
				"infra",
				"infrastructure",
				"terraform",
				"pulumi",
				"k8s",
				"helm",
			].includes(segment),
		) ||
		fileName === "dockerfile" ||
		fileName.startsWith("docker-compose") ||
		fileName === "flake.nix" ||
		fileName === "flake.lock"
	) {
		return "infrastructure";
	}
	if (
		segments.some((segment) =>
			["auth", "permissions", "rbac"].includes(segment),
		) ||
		fileName === "auth.ts" ||
		fileName === "auth.js" ||
		fileName.startsWith("auth.") ||
		fileName.includes("permissions")
	) {
		return "authentication";
	}
	if (
		fileName === ".env" ||
		fileName.startsWith(".env.") ||
		segments.some((segment) => ["secrets", "credentials"].includes(segment))
	) {
		return "secrets";
	}
	if (
		segments.some((segment) =>
			["deploy", "deployment", "release"].includes(segment),
		) ||
		fileName.includes("release")
	) {
		return "release";
	}
	if (
		segments.some((segment) => ["generated", "vendor"].includes(segment)) ||
		generatedExtensions.has(extension)
	) {
		return "generated";
	}
	return null;
}

function finding(
	category: RestrictedChangeCategory,
	reason: string,
	path?: string,
): RestrictedChange {
	return {
		category,
		path,
		reason,
		proposal:
			"Stop this run and create a separately scoped, human-approved change proposal.",
	};
}

/**
 * Evaluates the repository-reported change set. Agent-reported paths are never
 * used as the source of truth for this policy decision.
 */
export function evaluateRepositoryChanges(
	changeSet: RepositoryChangeSet,
	route: SupportRoute,
): RestrictedChange[] {
	const findings: RestrictedChange[] = [];

	for (const rawPath of changeSet.changedPaths) {
		if (isUnsafeRepositoryPath(rawPath)) {
			findings.push(
				finding(
					"unexpected",
					"The repository returned an unsafe path.",
					rawPath,
				),
			);
			continue;
		}
		const path = rawPath.replaceAll("\\", "/");

		const category = categoryForPath(path);
		if (category) {
			findings.push(
				finding(
					category,
					`Changes to ${category} files are proposal-only.`,
					path,
				),
			);
		}
		if (matchesAny(path, route.forbiddenPaths)) {
			findings.push(
				finding(
					"unexpected",
					"The path is explicitly forbidden by repository policy.",
					path,
				),
			);
		}
		if (!matchesAny(path, route.allowedPaths)) {
			findings.push(
				finding(
					"unexpected",
					"The path is outside the route's allowlist.",
					path,
				),
			);
		}
	}

	for (const dependency of changeSet.addedDependencies ?? []) {
		findings.push(
			finding(
				"dependencies",
				`The change introduces dependency ${dependency}.`,
			),
		);
	}

	if (
		changeSet.patch &&
		/^\+.*\b(create|alter|drop|truncate)\s+(table|schema|database)\b/im.test(
			changeSet.patch,
		)
	) {
		findings.push(
			finding("database", "The patch contains a database DDL statement."),
		);
	}

	return findings.filter(
		(item, index, all) =>
			all.findIndex(
				(candidate) =>
					candidate.category === item.category && candidate.path === item.path,
			) === index,
	);
}
