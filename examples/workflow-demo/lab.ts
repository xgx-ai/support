import type {
	AgentStageOutput,
	AutomationMode,
	SupportRoute,
	WorkflowAction,
	WorkflowRecord,
} from "../../packages/support-workflow/src/contracts.ts";
import {
	createSupportWorkflowController,
	type SupportWorkflowController,
} from "../../packages/support-workflow/src/controller.ts";
import type {
	AgentRuntime,
	AgentStageRequest,
	WorkflowIngressJob,
} from "../../packages/support-workflow/src/ports.ts";
import { createQmClient } from "../../packages/support-workflow/src/qm-client.ts";
import { createQmAgentRuntime } from "../../packages/support-workflow/src/qm-runtime.ts";
import {
	createStaffWorkflowPanelView,
	type StaffWorkflowPanelView,
} from "../../packages/support-workflow/src/staff-view.ts";
import {
	type AgentStageScript,
	createFakeRepositoryPort,
	createInMemoryWorkflowStore,
	createQmMockAgentRuntime,
	createRecordingDeploymentPort,
	createRecordingResponsePublisher,
	createScriptedAgentRuntime,
	createSequentialIdGenerator,
} from "../../packages/support-workflow/src/testing.ts";
import type {
	LocalPerformTicketActionInput,
	LocalSupportAppSummary,
	LocalSupportTicketDetail,
	LocalSupportTicketSummary,
	LocalTicketDecision,
	LocalTicketStatus,
} from "./inbox.ts";
import {
	type WorkflowDemoScenario,
	workflowScenarios,
} from "./src/fixtures.ts";

export const localScenarioNames = [
	"happy",
	"shadow",
	"answer",
	"restricted",
	"p0",
	"qc-fail",
	"stale",
] as const;

export type LocalScenarioName = (typeof localScenarioNames)[number];
export type LocalQmMode = "qm-mock" | "qm-live" | "scripted";

export interface LocalWorkflowLabStatus {
	mode: LocalQmMode;
	qmUrl?: string;
	workflowId?: string;
	workflowState?: WorkflowRecord["state"];
	agentStages: string[];
	deployments: number;
	publicResponses: number;
}

export interface LocalWorkflowLab {
	reset(scenario?: LocalScenarioName): Promise<StaffWorkflowPanelView>;
	getView(): Promise<StaffWorkflowPanelView | null>;
	performAction(input: {
		action: WorkflowAction;
		expectedVersion: number;
		note?: string;
	}): Promise<StaffWorkflowPanelView>;
	listApps(): Promise<LocalSupportAppSummary[]>;
	listTickets(appId: string): Promise<LocalSupportTicketSummary[] | null>;
	getTicket(
		appId: string,
		issueNumber: number,
	): Promise<LocalSupportTicketDetail | null>;
	performTicketAction(
		input: LocalPerformTicketActionInput,
	): Promise<LocalSupportTicketDetail>;
	status(): Promise<LocalWorkflowLabStatus>;
}

interface LabRuntime extends AgentRuntime {
	requests: AgentStageRequest[];
}

interface LocalSupportAppSeed {
	id: string;
	name: string;
	description: string;
	targetRepository: string;
}

interface LocalSupportTicketSeed {
	id: string;
	appId: string;
	issueNumber: number;
	title: string;
	report: string;
	submittedBy: string;
	priority: LocalSupportTicketSummary["priority"];
	labels: string[];
	updatedAt: string;
	status: LocalTicketStatus;
	risk: NonNullable<LocalSupportTicketSummary["risk"]>;
	requiresReview: boolean;
	source: LocalSupportTicketSummary["source"];
	scenarioId?: "plan" | "qc" | "restricted";
}

const liveAppId = "ama";
const liveIssueNumber = 4821;

const localAppSeeds: LocalSupportAppSeed[] = [
	{
		id: "ama",
		name: "AMA",
		description: "Customer support tickets for the AMA application.",
		targetRepository: "xgx-ai/ama-app",
	},
	{
		id: "dms",
		name: "DMS",
		description: "Customer support tickets for the document management app.",
		targetRepository: "xgx-ai/dms",
	},
	{
		id: "support",
		name: "Support",
		description: "Tickets for the shared support platform and tooling.",
		targetRepository: "xgx-ai/support",
	},
];

