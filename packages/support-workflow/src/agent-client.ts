import { z } from "zod";
import { httpUrlSchema } from "./contracts";

const agentTurnStatusSchema = z.enum([
	"ok",
	"refused",
	"failed",
	"pending_approval",
	"queued",
	"silent",
	"react",
]);

const agentTurnResultSchema = z.object({
	status: agentTurnStatusSchema,
	sessionId: z.string().optional(),
	reply: z.string().optional(),
	reason: z.string().optional(),
	adminUrl: httpUrlSchema.optional(),
	runId: z.string().optional(),
});

const agentRunSchema = z.object({
	id: z.string().optional(),
	status: z.enum(["pending", "running", "done", "failed"]),
	result: agentTurnResultSchema.nullable().optional(),
});

export interface AgentActorAssertion {
	externalId: string;
	displayName?: string;
	isBot?: boolean;
}

export interface AgentTurnRequest {
	surface: string;
	actor: AgentActorAssertion;
	conversation: {
		kind: "channel";
		threadRef: string;
		channelRef: string;
		channelName: string;
		audience: AgentActorAssertion[];
		isPrivate: true;
	};
	text: string;
	origin: {
		kind: "automation";
		screenData: string;
	};
	triggered: true;
	readOnly: boolean;
	requireSecurityScreen: true;
	idempotencyKey: string;
	async: true;
	workspace?: {
		path: string;
		access: "read_only" | "candidate_write";
	};
	model?: string;
	harness?: string;
}

export interface AgentTurnCompletion {
	runId: string;
	reply: string;
	sessionId?: string;
	adminUrl?: string;
}

export type AgentClientErrorKind =
	| "configuration"
	| "http"
	| "contract"
	| "refused"
	| "approval_required"
	| "failed"
	| "timeout";

export class AgentClientError extends Error {
	constructor(
		public readonly kind: AgentClientErrorKind,
		message: string,
	) {
		super(message);
		this.name = "AgentClientError";
	}
}

export interface CreateAgentClientOptions {
	baseUrl: string;
	signingSecret: string;
	fetch?: AgentFetch;
	now?: () => Date;
	nonce?: () => string;
	sleep?: (milliseconds: number) => Promise<void>;
	pollIntervalMs?: number;
	timeoutMs?: number;
	requestTimeoutMs?: number;
}

export type AgentFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function toHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function canonicalAgentPayload(
	method: string,
	pathWithQuery: string,
	body: string,
): string {
	return `${method.toUpperCase()}\n${pathWithQuery}\n${body}`;
}

export async function signAgentSourceRequest(input: {
	secret: string;
	timestampSeconds: number;
	method: string;
	pathWithQuery: string;
	body: string;
}): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(input.secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const canonical = canonicalAgentPayload(
		input.method,
		input.pathWithQuery,
		input.body,
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`v0:${input.timestampSeconds}:${canonical}`),
	);
	return `v0=${toHex(signature)}`;
}

function defaultSleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(value: unknown): string {
	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return "Agent runtime request failed";
}

