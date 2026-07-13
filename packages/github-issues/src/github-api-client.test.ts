import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { closeIssue } from "./github-api-client";

const originalFetch = globalThis.fetch;
const originalEnv = {
	GITHUB_APP_ID: process.env.GITHUB_APP_ID,
	GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,
	GITHUB_APP_PRIVATE_KEY_BASE64: process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
	GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
};

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

describe("closeIssue", () => {
	test("closes the GitHub issue as completed", async () => {
		const { privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		process.env.GITHUB_APP_ID = "123";
		process.env.GITHUB_APP_INSTALLATION_ID = "456";
		process.env.GITHUB_APP_PRIVATE_KEY_BASE64 =
			Buffer.from(privateKey).toString("base64");
		process.env.GITHUB_REPOSITORY = "example/support";

		let issueRequest: { url: string; init?: RequestInit } | undefined;
		globalThis.fetch = Object.assign(
			async (
				input: URL | RequestInfo,
				init?: BunFetchRequestInit | RequestInit,
			) => {
				const url = String(input);
				if (url.endsWith("/app/installations/456/access_tokens")) {
					return Response.json({
						token: "installation-token",
						expires_at: "2000-01-01T00:00:00Z",
					});
				}

				issueRequest = { url, init };
				return Response.json({
					number: 42,
					title: "Export fails",
					body: "Help me",
					state: "closed",
					labels: [],
					user: null,
					assignee: null,
					assignees: [],
					comments: 0,
					created_at: "2026-07-13T10:00:00Z",
					updated_at: "2026-07-13T10:05:00Z",
					closed_at: "2026-07-13T10:05:00Z",
					state_reason: "completed",
				});
			},
			{ preconnect: originalFetch.preconnect },
		);

		const issue = await closeIssue(42);

		expect(issue.state).toBe("closed");
		expect(issueRequest?.url).toBe(
			"https://api.github.com/repos/example/support/issues/42",
		);
		expect(issueRequest?.init?.method).toBe("PATCH");
		expect(JSON.parse(String(issueRequest?.init?.body))).toEqual({
			state: "closed",
			state_reason: "completed",
		});
	});
});
