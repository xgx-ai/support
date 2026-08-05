import { accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { createSupportAgentRuntime } from "./runtime";

function positiveInteger(name: string, fallback: number): number {
	const raw = Bun.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function port(name: string, fallback: number): number {
	const value = positiveInteger(name, fallback);
	if (value > 65_535) throw new Error(`${name} must be at most 65535`);
	return value;
}

const harness = Bun.env.SUPPORT_AGENT_HARNESS?.trim() ?? "mock";
if (harness !== "mock" && harness !== "codex") {
	throw new Error("SUPPORT_AGENT_HARNESS must be mock or codex");
}
const signingSecret = Bun.env.SUPPORT_AGENT_SIGNING_SECRET?.trim();
if (!signingSecret) throw new Error("SUPPORT_AGENT_SIGNING_SECRET is required");
const repositoryRoot = resolve(
	Bun.env.SUPPORT_AGENT_REPOSITORY_ROOT?.trim() ??
		resolve(import.meta.dir, "../../.."),
);
const configuredCodexBinary = Bun.env.SUPPORT_AGENT_CODEX_BIN?.trim();
const localCodexBinary = join(repositoryRoot, "node_modules/.bin/codex");
const executable = (path: string): boolean => {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
};
const codexBinaryPath =
	harness === "codex"
		? configuredCodexBinary
			? (Bun.which(configuredCodexBinary) ??
				(executable(resolve(repositoryRoot, configuredCodexBinary))
					? resolve(repositoryRoot, configuredCodexBinary)
					: undefined))
			: executable(localCodexBinary)
				? localCodexBinary
				: (Bun.which("codex") ?? undefined)
		: undefined;
if (harness === "codex" && !codexBinaryPath) {
	throw new Error(
		"Codex executable not found; set SUPPORT_AGENT_CODEX_BIN or run bun install to install the pinned local binary",
	);
}
const hostname = Bun.env.SUPPORT_AGENT_HOST?.trim() || "127.0.0.1";
const listenPort = port("SUPPORT_AGENT_PORT", 4_185);
const runtime = createSupportAgentRuntime({
	signingSecret,
	harness,
	workspaceRoot: Bun.env.SUPPORT_AGENT_WORKSPACE_ROOT?.trim() || undefined,
	skillsRoot: resolve(
		Bun.env.SUPPORT_AGENT_SKILLS_ROOT?.trim() ??
			resolve(import.meta.dir, "../skills"),
	),
	turnTimeoutMs: positiveInteger("SUPPORT_AGENT_TURN_TIMEOUT_MS", 80_000),
	securityScreenTimeoutMs: positiveInteger(
		"SUPPORT_AGENT_SECURITY_SCREEN_TIMEOUT_MS",
		30_000,
	),
	concurrency: positiveInteger("SUPPORT_AGENT_CONCURRENCY", 2),
	codexBinaryPath,
	codexEnvironment: Bun.env,
});

const server = Bun.serve({
	hostname,
	port: listenPort,
	fetch: runtime.fetch,
});

console.log(
	`[support-agent] ${harness} harness listening at ${server.url.origin}`,
);

function shutdown(signal: string): void {
	console.log(`[support-agent] ${signal} received, shutting down`);
	void server.stop(true);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
