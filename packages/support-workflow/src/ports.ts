import type {
	AgentArtifact,
	AgentStage,
	NixExecutionProfile,
	RepositoryCheckResult,
	StaffWorkflowWorkspace,
	SupportIssueSnapshot,
	SupportRoute,
	WorkflowActivity,
	WorkflowApproval,
	WorkflowOutbox,
	WorkflowRecord,
	WorkflowReviewFeedback,
} from "./contracts";

export interface Clock {
	now(): Date;
}

export interface IdGenerator {
	next(prefix: string): string;
}

export interface WorkflowStore {
	hasIngressIdempotencyKey(key: string): Promise<boolean>;
	get(workflowId: string): Promise<WorkflowRecord | null>;
	/**
	 * Atomically applies a workflow CAS together with every supplied audit and
	 * side-effect-intent record. `expectedVersion: null` creates a workflow.
	 */
	transact(
		transaction: WorkflowStoreTransaction,
	): Promise<"committed" | "conflict" | "duplicate">;
	getArtifact(artifactId: string): Promise<AgentArtifact | null>;
	listArtifacts(workflowId: string): Promise<AgentArtifact[]>;
	listActivities(workflowId: string): Promise<WorkflowActivity[]>;
	listApprovals(workflowId: string): Promise<WorkflowApproval[]>;
	listFeedback(workflowId: string): Promise<WorkflowReviewFeedback[]>;
	getOutbox(outboxId: string): Promise<WorkflowOutbox | null>;
	listOutbox(workflowId: string): Promise<WorkflowOutbox[]>;
}

export interface WorkflowStoreTransaction {
	workflowId: string;
	expectedVersion: number | null;
	next: WorkflowRecord;
	ingressIdempotencyKey?: string;
	artifacts?: AgentArtifact[];
	activities?: WorkflowActivity[];
	approvals?: WorkflowApproval[];
	feedback?: WorkflowReviewFeedback[];
	outbox?: WorkflowOutbox[];
	/** Cancel every pending/running intent for this workflow in the same commit. */
	cancelOpenOutbox?: boolean;
}

export interface SupportRouteResolver {
	resolve(issue: SupportIssueSnapshot): Promise<SupportRoute | null>;
}

export interface WorkflowIngressJob {
	idempotencyKey: string;
	deliveryId: string;
	eventType: string;
	issue: SupportIssueSnapshot;
	route: SupportRoute;
	receivedAt: string;
}

export interface WorkflowQueue {
	enqueue(
		job: WorkflowIngressJob,
	): Promise<{ status: "enqueued" | "duplicate" }>;
}

export interface AgentStageRequest {
	workflow: WorkflowRecord;
	stage: AgentStage;
	attempt: number;
	idempotencyKey: string;
	previousArtifacts: AgentArtifact[];
	reviewFeedback: WorkflowReviewFeedback[];
	readOnly: boolean;
	capabilities: AgentStageCapability[];
	workspace?: RepositoryStageWorkspace;
}

export type AgentStageCapability =
	| "issue_read"
	| "repository_read"
	| "candidate_write"
	| "staging_read"
	| "production_read";

export interface AgentRuntime {
	execute(request: AgentStageRequest): Promise<AgentArtifact>;
}

export interface RepositoryChangeSet {
	baseSha: string;
	headSha: string;
	changedPaths: string[];
	patch?: string;
	addedDependencies?: string[];
}

export interface RepositoryStageWorkspace {
	id: string;
	targetRepository: string;
	revision: string;
	access: "read_only" | "candidate_write";
	/** Reference/path already provisioned inside the agent sandbox. */
	workspaceRef: string;
}

export interface PrepareRepositoryStageInput {
	workflow: WorkflowRecord;
	stage: Extract<AgentStage, "investigate" | "implement" | "qc">;
	operationId: string;
	targetRevision: string;
	access: RepositoryStageWorkspace["access"];
}

export interface RunRepositoryChecksInput {
	workflow: WorkflowRecord;
	stage: Extract<AgentStage, "implement" | "qc">;
	workspace: RepositoryStageWorkspace;
	profile: NixExecutionProfile;
}

export interface RepositoryPort {
	getBaseSha(route: SupportRoute): Promise<string>;
	prepareStageWorkspace(
		input: PrepareRepositoryStageInput,
	): Promise<RepositoryStageWorkspace>;
	releaseStageWorkspace(
		workspace: RepositoryStageWorkspace,
		outcome: "completed" | "failed" | "cancelled",
	): Promise<void>;
	runChecks(input: RunRepositoryChecksInput): Promise<RepositoryCheckResult[]>;
	inspectChanges(
		workflow: WorkflowRecord,
		artifact: AgentArtifact,
		workspace: RepositoryStageWorkspace,
	): Promise<RepositoryChangeSet>;
	verifyMergedSha(input: {
		workflow: WorkflowRecord;
		candidateSha: string;
		mergedSha: string;
	}): Promise<boolean>;
}

export interface DeploymentPort {
	deploy(input: {
		workflow: WorkflowRecord;
		adapter: string;
		environment: string;
		sha: string;
		idempotencyKey: string;
	}): Promise<{ deployedSha: string; url?: string }>;
}

export interface PublicResponsePublisher {
	publish(input: {
		workflow: WorkflowRecord;
		body: string;
		idempotencyKey: string;
	}): Promise<{ url?: string }>;
}

export interface WorkflowWorkspaceReader {
	getStaffWorkspace(workflowId: string): Promise<StaffWorkflowWorkspace | null>;
}
