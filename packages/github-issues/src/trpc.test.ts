import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { handleCreateIssue, handleReopenIssue } from "./trpc";

const originalFetch = globalThis.fetch;
const originalEnv = {
	GITHUB_APP_ID: process.env.GITHUB_APP_ID,
	GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,
	GITHUB_APP_PRIVATE_KEY_BASE64: process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
	GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
};

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

function configureGitHub() {
	process.env.GITHUB_APP_ID = "123";
	process.env.GITHUB_APP_INSTALLATION_ID = "456";
	process.env.GITHUB_APP_PRIVATE_KEY_BASE64 =
		Buffer.from(privateKey).toString("base64");
	process.env.GITHUB_REPOSITORY = "example/support";
}

function rawIssue(number: number, state: "open" | "closed", body = "Help me") {
	return {
		number,
		title: number === 42 ? "Export fails" : "Related export issue",
		body,
		state,
		labels: [],
		user: null,
		assignee: null,
		assignees: [],
		comments: 0,
		created_at: "2026-07-13T10:00:00Z",
		updated_at: "2026-07-13T10:05:00Z",
		closed_at: state === "closed" ? "2026-07-13T10:05:00Z" : null,
		state_reason: state === "closed" ? "completed" : null,
	};
}

function installationTokenResponse(): Response {
	return Response.json({
		token: "installation-token",
		expires_at: "2000-01-01T00:00:00Z",
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("handleCreateIssue with a related ticket", () => {
	test("creates both ticket references", async () => {
		configureGitHub();
		const requests: { url: string; method: string; body?: string }[] = [];
		globalThis.fetch = Object.assign(
			async (
				input: URL | RequestInfo,
				init?: BunFetchRequestInit | RequestInit,
			) => {
				const url = String(input);
				const method = init?.method ?? "GET";
				if (url.endsWith("/app/installations/456/access_tokens")) {
					return installationTokenResponse();
				}
				requests.push({ url, method, body: init?.body?.toString() });

				if (url.endsWith("/issues/42") && method === "GET") {
					return Response.json(rawIssue(42, "closed"));
				}
				if (url.endsWith("/issues") && method === "POST") {
					const requestBody = JSON.parse(String(init?.body)) as {
						body: string;
					};
					return Response.json(rawIssue(57, "open", requestBody.body));
				}
				if (url.endsWith("/issues/42/comments") && method === "POST") {
					return Response.json({
						id: 100,
						body: JSON.parse(String(init?.body)).body,
						user: null,
						created_at: "2026-07-13T10:06:00Z",
						updated_at: "2026-07-13T10:06:00Z",
					});
				}
				return new Response("Not found", { status: 404 });
			},
			{ preconnect: originalFetch.preconnect },
		);

		const result = await handleCreateIssue(
			{
				title: "Related export issue",
				body: "The PDF export is also blank",
				relatedIssueNumber: 42,
			},
			"Ada",
			"user_123",
		);

		expect(result.error).toBeNull();
		expect(result.data?.number).toBe(57);
		const createRequest = requests.find(
			(request) => request.url.endsWith("/issues") && request.method === "POST",
		);
		expect(createRequest?.body).toContain("Related to #42");
		expect(createRequest?.body).toContain("relatedIssueNumber: 42");
		const backlinkRequest = requests.find((request) =>
			request.url.endsWith("/issues/42/comments"),
		);
		expect(backlinkRequest?.body).toContain("Related ticket created: #57");
		expect(backlinkRequest?.body).toContain("followUpIssueNumber: 57");
	});

	test("rejects a related source ticket that is still open", async () => {
		configureGitHub();
		let createRequestMade = false;
		globalThis.fetch = Object.assign(
			async (
				input: URL | RequestInfo,
				init?: BunFetchRequestInit | RequestInit,
			) => {
				const url = String(input);
				if (url.endsWith("/app/installations/456/access_tokens")) {
					return installationTokenResponse();
				}
				if (url.endsWith("/issues/42")) {
					return Response.json(rawIssue(42, "open"));
				}
				if (init?.method === "POST") createRequestMade = true;
				return new Response("Not found", { status: 404 });
			},
			{ preconnect: originalFetch.preconnect },
		);

		const result = await handleCreateIssue(
			{
				title: "Related export issue",
				body: "The PDF export is also blank",
				relatedIssueNumber: 42,
			},
			"Ada",
			"user_123",
		);

		expect(result).toEqual({
			data: null,
			error: "Related tickets can only be created from a closed ticket",
		});
		expect(createRequestMade).toBe(false);
	});

	test("rejects a related source ticket that does not exist", async () => {
		configureGitHub();
		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		let createRequestMade = false;
		globalThis.fetch = Object.assign(
			async (
				input: URL | RequestInfo,
				init?: BunFetchRequestInit | RequestInit,
			) => {
				const url = String(input);
				if (url.endsWith("/app/installations/456/access_tokens")) {
					return installationTokenResponse();
				}
				if (init?.method === "POST") createRequestMade = true;
				return new Response("Not found", { status: 404 });
			},
			{ preconnect: originalFetch.preconnect },
		);

		const result = await handleCreateIssue(
			{
				title: "Related export issue",
				body: "The PDF export is also blank",
				relatedIssueNumber: 404,
			},
			"Ada",
			"user_123",
		);

		expect(result).toEqual({ data: null, error: "Not found on GitHub" });
		expect(createRequestMade).toBe(false);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	test("keeps the new ticket when the backlink comment fails", async () => {
		configureGitHub();
		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		globalThis.fetch = Object.assign(
			async (
				input: URL | RequestInfo,
				init?: BunFetchRequestInit | RequestInit,
			) => {
				const url = String(input);
				const method = init?.method ?? "GET";
				if (url.endsWith("/app/installations/456/access_tokens")) {
					return installationTokenResponse();
				}
				if (url.endsWith("/issues/42") && method === "GET") {
					return Response.json(rawIssue(42, "closed"));
				}
				if (url.endsWith("/issues") && method === "POST") {
					return Response.json(rawIssue(57, "open"));
				}
				if (url.endsWith("/issues/42/comments")) {
					return new Response("Failed", {
						status: 500,
						statusText: "Server Error",
					});
				}
				return new Response("Not found", { status: 404 });
			},
			{ preconnect: originalFetch.preconnect },
		);

		const result = await handleCreateIssue(
			{
				title: "Related export issue",
				body: "The PDF export is also blank",
				relatedIssueNumber: 42,
			},
			"Ada",
			"user_123",
		);

		expect(result.error).toBeNull();
		expect(result.data?.number).toBe(57);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("handleReopenIssue", () => {
	test("returns an already-open ticket without updating it", async () => {
		configureGitHub();
		let patchRequestMade = false;
		globalThis.fetch = Object.assign(
			async (
				input: URL | RequestInfo,
				init?: BunFetchRequestInit | RequestInit,
			) => {
				const url = String(input);
				if (url.endsWith("/app/installations/456/access_tokens")) {
					return installationTokenResponse();
				}
				if (init?.method === "PATCH") patchRequestMade = true;
				return Response.json(rawIssue(42, "open"));
			},
			{ preconnect: originalFetch.preconnect },
		);

		const result = await handleReopenIssue({ issueNumber: 42 });

		expect(result.error).toBeNull();
		expect(result.data?.state).toBe("open");
		expect(patchRequestMade).toBe(false);
	});
});
