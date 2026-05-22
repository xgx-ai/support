import { describe, expect, test } from "bun:test";
import {
	createIssueWebhookReplayRequest,
	issueWebhookReplayOptionsFromEnv,
} from "./webhook-replay";
import { createIssueWebhookHandler } from "./webhooks";

describe("webhook replay helpers", () => {
	test("creates a signed issue webhook request accepted by the handler", async () => {
		const secret = "webhook-secret";
		const events: unknown[] = [];
		const handler = createIssueWebhookHandler({
			secret,
			onEvent: (event) => {
				events.push(event);
			},
		});

		const request = await createIssueWebhookReplayRequest({
			url: "https://example.com/webhooks/support",
			secret,
			author: "Ada",
			authorId: "user_123",
			tenant: "demo",
			issueNumber: 42,
			title: "Export fails",
			body: "The export button errors.",
			deliveryId: "local-delivery",
			now: "2026-05-22T10:15:00Z",
		});
		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "issue.closed",
			deliveryId: "local-delivery",
			issueBody: "The export button errors.",
			issueMeta: {
				author: "Ada",
				authorId: "user_123",
				tenant: "demo",
			},
			issue: {
				number: 42,
				title: "Export fails",
				state_reason: "completed",
			},
		});
	});

	test("requires the replay environment variables", () => {
		expect(() => issueWebhookReplayOptionsFromEnv({})).toThrow(
			"Missing SUPPORT_WEBHOOK_URL",
		);
		expect(() =>
			issueWebhookReplayOptionsFromEnv({
				SUPPORT_WEBHOOK_URL: "http://localhost:8787/api/webhooks/support",
			}),
		).toThrow("Missing GITHUB_WEBHOOK_SECRET");
		expect(() =>
			issueWebhookReplayOptionsFromEnv({
				SUPPORT_WEBHOOK_URL: "http://localhost:8787/api/webhooks/support",
				GITHUB_WEBHOOK_SECRET: "secret",
			}),
		).toThrow("Missing SUPPORT_WEBHOOK_AUTHOR_ID");
	});

	test("reads issue state reason from the replay environment", () => {
		const options = issueWebhookReplayOptionsFromEnv({
			SUPPORT_WEBHOOK_URL: "http://localhost:8787/api/webhooks/support",
			GITHUB_WEBHOOK_SECRET: "secret",
			SUPPORT_WEBHOOK_AUTHOR_ID: "user_123",
			SUPPORT_WEBHOOK_STATE_REASON: "not_planned",
		});

		expect(options.stateReason).toBe("not_planned");
	});
});
