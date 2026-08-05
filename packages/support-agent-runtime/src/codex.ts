import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CODEX_ENVIRONMENT_KEYS = [
	"PATH",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"CODEX_ACCESS_TOKEN",
] as const;

const DISABLED_CODEX_CONFIG = [
	'approval_policy="never"',
	'web_search="disabled"',
	"features.apps=false",
	"features.enable_mcp_apps=false",
	"features.plugins=false",
	"features.plugin_sharing=false",
	"features.remote_plugin=false",
	"features.skill_mcp_dependency_install=false",
	"features.browser_use=false",
	"features.browser_use_external=false",
	"features.browser_use_full_cdp_access=false",
	"features.in_app_browser=false",
	"features.computer_use=false",
	"features.image_generation=false",
	"features.standalone_web_search=false",
	"features.multi_agent=false",
	"features.request_permissions_tool=false",
	"features.tool_suggest=false",
] as const;

export interface CodexExecutionInput {
	prompt: string;
	readOnly: boolean;
	model?: string;
}

export interface CodexExecutionOptions {
	workingDirectory?: string;
	skillsRoot: string;
	timeoutMs: number;
	binaryPath?: string;
	environment?: Record<string, string | undefined>;
	spawn?: CodexSpawn;
}

export interface CodexProcess {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill(signal?: number | NodeJS.Signals): void;
}

export interface CodexSpawnInput {
	command: string[];
	cwd: string;
	environment: Record<string, string | undefined>;
	stdin: string;
}

export type CodexSpawn = (input: CodexSpawnInput) => CodexProcess;

export class CodexTurnAbortedError extends Error {
	constructor(message = "Codex turn aborted") {
		super(message);
		this.name = "CodexTurnAbortedError";
	}
}

export class CodexTurnTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Codex turn exceeded ${timeoutMs}ms`);
		this.name = "CodexTurnTimeoutError";
	}
}

export function codexArguments(
	input: CodexExecutionInput,
	options: { skipGitRepositoryCheck?: boolean } = {},
): string[] {
	if (!input.readOnly) {
		throw new Error(
			"The local Support Codex harness only accepts read-only turns",
		);
	}
	return [
		"exec",
		"--json",
		"--color",
		"never",
		"--ephemeral",
		"--ignore-user-config",
		"--ignore-rules",
		"--sandbox",
		"read-only",
		...DISABLED_CODEX_CONFIG.flatMap((value) => ["--config", value]),
		...(input.model ? ["--model", input.model] : []),
		...(options.skipGitRepositoryCheck ? ["--skip-git-repo-check"] : []),
		"-",
	];
}

export function isolatedCodexEnvironment(
	source: Record<string, string | undefined>,
	home: string,
): Record<string, string | undefined> {
	const environment: Record<string, string | undefined> = {
		HOME: home,
		CODEX_HOME: join(home, "codex-home"),
	};
	for (const name of CODEX_ENVIRONMENT_KEYS) {
		if (source[name] !== undefined) environment[name] = source[name];
	}
	return environment;
}

export function finalCodexMessage(jsonl: string): string {
	let reply: string | undefined;
	let failure: string | undefined;
	for (const line of jsonl.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!event || typeof event !== "object") continue;
		const record = event as Record<string, unknown>;
		if (
			record.type === "item.completed" &&
			record.item &&
			typeof record.item === "object"
		) {
			const item = record.item as Record<string, unknown>;
			if (item.type === "agent_message" && typeof item.text === "string") {
				reply = item.text;
			}
		}
		if (record.type === "error" && typeof record.message === "string") {
			failure = record.message;
		}
		if (
			record.type === "turn.failed" &&
			record.error &&
			typeof record.error === "object"
		) {
			const error = record.error as Record<string, unknown>;
			if (typeof error.message === "string") failure = error.message;
		}
	}
	if (reply !== undefined) return reply;
	throw new Error(failure ?? "Codex completed without an agent message");
}

function defaultSpawn(input: CodexSpawnInput): CodexProcess {
	return Bun.spawn({
		cmd: input.command,
		cwd: input.cwd,
		env: input.environment,
		stdin: new Blob([input.stdin]),
		stdout: "pipe",
		stderr: "pipe",
	}) as CodexProcess;
}

function prepareCodexHome(
	environment: Record<string, string | undefined>,
	skillsRoot: string,
): void {
	const codexHome = environment.CODEX_HOME;
	if (!codexHome) throw new Error("Isolated CODEX_HOME was not configured");
	mkdirSync(codexHome, { recursive: true });
	if (!existsSync(skillsRoot)) {
		throw new Error(`Support agent skills were not found at ${skillsRoot}`);
	}
	cpSync(skillsRoot, join(codexHome, "skills"), { recursive: true });
	if (!environment.OPENAI_API_KEY) return;
	writeFileSync(
		join(codexHome, "auth.json"),
		JSON.stringify({
			auth_mode: "apikey",
			OPENAI_API_KEY: environment.OPENAI_API_KEY,
		}),
		{ mode: 0o600 },
	);
}

function truncateError(value: string): string {
	const trimmed = value.trim();
	return trimmed.length > 4_000 ? `${trimmed.slice(0, 4_000)}…` : trimmed;
}

export async function executeCodexTurn(
	input: CodexExecutionInput,
	options: CodexExecutionOptions,
	signal: AbortSignal,
): Promise<string> {
	const arguments_ = codexArguments(input, {
		skipGitRepositoryCheck: options.workingDirectory === undefined,
	});
	const isolatedHome = mkdtempSync(join(tmpdir(), "xgx-support-codex-"));
	const environment = isolatedCodexEnvironment(
		options.environment ?? Bun.env,
		isolatedHome,
	);
	prepareCodexHome(environment, options.skillsRoot);
	const workingDirectory = options.workingDirectory
		? options.workingDirectory
		: join(isolatedHome, "empty-workspace");
	if (options.workingDirectory) {
		if (
			!existsSync(workingDirectory) ||
			!statSync(workingDirectory).isDirectory()
		) {
			throw new Error("Support agent workspace is not a provisioned directory");
		}
	} else {
		mkdirSync(workingDirectory, { recursive: true });
	}
	const spawn = options.spawn ?? defaultSpawn;
	let process: CodexProcess | undefined;
	let forcedKill: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	const stop = () => {
		if (!process) return;
		try {
			process.kill("SIGTERM");
		} catch {
			return;
		}
		forcedKill = setTimeout(() => {
			try {
				process?.kill("SIGKILL");
			} catch {
				return;
			}
		}, 2_000);
	};
	const timeout = setTimeout(() => {
		timedOut = true;
		stop();
	}, options.timeoutMs);
	signal.addEventListener("abort", stop, { once: true });
	try {
		if (signal.aborted) throw new CodexTurnAbortedError();
		process = spawn({
			command: [options.binaryPath ?? "codex", ...arguments_],
			cwd: workingDirectory,
			environment,
			stdin: input.prompt,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);
		if (timedOut) throw new CodexTurnTimeoutError(options.timeoutMs);
		if (signal.aborted) throw new CodexTurnAbortedError();
		if (exitCode !== 0) {
			throw new Error(
				truncateError(stderr) || `Codex exited with status ${exitCode}`,
			);
		}
		return finalCodexMessage(stdout);
	} finally {
		clearTimeout(timeout);
		if (forcedKill) clearTimeout(forcedKill);
		signal.removeEventListener("abort", stop);
		rmSync(isolatedHome, { recursive: true, force: true });
	}
}
