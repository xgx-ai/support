import { z } from "zod";
import {
	type AgentArtifact,
	type AgentStage,
	agentArtifactEnvelopeSchema,
	agentArtifactSchema,
	assertStageDecision,
	httpUrlSchema,
	type RiskLevel,
	type StaffWorkflowWorkspace,
	SUPPORT_WORKFLOW_VERSION,
	supportIssueSnapshotSchema,
	supportRouteSchema,
	type WorkflowAction,
	type WorkflowActivity,
	type WorkflowApproval,
	type WorkflowOutbox,
	type WorkflowRecord,
	type WorkflowReviewFeedback,
	type WorkflowState,
	workflowRecordSchema,
} from "./contracts";
import {
	deploymentKey,
	hashValue,
	publicResponseKey,
	stageIdempotencyKey,
} from "./idempotency";
import { evaluateRepositoryChanges } from "./policy";
import type {
	AgentRuntime,
	AgentStageCapability,
	Clock,
	DeploymentPort,
	IdGenerator,
	PrepareRepositoryStageInput,
	PublicResponsePublisher,
	RepositoryPort,
	RepositoryStageWorkspace,
	WorkflowIngressJob,
	WorkflowStore,
	WorkflowStoreTransaction,
} from "./ports";
import { QmClientError } from "./qm-client";
import {
	assertTransition,
	availableWorkflowActions,
	runningStateForStage,
	stageForState,
} from "./state-machine";
import { getStaffWorkflowWorkspace } from "./store";

export interface CreateSupportWorkflowControllerOptions {
	store: WorkflowStore;
	runtime: AgentRuntime;
	repository: RepositoryPort;
	deployment: DeploymentPort;
	responses: PublicResponsePublisher;
	clock: Clock;
	ids: IdGenerator;
	maxStageAttempts?: number;
	maxQcLoops?: number;
	leaseDurationMs?: number;
	maxScreenedInputChars?: number;
}

export interface PerformWorkflowActionInput {
	workflowId: string;
	expectedVersion: number;
	action: WorkflowAction;
	actorId: string;
	note?: string;
	mergedSha?: string;
}

export interface IngestWorkflowResult {
	status: "created" | "updated" | "duplicate" | "ignored";
	workflow: WorkflowRecord | null;
}

type TransactionExtras = Omit<
	WorkflowStoreTransaction,
	"workflowId" | "expectedVersion" | "next"
>;

const riskRank: Record<RiskLevel, number> = {
	r0: 0,
	r1: 1,
	r2: 2,
	r3: 3,
};

function maxRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
	return riskRank[left] >= riskRank[right] ? left : right;
}

function workflowIdFor(job: WorkflowIngressJob): string {
	return (
		"support:" +
		job.issue.supportRepository +
		"#" +
		String(job.issue.issueNumber)
	);
}

function isContractError(error: unknown): boolean {
	return (
		error instanceof z.ZodError ||
		error instanceof SyntaxError ||
		(error instanceof QmClientError && error.kind === "contract")
	);
}

function isCriticalIssue(workflow: Pick<WorkflowRecord, "issue">): boolean {
	return workflow.issue.labels.some((label) => {
		const normalised = label.trim().toLowerCase();
		return normalised === "p0" || normalised === "security";
	});
}

function isExternalLease(workflow: WorkflowRecord): boolean {
	return (
		workflow.activeLease !== undefined &&
		workflow.activeLease.kind !== "agent_stage"
	);
}

function repositoryStageSpec(
	workflow: WorkflowRecord,
	stage: AgentStage,
):
	| Pick<PrepareRepositoryStageInput, "stage" | "targetRevision" | "access">
	| undefined {
	if (stage === "investigate") {
		if (!workflow.baseSha) {
			throw new Error("Investigation requires an immutable base SHA");
		}
		return {
			stage,
			targetRevision: workflow.baseSha,
			access: "read_only",
		};
	}
	if (stage === "implement") {
		if (!workflow.baseSha) {
			throw new Error("Implementation requires the plan-approved base SHA");
		}
		return {
			stage,
			targetRevision: workflow.baseSha,
			access: "candidate_write",
		};
	}
	if (stage === "qc") {
		if (!workflow.headSha) {
			throw new Error("QC requires an immutable candidate SHA");
		}
		return {
			stage,
			targetRevision: workflow.headSha,
			access: "read_only",
		};
	}
	return undefined;
}

function capabilitiesForStage(stage: AgentStage): AgentStageCapability[] {
	const capabilities: AgentStageCapability[] = ["issue_read"];
	if (stage === "investigate" || stage === "qc") {
		capabilities.push("repository_read");
	}
	if (stage === "implement") capabilities.push("candidate_write");
	if (stage === "verify_staging") capabilities.push("staging_read");
	if (stage === "verify_production") capabilities.push("production_read");
	return capabilities;
}

