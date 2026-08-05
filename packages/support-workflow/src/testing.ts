import type { AgentClient, AgentTurnRequest } from "./agent-client";
import { parseAgentStageOutput } from "./agent-runtime";
import {
	type AgentArtifact,
	type AgentStage,
	type AgentStageOutput,
	type RepositoryCheckResult,
	SUPPORT_WORKFLOW_VERSION,
	type SupportRoute,
	type WorkflowActivity,
	type WorkflowApproval,
	type WorkflowOutbox,
	type WorkflowRecord,
	type WorkflowReviewFeedback,
} from "./contracts";
import type {
	AgentRuntime,
	AgentStageRequest,
	Clock,
	DeploymentPort,
	IdGenerator,
	PublicResponsePublisher,
	RepositoryChangeSet,
	RepositoryPort,
	RepositoryStageWorkspace,
	RunRepositoryChecksInput,
	SupportRouteResolver,
	WorkflowIngressJob,
	WorkflowQueue,
	WorkflowStore,
} from "./ports";

function copy<T>(value: T): T {
	return structuredClone(value);
}

export function createManualClock(initial = "2026-08-05T09:00:00.000Z") {
	let current = new Date(initial);
	const clock: Clock = {
		now: () => new Date(current),
	};
	return {
		clock,
		advance(milliseconds: number) {
			current = new Date(current.getTime() + milliseconds);
		},
		set(value: string | Date) {
			current = new Date(value);
		},
	};
}

export function createSequentialIdGenerator(): IdGenerator {
	let sequence = 0;
	return {
		next(prefix) {
			sequence += 1;
			return `${prefix}-${sequence}`;
		},
	};
}