export function createAgentClient(options: CreateAgentClientOptions) {
	if (options.signingSecret.length < 32) {
		throw new AgentClientError(
			"configuration",
			"Agent runtime source signing secret must be at least 32 characters",
		);
	}

	const fetcher = options.fetch ?? globalThis.fetch;
	const now = options.now ?? (() => new Date());
	const nonce =
		options.nonce ??
		(() => crypto.randomUUID().replaceAll("-", "").slice(0, 16));
	const sleep = options.sleep ?? defaultSleep;
	const parsedBaseUrl = httpUrlSchema.safeParse(options.baseUrl);
	if (!parsedBaseUrl.success) {
		throw new AgentClientError(
			"configuration",
			"Agent runtime base URL must be an absolute HTTP(S) URL",
		);
	}
	const baseUrl = parsedBaseUrl.data.replace(/\/$/, "");
	const pollIntervalMs = options.pollIntervalMs ?? 1_000;
	const timeoutMs = options.timeoutMs ?? 120_000;
	const requestTimeoutMs =
		options.requestTimeoutMs ?? Math.min(timeoutMs, 30_000);

	const pathWithNonce = (path: string): string => {
		const separator = path.includes("?") ? "&" : "?";
		return `${path}${separator}_sourceAuthNonce=${now().getTime()}-${nonce()}`;
	};

	const request = async (
		method: "GET" | "POST",
		path: string,
		bodyValue?: unknown,
	): Promise<unknown> => {
		const signedPath = pathWithNonce(path);
		const body = bodyValue === undefined ? "" : JSON.stringify(bodyValue);
		const timestampSeconds = Math.floor(now().getTime() / 1_000);
		const signature = await signAgentSourceRequest({
			secret: options.signingSecret,
			timestampSeconds,
			method,
			pathWithQuery: signedPath,
			body,
		});
		const abort = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let response: Response;
		try {
			response = await Promise.race([
				fetcher(`${baseUrl}${signedPath}`, {
					method,
					headers: {
						accept: "application/json",
						...(body ? { "content-type": "application/json" } : {}),
						"x-signature": signature,
						"x-timestamp": String(timestampSeconds),
					},
					signal: abort.signal,
					...(body ? { body } : {}),
				}),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						abort.abort();
						reject(
							new AgentClientError(
								"timeout",
								`Agent runtime ${method} ${path} exceeded ${requestTimeoutMs}ms`,
							),
						);
					}, requestTimeoutMs);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			throw new AgentClientError(
				"contract",
				`Agent runtime returned non-JSON response (${response.status})`,
			);
		}
		if (!response.ok) {
			throw new AgentClientError(
				"http",
				`${errorMessage(data)} (${response.status})`,
			);
		}
		return data;
	};

	const completeTurnResult = (
		value: z.infer<typeof agentTurnResultSchema>,
		fallbackRunId?: string,
	): AgentTurnCompletion => {
		if (value.status === "pending_approval") {
			throw new AgentClientError(
				"approval_required",
				value.reason ?? "Agent stage requested an interactive approval",
			);
		}
		if (value.status === "refused") {
			throw new AgentClientError(
				"refused",
				value.reason ?? "Agent runtime refused the support stage",
			);
		}
		if (value.status !== "ok") {
			throw new AgentClientError(
				"failed",
				value.reason ??
					`Agent runtime returned terminal status ${value.status}`,
			);
		}
		if (!value.reply) {
			throw new AgentClientError(
				"contract",
				"Agent runtime completed without a reply",
			);
		}
		const runId = value.runId ?? fallbackRunId;
		if (!runId) {
			throw new AgentClientError(
				"contract",
				"Agent runtime completed without a run ID",
			);
		}
		return {
			runId,
			reply: value.reply,
			sessionId: value.sessionId,
			adminUrl: value.adminUrl,
		};
	};

	const abortRun = async (runId: string): Promise<void> => {
		await request("POST", `/v1/runs/${encodeURIComponent(runId)}/signal`, {
			kind: "abort",
		});
	};

	const waitForRun = async (runId: string): Promise<AgentTurnCompletion> => {
		const startedAt = now().getTime();
		while (now().getTime() - startedAt <= timeoutMs) {
			const raw = await request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
			const parsed = agentRunSchema.safeParse(raw);
			if (!parsed.success) {
				throw new AgentClientError(
					"contract",
					`Invalid agent run response: ${z.prettifyError(parsed.error)}`,
				);
			}
			if (parsed.data.status === "failed") {
				throw new AgentClientError("failed", "Agent run failed");
			}
			if (parsed.data.status === "done") {
				if (!parsed.data.result) {
					throw new AgentClientError(
						"contract",
						"Agent run completed without a result",
					);
				}
				return completeTurnResult(parsed.data.result, runId);
			}
			await sleep(pollIntervalMs);
		}

		await abortRun(runId).catch(() => undefined);
		throw new AgentClientError("timeout", `Agent run ${runId} timed out`);
	};

	const runTurn = async (
		turn: AgentTurnRequest,
	): Promise<AgentTurnCompletion> => {
		const raw = await request("POST", "/v1/turns?async=1", turn);
		const parsed = agentTurnResultSchema.safeParse(raw);
		if (!parsed.success) {
			throw new AgentClientError(
				"contract",
				`Invalid agent turn response: ${z.prettifyError(parsed.error)}`,
			);
		}
		if (parsed.data.status !== "queued") {
			return completeTurnResult(parsed.data);
		}
		if (!parsed.data.runId) {
			throw new AgentClientError("contract", "Queued agent turn has no run ID");
		}
		return waitForRun(parsed.data.runId);
	};

	return {
		runTurn,
		waitForRun,
		abortRun,
	};
}

export type AgentClient = ReturnType<typeof createAgentClient>;
