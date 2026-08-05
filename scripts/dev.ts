import { accessSync, constants, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const agentRuntimeRoot = join(repositoryRoot, "packages/support-agent-runtime");
const demoRoot = join(repositoryRoot, "examples/workflow-demo");
const supportEnvironmentFile = join(repositoryRoot, ".env");
const bunExecutable = process.execPath;
const runtimeOnly = process.argv.slice(2).includes("--agent-only");
const unexpectedArguments = process.argv
	.slice(2)
	.filter((argument) => argument !== "--agent-only");

type ShutdownSignal = "SIGINT" | "SIGTERM";
type ManagedChild = {
	name: "Agent runtime" | "Support UI";
	process: ReturnType<typeof Bun.spawn>;
	exited: boolean;
};

function parsePort(
	name: string,
	fallback: number,
	raw = Bun.env[name],
): number {
	if (!raw) return fallback;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`${name} must be an integer between 1 and 65535`);
	}
	return port;
}

function parsePositiveMilliseconds(
	name: string,
	fallback: number,
	raw = Bun.env[name],
): number {
	if (!raw) return fallback;
	const milliseconds = Number(raw);
	if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
		throw new Error(`${name} must be a positive number`);
	}
	return milliseconds;
}

function ephemeralSigningSecret(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function readEnvironmentValue(
	path: string,
	name: string,
): Promise<string | undefined> {
	if (!existsSync(path)) return undefined;
	const contents = await Bun.file(path).text();
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
		const rawValue = line.slice(separator + 1).trim();
		const quoted =
			rawValue.length >= 2 &&
			((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
				(rawValue.startsWith("'") && rawValue.endsWith("'")));
		const value = quoted ? rawValue.slice(1, -1) : rawValue;
		return value || undefined;
	}
	return undefined;
}

async function installLockedDependencies(
	label: string,
	cwd: string,
): Promise<void> {
	console.log(`[dev] Installing missing ${label} dependencies`);
	const install = Bun.spawn({
		cmd: [bunExecutable, "install", "--frozen-lockfile"],
		cwd,
		env: process.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await install.exited;
	if (exitCode !== 0) {
		throw new Error(`${label} dependency install failed (exit ${exitCode})`);
	}
}

async function ensureLocalDependencies(
	harness: "mock" | "codex",
): Promise<void> {
	const installations = [
		{
			label: "Support",
			cwd: repositoryRoot,
			marker: join(repositoryRoot, "node_modules/zod"),
		},
		...(harness === "codex"
			? [
					{
						label: "pinned Codex runtime",
						cwd: repositoryRoot,
						marker: join(repositoryRoot, "node_modules/.bin/codex"),
					},
				]
			: []),
		...(!runtimeOnly
			? [
					{
						label: "staff UI",
						cwd: demoRoot,
						marker: join(demoRoot, "node_modules/solid-js"),
					},
				]
			: []),
	];

	for (const installation of installations) {
		if (!existsSync(installation.marker)) {
			await installLockedDependencies(installation.label, installation.cwd);
		}
	}
}

function agentHarness(configuredHarness: string | undefined): "mock" | "codex" {
	const harness = (configuredHarness ?? "mock").trim();
	if (harness === "mock" || harness === "codex") {
		return harness;
	}
	throw new Error("SUPPORT_AGENT_HARNESS must be mock or codex");
}

function resolveCodexExecutable(configured: string | undefined): string {
	const executable = (path: string): boolean => {
		try {
			accessSync(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	};
	if (configured) {
		const configuredPath =
			Bun.which(configured) ??
			(executable(resolve(repositoryRoot, configured))
				? resolve(repositoryRoot, configured)
				: undefined);
		if (configuredPath) return configuredPath;
		throw new Error(
			`SUPPORT_AGENT_CODEX_BIN does not resolve to an executable: ${configured}`,
		);
	}
	const local = join(repositoryRoot, "node_modules/.bin/codex");
	if (executable(local)) return local;
	const fromPath = Bun.which("codex");
	if (fromPath) return fromPath;
	throw new Error(
		"Codex executable not found; set SUPPORT_AGENT_CODEX_BIN or run bun install to install the pinned local binary",
	);
}

function createChild(
	name: ManagedChild["name"],
	command: string[],
	options: { cwd: string; env: Record<string, string | undefined> },
): ManagedChild {
	const subprocess = Bun.spawn({
		cmd: command,
		cwd: options.cwd,
		env: options.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const child: ManagedChild = { name, process: subprocess, exited: false };
	void subprocess.exited.finally(() => {
		child.exited = true;
	});
	return child;
}

async function waitForAgentRuntime(
	child: ManagedChild,
	baseUrl: string,
	timeoutMs: number,
	shutdownSignal: () => ShutdownSignal | undefined,
): Promise<ShutdownSignal | undefined> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "Agent runtime did not answer its health check";
	while (Date.now() < deadline) {
		const signal = shutdownSignal();
		if (signal) return signal;
		if (child.exited) {
			const code = await child.process.exited;
			throw new Error(
				`Agent runtime exited before becoming ready (exit ${code})`,
			);
		}
		try {
			const response = await fetch(`${baseUrl}/healthz`, {
				signal: AbortSignal.timeout(1_000),
			});
			if (response.ok) {
				const body = (await response.json()) as { ok?: unknown };
				if (body.ok === true) return undefined;
				lastError = "Agent runtime health response did not report ok";
			} else {
				lastError = `Agent runtime health check returned HTTP ${response.status}`;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : lastError;
		}
		await Bun.sleep(200);
	}
	throw new Error(
		`Agent runtime was not ready within ${timeoutMs}ms: ${lastError}`,
	);
}

async function stopChild(
	child: ManagedChild | undefined,
	signal: ShutdownSignal,
	graceMs: number,
): Promise<void> {
	if (!child || child.exited) return;
	try {
		child.process.kill(signal);
	} catch {
		return;
	}
	const graceful = await Promise.race([
		child.process.exited.then(() => true),
		Bun.sleep(graceMs).then(() => false),
	]);
	if (graceful || child.exited) return;
	console.warn(`[dev] ${child.name} did not stop in time; forcing shutdown`);
	try {
		child.process.kill("SIGKILL");
		await child.process.exited;
	} catch {
		return;
	}
}

async function run(): Promise<number> {
	if (unexpectedArguments.length > 0) {
		throw new Error(
			`Unknown development argument: ${unexpectedArguments.join(" ")}`,
		);
	}
	const harness = agentHarness(
		Bun.env.SUPPORT_AGENT_HARNESS?.trim() ||
			(await readEnvironmentValue(
				supportEnvironmentFile,
				"SUPPORT_AGENT_HARNESS",
			)),
	);
	await ensureLocalDependencies(harness);

	const configuredPort =
		Bun.env.SUPPORT_AGENT_PORT?.trim() ||
		(await readEnvironmentValue(supportEnvironmentFile, "SUPPORT_AGENT_PORT"));
	const port = parsePort("SUPPORT_AGENT_PORT", 4_185, configuredPort);
	const startupTimeoutMs = parsePositiveMilliseconds(
		"SUPPORT_AGENT_STARTUP_TIMEOUT_MS",
		30_000,
		Bun.env.SUPPORT_AGENT_STARTUP_TIMEOUT_MS?.trim(),
	);
	const shutdownTimeoutMs = parsePositiveMilliseconds(
		"SUPPORT_DEV_SHUTDOWN_TIMEOUT_MS",
		8_000,
	);
	const openAiApiKey =
		Bun.env.OPENAI_API_KEY?.trim() ||
		(await readEnvironmentValue(supportEnvironmentFile, "OPENAI_API_KEY"));
	if (harness === "codex" && !openAiApiKey) {
		throw new Error(
			"OPENAI_API_KEY is required in the root .env when SUPPORT_AGENT_HARNESS=codex",
		);
	}
	const configuredCodexBinary =
		Bun.env.SUPPORT_AGENT_CODEX_BIN?.trim() ||
		(await readEnvironmentValue(
			supportEnvironmentFile,
			"SUPPORT_AGENT_CODEX_BIN",
		));
	const codexBinary =
		harness === "codex"
			? resolveCodexExecutable(configuredCodexBinary)
			: undefined;
	const configuredWorkspaceRoot =
		Bun.env.SUPPORT_AGENT_WORKSPACE_ROOT?.trim() ||
		(await readEnvironmentValue(
			supportEnvironmentFile,
			"SUPPORT_AGENT_WORKSPACE_ROOT",
		));
	const defaultWorkspaceRoot =
		!runtimeOnly && harness === "codex"
			? resolve(repositoryRoot, "..")
			: undefined;
	const workspaceRoot = configuredWorkspaceRoot
		? resolve(configuredWorkspaceRoot)
		: defaultWorkspaceRoot;
	if (workspaceRoot && !existsSync(workspaceRoot)) {
		throw new Error(
			`SUPPORT_AGENT_WORKSPACE_ROOT does not exist: ${workspaceRoot}`,
		);
	}
	const agentBaseUrl = `http://127.0.0.1:${port}`;
	const signingSecret = ephemeralSigningSecret();
	const agentEnvironment: Record<string, string | undefined> = {
		PATH: process.env.PATH,
		TMPDIR: process.env.TMPDIR,
		LANG: process.env.LANG,
		LC_ALL: process.env.LC_ALL,
		SSL_CERT_FILE: process.env.SSL_CERT_FILE,
		SSL_CERT_DIR: process.env.SSL_CERT_DIR,
		NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
		HTTP_PROXY: process.env.HTTP_PROXY,
		HTTPS_PROXY: process.env.HTTPS_PROXY,
		NO_PROXY: process.env.NO_PROXY,
		ALL_PROXY: process.env.ALL_PROXY,
		OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
		NODE_ENV: "development",
		SUPPORT_AGENT_HOST: "127.0.0.1",
		SUPPORT_AGENT_PORT: String(port),
		SUPPORT_AGENT_HARNESS: harness,
		SUPPORT_AGENT_SIGNING_SECRET: signingSecret,
		SUPPORT_AGENT_REPOSITORY_ROOT: repositoryRoot,
		...(workspaceRoot ? { SUPPORT_AGENT_WORKSPACE_ROOT: workspaceRoot } : {}),
		SUPPORT_AGENT_CODEX_BIN: codexBinary,
	};
	if (harness !== "mock" && openAiApiKey) {
		agentEnvironment.OPENAI_API_KEY = openAiApiKey;
	}

	let agent: ManagedChild | undefined;
	let ui: ManagedChild | undefined;
	let requestedSignal: ShutdownSignal = "SIGTERM";
	let receivedSignal: ShutdownSignal | undefined;
	let resolveSignal: ((signal: ShutdownSignal) => void) | undefined;
	const signalReceived = new Promise<ShutdownSignal>((resolveSignalPromise) => {
		resolveSignal = resolveSignalPromise;
	});
	const requestShutdown = (signal: ShutdownSignal) => {
		requestedSignal = signal;
		receivedSignal = signal;
		resolveSignal?.(signal);
		resolveSignal = undefined;
	};
	process.once("SIGINT", () => requestShutdown("SIGINT"));
	process.once("SIGTERM", () => requestShutdown("SIGTERM"));

	try {
		console.log(
			`[dev] Starting Support agent runtime with Bun (${harness} harness) at ${agentBaseUrl}`,
		);
		console.log(
			harness === "mock"
				? "[dev] Mock mode: deterministic agents, no model requests"
				: "[dev] Codex mode: idle until you click Run agents in the staff UI",
		);
		console.log(
			workspaceRoot
				? `[dev] Optional read-only repository context root: ${workspaceRoot}`
				: "[dev] No external workspace configured; reasoning-only turns remain available",
		);
		agent = createChild(
			"Agent runtime",
			[bunExecutable, "--watch", "src/index.ts"],
			{
				cwd: agentRuntimeRoot,
				env: agentEnvironment,
			},
		);
		const startupSignal = await waitForAgentRuntime(
			agent,
			agentBaseUrl,
			startupTimeoutMs,
			() => receivedSignal,
		);
		if (startupSignal) return startupSignal === "SIGINT" ? 130 : 143;
		console.log(`[dev] Agent runtime ready at ${agentBaseUrl}`);

		if (!runtimeOnly) {
			const uiPort = parsePort("SUPPORT_WORKFLOW_DEMO_PORT", 4_174);
			const uiEnvironment: Record<string, string | undefined> = {
				PATH: process.env.PATH,
				TMPDIR: process.env.TMPDIR,
				LANG: process.env.LANG,
				LC_ALL: process.env.LC_ALL,
				NODE_ENV: "development",
				SUPPORT_AGENT_MODE: harness === "mock" ? "mock" : "live",
				SUPPORT_AGENT_BASE_URL: agentBaseUrl,
				SUPPORT_AGENT_SIGNING_SECRET: signingSecret,
				SUPPORT_AGENT_HARNESS: harness,
				...(workspaceRoot
					? { SUPPORT_AGENT_WORKSPACE_ROOT: workspaceRoot }
					: {}),
				SUPPORT_WORKFLOW_DEMO_PORT: String(uiPort),
			};
			ui = createChild("Support UI", [bunExecutable, "--watch", "dev.ts"], {
				cwd: demoRoot,
				env: uiEnvironment,
			});
			console.log(`[dev] Support UI starting at http://127.0.0.1:${uiPort}`);
		}

		const childExits = [
			agent.process.exited.then((code) => ({
				name: agent?.name ?? "Agent runtime",
				code,
			})),
			...(ui
				? [
						ui.process.exited.then((code) => ({
							name: ui?.name ?? "Support UI",
							code,
						})),
					]
				: []),
		];
		const outcome = await Promise.race([
			signalReceived.then((signal) => ({ signal })),
			...childExits,
		]);
		await Bun.sleep(0);
		if (receivedSignal) {
			return receivedSignal === "SIGINT" ? 130 : 143;
		}
		if ("signal" in outcome) {
			requestedSignal = outcome.signal;
			return outcome.signal === "SIGINT" ? 130 : 143;
		}
		console.error(`[dev] ${outcome.name} exited with code ${outcome.code}`);
		return outcome.code === 0 ? 1 : outcome.code;
	} finally {
		await stopChild(ui, requestedSignal, shutdownTimeoutMs);
		await stopChild(agent, requestedSignal, shutdownTimeoutMs);
	}
}

try {
	process.exitCode = await run();
} catch (error) {
	console.error(
		`[dev] ${error instanceof Error ? error.message : "Development startup failed"}`,
	);
	process.exitCode = 1;
}
