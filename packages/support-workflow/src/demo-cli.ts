import type {
	AgentStageOutput,
	SupportRoute,
	WorkflowRecord,
} from "./contracts";
import { createSupportWorkflowController } from "./controller";
import type { WorkflowIngressJob } from "./ports";
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

export const demoScenarioNames = [
	"happy",
	"shadow",
	"answer",
	"restricted",
	"p0",
	"qc-fail",
	"stale",
] as const;

export type DemoScenarioName = (typeof demoScenarioNames)[number];

export interface WorkflowDemoResult {
	scenario: DemoScenarioName;
	workflowId: string;
	finalState: WorkflowRecord["state"];
	states: WorkflowRecord["state"][];
	agentStages: string[];
	approvals: string[];
	deployments: number;
	publicResponses: number;
	internalActivities: number;
	publicActivities: number;
}

const route: SupportRoute = {
	id: "local-demo",
	targetRepository: "example/product",
	baseBranch: "main",
	qmScope: "team:support-local-demo",
	automationMode: "full",
	allowedPaths: ["src/**", "test/**"],
	forbiddenPaths: ["src/security/**"],
	testCommands: ["bun test", "bun run check"],
	stagingEnvironment: "local-staging",
	productionEnvironment: "local-production",
	deployAdapter: "record-only-local-demo",
};

function output(overrides: Partial<AgentStageOutput> = {}): AgentStageOutput {
	return {
		decision: "pass",
		risk: "r1",
		confidence: 0.95,
		title: "Demo stage complete",
		summary: "The scripted local stage completed.",
		evidence: [],
		changedPaths: [],
		tests: [],
		restrictedChanges: [],
		links: [],
		...overrides,
	};
}

function scenarioScript(scenario: DemoScenarioName): AgentStageScript {
	if (scenario === "answer") {
		return {
			triage: [output({ risk: "r0", triageRoute: "response" })],
		};
	}
	if (scenario === "restricted") {
		return {
			investigate: [
				output({
					decision: "proposal_only",
					risk: "r3",
					restrictedChanges: [
						{
							category: "database",
							reason: "The example would require persistent schema work.",
							proposal: "Raise a separate reviewed migration proposal.",
						},
					],
				}),
			],
		};
	}
	if (scenario === "qc-fail") {
		return {
			qc: [
				output({ decision: "changes_requested", headSha: "candidate-sha" }),
				output({ decision: "changes_requested", headSha: "candidate-sha" }),
			],
		};
	}
	return {};
}

function ingressJob(scenario: DemoScenarioName): WorkflowIngressJob {
	return {
		idempotencyKey: `local-demo:${scenario}:delivery-1`,
		deliveryId: "delivery-1",
		eventType: "issue.opened",
		issue: {
			supportRepository: "example/support",
			issueNumber: 42,
			title: "Export fails for a customer",
			body: "Clicking Export returns a 500 response.",
			labels: scenario === "p0" ? ["bug", "p0"] : ["bug", "p2"],
			authorId: "local-customer",
			triggerType: "issue.opened",
			updatedAt: "2026-08-05T09:00:00.000Z",
		},
		route:
			scenario === "shadow" ? { ...route, automationMode: "shadow" } : route,
		receivedAt: "2026-08-05T09:00:00.000Z",
	};
}

export async function runWorkflowDemo(
	scenario: DemoScenarioName,
): Promise<WorkflowDemoResult> {
	const manual = createManualClock();
	const ids = createSequentialIdGenerator();
	const store = createInMemoryWorkflowStore();
	const runtime = createScriptedAgentRuntime({
		script: scenarioScript(scenario),
		clock: manual.clock,
		ids,
	});
	const deployment = createRecordingDeploymentPort();
	const responses = createRecordingResponsePublisher();
	const controller = createSupportWorkflowController({
		store,
		runtime,
		repository: createFakeRepositoryPort(),
		deployment,
		responses,
		clock: manual.clock,
		ids,
	});
	const states: WorkflowRecord["state"][] = [];
	const record = (workflow: WorkflowRecord) => {
		states.push(workflow.state);
		return workflow;
	};

	const ingested = await controller.ingest(ingressJob(scenario));
	if (!ingested.workflow)
		throw new Error("The local demo workflow was not created");
	let workflow = record(ingested.workflow);
	workflow = record(await controller.runUntilGate(workflow.id));

	if (scenario === "stale") {
		const changed = ingressJob(scenario);
		changed.idempotencyKey = "local-demo:stale:delivery-2";
		changed.deliveryId = "delivery-2";
		changed.eventType = "comment.created";
		changed.issue = {
			...changed.issue,
			latestComment: "The issue now affects every export.",
			triggerType: "comment.created",
			updatedAt: "2026-08-05T10:00:00.000Z",
		};
		const updated = await controller.ingest(changed);
		if (!updated.workflow)
			throw new Error("The stale workflow update was lost");
		workflow = record(updated.workflow);
	}

	if (workflow.state === "awaiting_plan_approval") {
		workflow = record(
			await controller.performAction({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				action: "approve_plan",
				actorId: "local-plan-approver",
			}),
		);
		workflow = record(await controller.runUntilGate(workflow.id));
	}

	if (workflow.state === "awaiting_human_review") {
		workflow = record(
			await controller.performAction({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				action: "record_merge",
				actorId: "local-code-reviewer",
				mergedSha: "local-merged-sha",
			}),
		);
		workflow = record(await controller.runUntilGate(workflow.id));
	}

	if (workflow.state === "awaiting_deploy_approval") {
		workflow = record(
			await controller.performAction({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				action: "approve_deploy",
				actorId: "local-release-owner",
			}),
		);
		workflow = record(await controller.runUntilGate(workflow.id));
	}

	if (workflow.state === "awaiting_response_approval") {
		workflow = record(
			await controller.performAction({
				workflowId: workflow.id,
				expectedVersion: workflow.version,
				action: "approve_response",
				actorId: "local-support-owner",
			}),
		);
	}

	const workspace = await controller.getStaffWorkspace(workflow.id);
	if (!workspace) throw new Error("The local demo workspace was not found");
	return {
		scenario,
		workflowId: workflow.id,
		finalState: workflow.state,
		states,
		agentStages: runtime.requests.map((request) => request.stage),
		approvals: workspace.approvals.map((approval) => approval.kind),
		deployments: deployment.deployments.length,
		publicResponses: responses.published.length,
		internalActivities: workspace.activities.filter(
			(activity) => activity.visibility === "internal",
		).length,
		publicActivities: workspace.activities.filter(
			(activity) => activity.visibility === "public",
		).length,
	};
}

function parseScenario(args: string[]): DemoScenarioName {
	const value = args
		.find((argument) => argument.startsWith("--scenario="))
		?.split("=")[1];
	if (!value) return "happy";
	if (demoScenarioNames.includes(value as DemoScenarioName)) {
		return value as DemoScenarioName;
	}
	throw new Error(
		`Unknown scenario ${value}. Choose one of: ${demoScenarioNames.join(", ")}`,
	);
}

if (import.meta.main) {
	const result = await runWorkflowDemo(parseScenario(Bun.argv.slice(2)));
	console.log(JSON.stringify(result, null, 2));
}