const localTicketSeeds: LocalSupportTicketSeed[] = [
	{
		id: "ama-4821",
		appId: liveAppId,
		issueNumber: liveIssueNumber,
		title: "Export fails for a customer",
		report:
			"Clicking Export returns a 500 response in the local demonstration.",
		submittedBy: "Local customer",
		priority: "p2",
		labels: ["bug", "p2"],
		updatedAt: "2026-08-05T08:17:00.000Z",
		status: "new",
		risk: "r1",
		requiresReview: false,
		source: "live",
	},
	{
		id: "ama-4819-sample",
		appId: "ama",
		issueNumber: 4819,
		title: "Priority badge is missing",
		report:
			"Priority labels are present on the issue, but the support list does not show the expected badge.",
		submittedBy: "Sample customer",
		priority: "p2",
		labels: ["bug", "ui", "p2"],
		updatedAt: "2026-08-05T08:17:00.000Z",
		status: "needs_review",
		risk: "r2",
		requiresReview: true,
		source: "sample",
		scenarioId: "plan",
	},
	{
		id: "dms-2306-sample",
		appId: "dms",
		issueNumber: 2306,
		title: "Priority labels with whitespace are misclassified",
		report:
			"A priority label with leading whitespace bypasses normalisation and displays the wrong severity.",
		submittedBy: "Sample customer",
		priority: "p1",
		labels: ["bug", "quality", "p1"],
		updatedAt: "2026-08-05T08:31:00.000Z",
		status: "blocked",
		risk: "r2",
		requiresReview: true,
		source: "sample",
		scenarioId: "qc",
	},
	{
		id: "support-4870-sample",
		appId: "support",
		issueNumber: 4870,
		title: "Search results are stale",
		report:
			"New support records do not consistently appear in search results without a manual refresh.",
		submittedBy: "Sample customer",
		priority: "p1",
		labels: ["search", "data", "p1"],
		updatedAt: "2026-08-05T09:12:00.000Z",
		status: "blocked",
		risk: "r3",
		requiresReview: true,
		source: "sample",
		scenarioId: "restricted",
	},
];

const sampleScenarioById = new Map(
	workflowScenarios
		.filter((scenario) => ["plan", "qc", "restricted"].includes(scenario.id))
		.map((scenario) => [scenario.id, scenario]),
);

const fullRoute: SupportRoute = {
	id: "bun-local-dev",
	targetRepository: "xgx-ai/ama-app",
	baseBranch: "main",
	qmScope: "team:support-bun-local",
	automationMode: "full",
	allowedPaths: ["src/**", "test/**"],
	forbiddenPaths: [
		"src/security/**",
		"**/package.json",
		"**/bun.lock",
		"**/migrations/**",
	],
	testCommands: ["bun run check", "bun run test"],
	stagingEnvironment: "local-staging",
	productionEnvironment: "local-production",
	deployAdapter: "record-only-bun-dev",
};