export function createSupportWorkflowController(
	options: CreateSupportWorkflowControllerOptions,
) {
	const maxStageAttempts = options.maxStageAttempts ?? 3;
	const maxQcLoops = options.maxQcLoops ?? 2;
	const leaseDurationMs = options.leaseDurationMs ?? 5 * 60_000;
	const maxScreenedInputChars = options.maxScreenedInputChars ?? 12_000;

	const nowIso = (): string => options.clock.now().toISOString();

	const leaseExpiresAt = (): string =>
		new Date(options.clock.now().getTime() + leaseDurationMs).toISOString();

	const leaseIsLive = (workflow: WorkflowRecord): boolean =>
		workflow.activeLease !== undefined &&
		Date.parse(workflow.activeLease.expiresAt) > options.clock.now().getTime();

	const newActivity = (
		workflowId: string,
		activity: Omit<WorkflowActivity, "id" | "workflowId" | "createdAt">,
	): WorkflowActivity => ({
		...activity,
		id: options.ids.next("activity"),
		workflowId,
		createdAt: nowIso(),
	});

	const updatedRecord = (
		current: WorkflowRecord,
		changes: Partial<WorkflowRecord>,
	): WorkflowRecord =>
		workflowRecordSchema.parse({
			...current,
			...changes,
			version: current.version + 1,
			updatedAt: nowIso(),
		});

	const persist = async (
		current: WorkflowRecord,
		next: WorkflowRecord,
		extras: TransactionExtras = {},
	): Promise<WorkflowRecord> => {
		const result = await options.store.transact({
			workflowId: current.id,
			expectedVersion: current.version,
			next,
			...extras,
		});
		if (result !== "committed") {
			throw new Error(
				"Workflow " +
					current.id +
					" changed while processing version " +
					String(current.version),
			);
		}
		return next;
	};

	const transition = async (
		current: WorkflowRecord,
		state: WorkflowState,
		changes: Partial<WorkflowRecord> = {},
		extras: TransactionExtras = {},
	): Promise<WorkflowRecord> => {
		if (current.state !== state) assertTransition(current.state, state);
		const next = updatedRecord(current, {
			...changes,
			state,
			activeStage: undefined,
			activeLease: undefined,
		});
		return persist(current, next, extras);
	};

	const latestArtifact = async (
		workflow: WorkflowRecord,
	): Promise<AgentArtifact> => {
		if (!workflow.lastArtifactId) {
			throw new Error("Workflow " + workflow.id + " has no current artifact");
		}
		const artifact = await options.store.getArtifact(workflow.lastArtifactId);
		if (!artifact) {
			throw new Error("Artifact " + workflow.lastArtifactId + " was not found");
		}
		return artifact;
	};

	const createApproval = async (
		workflow: WorkflowRecord,
		artifact: AgentArtifact,
		kind: WorkflowApproval["kind"],
		actorId: string,
		note: string | undefined,
		bindings: Pick<
			WorkflowApproval,
			"baseSha" | "candidateSha" | "mergedSha" | "deployedSha"
		> = {},
	): Promise<WorkflowApproval> => ({
		id: options.ids.next("approval"),
		kind,
		actorId,
		createdAt: nowIso(),
		issueSnapshotHash: workflow.issueSnapshotHash,
		artifactId: artifact.artifactId,
		artifactHash: await hashValue(artifact),
		...bindings,
		note,
	});

	const requireBoundApproval = async (
		workflow: WorkflowRecord,
		kind: WorkflowApproval["kind"],
		expected: Partial<
			Pick<
				WorkflowApproval,
				"baseSha" | "candidateSha" | "mergedSha" | "deployedSha"
			>
		> = {},
	): Promise<WorkflowApproval> => {
		const approvals = await options.store.listApprovals(workflow.id);
		const approval = approvals.findLast((item) => item.kind === kind);
		if (!approval) {
			throw new Error("Workflow is missing its durable " + kind + " approval");
		}
		if (approval.issueSnapshotHash !== workflow.issueSnapshotHash) {
			throw new Error(
				kind + " approval is stale for the current issue snapshot",
			);
		}
		const artifact = await options.store.getArtifact(approval.artifactId);
		if (!artifact || (await hashValue(artifact)) !== approval.artifactHash) {
			throw new Error(kind + " approval artifact binding is invalid");
		}
		for (const field of [
			"baseSha",
			"candidateSha",
			"mergedSha",
			"deployedSha",
		] as const) {
			if (
				expected[field] !== undefined &&
				approval[field] !== expected[field]
			) {
				throw new Error(
					kind + " approval is not bound to the expected " + field,
				);
			}
		}
		return approval;
	};

	const stageGateCheck = async (
		workflow: WorkflowRecord,
		stage: AgentStage,
	): Promise<void> => {
		if (stage === "implement" || stage === "qc") {
			await requireBoundApproval(workflow, "plan", {
				baseSha: workflow.baseSha,
			});
		}
		if (stage === "verify_staging") {
			if (!workflow.route.stagingEnvironment) {
				throw new Error("Staging verification has no configured environment");
			}
			await requireBoundApproval(workflow, "merge", {
				mergedSha: workflow.headSha,
			});
		}
		if (stage === "deploy") {
			await requireBoundApproval(workflow, "deploy", {
				mergedSha: workflow.headSha,
			});
		}
		if (stage === "verify_production") {
			await requireBoundApproval(workflow, "deploy", {
				mergedSha: workflow.headSha,
			});
		}
	};

	const inputIsTooLargeToScreen = (job: WorkflowIngressJob): boolean =>
		job.issue.title.length +
			job.issue.body.length +
			(job.issue.latestComment?.length ?? 0) >
		maxScreenedInputChars;

	const assertExternalEffectIsReconciled = async (
		workflow: WorkflowRecord,
	): Promise<void> => {
		if (isExternalLease(workflow)) {
			throw new Error(
				"An external workflow effect is being reconciled; retry ingress later",
			);
		}
		const outbox = await options.store.listOutbox(workflow.id);
		if (outbox.some((item) => item.status === "running" && item.attempts > 0)) {
			throw new Error(
				"An attempted external effect must be reconciled before issue updates",
			);
		}
	};

	const ingest = async (
		job: WorkflowIngressJob,
	): Promise<IngestWorkflowResult> => {
		const parsedJob = {
			...job,
			issue: supportIssueSnapshotSchema.parse(job.issue),
			route: supportRouteSchema.parse(job.route),
		};
		const id = workflowIdFor(parsedJob);
		if (
			await options.store.hasIngressIdempotencyKey(parsedJob.idempotencyKey)
		) {
			return { status: "duplicate", workflow: await options.store.get(id) };
		}

		const issueSnapshotHash = await hashValue(parsedJob.issue);
		const existing = await options.store.get(id);
		if (existing) {
			if (existing.issueSnapshotHash === issueSnapshotHash) {
				const duplicateRecord = updatedRecord(existing, {});
				const result = await options.store.transact({
					workflowId: existing.id,
					expectedVersion: existing.version,
					next: duplicateRecord,
					ingressIdempotencyKey: parsedJob.idempotencyKey,
				});
				return {
					status: "duplicate",
					workflow:
						result === "committed"
							? duplicateRecord
							: await options.store.get(existing.id),
				};
			}

			await assertExternalEffectIsReconciled(existing);
			const eventClosesIssue =
				parsedJob.eventType === "issue.closed" ||
				parsedJob.eventType === "issue.deleted";
			const eventReopensIssue = parsedJob.eventType === "issue.reopened";
			const oversized = inputIsTooLargeToScreen(parsedJob);
			let state: WorkflowState;
			let status: IngestWorkflowResult["status"] = "updated";
			let retryState: WorkflowState | undefined;
			if (eventClosesIssue) {
				state = "cancelled";
			} else if (isCriticalIssue({ issue: parsedJob.issue })) {
				state = "security_escalation";
			} else if (oversized) {
				state = "needs_human";
				retryState = "received";
			} else if (
				eventReopensIssue ||
				existing.state === "needs_info" ||
				(existing.state === "cancelled" &&
					parsedJob.eventType === "issue.reopened")
			) {
				state = "received";
			} else if (
				[
					"cancelled",
					"security_escalation",
					"restricted_proposal_only",
					"closed",
				].includes(existing.state)
			) {
				state = existing.state;
				status = "ignored";
			} else {
				state = "stale";
				retryState = "received";
			}

			const refreshedBaseSha = eventClosesIssue
				? existing.baseSha
				: await options.repository.getBaseSha(parsedJob.route);
			const next = updatedRecord(existing, {
				state,
				issue: parsedJob.issue,
				issueSnapshotHash,
				route: parsedJob.route,
				baseSha: refreshedBaseSha,
				headSha:
					state === "received" || state === "stale"
						? undefined
						: existing.headSha,
				deployedSha:
					state === "received" || state === "stale"
						? undefined
						: existing.deployedSha,
				activeStage: undefined,
				activeLease: undefined,
				lastError: oversized
					? "Customer input exceeds the fail-closed security-screen limit"
					: undefined,
				retryState,
			});
			const activity = newActivity(existing.id, {
				visibility: "internal",
				stage: "intake",
				status:
					state === "security_escalation" || state === "needs_human"
						? "needs_human"
						: state === "cancelled" || state === "stale"
							? "blocked"
							: "pending",
				title: oversized
					? "Input held for manual security review"
					: eventClosesIssue
						? "Support issue closed"
						: "Support issue updated",
				summary: oversized
					? "The untrusted issue payload was not sent to QM because complete security screening could not be guaranteed."
					: state === "stale"
						? "Existing approvals, pending effects, and in-flight work were invalidated."
						: "The authoritative issue snapshot was refreshed.",
				actor: "Support ingress",
				links: [],
			});
			const result = await options.store.transact({
				workflowId: existing.id,
				expectedVersion: existing.version,
				next,
				ingressIdempotencyKey: parsedJob.idempotencyKey,
				activities: [activity],
				cancelOpenOutbox: true,
			});
			if (result !== "committed") {
				throw new Error(
					"Concurrent workflow update while ingesting " + existing.id,
				);
			}
			return { status, workflow: next };
		}

		const createdAt = nowIso();
		const baseSha = await options.repository.getBaseSha(parsedJob.route);
		const oversized = inputIsTooLargeToScreen(parsedJob);
		const eventClosesIssue =
			parsedJob.eventType === "issue.closed" ||
			parsedJob.eventType === "issue.deleted";
		const initialState: WorkflowState = eventClosesIssue
			? "cancelled"
			: isCriticalIssue({ issue: parsedJob.issue })
				? "security_escalation"
				: oversized
					? "needs_human"
					: "received";
		const workflow = workflowRecordSchema.parse({
			workflowVersion: SUPPORT_WORKFLOW_VERSION,
			id,
			version: 0,
			state: initialState,
			issue: parsedJob.issue,
			issueSnapshotHash,
			route: parsedJob.route,
			risk: "r1",
			baseSha,
			qcLoops: 0,
			stageAttempts: {},
			lastError: oversized
				? "Customer input exceeds the fail-closed security-screen limit"
				: undefined,
			retryState: oversized ? "received" : undefined,
			createdAt,
			updatedAt: createdAt,
		});
		const activity = newActivity(id, {
			visibility: "internal",
			stage: "intake",
			status:
				initialState === "received"
					? "pending"
					: initialState === "cancelled"
						? "blocked"
						: "needs_human",
			title: oversized
				? "Input held for manual security review"
				: "Support issue received",
			summary: oversized
				? "The untrusted issue payload was not sent to QM because complete security screening could not be guaranteed."
				: "Routed to " + parsedJob.route.targetRepository + ".",
			actor: "Support ingress",
			links: [],
		});
		const result = await options.store.transact({
			workflowId: id,
			expectedVersion: null,
			next: workflow,
			ingressIdempotencyKey: parsedJob.idempotencyKey,
			activities: [activity],
		});
		if (result === "duplicate") {
			return { status: "duplicate", workflow: await options.store.get(id) };
		}
		if (result === "conflict") return ingest(parsedJob);
		return { status: "created", workflow };
	};

	const nextStateFromArtifact = (
		workflow: WorkflowRecord,
		artifact: AgentArtifact,
	): WorkflowState => {
		if (artifact.decision === "escalate") return "security_escalation";
		if (artifact.decision === "failed") return "failed_retryable";
		if (artifact.decision === "needs_info") {
			return ["validate", "triage", "investigate"].includes(artifact.stage)
				? "needs_info"
				: "needs_human";
		}
		if (artifact.decision === "proposal_only") {
			return [
				"investigate",
				"implement",
				"verify_staging",
				"verify_production",
			].includes(artifact.stage)
				? "restricted_proposal_only"
				: "needs_human";
		}
		if (artifact.decision === "changes_requested") {
			return artifact.stage === "qc" ? "changes_requested" : "needs_human";
		}

		switch (artifact.stage) {
			case "validate":
				return "triaging";
			case "triage":
				return workflow.route.automationMode === "shadow"
					? "shadow_complete"
					: artifact.triageRoute === "response"
						? "response_drafting"
						: "investigating";
			case "investigate":
				return "plan_ready";
			case "implement":
				return "draft_pr_open";
			case "qc":
				return "awaiting_human_review";
			case "verify_staging":
				return "awaiting_deploy_approval";
			case "deploy":
				return "deployment_pending";
			case "verify_production":
				return "response_drafting";
			case "respond":
				return "awaiting_response_approval";
		}
	};

	const finishWithError = async (
		claimed: WorkflowRecord,
		stage: AgentStage,
		error: unknown,
	): Promise<WorkflowRecord> => {
		const message =
			error instanceof Error ? error.message : "Agent stage failed";
		const attempts = claimed.stageAttempts[stage] ?? 1;
		const nextState: WorkflowState =
			attempts >= maxStageAttempts ? "needs_human" : "failed_retryable";
		const activity = newActivity(claimed.id, {
			visibility: "internal",
			stage,
			status: nextState === "needs_human" ? "needs_human" : "failed",
			title: stage + " failed",
			summary: message,
			actor: "QM " + stage,
			links: [],
		});
		return transition(
			claimed,
			nextState,
			{
				lastError: message,
				retryState: runningStateForStage(stage, claimed.state),
			},
			{ activities: [activity] },
		);
	};

	const applyArtifact = async (
		claimed: WorkflowRecord,
		rawArtifact: AgentArtifact,
		workspace?: RepositoryStageWorkspace,
	): Promise<WorkflowRecord> => {
		let artifact = agentArtifactEnvelopeSchema.parse(rawArtifact);
		if (
			artifact.workflowId !== claimed.id ||
			artifact.issueSnapshotHash !== claimed.issueSnapshotHash ||
			artifact.stage !== claimed.activeStage
		) {
			throw new z.ZodError([
				{
					code: "custom",
					path: ["stage"],
					message:
						"Agent runtime returned an artifact for the wrong workflow stage",
				},
			]);
		}
		assertStageDecision(artifact.stage, artifact.decision);

		let changes: Partial<WorkflowRecord> = {
			lastArtifactId: artifact.artifactId,
			risk: maxRisk(claimed.risk, artifact.risk),
			lastError: undefined,
			retryState: undefined,
		};

		if (artifact.stage === "implement") {
			if (!workspace || workspace.access !== "candidate_write") {
				throw new Error("Implementation has no trusted candidate workspace");
			}
			const changeSet = await options.repository.inspectChanges(
				claimed,
				artifact,
				workspace,
			);
			const policyFindings = evaluateRepositoryChanges(
				changeSet,
				claimed.route,
			);
			if (!claimed.baseSha || changeSet.baseSha !== claimed.baseSha) {
				artifact = {
					...artifact,
					decision: "failed",
					baseSha: claimed.baseSha,
					headSha: undefined,
					changedPaths: changeSet.changedPaths,
					summary:
						"The candidate was built from a different base SHA than the human-approved plan.",
				};
			} else {
				artifact = {
					...artifact,
					baseSha: claimed.baseSha,
					headSha: changeSet.headSha,
					changedPaths: changeSet.changedPaths,
					restrictedChanges: [...artifact.restrictedChanges, ...policyFindings],
				};
				if (artifact.restrictedChanges.length > 0) {
					artifact = {
						...artifact,
						decision: "proposal_only",
						risk: "r3",
					};
				}
				changes = {
					...changes,
					headSha: changeSet.headSha,
					risk: maxRisk(changes.risk ?? claimed.risk, artifact.risk),
				};
			}
		}

		if (
			artifact.stage === "qc" &&
			(!artifact.headSha || artifact.headSha !== claimed.headSha)
		) {
			artifact = {
				...artifact,
				decision: "failed",
				summary: "QC inspected a different commit SHA; approval is stale.",
			};
		}

		if (artifact.stage === "verify_staging") {
			if (
				!claimed.route.stagingEnvironment ||
				!artifact.headSha ||
				artifact.headSha !== claimed.headSha
			) {
				artifact = {
					...artifact,
					decision: "failed",
					summary:
						"Staging verification requires the configured environment and exact merged commit SHA.",
				};
			}
		}

		if (artifact.stage === "deploy") {
			if (
				artifact.decision !== "pass" ||
				!claimed.headSha ||
				artifact.headSha !== claimed.headSha ||
				!claimed.route.deployAdapter ||
				!claimed.route.productionEnvironment
			) {
				artifact = {
					...artifact,
					decision: "failed",
					summary:
						"Deployment intent requires a passing check, immutable approved SHA, and configured trusted adapter.",
				};
			}
		}

		if (
			artifact.stage === "verify_production" &&
			(!artifact.deployedSha || artifact.deployedSha !== claimed.deployedSha)
		) {
			artifact = {
				...artifact,
				decision: "failed",
				summary: "Production verification observed an unexpected SHA.",
			};
		}

		if (
			artifact.stage === "respond" &&
			(artifact.decision !== "pass" || !artifact.publicResponse)
		) {
			artifact = {
				...artifact,
				decision: "failed",
				summary: "Response stage did not produce a public response candidate.",
			};
		}

		artifact = agentArtifactSchema.parse(artifact);
		let nextState = nextStateFromArtifact(claimed, artifact);
		if (
			isCriticalIssue(claimed) &&
			(artifact.stage === "validate" || artifact.stage === "triage")
		) {
			nextState = "security_escalation";
		}

		if (artifact.stage === "qc" && nextState === "changes_requested") {
			const qcLoops = claimed.qcLoops + 1;
			changes.qcLoops = qcLoops;
			if (qcLoops >= maxQcLoops) nextState = "needs_human";
		}

		if (nextState === "failed_retryable") {
			const attempts = claimed.stageAttempts[artifact.stage] ?? 1;
			if (attempts >= maxStageAttempts) nextState = "needs_human";
			changes.lastError = artifact.summary;
			changes.retryState = runningStateForStage(artifact.stage, claimed.state);
		}

		let outbox: WorkflowOutbox[] | undefined;
		if (artifact.stage === "deploy" && nextState === "deployment_pending") {
			const adapter = claimed.route.deployAdapter;
			const environment = claimed.route.productionEnvironment;
			const sha = claimed.headSha;
			if (!adapter || !environment || !sha) {
				throw new Error("Trusted deployment configuration disappeared");
			}
			const artifactHash = await hashValue(artifact);
			outbox = [
				{
					id: options.ids.next("outbox"),
					kind: "deployment",
					workflowId: claimed.id,
					workflowVersion: claimed.version + 1,
					issueSnapshotHash: claimed.issueSnapshotHash,
					artifactId: artifact.artifactId,
					artifactHash,
					status: "pending",
					idempotencyKey: deploymentKey(claimed.id, adapter, environment, sha),
					attempts: 0,
					adapter,
					environment,
					sha,
					createdAt: nowIso(),
					updatedAt: nowIso(),
				},
			];
		}

		const activity = newActivity(claimed.id, {
			visibility: artifact.visibility,
			stage: artifact.stage,
			status:
				nextState === "failed_retryable"
					? "failed"
					: [
								"needs_info",
								"security_escalation",
								"restricted_proposal_only",
								"needs_human",
							].includes(nextState)
						? "needs_human"
						: "succeeded",
			title: artifact.title,
			summary: artifact.summary,
			details: artifact.details,
			actor: "QM " + artifact.stage,
			artifactId: artifact.artifactId,
			links: artifact.links,
		});
		return transition(claimed, nextState, changes, {
			artifacts: [artifact],
			activities: [activity],
			outbox,
		});
	};

	const advancePlanGate = async (
		workflow: WorkflowRecord,
	): Promise<WorkflowRecord> => {
		const artifact = await latestArtifact(workflow);
		const restricted =
			artifact.decision === "proposal_only" ||
			workflow.risk === "r3" ||
			artifact.risk === "r3" ||
			artifact.restrictedChanges.length > 0;
		const state: WorkflowState = restricted
			? "restricted_proposal_only"
			: "awaiting_plan_approval";
		const activity = newActivity(workflow.id, {
			visibility: "internal",
			stage: "policy",
			status: restricted ? "blocked" : "needs_human",
			title: restricted
				? "Restricted change proposed"
				: "Plan approval required",
			summary: restricted
				? "The agent may propose this change but cannot implement it."
				: "A human must approve the plan before implementation begins.",
			actor: "Support policy",
			artifactId: artifact.artifactId,
			links: artifact.links,
		});
		return transition(workflow, state, {}, { activities: [activity] });
	};

	const prepareWorkspace = async (
		workflow: WorkflowRecord,
		stage: AgentStage,
		operationId: string,
	): Promise<RepositoryStageWorkspace | undefined> => {
		const spec = repositoryStageSpec(workflow, stage);
		if (!spec) return undefined;
		const workspace = await options.repository.prepareStageWorkspace({
			workflow,
			operationId,
			...spec,
		});
		if (
			workspace.targetRepository !== workflow.route.targetRepository ||
			workspace.revision !== spec.targetRevision ||
			workspace.access !== spec.access
		) {
			await options.repository
				.releaseStageWorkspace(workspace, "failed")
				.catch(() => undefined);
			throw new Error(
				"Repository adapter returned a workspace outside the requested boundary",
			);
		}
		return workspace;
	};

	const claimStage = async (
		workflow: WorkflowRecord,
		stage: AgentStage,
		previousArtifacts: AgentArtifact[],
		reviewFeedback: WorkflowReviewFeedback[],
	): Promise<WorkflowRecord> => {
		if (workflow.activeLease) {
			if (
				workflow.activeLease.kind !== "agent_stage" ||
				workflow.activeStage !== stage
			) {
				throw new Error("Workflow has a different active operation");
			}
			if (leaseIsLive(workflow)) {
				throw new Error(
					"Workflow stage lease is still active until " +
						workflow.activeLease.expiresAt,
				);
			}
			const resumed = updatedRecord(workflow, {
				activeLease: {
					...workflow.activeLease,
					id: options.ids.next("stage-lease"),
					acquiredAt: nowIso(),
					expiresAt: leaseExpiresAt(),
				},
			});
			const activity = newActivity(workflow.id, {
				visibility: "internal",
				stage,
				status: "running",
				title: stage + " resumed",
				summary:
					"Replaying the persisted QM idempotency key after lease expiry.",
				actor: "Support worker",
				links: [],
			});
			return persist(workflow, resumed, { activities: [activity] });
		}

		const runningState = runningStateForStage(stage, workflow.state);
		if (workflow.state !== runningState) {
			assertTransition(workflow.state, runningState);
		}
		const attempt = (workflow.stageAttempts[stage] ?? 0) + 1;
		const inputHash = await hashValue({
			issue: workflow.issueSnapshotHash,
			stage,
			baseSha: workflow.baseSha,
			headSha: workflow.headSha,
			previousArtifacts: previousArtifacts.map(
				(artifact) => artifact.artifactId,
			),
			reviewFeedback: reviewFeedback.map((item) => ({
				id: item.id,
				kind: item.kind,
				note: item.note,
			})),
		});
		const idempotencyKey = stageIdempotencyKey({
			workflowId: workflow.id,
			stage,
			inputHash,
			attempt,
		});
		const claimed = updatedRecord(workflow, {
			state: runningState,
			activeStage: stage,
			activeLease: {
				id: options.ids.next("stage-lease"),
				kind: "agent_stage",
				idempotencyKey,
				attempt,
				acquiredAt: nowIso(),
				expiresAt: leaseExpiresAt(),
			},
			stageAttempts: {
				...workflow.stageAttempts,
				[stage]: attempt,
			},
		});
		const activity = newActivity(workflow.id, {
			visibility: "internal",
			stage,
			status: "running",
			title: stage + " started",
			summary: "QM stage attempt " + String(attempt) + " is running.",
			actor: "QM " + stage,
			links: [],
		});
		return persist(workflow, claimed, { activities: [activity] });
	};

	const executeStage = async (
		workflow: WorkflowRecord,
		stage: AgentStage,
	): Promise<WorkflowRecord> => {
		await stageGateCheck(workflow, stage);
		const [allArtifacts, allFeedback] = await Promise.all([
			options.store.listArtifacts(workflow.id),
			options.store.listFeedback(workflow.id),
		]);
		const previousArtifacts = allArtifacts.filter(
			(artifact) => artifact.issueSnapshotHash === workflow.issueSnapshotHash,
		);
		const reviewFeedback = allFeedback.filter(
			(item) => item.issueSnapshotHash === workflow.issueSnapshotHash,
		);
		const claimed = await claimStage(
			workflow,
			stage,
			previousArtifacts,
			reviewFeedback,
		);
		const lease = claimed.activeLease;
		if (!lease || lease.kind !== "agent_stage") {
			throw new Error("Agent stage was not durably leased");
		}
		let workspace: RepositoryStageWorkspace | undefined;
		let outcome: "completed" | "failed" | "cancelled" = "failed";
		try {
			workspace = await prepareWorkspace(claimed, stage, lease.id);
			const artifact = await options.runtime.execute({
				workflow: claimed,
				stage,
				attempt: lease.attempt,
				idempotencyKey: lease.idempotencyKey,
				previousArtifacts,
				reviewFeedback,
				readOnly: stage !== "implement",
				capabilities: capabilitiesForStage(stage),
				workspace,
			});
			const next = await applyArtifact(claimed, artifact, workspace);
			outcome = "completed";
			return next;
		} catch (error) {
			if (isContractError(error) && lease.attempt < 2) {
				const repairable = await finishWithError(claimed, stage, error);
				const retried = await performAction({
					workflowId: workflow.id,
					expectedVersion: repairable.version,
					action: "retry",
					actorId: "support-controller",
					note: "Automatic structured-output repair retry",
				});
				return runNext(retried.id);
			}
			return finishWithError(claimed, stage, error);
		} finally {
			if (workspace) {
				await options.repository
					.releaseStageWorkspace(workspace, outcome)
					.catch(() => undefined);
			}
		}
	};

	const findOpenOutbox = async (
		workflow: WorkflowRecord,
		kind: WorkflowOutbox["kind"],
	): Promise<WorkflowOutbox> => {
		const items = await options.store.listOutbox(workflow.id);
		const item = items.findLast(
			(candidate) =>
				candidate.kind === kind &&
				(candidate.status === "pending" || candidate.status === "running") &&
				candidate.issueSnapshotHash === workflow.issueSnapshotHash,
		);
		if (!item) {
			throw new Error("Workflow has no current " + kind + " outbox intent");
		}
		return item;
	};

	const failOutbox = async (
		claimed: WorkflowRecord,
		item: WorkflowOutbox,
		error: unknown,
	): Promise<WorkflowRecord> => {
		const message =
			error instanceof Error
				? error.message
				: "External workflow effect failed";
		const pendingState: WorkflowState =
			item.kind === "deployment"
				? "deployment_pending"
				: "response_publish_pending";
		const failedItem: WorkflowOutbox = {
			...item,
			status: "running",
			updatedAt: nowIso(),
		};
		const activity = newActivity(claimed.id, {
			visibility: "internal",
			stage: item.kind === "deployment" ? "deploy" : "respond",
			status: "failed",
			title:
				item.kind === "deployment"
					? "Deployment dispatch failed"
					: "Response publication failed",
			summary:
				message +
				" The same idempotency key must be reconciled before new issue input can proceed.",
			actor: "Support effect worker",
			links: [],
		});
		return transition(
			claimed,
			"failed_retryable",
			{
				lastError: message,
				retryState: pendingState,
			},
			{ activities: [activity], outbox: [failedItem] },
		);
	};

	const claimOutbox = async (
		workflow: WorkflowRecord,
		item: WorkflowOutbox,
	): Promise<{ workflow: WorkflowRecord; item: WorkflowOutbox }> => {
		if (workflow.activeLease && leaseIsLive(workflow)) {
			throw new Error(
				"External effect lease is active until " +
					workflow.activeLease.expiresAt,
			);
		}
		if (
			workflow.activeLease &&
			(workflow.activeLease.outboxId !== item.id ||
				workflow.activeLease.kind === "agent_stage")
		) {
			throw new Error("Workflow has a different active operation");
		}
		const attempt = item.attempts + 1;
		const claimedItem: WorkflowOutbox = {
			...item,
			status: "running",
			attempts: attempt,
			updatedAt: nowIso(),
		};
		const claimed = updatedRecord(workflow, {
			activeStage: undefined,
			activeLease: {
				id: options.ids.next("effect-lease"),
				kind:
					item.kind === "deployment" ? "deployment" : "response_publication",
				idempotencyKey: item.idempotencyKey,
				attempt,
				acquiredAt: nowIso(),
				expiresAt: leaseExpiresAt(),
				outboxId: item.id,
			},
		});
		const activity = newActivity(workflow.id, {
			visibility: "internal",
			stage: item.kind === "deployment" ? "deploy" : "respond",
			status: "running",
			title:
				item.kind === "deployment"
					? "Trusted deployment dispatch started"
					: "Approved response publication started",
			summary: "Executing durable outbox attempt " + String(attempt) + ".",
			actor: "Support effect worker",
			links: [],
		});
		await persist(workflow, claimed, {
			activities: [activity],
			outbox: [claimedItem],
		});
		return { workflow: claimed, item: claimedItem };
	};

	const dispatchOutbox = async (
		workflow: WorkflowRecord,
	): Promise<WorkflowRecord> => {
		const kind: WorkflowOutbox["kind"] =
			workflow.state === "deployment_pending"
				? "deployment"
				: "public_response";
		const currentItem = await findOpenOutbox(workflow, kind);
		const claimed = await claimOutbox(workflow, currentItem);
		try {
			const artifact = await options.store.getArtifact(claimed.item.artifactId);
			if (
				!artifact ||
				(await hashValue(artifact)) !== claimed.item.artifactHash ||
				claimed.item.issueSnapshotHash !== claimed.workflow.issueSnapshotHash
			) {
				throw new Error("Outbox artifact or issue binding is stale");
			}

			if (claimed.item.kind === "deployment") {
				await requireBoundApproval(claimed.workflow, "deploy", {
					mergedSha: claimed.item.sha,
				});
				if (
					claimed.workflow.headSha !== claimed.item.sha ||
					claimed.workflow.route.deployAdapter !== claimed.item.adapter ||
					claimed.workflow.route.productionEnvironment !==
						claimed.item.environment
				) {
					throw new Error("Deployment intent no longer matches the route");
				}
				const receipt = await options.deployment.deploy({
					workflow: claimed.workflow,
					adapter: claimed.item.adapter,
					environment: claimed.item.environment,
					sha: claimed.item.sha,
					idempotencyKey: claimed.item.idempotencyKey,
				});
				if (receipt.deployedSha !== claimed.item.sha) {
					throw new Error(
						"The trusted deployment adapter reported an unexpected SHA",
					);
				}
				const safeUrl = receipt.url
					? httpUrlSchema.safeParse(receipt.url)
					: undefined;
				const completedArtifact = agentArtifactSchema.parse({
					...artifact,
					artifactId: options.ids.next("artifact-deployment-receipt"),
					createdAt: nowIso(),
					deployedSha: receipt.deployedSha,
					links:
						safeUrl?.success === true
							? [
									...artifact.links,
									{
										label: "View deployment",
										url: safeUrl.data,
										kind: "deployment",
									},
								]
							: artifact.links,
				});
				const completedItem: WorkflowOutbox = {
					...claimed.item,
					status: "completed",
					deployedSha: receipt.deployedSha,
					resultUrl: safeUrl?.success === true ? safeUrl.data : undefined,
					updatedAt: nowIso(),
				};
				const activity = newActivity(claimed.workflow.id, {
					visibility: "internal",
					stage: "deploy",
					status: "succeeded",
					title: "Trusted deployment completed",
					summary:
						"The adapter confirmed the exact approved SHA in " +
						claimed.item.environment +
						".",
					actor: "Support effect worker",
					artifactId: completedArtifact.artifactId,
					links:
						safeUrl?.success === true
							? [
									{
										label: "View deployment",
										url: safeUrl.data,
										kind: "deployment",
									},
								]
							: [],
				});
				return transition(
					claimed.workflow,
					"verifying_production",
					{
						deployedSha: receipt.deployedSha,
						lastArtifactId: completedArtifact.artifactId,
					},
					{
						artifacts: [completedArtifact],
						activities: [activity],
						outbox: [completedItem],
					},
				);
			}

			await requireBoundApproval(claimed.workflow, "response", {
				deployedSha: claimed.workflow.deployedSha,
			});
			const published = await options.responses.publish({
				workflow: claimed.workflow,
				body: claimed.item.body,
				idempotencyKey: claimed.item.idempotencyKey,
			});
			const safeUrl = published.url
				? httpUrlSchema.safeParse(published.url)
				: undefined;
			const publicArtifact = agentArtifactSchema.parse({
				...artifact,
				artifactId: options.ids.next("artifact-public-response"),
				createdAt: nowIso(),
				visibility: "public",
			});
			const completedItem: WorkflowOutbox = {
				...claimed.item,
				status: "completed",
				resultUrl: safeUrl?.success === true ? safeUrl.data : undefined,
				updatedAt: nowIso(),
			};
			const activity = newActivity(claimed.workflow.id, {
				visibility: "public",
				stage: "respond",
				status: "succeeded",
				title: "Customer response published",
				summary: claimed.item.body,
				actor: "Support effect worker",
				artifactId: publicArtifact.artifactId,
				links:
					safeUrl?.success === true
						? [
								{
									label: "View response",
									url: safeUrl.data,
									kind: "other",
								},
							]
						: [],
			});
			return transition(
				claimed.workflow,
				"closed",
				{ lastArtifactId: publicArtifact.artifactId },
				{
					artifacts: [publicArtifact],
					activities: [activity],
					outbox: [completedItem],
				},
			);
		} catch (error) {
			return failOutbox(claimed.workflow, claimed.item, error);
		}
	};

	const runNext = async (workflowId: string): Promise<WorkflowRecord> => {
		let workflow = await options.store.get(workflowId);
		if (!workflow) {
			throw new Error("Workflow " + workflowId + " was not found");
		}
		if (!availableWorkflowActions(workflow).includes("run_next")) {
			throw new Error(
				"Workflow state " +
					workflow.state +
					" is not runnable in mode " +
					workflow.route.automationMode,
			);
		}
		if (
			workflow.state === "deployment_pending" ||
			workflow.state === "response_publish_pending"
		) {
			return dispatchOutbox(workflow);
		}
		if (workflow.state === "plan_ready") return advancePlanGate(workflow);
		if (workflow.state === "changes_requested") {
			workflow = await transition(workflow, "implementing");
		}

		const stage = workflow.activeStage ?? stageForState(workflow.state);
		if (!stage) {
			throw new Error(
				"Workflow state " + workflow.state + " has no agent stage",
			);
		}
		return executeStage(workflow, stage);
	};

	const actionActivity = (
		workflow: WorkflowRecord,
		input: PerformWorkflowActionInput,
	): WorkflowActivity =>
		newActivity(workflow.id, {
			visibility: "internal",
			stage: input.actorId === "support-controller" ? "policy" : "human_review",
			status: "succeeded",
			title: input.action.replaceAll("_", " "),
			summary: input.note ?? "Action performed by " + input.actorId + ".",
			actor: input.actorId,
			links: [],
		});

	async function performAction(
		input: PerformWorkflowActionInput,
	): Promise<WorkflowRecord> {
		const workflow = await options.store.get(input.workflowId);
		if (!workflow) {
			throw new Error("Workflow " + input.workflowId + " was not found");
		}
		if (workflow.version !== input.expectedVersion) {
			throw new Error(
				"Workflow changed: expected version " +
					String(input.expectedVersion) +
					", current version " +
					String(workflow.version),
			);
		}
		if (!availableWorkflowActions(workflow).includes(input.action)) {
			throw new Error(
				"Action " +
					input.action +
					" is not available in state " +
					workflow.state,
			);
		}
		if (input.action === "run_next") return runNext(workflow.id);

		const activity = actionActivity(workflow, input);
		switch (input.action) {
			case "approve_plan": {
				const artifact = await latestArtifact(workflow);
				const approval = await createApproval(
					workflow,
					artifact,
					"plan",
					input.actorId,
					input.note,
					{ baseSha: workflow.baseSha },
				);
				return transition(
					workflow,
					"implementing",
					{},
					{ approvals: [approval], activities: [activity] },
				);
			}
			case "revise_plan":
			case "request_changes": {
				const note = input.note?.trim();
				if (!note) {
					throw new Error(input.action + " requires actionable feedback");
				}
				const artifact = await latestArtifact(workflow);
				const feedback: WorkflowReviewFeedback = {
					id: options.ids.next("feedback"),
					workflowId: workflow.id,
					kind: input.action,
					actorId: input.actorId,
					note,
					issueSnapshotHash: workflow.issueSnapshotHash,
					targetArtifactId: artifact.artifactId,
					createdAt: nowIso(),
				};
				return transition(
					workflow,
					input.action === "revise_plan"
						? "investigating"
						: "changes_requested",
					{},
					{ feedback: [feedback], activities: [activity] },
				);
			}
			case "record_merge": {
				if (!input.mergedSha) {
					throw new Error("record_merge requires mergedSha");
				}
				if (!workflow.headSha) {
					throw new Error("record_merge requires an approved candidate SHA");
				}
				const candidateSha = workflow.headSha;
				const mergeVerified = await options.repository.verifyMergedSha({
					workflow,
					candidateSha,
					mergedSha: input.mergedSha,
				});
				if (!mergeVerified) {
					throw new Error(
						"The repository adapter could not bind the merged SHA to the reviewed candidate",
					);
				}
				const artifact = await latestArtifact(workflow);
				const approval = await createApproval(
					workflow,
					artifact,
					"merge",
					input.actorId,
					input.note,
					{
						baseSha: workflow.baseSha,
						candidateSha,
						mergedSha: input.mergedSha,
					},
				);
				return transition(
					workflow,
					"merged",
					{ headSha: input.mergedSha },
					{ approvals: [approval], activities: [activity] },
				);
			}
			case "approve_deploy": {
				const artifact = await latestArtifact(workflow);
				const approval = await createApproval(
					workflow,
					artifact,
					"deploy",
					input.actorId,
					input.note,
					{
						baseSha: workflow.baseSha,
						mergedSha: workflow.headSha,
					},
				);
				return transition(
					workflow,
					"deploying",
					{},
					{ approvals: [approval], activities: [activity] },
				);
			}
			case "approve_response": {
				const artifact = await latestArtifact(workflow);
				if (!artifact.publicResponse) {
					throw new Error("Response artifact has no public response candidate");
				}
				const approval = await createApproval(
					workflow,
					artifact,
					"response",
					input.actorId,
					input.note,
					{
						baseSha: workflow.baseSha,
						mergedSha: workflow.headSha,
						deployedSha: workflow.deployedSha,
					},
				);
				const artifactHash = await hashValue(artifact);
				assertTransition(workflow.state, "response_publish_pending");
				const next = updatedRecord(workflow, {
					state: "response_publish_pending",
					activeStage: undefined,
					activeLease: undefined,
				});
				const outbox: WorkflowOutbox = {
					id: options.ids.next("outbox"),
					kind: "public_response",
					workflowId: workflow.id,
					workflowVersion: next.version,
					issueSnapshotHash: workflow.issueSnapshotHash,
					artifactId: artifact.artifactId,
					artifactHash,
					status: "pending",
					idempotencyKey: publicResponseKey(workflow.id, artifactHash),
					attempts: 0,
					body: artifact.publicResponse,
					createdAt: nowIso(),
					updatedAt: nowIso(),
				};
				await persist(workflow, next, {
					approvals: [approval],
					activities: [activity],
					outbox: [outbox],
				});
				return runNext(next.id);
			}
			case "retry": {
				const retryState = workflow.retryState ?? "received";
				return transition(
					workflow,
					retryState,
					{
						lastError: undefined,
						retryState: undefined,
					},
					{ activities: [activity] },
				);
			}
			case "cancel": {
				const outbox = await options.store.listOutbox(workflow.id);
				if (
					isExternalLease(workflow) ||
					outbox.some((item) => item.status === "running" && item.attempts > 0)
				) {
					throw new Error(
						"An attempted external effect must be reconciled before cancellation",
					);
				}
				return transition(
					workflow,
					"cancelled",
					{},
					{ activities: [activity], cancelOpenOutbox: true },
				);
			}
			default:
				throw new Error("Unsupported workflow action: " + input.action);
		}
	}

	const runUntilGate = async (
		workflowId: string,
		maxSteps = 20,
	): Promise<WorkflowRecord> => {
		let workflow = await options.store.get(workflowId);
		if (!workflow) {
			throw new Error("Workflow " + workflowId + " was not found");
		}
		for (let step = 0; step < maxSteps; step += 1) {
			if (!availableWorkflowActions(workflow).includes("run_next")) {
				return workflow;
			}
			workflow = await runNext(workflow.id);
		}
		throw new Error(
			"Workflow " +
				workflowId +
				" exceeded " +
				String(maxSteps) +
				" automatic steps",
		);
	};

	const getStaffWorkspace = async (
		workflowId: string,
	): Promise<StaffWorkflowWorkspace | null> =>
		getStaffWorkflowWorkspace(options.store, workflowId);

	return {
		ingest,
		runNext,
		runUntilGate,
		performAction,
		getStaffWorkspace,
	};
}

export type SupportWorkflowController = ReturnType<
	typeof createSupportWorkflowController
>;