export function createInMemoryWorkflowStore(): WorkflowStore & {
	reset(): void;
} {
	const idempotency = new Set<string>();
	const workflows = new Map<string, WorkflowRecord>();
	const artifacts = new Map<string, AgentArtifact>();
	const activities = new Map<string, WorkflowActivity[]>();
	const approvals = new Map<string, WorkflowApproval[]>();
	const feedback = new Map<string, WorkflowReviewFeedback[]>();
	const outbox = new Map<string, WorkflowOutbox>();

	return {
		async hasIngressIdempotencyKey(key) {
			return idempotency.has(key);
		},
		async get(workflowId) {
			const workflow = workflows.get(workflowId);
			return workflow ? copy(workflow) : null;
		},
		async transact(transaction) {
			if (
				transaction.ingressIdempotencyKey &&
				idempotency.has(transaction.ingressIdempotencyKey)
			) {
				return "duplicate";
			}
			const current = workflows.get(transaction.workflowId);
			if (transaction.expectedVersion === null) {
				if (current) return "conflict";
				if (transaction.next.version !== 0) {
					throw new Error("A newly created workflow must start at version 0");
				}
			} else if (
				!current ||
				current.version !== transaction.expectedVersion ||
				transaction.next.version !== transaction.expectedVersion + 1
			) {
				return "conflict";
			}
			if (
				transaction.next.id !== transaction.workflowId ||
				transaction.next.workflowVersion !== SUPPORT_WORKFLOW_VERSION
			) {
				throw new Error("Invalid workflow transaction payload");
			}

			const nextArtifacts = new Map(artifacts);
			const nextActivities = new Map(activities);
			const nextApprovals = new Map(approvals);
			const nextFeedback = new Map(feedback);
			const nextOutbox = new Map(outbox);
			for (const artifact of transaction.artifacts ?? []) {
				if (artifact.workflowId !== transaction.workflowId) {
					throw new Error("Artifact belongs to another workflow");
				}
				nextArtifacts.set(artifact.artifactId, copy(artifact));
			}
			for (const activity of transaction.activities ?? []) {
				if (activity.workflowId !== transaction.workflowId) {
					throw new Error("Activity belongs to another workflow");
				}
				const list = [...(nextActivities.get(transaction.workflowId) ?? [])];
				if (!list.some((item) => item.id === activity.id)) {
					list.push(copy(activity));
				}
				nextActivities.set(transaction.workflowId, list);
			}
			for (const approval of transaction.approvals ?? []) {
				const list = [...(nextApprovals.get(transaction.workflowId) ?? [])];
				if (!list.some((item) => item.id === approval.id)) {
					list.push(copy(approval));
				}
				nextApprovals.set(transaction.workflowId, list);
			}
			for (const item of transaction.feedback ?? []) {
				if (item.workflowId !== transaction.workflowId) {
					throw new Error("Feedback belongs to another workflow");
				}
				const list = [...(nextFeedback.get(transaction.workflowId) ?? [])];
				if (!list.some((candidate) => candidate.id === item.id)) {
					list.push(copy(item));
				}
				nextFeedback.set(transaction.workflowId, list);
			}
			if (transaction.cancelOpenOutbox) {
				for (const [id, item] of nextOutbox) {
					if (
						item.workflowId === transaction.workflowId &&
						(item.status === "pending" || item.status === "running")
					) {
						nextOutbox.set(id, {
							...item,
							status: "cancelled",
							updatedAt: transaction.next.updatedAt,
						});
					}
				}
			}
			for (const item of transaction.outbox ?? []) {
				if (item.workflowId !== transaction.workflowId) {
					throw new Error("Outbox item belongs to another workflow");
				}
				nextOutbox.set(item.id, copy(item));
			}

			workflows.set(transaction.workflowId, copy(transaction.next));
			artifacts.clear();
			for (const [id, artifact] of nextArtifacts) artifacts.set(id, artifact);
			activities.clear();
			for (const [id, list] of nextActivities) activities.set(id, list);
			approvals.clear();
			for (const [id, list] of nextApprovals) approvals.set(id, list);
			feedback.clear();
			for (const [id, list] of nextFeedback) feedback.set(id, list);
			outbox.clear();
			for (const [id, item] of nextOutbox) outbox.set(id, item);
			if (transaction.ingressIdempotencyKey) {
				idempotency.add(transaction.ingressIdempotencyKey);
			}
			return "committed";
		},
		async getArtifact(artifactId) {
			const artifact = artifacts.get(artifactId);
			return artifact ? copy(artifact) : null;
		},
		async listArtifacts(workflowId) {
			return [...artifacts.values()]
				.filter((artifact) => artifact.workflowId === workflowId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map(copy);
		},
		async listActivities(workflowId) {
			return (activities.get(workflowId) ?? []).map(copy);
		},
		async listApprovals(workflowId) {
			return (approvals.get(workflowId) ?? []).map(copy);
		},
		async listFeedback(workflowId) {
			return (feedback.get(workflowId) ?? []).map(copy);
		},
		async getOutbox(outboxId) {
			const item = outbox.get(outboxId);
			return item ? copy(item) : null;
		},
		async listOutbox(workflowId) {
			return [...outbox.values()]
				.filter((item) => item.workflowId === workflowId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map(copy);
		},
		reset() {
			idempotency.clear();
			workflows.clear();
			artifacts.clear();
			activities.clear();
			approvals.clear();
			feedback.clear();
			outbox.clear();
		},
	};
}

export function createInMemoryWorkflowQueue(): WorkflowQueue & {
	take(): WorkflowIngressJob | null;
	list(): WorkflowIngressJob[];
	drain(handler: (job: WorkflowIngressJob) => Promise<unknown>): Promise<void>;
} {
	const keys = new Set<string>();
	const jobs: WorkflowIngressJob[] = [];
	return {
		async enqueue(job) {
			if (keys.has(job.idempotencyKey)) return { status: "duplicate" };
			keys.add(job.idempotencyKey);
			jobs.push(copy(job));
			return { status: "enqueued" };
		},
		take() {
			const job = jobs.shift();
			return job ? copy(job) : null;
		},
		list() {
			return jobs.map(copy);
		},
		async drain(handler) {
			for (;;) {
				const job = jobs.shift();
				if (!job) return;
				await handler(copy(job));
			}
		},
	};
}

export function createStaticSupportRouteResolver(
	routes: Record<string, SupportRoute>,
): SupportRouteResolver {
	return {
		async resolve(issue) {
			const route = routes[issue.supportRepository];
			return route ? copy(route) : null;
		},
	};
}

type ScriptedResult =
	| AgentStageOutput
	| Error
	| ((
			request: AgentStageRequest,
	  ) => AgentStageOutput | Promise<AgentStageOutput>);

export type AgentStageScript = Partial<Record<AgentStage, ScriptedResult[]>>;

function defaultOutput(request: AgentStageRequest): AgentStageOutput {
	const shared = {
		decision: "pass" as const,
		risk: request.stage === "triage" ? ("r1" as const) : request.workflow.risk,
		confidence: 0.95,
		title: `${request.stage} completed`,
		summary: `Scripted ${request.stage} stage completed.`,
		evidence: [],
		changedPaths: [],
		tests: [],
		restrictedChanges: [],
		links: [],
		baseSha: request.workflow.baseSha,
		headSha: request.workflow.headSha,
	};
	if (request.stage === "triage") {
		return { ...shared, triageRoute: "code" };
	}
	if (request.stage === "implement") {
		return { ...shared, headSha: "candidate-sha" };
	}
	if (request.stage === "verify_production") {
		return { ...shared, deployedSha: request.workflow.deployedSha };
	}
	if (request.stage === "respond") {
		return {
			...shared,
			publicResponse: "We verified the change and the issue is now resolved.",
		};
	}
	return shared;
}

export function createScriptedAgentRuntime(input?: {
	script?: AgentStageScript;
	clock?: Clock;
	ids?: IdGenerator;
}): AgentRuntime & { requests: AgentStageRequest[] } {
	const requests: AgentStageRequest[] = [];
	const script = Object.fromEntries(
		Object.entries(input?.script ?? {}).map(([stage, entries]) => [
			stage,
			[...(entries ?? [])],
		]),
	) as AgentStageScript;
	const clock = input?.clock ?? createManualClock().clock;
	const ids = input?.ids ?? createSequentialIdGenerator();

	return {
		requests,
		async execute(request) {
			requests.push(copy(request));
			const next = script[request.stage]?.shift();
			if (next instanceof Error) throw next;
			const output =
				typeof next === "function"
					? await next(request)
					: (next ?? defaultOutput(request));
			return {
				...output,
				workflowVersion: SUPPORT_WORKFLOW_VERSION,
				artifactId: ids.next("artifact"),
				workflowId: request.workflow.id,
				issueSnapshotHash: request.workflow.issueSnapshotHash,
				runId: ids.next("agent-run"),
				stage: request.stage,
				createdAt: clock.now().toISOString(),
				visibility:
					request.stage === "respond" ? "public_candidate" : "internal",
			};
		},
	};
}

/**
 * Runs deterministic stage artifacts through the agent runtime's signed HTTP
 * and screening boundary. This is deliberately a local-development adapter: the mock
 * harness performs no repository or model work, while the real controller,
 * source auth, async run worker, idempotency, and fail-closed screening remain
 * exercised.
 */
export function createAgentMockRuntime(input: {
	client: AgentClient;
	clock?: Clock;
	ids?: IdGenerator;
	outputForRequest?: (
		request: AgentStageRequest,
	) => AgentStageOutput | Promise<AgentStageOutput>;
}): AgentRuntime & { requests: AgentStageRequest[] } {
	const requests: AgentStageRequest[] = [];
	const clock = input.clock ?? { now: () => new Date() };
	const ids = input.ids ?? createSequentialIdGenerator();

	return {
		requests,
		async execute(request) {
			requests.push(copy(request));
			const expectedOutput = input.outputForRequest
				? await input.outputForRequest(request)
				: defaultOutput(request);
			const actor = {
				externalId: `support-dev:${request.stage}`,
				displayName: `Support dev ${request.stage}`,
				isBot: true,
			};
			const threadRef = `support-dev:${request.workflow.id}:${request.stage}:${request.attempt}`;
			const turn: AgentTurnRequest = {
				surface: "support-dev",
				actor,
				conversation: {
					kind: "channel",
					threadRef,
					channelRef: threadRef,
					channelName: `${request.workflow.route.targetRepository}#${request.workflow.issue.issueNumber} ${request.stage}`,
					audience: [actor],
					isPrivate: true,
				},
				text: `!json ${JSON.stringify(expectedOutput)}`,
				origin: {
					kind: "automation",
					screenData: JSON.stringify({
						title: request.workflow.issue.title,
						body: request.workflow.issue.body,
						latestComment: request.workflow.issue.latestComment,
					}),
				},
				triggered: true,
				readOnly: request.readOnly,
				requireSecurityScreen: true,
				idempotencyKey: request.idempotencyKey,
				async: true,
				...(request.workspace
					? {
							workspace: {
								path: request.workspace.workspaceRef,
								access: request.workspace.access,
							},
						}
					: {}),
				harness: "mock",
			};
			const completion = await input.client.runTurn(turn);
			const output = parseAgentStageOutput(completion.reply, request.stage);
			const links = [...output.links];
			if (completion.adminUrl) {
				links.push({
					label: "Open agent run",
					url: completion.adminUrl,
					kind: "agent_run",
				});
			}
			return {
				...output,
				workflowVersion: SUPPORT_WORKFLOW_VERSION,
				artifactId: ids.next("artifact"),
				workflowId: request.workflow.id,
				issueSnapshotHash: request.workflow.issueSnapshotHash,
				runId: completion.runId,
				stage: request.stage,
				createdAt: clock.now().toISOString(),
				visibility:
					request.stage === "respond" ? "public_candidate" : "internal",
				links,
			};
		},
	};
}

export function createFakeRepositoryPort(input?: {
	baseSha?: string;
	changeSet?: RepositoryChangeSet;
	inspectChangeSets?: RepositoryChangeSet[];
	checkResults?: Partial<
		Record<Extract<AgentStage, "implement" | "qc">, RepositoryCheckResult[]>
	>;
}): RepositoryPort & {
	setChangeSet(changeSet: RepositoryChangeSet): void;
	setInspectChangeSets(changeSets: RepositoryChangeSet[]): void;
	setCheckResults(
		stage: Extract<AgentStage, "implement" | "qc">,
		results: RepositoryCheckResult[],
	): void;
	setMergeVerification(valid: boolean): void;
	workspaces: RepositoryStageWorkspace[];
	checkRuns: RunRepositoryChecksInput[];
	operations: string[];
} {
	const baseSha = input?.baseSha ?? "base-sha";
	let mergeIsValid = true;
	let changeSet = input?.changeSet ?? {
		baseSha,
		headSha: "candidate-sha",
		changedPaths: ["src/support-fix.ts", "src/support-fix.test.ts"],
	};
	const inspectChangeSets = (input?.inspectChangeSets ?? []).map(copy);
	const checkResults = new Map<
		Extract<AgentStage, "implement" | "qc">,
		RepositoryCheckResult[]
	>(
		Object.entries(input?.checkResults ?? {}) as Array<
			[Extract<AgentStage, "implement" | "qc">, RepositoryCheckResult[]]
		>,
	);
	const workspaces: RepositoryStageWorkspace[] = [];
	const checkRuns: RunRepositoryChecksInput[] = [];
	const operations: string[] = [];
	return {
		workspaces,
		checkRuns,
		operations,
		async getBaseSha() {
			return baseSha;
		},
		async prepareStageWorkspace(stageInput) {
			const workspace = {
				id: `workspace-${stageInput.operationId}`,
				targetRepository: stageInput.workflow.route.targetRepository,
				revision: stageInput.targetRevision,
				access: stageInput.access,
				workspaceRef: `/workspace/${stageInput.operationId}`,
			} satisfies RepositoryStageWorkspace;
			workspaces.push(copy(workspace));
			return workspace;
		},
		async releaseStageWorkspace() {},
		async runChecks(checkInput) {
			operations.push(`checks:${checkInput.stage}`);
			checkRuns.push(copy(checkInput));
			const configured = checkResults.get(checkInput.stage);
			if (configured) return copy(configured);
			return checkInput.profile.checks.map((check) => ({
				checkId: check.id,
				status: "passed" as const,
				summary: `${check.label} passed in the fake repository runner.`,
			}));
		},
		async inspectChanges(_workflow, artifact) {
			operations.push(`inspect:${artifact.stage}`);
			return copy(inspectChangeSets.shift() ?? changeSet);
		},
		async verifyMergedSha() {
			return mergeIsValid;
		},
		setChangeSet(next) {
			changeSet = copy(next);
		},
		setInspectChangeSets(next) {
			inspectChangeSets.splice(0, inspectChangeSets.length, ...next.map(copy));
		},
		setCheckResults(stage, results) {
			checkResults.set(stage, copy(results));
		},
		setMergeVerification(valid) {
			mergeIsValid = valid;
		},
	};
}

export function createRecordingResponsePublisher(): PublicResponsePublisher & {
	published: Array<{
		workflowId: string;
		body: string;
		idempotencyKey: string;
	}>;
} {
	const published: Array<{
		workflowId: string;
		body: string;
		idempotencyKey: string;
	}> = [];
	return {
		published,
		async publish(input) {
			if (
				!published.some((item) => item.idempotencyKey === input.idempotencyKey)
			) {
				published.push({
					workflowId: input.workflow.id,
					body: input.body,
					idempotencyKey: input.idempotencyKey,
				});
			}
			return {
				url: `https://github.com/${input.workflow.issue.supportRepository}/issues/${input.workflow.issue.issueNumber}`,
			};
		},
	};
}

export function createRecordingDeploymentPort(): DeploymentPort & {
	deployments: Array<{
		workflowId: string;
		adapter: string;
		environment: string;
		sha: string;
		idempotencyKey: string;
	}>;
} {
	const deployments: Array<{
		workflowId: string;
		adapter: string;
		environment: string;
		sha: string;
		idempotencyKey: string;
	}> = [];
	return {
		deployments,
		async deploy(input) {
			if (
				!deployments.some(
					(deployment) => deployment.idempotencyKey === input.idempotencyKey,
				)
			) {
				deployments.push({
					workflowId: input.workflow.id,
					adapter: input.adapter,
					environment: input.environment,
					sha: input.sha,
					idempotencyKey: input.idempotencyKey,
				});
			}
			return {
				deployedSha: input.sha,
				url: `https://deployments.example/${input.environment}/${input.sha}`,
			};
		},
	};
}
