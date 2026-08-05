import { describe, expect, test } from "bun:test";
import {
	canonicalQmPayload,
	createQmClient,
	QmClientError,
	signQmSourceRequest,
} from "./qm-client";
import { createManualClock } from "./testing";

const turn = {
	surface: "webhook",
	actor: { externalId: "support:validate", isBot: true },
	conversation: {
		kind: "channel" as const,
		threadRef: "team:support:issue:42:validate:1",
		channelRef: "team:support:issue:42:validate:1",
		channelName: "example/product#42 validate",
		audience: [{ externalId: "support:validate" }],
		isPrivate: true as const,
	},
	text: "Validate this case",
	origin: { kind: "automation" as const, screenData: "untrusted issue" },
	triggered: true as const,
	readOnly: true,
	requireSecurityScreen: true as const,
	idempotencyKey: "support:42:validate:input:1",
	async: true as const,
};

describe("QM v0.1.4 client", () => {
	test("rejects a non-HTTP QM endpoint", () => {
		expect(() =>
			createQmClient({
				baseUrl: "file:///tmp/qm.sock",
				signingSecret: "z".repeat(32),
			}),
		).toThrow("absolute HTTP(S) URL");
	});

	test("matches the upstream source-auth test vector", async () => {
		expect(canonicalQmPayload("POST", "/v1/system/probe", "{}")).toBe(
			"POST\n/v1/system/probe\n{}",
		);
		expect(
			await signQmSourceRequest({
				secret: "s",
				timestampSeconds: 1_000,
				method: "POST",
				pathWithQuery: "/v1/system/probe",
				body: "{}",
			}),
		).toBe(
			"v0=4a4568e74905ec430a373d391aacd0fdeff314f38371d91ffdcb5dacd6868f6e",
		);
	});

	test("signs an async turn, polls both run statuses and returns the reply", async () => {
		const manual = createManualClock();
		const seen: Array<{ url: URL; init?: RequestInit }> = [];
		let polls = 0;
		const fetcher = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(String(input));
			seen.push({ url, init });
			if (url.pathname === "/v1/turns") {
				return Response.json(
					{ status: "queued", runId: "run-123" },
					{ status: 202 },
				);
			}
			polls += 1;
			if (polls === 1) {
				return Response.json({
					id: "run-123",
					status: "running",
					result: null,
				});
			}
			return Response.json({
				id: "run-123",
				status: "done",
				result: {
					status: "ok",
					runId: "run-123",
					sessionId: "session-123",
					reply: '{"decision":"pass"}',
				},
			});
		};
		let nonce = 0;
		const client = createQmClient({
			baseUrl: "http://qm.test",
			signingSecret: "a".repeat(32),
			fetch: fetcher,
			now: manual.clock.now,
			nonce: () => `nonce-${++nonce}`,
			pollIntervalMs: 10,
			sleep: async (milliseconds) => manual.advance(milliseconds),
		});

		const result = await client.runTurn(turn);
		expect(result).toEqual({
			runId: "run-123",
			reply: '{"decision":"pass"}',
			sessionId: "session-123",
			adminUrl: undefined,
		});
		expect(seen).toHaveLength(3);
		const first = seen[0];
		if (!first) throw new Error("QM turn request was not recorded");
		expect(first.url.searchParams.get("async")).toBe("1");
		expect(first.url.searchParams.get("_sourceAuthNonce")).toBe(
			"1785920400000-nonce-1",
		);

		const body = String(first.init?.body);
		const timestamp = Number(
			(first.init?.headers as Record<string, string>)["x-timestamp"],
		);
		const expected = await signQmSourceRequest({
			secret: "a".repeat(32),
			timestampSeconds: timestamp,
			method: "POST",
			pathWithQuery: `${first.url.pathname}${first.url.search}`,
			body,
		});
		expect((first.init?.headers as Record<string, string>)["x-signature"]).toBe(
			expected,
		);
		expect(JSON.parse(body).idempotencyKey).toBe(turn.idempotencyKey);
		expect(JSON.parse(body).readOnly).toBe(true);
		expect(JSON.parse(body).requireSecurityScreen).toBe(true);
	});

	test("accepts a terminal idempotency response without polling", async () => {
		let calls = 0;
		const client = createQmClient({
			baseUrl: "http://qm.test",
			signingSecret: "b".repeat(32),
			nonce: () => "terminal",
			fetch: async () => {
				calls += 1;
				return Response.json({
					status: "ok",
					runId: "prior-run",
					reply: "prior result",
				});
			},
		});

		expect(await client.runTurn(turn)).toMatchObject({
			runId: "prior-run",
			reply: "prior result",
		});
		expect(calls).toBe(1);
	});

	test("fails closed when a background stage requests approval", async () => {
		const client = createQmClient({
			baseUrl: "http://qm.test",
			signingSecret: "c".repeat(32),
			fetch: async () =>
				Response.json({
					status: "pending_approval",
					runId: "approval-run",
					reason: "command needs approval",
				}),
		});

		try {
			await client.runTurn(turn);
			throw new Error("Expected approval failure");
		} catch (error) {
			expect(error).toBeInstanceOf(QmClientError);
			expect((error as QmClientError).kind).toBe("approval_required");
		}
	});

	test("rejects non-HTTP admin links returned by QM", async () => {
		const client = createQmClient({
			baseUrl: "http://qm.test",
			signingSecret: "d".repeat(32),
			fetch: async () =>
				Response.json({
					status: "ok",
					runId: "unsafe-link-run",
					reply: "{}",
					adminUrl: "javascript:alert(1)",
				}),
		});
		await expect(client.runTurn(turn)).rejects.toMatchObject({
			kind: "contract",
		});
	});

	test("bounds each HTTP request as well as the overall poll", async () => {
		const client = createQmClient({
			baseUrl: "http://qm.test",
			signingSecret: "e".repeat(32),
			requestTimeoutMs: 5,
			fetch: async () => new Promise<Response>(() => undefined),
		});
		await expect(client.runTurn(turn)).rejects.toMatchObject({
			kind: "timeout",
		});
	});
});
