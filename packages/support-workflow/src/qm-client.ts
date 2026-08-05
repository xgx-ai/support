import { z } from "zod";
import { httpUrlSchema } from "./contracts";

const qmTurnStatusSchema = z.enum([
	"ok",
	"refused",
	"failed",
	"pending_approval",
	"queued",
	"silent",
	"react",
]);

const qmTurnResultSchema = z.object({
	status: qmTurnStatusSchema,
	sessionId: z.string().optional(),
	reply: z.string().optional(),
	reason: z.string().optional(),
	adminUrl: httpUrlSchema.optional(),
	runId: z.string().optional(),
});

const qmRunSchema = z.object({
	id: z.string().optional(),
	status: z.enum(["pending", "running", "done", "failed"]),
	result: qmTurnResultSchema.nullable().optional(),
});

export interface QmActorAssertion {
	externalId: string;
	displayName?: string;
	isBot?: boolean;
}

export interface QmTurnRequest {
	surface: string;
	actor: QmActorAssertion;
	conversation: {
		kind: "channel";
		threadRef: string;
		channelRef: string;
		channelName: string;
		audience: QmActorAssertion[];
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
	model?: string;
	harness?: string;
}

export interface QmTurnCompletion {
	runId: string;
	reply: string;
	sessionId?: string;
	adminUrl?: string;
}

export type QmClientErrorKind =
	| "configuration"
	| "http"
	| "contract"
	| "refused"
	| "approval_required"
	| "failed"
	| "timeout";

export class QmClientError extends Error {
	constructor(
		public readonly kind: QmClientErrorKind,
		message: string,
	) {
		super(message);
		this.name = "QmClientError";
	}
}

export interface CreateQmClientOptions {
	baseUrl: string;
	signingSecret: string;
	fetch?: QmFetch;
	now?: () => Date;
	nonce?: () => string;
	sleep?: (milliseconds: number) => Promise<void>;
	pollIntervalMs?: number;
	timeoutMs?: number;
	requestTimeoutMs?: number;
}

export type QmFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function toHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function canonicalQmPayload(
	method: string,
	pathWithQuery: string,
	body: string,
): string {
	return `${method.toUpperCase()}\n${pathWithQuery}\n${body}`;
}

export async function signQmSourceRequest(input: {
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
	const canonical = canonicalQmPayload(
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
	return "QM request failed";
}

export function createQmClient(options: CreateQmClientOptions) {
	if (options.signingSecret.length < 32) {
		throw new QmClientError(
			"configuration",
			"QM source signing secret must be at least 32 characters",
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
		throw new QmClientError(
			"configuration",
			"QM base URL must be an absolute HTTP(S) URL",
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
		const signature = await signQmSourceRequest({
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
							new QmClientError(
								"timeout",
								`QM ${method} ${path} exceeded ${requestTimeoutMs}ms`,
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
			throw new QmClientError(
				"contract",
				`QM returned non-JSON response (${response.status})`,
			);
		}
		if (!response.ok) {
			throw new QmClientError(
				"http",
				`${errorMessage(data)} (${response.status})`,
			);
		}
		return data;
	};

	const completeTurnResult = (
		value: z.infer<typeof qmTurnResultSchema>,
		fallbackRunId?: string,
	): QmTurnCompletion => {
		if (value.status === "pending_approval") {
			throw new QmClientError(
				"approval_required",
				value.reason ?? "QM stage requested an interactive approval",
			);
		}
		if (value.status === "refused") {
			throw new QmClientError(
				"refused",
				value.reason ?? "QM refused the support stage",
			);
		}
		if (value.status !== "ok") {
			throw new QmClientError(
				"failed",
				value.reason ?? `QM returned terminal status ${value.status}`,
			);
		}
		if (!value.reply) {
			throw new QmClientError("contract", "QM completed without a reply");
		}
		const runId = value.runId ?? fallbackRunId;
		if (!runId) {
			throw new QmClientError("contract", "QM completed without a run ID");
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

	const waitForRun = async (runId: string): Promise<QmTurnCompletion> => {
		const startedAt = now().getTime();
		while (now().getTime() - startedAt <= timeoutMs) {
			const raw = await request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
			const parsed = qmRunSchema.safeParse(raw);
			if (!parsed.success) {
				throw new QmClientError(
					"contract",
					`Invalid QM run response: ${z.prettifyError(parsed.error)}`,
				);
			}
			if (parsed.data.status === "failed") {
				throw new QmClientError("failed", "QM run failed");
			}
			if (parsed.data.status === "done") {
				if (!parsed.data.result) {
					throw new QmClientError(
						"contract",
						"QM run completed without a result",
					);
				}
				return completeTurnResult(parsed.data.result, runId);
			}
			await sleep(pollIntervalMs);
		}

		await abortRun(runId).catch(() => undefined);
		throw new QmClientError("timeout", `QM run ${runId} timed out`);
	};

	const runTurn = async (turn: QmTurnRequest): Promise<QmTurnCompletion> => {
		const raw = await request("POST", "/v1/turns?async=1", turn);
		const parsed = qmTurnResultSchema.safeParse(raw);
		if (!parsed.success) {
			throw new QmClientError(
				"contract",
				`Invalid QM turn response: ${z.prettifyError(parsed.error)}`,
			);
		}
		if (parsed.data.status !== "queued") {
			return completeTurnResult(parsed.data);
		}
		if (!parsed.data.runId) {
			throw new QmClientError("contract", "Queued QM turn has no run ID");
		}
		return waitForRun(parsed.data.runId);
	};

	return {
		runTurn,
		waitForRun,
		abortRun,
	};
}

export type QmClient = ReturnType<typeof createQmClient>;