function stageOutput(
	request: AgentStageRequest,
	scenario: LocalScenarioName,
): AgentStageOutput {
	const shared = {
		decision: "pass" as const,
		risk: request.stage === "triage" ? ("r1" as const) : request.workflow.risk,
		confidence: 0.96,
		title: `${request.stage.replaceAll("_", " ")} complete`,
		summary: `QM's Bun development runtime completed the ${request.stage.replaceAll("_", " ")} stage.`,
		details:
			"This deterministic development artifact crossed QM source authentication, inbound screening, asynchronous execution, and the support controller boundary.",
		evidence: [
			{
				title: "Local development evidence",
				detail:
					"No GitHub, deployment, database, or package mutation was performed.",
			},
		],
		changedPaths: [] as string[],
		tests: [] as AgentStageOutput["tests"],
		restrictedChanges: [] as AgentStageOutput["restrictedChanges"],
		links: [] as AgentStageOutput["links"],
		baseSha: request.workflow.baseSha,
		headSha: request.workflow.headSha,
	};

	if (request.stage === "triage") {
		return {
			...shared,
			risk: scenario === "answer" ? "r0" : "r1",
			triageRoute: scenario === "answer" ? "response" : "code",
		};
	}
	if (request.stage === "investigate" && scenario === "restricted") {
		return {
			...shared,
			decision: "proposal_only",
			risk: "r3",
			restrictedChanges: [
				{
					category: "database",
					reason: "The example requires a protected persistent-data change.",
					proposal: "Create a separate architecture and migration review.",
					rollback: "No change was applied by this workflow.",
				},
			],
		};
	}
	if (request.stage === "implement") {
		return {
			...shared,
			headSha: "candidate-sha",
			changedPaths: ["src/support-fix.ts", "src/support-fix.test.ts"],
			tests: [
				{
					command: "bun run test",
					status: "passed",
					summary: "Recorded by the local deterministic QM development lane.",
				},
			],
		};
	}
	if (request.stage === "qc") {
		return {
			...shared,
			decision: scenario === "qc-fail" ? "changes_requested" : "pass",
			headSha: request.workflow.headSha ?? "candidate-sha",
		};
	}
	if (request.stage === "verify_staging" || request.stage === "deploy") {
		return { ...shared, headSha: request.workflow.headSha };
	}
	if (request.stage === "verify_production") {
		return { ...shared, deployedSha: request.workflow.deployedSha };
	}
	if (request.stage === "respond") {
		return {
			...shared,
			publicResponse:
				"We have verified the change in the local workflow demonstration. No customer-facing system was modified.",
		};
	}
	return shared;
}

function ingressJob(
	scenario: LocalScenarioName,
	routeMode: AutomationMode,
	delivery = 1,
): WorkflowIngressJob {
	const timestamp = new Date().toISOString();
	return {
		idempotencyKey: `bun-dev:${scenario}:delivery-${delivery}`,
		deliveryId: `delivery-${delivery}`,
		eventType: delivery === 1 ? "issue.opened" : "comment.created",
		issue: {
			supportRepository: "xgx-ai/support",
			issueNumber: liveIssueNumber,
			title: "Export fails for a customer",
			body: "Clicking Export returns a 500 response in the local demonstration.",
			labels: scenario === "p0" ? ["bug", "p0"] : ["bug", "p2"],
			authorId: "local-customer",
			...(delivery > 1
				? {
						latestComment:
							"The issue changed while the private plan was under review.",
					}
				: {}),
			triggerType: delivery === 1 ? "issue.opened" : "comment.created",
			updatedAt: timestamp,
		},
		route: {
			...fullRoute,
			automationMode: scenario === "shadow" ? "shadow" : routeMode,
		},
		receivedAt: timestamp,
	};
}

function ticketKey(appId: string, issueNumber: number): string {
	return `${appId}:${issueNumber}`;
}

function localStatusForWorkflow(
	view: StaffWorkflowPanelView,
): LocalTicketStatus {
	switch (view.workflow.status) {
		case "running":
		case "pending":
			return "working";
		case "awaiting_approval":
		case "needs_human":
			return "needs_review";
		case "completed":
		case "succeeded":
		case "cancelled":
			return "resolved";
		case "failed":
		case "blocked":
		case "stale":
			return "blocked";
	}
}

const reviewActions = new Set<WorkflowAction>([
	"approve_plan",
	"revise_plan",
	"request_changes",
	"record_merge",
	"approve_deploy",
	"approve_response",
]);

function liveTicketSummary(
	seed: LocalSupportTicketSeed,
	view: StaffWorkflowPanelView,
): LocalSupportTicketSummary {
	const { scenarioId: _scenarioId, ...summary } = seed;
	return {
		...summary,
		labels: [...seed.labels],
		updatedAt: view.workflow.updatedAt,
		status: localStatusForWorkflow(view),
		risk: view.workflow.risk,
		requiresReview: view.availableActions.some((action) =>
			reviewActions.has(action.id),
		),
	};
}

