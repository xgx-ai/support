import { describe, expect, test } from "bun:test";
import type { AgentStageOutput, SupportRoute } from "./contracts";
import { createSupportWorkflowController } from "./controller";
import type { DeploymentPort, WorkflowIngressJob } from "./ports";
import {
	type AgentStageScript,
	createFakeRepositoryPort,
	createInMemoryWorkflowStore,
	createManualClock,
	createRecordingDeploymentPort,
	createRecordingResponsePublisher,
	createScriptedAgentRuntime,
	createSequentialIdGenerator,
} from "./testing";

const route: SupportRoute = {
	id: "auno",
	targetRepository: "example/auno",
	baseBranch: "main",
	qmScope: "team:support",
	automationMode: "full",
	allowedPaths: ["src/**"],
	forbiddenPaths: ["src/security/**"],
	testCommands: ["bun test", "bun run check"],
	stagingEnvironment: "staging",
	productionEnvironment: "production",
	deployAdapter: "github-actions",
};

const stageOutput = (
	overrides: Partial<AgentStageOutput> = {},
): AgentStageOutput => ({
	decision: "pass",
	risk: "r1",
	confidence: 0.95,
	title: "Stage complete",
	summary: "The stage completed successfully.",
	evidence: [],
	changedPaths: [],
	tests: [],
	restrictedChanges: [],
	links: [],
	...overrides,
});

const ingressJob = (
	overrides: Partial<WorkflowIngressJob> = {},
): WorkflowIngressJob => ({
	idempotencyKey: "github:example/support:delivery-1",
	deliveryId: "delivery-1",
	eventType: "issue.opened",
	issue: {
		supportRepository: "example/support",
		issueNumber: 42,
		title: "Export fails",
		body: "Click export and observe a 500 response.",
		labels: ["bug", "p2"],
		authorId: "customer-1",
		triggerType: "issue.opened",
		updatedAt: "2026-08-05T09:00:00.000Z",
	},
	route,
	receivedAt: "2026-08-05T09:00:00.000Z",
	...overrides,
});

function setup(input?: {
	script?: AgentStageScript;
	changeSet?: {
		baseSha: string;
		headSha: string;
		changedPaths: string[];
		patch?: string;
		addedDependencies?: string[];
	};
	deployment?: DeploymentPort;
}) {
	const manual = createManualClock();
	const ids = createSequentialIdGenerator();
	const store = createInMemoryWorkflowStore();
	const runtime = createScriptedAgentRuntime({
		script: input?.script,
		clock: manual.clock,
		ids,
	});
	const repository = createFakeRepositoryPort({
		baseSha: "base-sha",
		changeSet: input?.changeSet,
	});
	const recordingDeployment = createRecordingDeploymentPort();
	const deployment = input?.deployment ?? recordingDeployment;
	const responses = createRecordingResponsePublisher();
	const controller = createSupportWorkflowController({
		store,
		runtime,
		repository,
		deployment,
		responses,
		clock: manual.clock,
		ids,
	});
	return {
		controller,
		store,
		runtime,
		repository,
		deployment,
		deploymentRecords: recordingDeployment.deployments,
		responses,
		manual,
	};
}

async function ingestAndRunToPlan(
	controller: ReturnType<typeof setup>["controller"],
) {
	const ingested = await controller.ingest(ingressJob());
	if (!ingested.workflow) throw new Error("Workflow was not created");
	return controller.runUntilGate(ingested.workflow.id);
}

