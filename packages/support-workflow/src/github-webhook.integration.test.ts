import { describe, expect, test } from "bun:test";
import {
	createIssueWebhookHandler,
	createIssueWebhookReplayRequest,
} from "../../github-issues/src";
import { createSupportWorkflowController } from "./controller";
import { createSupportWorkflowWebhookEnqueuer } from "./github-webhook";
import {
	createFakeRepositoryPort,
	createInMemoryWorkflowQueue,
	createInMemoryWorkflowStore,
	createManualClock,
	createRecordingDeploymentPort,
	createRecordingResponsePublisher,
	createScriptedAgentRuntime,
	createSequentialIdGenerator,
	createStaticSupportRouteResolver,
} from "./testing";

describe("GitHub webhook to agent workflow integration", () => {
	test("replays a signed webhook, enqueues quickly, then runs agents in the worker", async () => {
		const secret = "webhook-secret";
		const queue = createInMemoryWorkflowQueue();
		const routes = createStaticSupportRouteResolver({
			"example/support": {
				id: "auno",
				targetRepository: "example/auno",
				baseBranch: "main",
				agentScope: "team:support",
				automationMode: "full",
				allowedPaths: ["src/**"],
				forbiddenPaths: [],
				executionProfile: {
					kind: "nix-dev-shell",
					profileId: "auno-support-v1",
					flakeSubdir: ".",
					workspaceSubdir: ".",
					devShell: "support",
					timeoutMs: 600_000,
					checks: [
						{
							id: "tests",
							label: "Unit tests",
							argv: ["bun", "test"],
						},
					],
				},
				stagingEnvironment: "staging",
				productionEnvironment: "production",
				deployAdapter: "github-actions",
			},
		});
		const enqueue = createSupportWorkflowWebhookEnqueuer({ queue, routes });
		const handler = createIssueWebhookHandler({
			secret,
			onEvent: enqueue,
		});
		const request = await createIssueWebhookReplayRequest({
			url: "https://example.com/api/webhooks/support",
			secret,
			authorId: "customer-1",
			action: "opened",
			issueNumber: 42,
			title: "Export fails",
			body: "The export action returns a 500 response.",
			deliveryId: "delivery-integration-1",
			now: "2026-08-05T09:00:00.000Z",
			repository: {
				id: 1,
				name: "support",
				full_name: "example/support",
			},
		});

		const response = await handler(request);
		expect(response.status).toBe(200);
		expect(queue.list()).toHaveLength(1);

		const manual = createManualClock();
		const ids = createSequentialIdGenerator();
		const store = createInMemoryWorkflowStore();
		const runtime = createScriptedAgentRuntime({ clock: manual.clock, ids });
		const controller = createSupportWorkflowController({
			store,
			runtime,
			repository: createFakeRepositoryPort(),
			deployment: createRecordingDeploymentPort(),
			responses: createRecordingResponsePublisher(),
			clock: manual.clock,
			ids,
		});
		await queue.drain((job) => controller.ingest(job));
		const workflowId = "support:example/support#42";
		const workflow = await controller.runUntilGate(workflowId);

		expect(workflow.state).toBe("awaiting_plan_approval");
		expect(runtime.requests.map((item) => item.stage)).toEqual([
			"validate",
			"triage",
			"investigate",
		]);
	});

	test("keeps GitHub App transport events and filters only trusted controller responses", async () => {
		const queue = createInMemoryWorkflowQueue();
		const routes = createStaticSupportRouteResolver({
			"example/support": {
				id: "auno",
				targetRepository: "example/auno",
				baseBranch: "main",
				agentScope: "team:support",
				automationMode: "full",
				allowedPaths: ["src/**"],
				forbiddenPaths: [],
				executionProfile: {
					kind: "nix-dev-shell",
					profileId: "auno-support-v1",
					flakeSubdir: ".",
					workspaceSubdir: ".",
					devShell: "support",
					timeoutMs: 600_000,
					checks: [
						{
							id: "tests",
							label: "Unit tests",
							argv: ["bun", "test"],
						},
					],
				},
			},
		});
		const enqueue = createSupportWorkflowWebhookEnqueuer({
			queue,
			routes,
			isControllerAuthoredResponse: (event) =>
				event.commentMeta?.workflowActor === "support-controller",
		});
		await enqueue({
			type: "comment.created",
			deliveryId: "delivery-customer-via-app",
			issue: {
				number: 42,
				title: "Export fails",
				updated_at: "2026-08-05T09:00:00.000Z",
				labels: [],
			},
			issueBody: "Issue body",
			issueMeta: {},
			repository: { full_name: "example/support" },
			sender: { login: "support-automation[bot]" },
			commentBody: "Customer follow-up",
		});
		expect(queue.list()).toHaveLength(1);

		await enqueue({
			type: "comment.created",
			deliveryId: "delivery-controller-response",
			issue: {
				number: 42,
				title: "Export fails",
				updated_at: "2026-08-05T09:01:00.000Z",
				labels: [],
			},
			issueBody: "Issue body",
			issueMeta: {},
			repository: { full_name: "example/support" },
			sender: { login: "support-automation[bot]" },
			commentBody: "Approved public response",
			commentMeta: { workflowActor: "support-controller" },
		});
		expect(queue.list()).toHaveLength(1);
	});

	test("enqueues P0 label, lifecycle, and comment update events", async () => {
		const queue = createInMemoryWorkflowQueue();
		const routes = createStaticSupportRouteResolver({
			"example/support": {
				id: "auno",
				targetRepository: "example/auno",
				baseBranch: "main",
				agentScope: "team:support",
				automationMode: "full",
				allowedPaths: ["src/**"],
				forbiddenPaths: [],
				executionProfile: {
					kind: "nix-dev-shell",
					profileId: "auno-support-v1",
					flakeSubdir: ".",
					workspaceSubdir: ".",
					devShell: "support",
					timeoutMs: 600_000,
					checks: [
						{
							id: "tests",
							label: "Unit tests",
							argv: ["bun", "test"],
						},
					],
				},
			},
		});
		const enqueue = createSupportWorkflowWebhookEnqueuer({ queue, routes });
		const eventTypes = [
			"issue.labeled",
			"issue.unlabeled",
			"issue.closed",
			"issue.deleted",
			"issue.reopened",
			"issue.transferred",
			"comment.edited",
			"comment.deleted",
		] as const;

		for (const [index, type] of eventTypes.entries()) {
			await enqueue({
				type,
				deliveryId: `delivery-update-${index}`,
				issue: {
					number: 42,
					title: "Export fails",
					updated_at: "2026-08-05T10:00:00.000Z",
					labels: [{ name: "p0" }],
				},
				issueBody: "Issue body",
				issueMeta: { authorId: "customer-1" },
				repository: { full_name: "example/support" },
				sender: { login: "support-automation[bot]" },
				commentBody: type.startsWith("comment.")
					? "Updated customer detail"
					: undefined,
				comment: type.startsWith("comment.")
					? { updated_at: "2026-08-05T10:01:00.000Z" }
					: undefined,
			});
		}

		expect(queue.list().map((job) => job.eventType)).toEqual([...eventTypes]);
		expect(queue.list()[0]?.issue.labels).toContain("p0");
		expect(queue.list().at(-1)?.issue.latestComment).toBeUndefined();
	});
});
