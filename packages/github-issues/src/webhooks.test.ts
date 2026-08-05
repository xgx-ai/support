import { describe, expect, test } from "bun:test";
import { createIssueWebhookHandler } from "./webhooks";

async function signature(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return `sha256=${[...new Uint8Array(signed)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")}`;
}

async function request(
	secret: string,
	body: string,
	headers: Record<string, string>,
): Promise<Request> {
	return new Request("https://example.com/webhooks/support", {
		method: "POST",
		body,
		headers: {
			"x-hub-signature-256": await signature(secret, body),
			...headers,
		},
	});
}

describe("createIssueWebhookHandler", () => {
	test("requires one durable dispatcher per delivery", () => {
		expect(() =>
			createIssueWebhookHandler({
				secret: "webhook-secret",
				onEvent: () => undefined,
				handlers: { "issue.opened": () => undefined },
			}),
		).toThrow("one durable webhook dispatcher");
	});

	test("normalises issue events and parses issue endmatter", async () => {
		const secret = "webhook-secret";
		const body = JSON.stringify({
			action: "closed",
			issue: {
				number: 42,
				title: "Export fails",
				body: "The export button errors.\n\n<!--meta\nauthor: Ada\nauthorId: user_123\n-->",
				state: "closed",
				labels: [],
				user: { login: "ada", avatar_url: "https://example.com/ada.png" },
				assignee: null,
				assignees: [],
				comments: 0,
				created_at: "2026-05-22T10:00:00Z",
				updated_at: "2026-05-22T10:15:00Z",
				closed_at: "2026-05-22T10:15:00Z",
				state_reason: "not_planned",
			},
			repository: {
				id: 1,
				name: "support",
				full_name: "example/support",
			},
			sender: { login: "maintainer", avatar_url: "https://example.com/m.png" },
		});
		const events: unknown[] = [];
		const handler = createIssueWebhookHandler({
			secret,
			onEvent: (event) => {
				events.push(event);
			},
		});

		const response = await handler(
			await request(secret, body, {
				"x-github-event": "issues",
				"x-github-delivery": "delivery-123",
			}),
		);

		expect(response.status).toBe(200);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "issue.closed",
			deliveryId: "delivery-123",
			issueBody: "The export button errors.",
			issueMeta: {
				author: "Ada",
				authorId: "user_123",
			},
			issue: {
				number: 42,
				title: "Export fails",
				state_reason: "not_planned",
			},
		});
	});

	test("rejects invalid signatures", async () => {
		const handler = createIssueWebhookHandler({
			secret: "expected-secret",
		});

		const response = await handler(
			await request("wrong-secret", "{}", {
				"x-github-event": "issues",
				"x-github-delivery": "delivery-123",
			}),
		);

		expect(response.status).toBe(401);
	});

	test("rejects malformed supported webhook payloads", async () => {
		const secret = "webhook-secret";
		const handler = createIssueWebhookHandler({ secret });
		const response = await handler(
			await request(
				secret,
				JSON.stringify({ action: "opened", issue: { number: "not-a-number" } }),
				{
					"x-github-event": "issues",
					"x-github-delivery": "delivery-invalid",
				},
			),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			data: null,
			error: "Invalid GitHub webhook payload",
		});
	});

	test("returns a retryable response when durable dispatch fails", async () => {
		const secret = "webhook-secret";
		const body = JSON.stringify({
			action: "opened",
			issue: {
				number: 42,
				title: "Export fails",
				body: "Steps",
				state: "open",
				labels: [],
				user: null,
				closed_at: null,
				created_at: "2026-08-05T09:00:00.000Z",
				updated_at: "2026-08-05T09:00:00.000Z",
			},
			repository: {
				id: 1,
				name: "support",
				full_name: "example/support",
			},
		});
		const handler = createIssueWebhookHandler({
			secret,
			onEvent: async () => {
				throw new Error("queue unavailable");
			},
		});
		const response = await handler(
			await request(secret, body, {
				"x-github-event": "issues",
				"x-github-delivery": "delivery-retry",
			}),
		);

		expect(response.status).toBe(503);
	});
});