function sampleTicketSummary(
	seed: LocalSupportTicketSeed,
	decision?: LocalTicketDecision,
): LocalSupportTicketSummary {
	const { scenarioId: _scenarioId, ...summary } = seed;
	const decisionResolved = decision
		? [
				"approve_plan",
				"record_merge",
				"approve_deploy",
				"approve_response",
				"cancel",
			].includes(decision.action)
		: false;
	return {
		...summary,
		labels: [...seed.labels],
		...(decision
			? {
					updatedAt: decision.recordedAt,
					status: decisionResolved
						? ("resolved" as const)
						: ("blocked" as const),
					requiresReview: false,
				}
			: {}),
	};
}

function sampleWorkflowView(
	seed: LocalSupportTicketSeed,
	scenario: WorkflowDemoScenario,
	decision?: LocalTicketDecision,
): StaffWorkflowPanelView {
	const workflowId = `sample:${seed.appId}#${seed.issueNumber}`;
	const baseVersion = scenario.confirmationContext.expectedVersion;
	const expectedVersion = decision ? baseVersion + 1 : baseVersion;
	const decisionIsApproval = decision
		? [
				"approve_plan",
				"record_merge",
				"approve_deploy",
				"approve_response",
			].includes(decision.action)
		: false;
	const decisionItem: StaffWorkflowPanelView["items"][number] | undefined =
		decision
			? {
					id: `sample-decision-${seed.id}`,
					title: decision.label,
					summary:
						decision.note ??
						"The decision was recorded only in this local sample inbox.",
					stage: "human_review",
					status: decisionIsApproval ? "succeeded" : "needs_human",
					visibility: "internal",
					occurredAt: decision.recordedAt,
					details: [
						{
							label: "Local-only decision",
							value:
								"Recorded in memory; no repository, GitHub, deployment, or customer response was changed.",
						},
					],
					links: [],
				}
			: undefined;

	return {
		workflowId,
		expectedVersion,
		confirmationContext: {
			...scenario.confirmationContext,
			workflowId,
			expectedVersion,
		},
		workflow: {
			title:
				scenario.workflow.title ??
				`Agent activity for issue #${seed.issueNumber}`,
			summary: decision
				? `${scenario.workflow.summary} A local staff decision has been recorded.`
				: scenario.workflow.summary,
			status: decision
				? decisionIsApproval || decision.action === "cancel"
					? "completed"
					: "needs_human"
				: scenario.workflow.status,
			activeStage: scenario.workflow.activeStage,
			risk: scenario.workflow.risk ?? seed.risk,
			updatedAt:
				decision?.recordedAt ?? scenario.workflow.updatedAt ?? seed.updatedAt,
			links: [...(scenario.workflow.links ?? [])],
		},
		items: [
			...scenario.items.map((item) => ({
				...item,
				details: [...(item.details ?? [])],
				links: [...(item.links ?? [])],
			})),
			...(decisionItem ? [decisionItem] : []),
		],
		availableActions: decision
			? []
			: scenario.actions.map((action) => ({
					id: action.id,
					label: action.label,
					description: action.description ?? "Record a local staff decision.",
					variant: action.variant ?? "outline",
				})),
	};
}