describe("support workflow controller", () => {
	test("runs the complete R1 workflow with every human and deployment gate", async () => {
		const { controller, deploymentRecords, responses, runtime } = setup();
		let workflow = await ingestAndRunToPlan(controller);
		expect(workflow.state).toBe("awaiting_plan_approval");

		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("awaiting_human_review");
		expect(workflow.headSha).toBe("candidate-sha");

		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "record_merge",
			actorId: "reviewer-1",
			mergedSha: "merged-sha",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("awaiting_deploy_approval");

		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_deploy",
			actorId: "release-owner-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("awaiting_response_approval");
		expect(workflow.deployedSha).toBe("merged-sha");
		expect(responses.published).toHaveLength(0);

		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_response",
			actorId: "support-owner-1",
		});
		expect(workflow.state).toBe("closed");
		expect(responses.published).toHaveLength(1);
		expect(deploymentRecords).toEqual([
			{
				workflowId: workflow.id,
				adapter: "github-actions",
				environment: "production",
				sha: "merged-sha",
				idempotencyKey: `support-deploy:${workflow.id}:github-actions:production:merged-sha`,
			},
		]);
		expect(runtime.requests.map((request) => request.stage)).toEqual([
			"validate",
			"triage",
			"investigate",
			"implement",
			"qc",
			"verify_staging",
			"deploy",
			"verify_production",
			"respond",
		]);

		const workspace = await controller.getStaffWorkspace(workflow.id);
		expect(workspace?.approvals.map((approval) => approval.kind)).toEqual([
			"plan",
			"merge",
			"deploy",
			"response",
		]);
		expect(workspace?.artifacts.at(-1)?.visibility).toBe("public");
		const responseApproval = workspace?.approvals.find(
			(approval) => approval.kind === "response",
		);
		expect(
			workspace?.artifacts.find(
				(artifact) => artifact.artifactId === responseApproval?.artifactId,
			)?.visibility,
		).toBe("public_candidate");
	});

	test("routes R0 support answers directly to response approval", async () => {
		const { controller, runtime } = setup({
			script: {
				triage: [stageOutput({ risk: "r0", triageRoute: "response" })],
			},
		});
		const ingested = await controller.ingest(ingressJob());
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(workflow.state).toBe("awaiting_response_approval");
		expect(runtime.requests.map((request) => request.stage)).toEqual([
			"validate",
			"triage",
			"respond",
		]);
	});

	test("runs validation and triage only in shadow mode", async () => {
		const { controller, deploymentRecords, responses, runtime } = setup();
		const ingested = await controller.ingest(
			ingressJob({ route: { ...route, automationMode: "shadow" } }),
		);
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(workflow.state).toBe("shadow_complete");
		expect(runtime.requests.map((request) => request.stage)).toEqual([
			"validate",
			"triage",
		]);
		expect(deploymentRecords).toHaveLength(0);
		expect(responses.published).toHaveLength(0);
	});

	test("stops R3 work as a proposal before implementation", async () => {
		const { controller, runtime } = setup({
			script: {
				investigate: [
					stageOutput({
						decision: "proposal_only",
						risk: "r3",
						restrictedChanges: [
							{
								category: "database",
								reason: "A new indexed field is required.",
								proposal: "Create a separately reviewed migration.",
							},
						],
					}),
				],
			},
		});
		const ingested = await controller.ingest(ingressJob());
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(workflow.state).toBe("restricted_proposal_only");
		expect(
			runtime.requests.some((request) => request.stage === "implement"),
		).toBe(false);
	});

	test("uses the trusted repository diff to block a package change", async () => {
		const { controller } = setup({
			changeSet: {
				baseSha: "base-sha",
				headSha: "candidate-sha",
				changedPaths: ["package.json", "src/export.ts"],
				addedDependencies: ["new-sdk"],
			},
		});
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("restricted_proposal_only");
		expect(workflow.risk).toBe("r3");
		const workspace = await controller.getStaffWorkspace(workflow.id);
		expect(
			workspace?.artifacts.at(-1)?.restrictedChanges.length,
		).toBeGreaterThan(0);
	});

	test("escalates P0 before code work even if an agent misses it", async () => {
		const { controller, runtime } = setup();
		const job = ingressJob({
			issue: {
				...ingressJob().issue,
				labels: ["bug", "p0"],
			},
		});
		const ingested = await controller.ingest(job);
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(workflow.state).toBe("security_escalation");
		expect(runtime.requests).toHaveLength(0);
	});

	test("deduplicates deliveries and invalidates work when the issue changes", async () => {
		const { controller } = setup();
		const first = await controller.ingest(ingressJob());
		const duplicate = await controller.ingest(ingressJob());
		expect(duplicate.status).toBe("duplicate");
		if (!first.workflow) throw new Error("Workflow was not created");
		let workflow = await controller.runUntilGate(first.workflow.id);
		expect(workflow.state).toBe("awaiting_plan_approval");

		const changed = await controller.ingest(
			ingressJob({
				idempotencyKey: "github:example/support:delivery-2",
				deliveryId: "delivery-2",
				eventType: "comment.created",
				issue: {
					...ingressJob().issue,
					latestComment: "This now affects every export.",
					triggerType: "comment.created",
					updatedAt: "2026-08-05T10:00:00.000Z",
				},
			}),
		);
		expect(changed.status).toBe("updated");
		expect(changed.workflow?.state).toBe("stale");
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: changed.workflow?.version ?? -1,
			action: "retry",
			actorId: "support-owner-1",
		});
		expect(workflow.state).toBe("received");
	});

	test("stops after two independent QC failure loops", async () => {
		const { controller } = setup({
			script: {
				qc: [
					stageOutput({
						decision: "changes_requested",
						headSha: "candidate-sha",
					}),
					stageOutput({
						decision: "changes_requested",
						headSha: "candidate-sha",
					}),
				],
			},
		});
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("needs_human");
		expect(workflow.qcLoops).toBe(2);
	});

	test("rejects QC and staging evidence that is not bound to the exact SHA", async () => {
		const qcSetup = setup({
			script: {
				qc: [stageOutput({ headSha: "different-sha" })],
			},
		});
		let workflow = await ingestAndRunToPlan(qcSetup.controller);
		workflow = await qcSetup.controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await qcSetup.controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("failed_retryable");
		expect(workflow.lastError).toContain("different commit SHA");

		const stagingSetup = setup({
			script: {
				verify_staging: [stageOutput({ headSha: "different-sha" })],
			},
		});
		workflow = await ingestAndRunToPlan(stagingSetup.controller);
		workflow = await stagingSetup.controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await stagingSetup.controller.runUntilGate(workflow.id);
		workflow = await stagingSetup.controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "record_merge",
			actorId: "reviewer-1",
			mergedSha: "merged-sha",
		});
		workflow = await stagingSetup.controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("failed_retryable");
		expect(workflow.lastError).toContain("merged commit SHA");
	});

	test("rejects a trusted deployment adapter receipt for another SHA", async () => {
		const { controller, responses } = setup({
			deployment: {
				async deploy() {
					return { deployedSha: "unexpected-sha" };
				},
			},
		});
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "record_merge",
			actorId: "reviewer-1",
			mergedSha: "merged-sha",
		});
		workflow = await controller.runUntilGate(workflow.id);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_deploy",
			actorId: "release-owner-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("failed_retryable");
		expect(workflow.lastError).toContain("unexpected SHA");
		expect(responses.published).toHaveLength(0);
	});

	test("does not expose a response before its human approval", async () => {
		const { controller, responses } = setup({
			script: {
				triage: [stageOutput({ risk: "r0", triageRoute: "response" })],
			},
		});
		const ingested = await controller.ingest(ingressJob());
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(responses.published).toHaveLength(0);
		const workspace = await controller.getStaffWorkspace(workflow.id);
		expect(workspace?.artifacts.at(-1)?.visibility).toBe("public_candidate");
		expect(
			workspace?.activities.some((item) => item.visibility === "public"),
		).toBe(false);
	});

	test("treats proposal_only investigation as restricted even without R3 metadata", async () => {
		const { controller, runtime } = setup({
			script: {
				investigate: [stageOutput({ decision: "proposal_only" })],
			},
		});
		const ingested = await controller.ingest(ingressJob());
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(workflow.state).toBe("restricted_proposal_only");
		expect(
			runtime.requests.some((request) => request.stage === "implement"),
		).toBe(false);
	});

	test("rejects implementation from a base SHA not bound to plan approval", async () => {
		const { controller } = setup({
			changeSet: {
				baseSha: "different-base",
				headSha: "candidate-sha",
				changedPaths: ["src/export.ts"],
			},
		});
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("failed_retryable");
		expect(workflow.baseSha).toBe("base-sha");
		expect(workflow.headSha).toBeUndefined();
		expect(workflow.lastError).toContain("different base SHA");
	});

	test("rejects a merged SHA that the trusted repository cannot bind", async () => {
		const { controller, repository } = setup();
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		repository.setMergeVerification(false);
		await expect(
			controller.performAction({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				action: "record_merge",
				actorId: "reviewer-1",
				mergedSha: "unbound-sha",
			}),
		).rejects.toThrow("could not bind");
		const current = await controller.getStaffWorkspace(workflow.id);
		expect(current?.workflow.state).toBe("awaiting_human_review");
		expect(current?.approvals.some((item) => item.kind === "merge")).toBe(
			false,
		);
	});

	test("keeps approval and gate transition atomic on storage failure", async () => {
		const { controller, store } = setup();
		const workflow = await ingestAndRunToPlan(controller);
		const transact = store.transact.bind(store);
		let failApproval = true;
		store.transact = async (transaction) => {
			if (failApproval && (transaction.approvals?.length ?? 0) > 0) {
				throw new Error("simulated transaction failure");
			}
			return transact(transaction);
		};
		await expect(
			controller.performAction({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				action: "approve_plan",
				actorId: "engineer-1",
			}),
		).rejects.toThrow("simulated transaction failure");
		const unchanged = await controller.getStaffWorkspace(workflow.id);
		expect(unchanged?.workflow.state).toBe("awaiting_plan_approval");
		expect(unchanged?.approvals).toHaveLength(0);

		failApproval = false;
		const approved = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		expect(approved.state).toBe("implementing");
		expect(
			(await controller.getStaffWorkspace(workflow.id))?.approvals,
		).toHaveLength(1);
	});

	test("does not poison ingress idempotency when a fallible read fails", async () => {
		const { controller, repository, store } = setup();
		const getBaseSha = repository.getBaseSha.bind(repository);
		let calls = 0;
		repository.getBaseSha = async (resolvedRoute) => {
			calls += 1;
			if (calls === 1) throw new Error("temporary repository failure");
			return getBaseSha(resolvedRoute);
		};
		await expect(controller.ingest(ingressJob())).rejects.toThrow(
			"temporary repository failure",
		);
		expect(
			await store.hasIngressIdempotencyKey(ingressJob().idempotencyKey),
		).toBe(false);
		const retried = await controller.ingest(ingressJob());
		expect(retried.status).toBe("created");
		expect(
			await store.hasIngressIdempotencyKey(ingressJob().idempotencyKey),
		).toBe(true);
	});

	test("replays the same persisted stage idempotency key after lease expiry", async () => {
		const { controller, manual, runtime, store } = setup();
		const ingested = await controller.ingest(ingressJob());
		if (!ingested.workflow) throw new Error("Workflow was not created");
		const workflow = ingested.workflow;
		const leased = {
			...workflow,
			version: workflow.version + 1,
			state: "validating" as const,
			activeStage: "validate" as const,
			activeLease: {
				id: "dead-worker",
				kind: "agent_stage" as const,
				idempotencyKey: "persisted-stage-key",
				attempt: 1,
				acquiredAt: "2026-08-05T08:00:00.000Z",
				expiresAt: "2026-08-05T08:05:00.000Z",
			},
			stageAttempts: { validate: 1 },
			updatedAt: manual.clock.now().toISOString(),
		};
		expect(
			await store.transact({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				next: leased,
			}),
		).toBe("committed");
		const next = await controller.runNext(workflow.id);
		expect(next.state).toBe("triaging");
		expect(runtime.requests.at(-1)?.idempotencyKey).toBe("persisted-stage-key");
		expect(runtime.requests.at(-1)?.attempt).toBe(1);
	});

	test("passes structured human revision feedback into the next agent run", async () => {
		const { controller, runtime } = setup();
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "revise_plan",
			actorId: "engineer-1",
			note: "Use the existing export service boundary and add the sibling test.",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("awaiting_plan_approval");
		const request = runtime.requests.findLast(
			(item) => item.stage === "investigate",
		);
		expect(request?.reviewFeedback.at(-1)?.kind).toBe("revise_plan");
		expect(request?.reviewFeedback.at(-1)?.note).toContain(
			"existing export service",
		);
	});

	test("fences issue updates until an attempted deployment is reconciled", async () => {
		const idempotencyKeys: string[] = [];
		let attempts = 0;
		const deployment: DeploymentPort = {
			async deploy(input) {
				attempts += 1;
				idempotencyKeys.push(input.idempotencyKey);
				if (attempts === 1) throw new Error("adapter response was lost");
				return { deployedSha: input.sha };
			},
		};
		const { controller } = setup({ deployment });
		let workflow = await ingestAndRunToPlan(controller);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_plan",
			actorId: "engineer-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "record_merge",
			actorId: "reviewer-1",
			mergedSha: "merged-sha",
		});
		workflow = await controller.runUntilGate(workflow.id);
		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "approve_deploy",
			actorId: "release-owner-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("failed_retryable");

		await expect(
			controller.ingest(
				ingressJob({
					idempotencyKey: "github:example/support:deployment-race",
					deliveryId: "deployment-race",
					eventType: "comment.created",
					issue: {
						...ingressJob().issue,
						latestComment: "Did it deploy?",
						triggerType: "comment.created",
						updatedAt: "2026-08-05T10:00:00.000Z",
					},
				}),
			),
		).rejects.toThrow("must be reconciled");

		workflow = await controller.performAction({
			workflowId: workflow.id,
			expectedVersion: workflow.version,
			action: "retry",
			actorId: "release-owner-1",
		});
		workflow = await controller.runUntilGate(workflow.id);
		expect(workflow.state).toBe("awaiting_response_approval");
		expect(idempotencyKeys).toHaveLength(2);
		expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
	});

	test("holds oversized untrusted input for manual review without calling QM", async () => {
		const { controller, runtime } = setup();
		const job = ingressJob({
			issue: {
				...ingressJob().issue,
				body: "x".repeat(12_100),
			},
		});
		const ingested = await controller.ingest(job);
		expect(ingested.workflow?.state).toBe("needs_human");
		expect(runtime.requests).toHaveLength(0);
	});

	test("enforces rollout mode inside direct runNext calls", async () => {
		const { controller, store } = setup();
		const ingested = await controller.ingest(
			ingressJob({ route: { ...route, automationMode: "plan" } }),
		);
		if (!ingested.workflow) throw new Error("Workflow was not created");
		let workflow = await controller.runUntilGate(ingested.workflow.id);
		expect(workflow.state).toBe("awaiting_plan_approval");
		const forced = {
			...workflow,
			version: workflow.version + 1,
			state: "implementing" as const,
			updatedAt: "2026-08-05T11:00:00.000Z",
		};
		expect(
			await store.transact({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				next: forced,
			}),
		).toBe("committed");
		workflow = forced;
		await expect(controller.runNext(workflow.id)).rejects.toThrow(
			"is not runnable in mode plan",
		);
	});
});
