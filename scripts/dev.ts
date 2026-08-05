import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const qmRoot = join(repositoryRoot, "experimental/qm");
const demoRoot = join(repositoryRoot, "examples/workflow-demo");
const supportSkills = join(repositoryRoot, "infra/qm/sandbox/skills");
const qmEnvironmentFile = join(repositoryRoot, "infra/qm/.env");
const bunExecutable = process.execPath;
const qmOnly = process.argv.slice(2).includes("--qm-only");
const unexpectedArguments = process.argv
	.slice(2)
	.filter((argument) => argument !== "--qm-only");

type ShutdownSignal = "SIGINT" | "SIGTERM";
type ManagedChild = {
	name: "QM" | "Support UI";
	process: ReturnType<typeof Bun.spawn>;
	exited: boolean;
};

function parsePort(name: string, fallback: number): number {
	const raw = Bun.env[name];
	if (!raw) return fallback;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`${name} must be an integer between 1 and 65535`);
	}
	return port;
}

function parsePositiveMilliseconds(name: string, fallback: number): number {
	const raw = Bun.env[name];
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

async function ensureLocalDependencies(): Promise<void> {
	const installations = [
		{
			label: "Support",
			cwd: repositoryRoot,
			marker: join(repositoryRoot, "node_modules/zod"),
		},
		{
			label: "QM",
			cwd: qmRoot,
			marker: join(qmRoot, "node_modules/fastify"),
		},
		...(!qmOnly
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

function qmHarness(
	configuredHarness: string | undefined,
): "mock" | "pi" | "opencode" | "codex" | "claude" {
	const harness = (configuredHarness ?? "mock").trim();
	if (
		harness === "mock" ||
		harness === "pi" ||
		harness === "opencode" ||
		harness === "codex" ||
		harness === "claude"
	) {
		return harness;
	}
	throw new Error(
		"SUPPORT_QM_HARNESS must be mock, pi, opencode, codex, or claude",
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

async function waitForQm(
	child: ManagedChild,
	baseUrl: string,
	timeoutMs: number,
	shutdownSignal: () => ShutdownSignal | undefined,
): Promise<ShutdownSignal | undefined> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "QM did not answer its health check";
	while (Date.now() < deadline) {
		const signal = shutdownSignal();
		if (signal) return signal;
		if (child.exited) {
			const code = await child.process.exited;
			throw new Error(`QM exited before becoming ready (exit ${code})`);
		}
		try {
			const response = await fetch(`${baseUrl}/healthz`, {
				signal: AbortSignal.timeout(1_000),
			});
			if (response.ok) {
				const body = (await response.json()) as { ok?: unknown };
				if (body.ok === true) return undefined;
				lastError = "QM health response did not report ok";
			} else {
				lastError = `QM health check returned HTTP ${response.status}`;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : lastError;
		}
		await Bun.sleep(200);
	}
	throw new Error(`QM was not ready within ${timeoutMs}ms: ${lastError}`);
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
	await ensureLocalDependencies();

	const port = parsePort("SUPPORT_QM_PORT", 4_185);
	const startupTimeoutMs = parsePositiveMilliseconds(
		"SUPPORT_QM_STARTUP_TIMEOUT_MS",
		30_000,
	);
	const shutdownTimeoutMs = parsePositiveMilliseconds(
		"SUPPORT_DEV_SHUTDOWN_TIMEOUT_MS",
		8_000,
	);
	const harness = qmHarness(
		Bun.env.SUPPORT_QM_HARNESS?.trim() ||
			(await readEnvironmentValue(qmEnvironmentFile, "SUPPORT_QM_HARNESS")),
	);
	const openAiApiKey =
		Bun.env.OPENAI_API_KEY?.trim() ||
		(await readEnvironmentValue(qmEnvironmentFile, "OPENAI_API_KEY"));
	const qmBaseUrl = `http://127.0.0.1:${port}`;
	const signingSecret = ephemeralSigningSecret();
	const configuredDataDir = Bun.env.SUPPORT_QM_DATA_DIR?.trim();
	const dataDir = configuredDataDir
		? resolve(configuredDataDir)
		: mkdtempSync(join(tmpdir(), "xgx-support-qm-"));
	const ownsDataDir = !configuredDataDir;
	const qmEnvironment: Record<string, string | undefined> = {
		...process.env,
		NODE_ENV: "development",
		HOST: "127.0.0.1",
		PORT: String(port),
		ORG_ID: "xgx-support-local",
		HARNESS: harness,
		SESSION_STORE: "memory",
		RUN_STORE: "memory",
		BACKGROUND_WORK_ENABLED: "1",
		WORKERS: "2",
		SANDBOX_BACKEND: "local",
		DATA_DIR: dataDir,
		SEED_SKILLS: "1",
		SKILLS_SEED_DIR: supportSkills,
		CORE_SIGNING_SECRET: signingSecret,
		ALLOW_UNAUTHENTICATED_CORE: "0",
		PUBLIC_API_URL: qmBaseUrl,
		SHUTDOWN_DRAIN_MS: "2000",
	};
	delete qmEnvironment.DATABASE_URL;
	delete qmEnvironment.SLACK_APP_TOKEN;
	delete qmEnvironment.SLACK_BOT_TOKEN;
	delete qmEnvironment.SLACK_SIGNING_SECRET;
	delete qmEnvironment.OPENAI_API_KEY;
	if (harness !== "mock" && openAiApiKey) {
		qmEnvironment.OPENAI_API_KEY = openAiApiKey;
	}
	if (harness === "mock") delete qmEnvironment.MODEL_PROVIDER;
	else if (Bun.env.SUPPORT_QM_MODEL_PROVIDER) {
		qmEnvironment.MODEL_PROVIDER = Bun.env.SUPPORT_QM_MODEL_PROVIDER;
	}

	let qm: ManagedChild | undefined;
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
			`[dev] Starting editable QM source with Bun (${harness} harness) at ${qmBaseUrl}`,
		);
		qm = createChild("QM", [bunExecutable, "--watch", "src/index.ts"], {
			cwd: qmRoot,
			env: qmEnvironment,
		});
		const startupSignal = await waitForQm(
			qm,
			qmBaseUrl,
			startupTimeoutMs,
			() => receivedSignal,
		);
		if (startupSignal) return startupSignal === "SIGINT" ? 130 : 143;
		console.log(`[dev] QM ready at ${qmBaseUrl}`);

		if (!qmOnly) {
			const uiEnvironment: Record<string, string | undefined> = {
				...process.env,
				SUPPORT_QM_MODE: harness === "mock" ? "mock" : "live",
				SUPPORT_QM_URL: qmBaseUrl,
				SUPPORT_QM_SIGNING_SECRET: signingSecret,
				SUPPORT_QM_HARNESS: harness,
				QM_BASE_URL: qmBaseUrl,
				QM_SIGNING_SECRET: signingSecret,
			};
			ui = createChild("Support UI", [bunExecutable, "--watch", "dev.ts"], {
				cwd: demoRoot,
				env: uiEnvironment,
			});
			const uiPort = parsePort("SUPPORT_WORKFLOW_DEMO_PORT", 4_174);
			console.log(`[dev] Support UI starting at http://127.0.0.1:${uiPort}`);
		}

		const childExits = [
			qm.process.exited.then((code) => ({ name: qm?.name ?? "QM", code })),
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
		await stopChild(qm, requestedSignal, shutdownTimeoutMs);
		if (ownsDataDir) rmSync(dataDir, { recursive: true, force: true });
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