export function createLocalWorkflowLab(options: {
	mode: LocalQmMode;
	qmUrl?: string;
	qmSigningSecret?: string;
}): LocalWorkflowLab {
	const clock = { now: () => new Date() };
	const sampleDecisions = new Map<string, LocalTicketDecision>();
	let currentWorkflowId: string | undefined;
	let currentScenario: LocalScenarioName = "happy";
	let controller: SupportWorkflowController | undefined;
	let runtime: LabRuntime | undefined;
	let deployment = createRecordingDeploymentPort();
	let responses = createRecordingResponsePublisher();

	const buildRuntime = (): LabRuntime => {
		const ids = createSequentialIdGenerator();
		if (options.mode === "qm-mock") {
			if (!options.qmUrl || !options.qmSigningSecret) {
				throw new Error(
					"QM mock mode requires its local URL and signing secret",
				);
			}
			return createQmMockAgentRuntime({
				client: createQmClient({
					baseUrl: options.qmUrl,
					signingSecret: options.qmSigningSecret,
					pollIntervalMs: 25,
					timeoutMs: 30_000,
				}),
				clock,
				ids,
				outputForRequest: (request) => stageOutput(request, currentScenario),
			});
		}
		if (options.mode === "qm-live") {
			if (!options.qmUrl || !options.qmSigningSecret) {
				throw new Error(
					"QM live mode requires its local URL and signing secret",
				);
			}
			const requests: AgentStageRequest[] = [];
			const live = createQmAgentRuntime({
				client: createQmClient({
					baseUrl: options.qmUrl,
					signingSecret: options.qmSigningSecret,
				}),
				clock,
				ids,
			});
			return {
				requests,
				async execute(request) {
					requests.push(structuredClone(request));
					return live.execute(request);
				},
			};
		}
		const scripted = Object.fromEntries(
			[
				"validate",
				"triage",
				"investigate",
				"implement",
				"qc",
				"verify_staging",
				"deploy",
				"verify_production",
				"respond",
			].map((stage) => [
				stage,
				[
					(request: AgentStageRequest) => stageOutput(request, currentScenario),
					(request: AgentStageRequest) => stageOutput(request, currentScenario),
				],
			]),
		) as AgentStageScript;
		return createScriptedAgentRuntime({ script: scripted, clock, ids });
	};

	const rebuild = () => {
		const store = createInMemoryWorkflowStore();
		deployment = createRecordingDeploymentPort();
		responses = createRecordingResponsePublisher();
		runtime = buildRuntime();
		controller = createSupportWorkflowController({
			store,
			runtime,
			repository: createFakeRepositoryPort(),
			deployment,
			responses,
			clock,
			ids: createSequentialIdGenerator(),
		});
	};

	const requireController = () => {
		if (!controller) throw new Error("The local workflow has not been started");
		return controller;
	};

	const getView = async (): Promise<StaffWorkflowPanelView | null> => {
		if (!currentWorkflowId || !controller) return null;
		const workspace = await controller.getStaffWorkspace(currentWorkflowId);
		return workspace ? createStaffWorkflowPanelView(workspace) : null;
	};

	const allTicketSummaries = async (): Promise<LocalSupportTicketSummary[]> => {
		const liveView = await getView();
		return localTicketSeeds.map((seed) => {
			if (seed.source === "live" && liveView) {
				return liveTicketSummary(seed, liveView);
			}
			return sampleTicketSummary(
				seed,
				seed.source === "sample"
					? sampleDecisions.get(ticketKey(seed.appId, seed.issueNumber))
					: undefined,
			);
		});
	};

	const appSummary = async (
		seed: LocalSupportAppSeed,
	): Promise<LocalSupportAppSummary> => {
		const tickets = (await allTicketSummaries()).filter(
			(ticket) => ticket.appId === seed.id,
		);
		return {
			...seed,
			ticketCount: tickets.length,
			needsReviewCount: tickets.filter((ticket) => ticket.requiresReview)
				.length,
		};
	};

	const performCurrentAction = async (input: {
		action: WorkflowAction;
		expectedVersion: number;
		note?: string;
	}): Promise<StaffWorkflowPanelView> => {
		if (!currentWorkflowId) throw new Error("No local workflow is active");
		await requireController().performAction({
			workflowId: currentWorkflowId,
			expectedVersion: input.expectedVersion,
			action: input.action,
			actorId: "local-staff-user",
			...(input.action === "record_merge"
				? { mergedSha: "local-merged-sha" }
				: {}),
			...(input.action === "revise_plan" || input.action === "request_changes"
				? {
						note:
							input.note?.trim() ||
							"Please address the local review feedback before continuing.",
					}
				: input.note?.trim()
					? { note: input.note.trim() }
					: {}),
		});
		await requireController().runUntilGate(currentWorkflowId);
		const view = await getView();
		if (!view) throw new Error("Local workflow view disappeared");
		return view;
	};

	const getTicket = async (
		appId: string,
		issueNumber: number,
	): Promise<LocalSupportTicketDetail | null> => {
		const appSeed = localAppSeeds.find((candidate) => candidate.id === appId);
		const ticketSeed = localTicketSeeds.find(
			(candidate) =>
				candidate.appId === appId && candidate.issueNumber === issueNumber,
		);
		if (!appSeed || !ticketSeed) return null;

		const app = await appSummary(appSeed);
		if (ticketSeed.source === "live") {
			const workflow = await getView();
			if (!workflow) return null;
			return {
				app,
				ticket: liveTicketSummary(ticketSeed, workflow),
				workflow,
			};
		}

		const scenario = ticketSeed.scenarioId
			? sampleScenarioById.get(ticketSeed.scenarioId)
			: undefined;
		if (!scenario)
			throw new Error(`Missing sample workflow for ${ticketSeed.id}`);
		const decision = sampleDecisions.get(ticketKey(appId, issueNumber));
		return {
			app,
			ticket: sampleTicketSummary(ticketSeed, decision),
			workflow: sampleWorkflowView(ticketSeed, scenario, decision),
			decision,
		};
	};

	return {
		async reset(scenario = "happy") {
			currentScenario = scenario;
			currentWorkflowId = undefined;
			rebuild();
			const routeMode: AutomationMode =
				options.mode === "qm-live" ? "plan" : "full";
			const ingested = await requireController().ingest(
				ingressJob(scenario, routeMode),
			);
			if (!ingested.workflow)
				throw new Error("Local workflow ingress was ignored");
			currentWorkflowId = ingested.workflow.id;
			await requireController().runUntilGate(currentWorkflowId);
			if (scenario === "stale") {
				await requireController().ingest(ingressJob(scenario, routeMode, 2));
			}
			const view = await getView();
			if (!view) throw new Error("Local workflow view was not created");
			return view;
		},
		getView,
		performAction: performCurrentAction,
		async listApps() {
			return Promise.all(localAppSeeds.map(appSummary));
		},
		async listTickets(appId) {
			if (!localAppSeeds.some((app) => app.id === appId)) return null;
			return (await allTicketSummaries()).filter(
				(ticket) => ticket.appId === appId,
			);
		},
		getTicket,
		async performTicketAction(input) {
			const current = await getTicket(input.appId, input.issueNumber);
			if (!current) {
				throw new Error(
					`Ticket ${input.appId}#${input.issueNumber} was not found`,
				);
			}
			if (
				(input.action === "revise_plan" ||
					input.action === "request_changes") &&
				!input.note?.trim()
			) {
				throw new Error(`${input.action} requires actionable feedback`);
			}
			if (current.ticket.source === "live") {
				await performCurrentAction(input);
				const updated = await getTicket(input.appId, input.issueNumber);
				if (!updated) throw new Error("Local live ticket disappeared");
				return updated;
			}

			if (current.workflow.expectedVersion !== input.expectedVersion) {
				throw new Error(
					`Workflow changed: expected version ${input.expectedVersion}, current version ${current.workflow.expectedVersion}`,
				);
			}
			const availableAction = current.workflow.availableActions.find(
				(action) => action.id === input.action,
			);
			if (!availableAction) {
				throw new Error(
					`Action ${input.action} is not available for ${input.appId}#${input.issueNumber}`,
				);
			}
			const decision: LocalTicketDecision = {
				action: input.action,
				label: availableAction.label,
				...(input.note?.trim() ? { note: input.note.trim() } : {}),
				recordedAt: clock.now().toISOString(),
			};
			sampleDecisions.set(ticketKey(input.appId, input.issueNumber), decision);
			const updated = await getTicket(input.appId, input.issueNumber);
			if (!updated) throw new Error("Local sample ticket disappeared");
			return updated;
		},
		async status() {
			const workflowId = currentWorkflowId;
			const view = await getView();
			const workspace = workflowId
				? await requireController().getStaffWorkspace(workflowId)
				: undefined;
			return {
				mode: options.mode,
				qmUrl: options.qmUrl,
				workflowId,
				workflowState: view ? workspace?.workflow.state : undefined,
				agentStages: runtime?.requests.map((request) => request.stage) ?? [],
				deployments: deployment.deployments.length,
				publicResponses: responses.published.length,
			};
		},
	};
}
