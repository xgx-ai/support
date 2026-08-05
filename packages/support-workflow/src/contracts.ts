import { z } from "zod";

/** Version of the persisted workflow and agent-artifact contracts. */
export const SUPPORT_WORKFLOW_VERSION = 2 as const;

export const workflowStateSchema = z.enum([
	"received",
	"validating",
	"needs_info",
	"security_escalation",
	"triaging",
	"shadow_complete",
	"investigating",
	"plan_ready",
	"restricted_proposal_only",
	"awaiting_plan_approval",
	"implementing",
	"draft_pr_open",
	"qc_running",
	"changes_requested",
	"awaiting_human_review",
	"merged",
	"verifying_staging",
	"awaiting_deploy_approval",
	"deploying",
	"deployment_pending",
	"verifying_production",
	"response_drafting",
	"awaiting_response_approval",
	"response_publish_pending",
	"responded",
	"closed",
	"failed_retryable",
	"needs_human",
	"blocked",
	"cancelled",
	"stale",
]);

export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const agentStageSchema = z.enum([
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

export type AgentStage = z.infer<typeof agentStageSchema>;

export const workflowActivityStageSchema = z.union([
	agentStageSchema,
	z.enum(["intake", "policy", "human_review"]),
]);
export type WorkflowActivityStage = z.infer<typeof workflowActivityStageSchema>;

export const automationModeSchema = z.enum([
	"shadow",
	"plan",
	"code",
	"release",
	"full",
]);
export type AutomationMode = z.infer<typeof automationModeSchema>;

export const riskLevelSchema = z.enum(["r0", "r1", "r2", "r3"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const artifactVisibilitySchema = z.enum([
	"internal",
	"public_candidate",
	"public",
]);
export type ArtifactVisibility = z.infer<typeof artifactVisibilitySchema>;

export const stageDecisionSchema = z.enum([
	"pass",
	"needs_info",
	"escalate",
	"proposal_only",
	"changes_requested",
	"failed",
]);
export type StageDecision = z.infer<typeof stageDecisionSchema>;

const stageDecisionSchemas: Record<AgentStage, z.ZodType<StageDecision>> = {
	validate: z.enum(["pass", "needs_info", "escalate", "failed"]),
	triage: z.enum(["pass", "needs_info", "escalate", "failed"]),
	investigate: z.enum([
		"pass",
		"needs_info",
		"escalate",
		"proposal_only",
		"failed",
	]),
	implement: z.enum(["pass", "escalate", "proposal_only", "failed"]),
	qc: z.enum([
		"pass",
		"escalate",
		"proposal_only",
		"changes_requested",
		"failed",
	]),
	verify_staging: z.enum(["pass", "escalate", "proposal_only", "failed"]),
	deploy: z.enum(["pass", "escalate", "failed"]),
	verify_production: z.enum(["pass", "escalate", "proposal_only", "failed"]),
	respond: z.enum(["pass", "escalate", "failed"]),
};

/** Fails closed when a stage returns a decision that has no trusted transition. */
export function assertStageDecision(
	stage: AgentStage,
	decision: StageDecision,
): void {
	stageDecisionSchemas[stage].parse(decision);
}

export const restrictedChangeCategorySchema = z.enum([
	"database",
	"dependencies",
	"ci",
	"infrastructure",
	"authentication",
	"secrets",
	"release",
	"generated",
	"unexpected",
]);
export type RestrictedChangeCategory = z.infer<
	typeof restrictedChangeCategorySchema
>;

export const httpUrlSchema = z
	.string()
	.url()
	.refine((value) => {
		const protocol = new URL(value).protocol;
		return protocol === "https:" || protocol === "http:";
	}, "URL must use http or https");

export const supportEvidenceSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
	url: httpUrlSchema.optional(),
});
export type SupportEvidence = z.infer<typeof supportEvidenceSchema>;

export const supportLinkSchema = z.object({
	label: z.string().min(1),
	url: httpUrlSchema,
	kind: z.enum(["qm", "pull_request", "check", "deployment", "other"]),
});
export type SupportLink = z.infer<typeof supportLinkSchema>;

export const testResultSchema = z.object({
	command: z.string().min(1),
	status: z.enum(["passed", "failed", "not_run"]),
	summary: z.string().min(1),
});
export type TestResult = z.infer<typeof testResultSchema>;

export const restrictedChangeSchema = z.object({
	category: restrictedChangeCategorySchema,
	path: z.string().min(1).optional(),
	reason: z.string().min(1),
	proposal: z.string().min(1),
	rollback: z.string().min(1).optional(),
});
export type RestrictedChange = z.infer<typeof restrictedChangeSchema>;

/**
 * Structured output returned by every QM support stage.
 * Workflow transitions are derived from this artifact by trusted code; the
 * agent's decision is only a recommendation.
 */
export const agentArtifactEnvelopeSchema = z.object({
	workflowVersion: z.literal(SUPPORT_WORKFLOW_VERSION),
	artifactId: z.string().min(1),
	workflowId: z.string().min(1),
	issueSnapshotHash: z.string().min(1),
	runId: z.string().min(1),
	stage: agentStageSchema,
	createdAt: z.string().datetime(),
	visibility: artifactVisibilitySchema.default("internal"),
	decision: stageDecisionSchema,
	risk: riskLevelSchema,
	confidence: z.number().min(0).max(1),
	title: z.string().min(1),
	summary: z.string().min(1),
	details: z.string().min(1).optional(),
	evidence: z.array(supportEvidenceSchema).default([]),
	changedPaths: z.array(z.string().min(1)).default([]),
	tests: z.array(testResultSchema).default([]),
	restrictedChanges: z.array(restrictedChangeSchema).default([]),
	links: z.array(supportLinkSchema).max(50).default([]),
	baseSha: z.string().min(1).optional(),
	headSha: z.string().min(1).optional(),
	deployedSha: z.string().min(1).optional(),
	publicResponse: z.string().min(1).optional(),
	triageRoute: z.enum(["response", "code"]).optional(),
});

export const agentArtifactSchema = agentArtifactEnvelopeSchema.superRefine(
	(artifact, context) => {
		const decision = stageDecisionSchemas[artifact.stage].safeParse(
			artifact.decision,
		);
		if (!decision.success) {
			context.addIssue({
				code: "custom",
				path: ["decision"],
				message: `Decision ${artifact.decision} is not valid for ${artifact.stage}`,
			});
		}
		if (artifact.decision !== "pass") return;
		const requireField = (
			field: "baseSha" | "headSha" | "deployedSha" | "publicResponse",
		) => {
			if (artifact[field]) return;
			context.addIssue({
				code: "custom",
				path: [field],
				message: `${field} is required for a passing ${artifact.stage} artifact`,
			});
		};
		switch (artifact.stage) {
			case "triage":
				if (!artifact.triageRoute) {
					context.addIssue({
						code: "custom",
						path: ["triageRoute"],
						message: "triageRoute is required for passing triage",
					});
				}
				break;
			case "investigate":
				requireField("baseSha");
				break;
			case "implement":
			case "qc":
				requireField("baseSha");
				requireField("headSha");
				break;
			case "verify_staging":
			case "deploy":
				requireField("headSha");
				break;
			case "verify_production":
				requireField("deployedSha");
				break;
			case "respond":
				requireField("publicResponse");
				break;
			default:
				break;
		}
	},
);

export type AgentArtifact = z.infer<typeof agentArtifactSchema>;

/** Fields authored by an agent; identity and timing fields are added by the controller. */
export const agentStageOutputSchema = agentArtifactEnvelopeSchema.omit({
	workflowVersion: true,
	artifactId: true,
	workflowId: true,
	issueSnapshotHash: true,
	runId: true,
	stage: true,
	createdAt: true,
	visibility: true,
});
export type AgentStageOutput = z.infer<typeof agentStageOutputSchema>;

export const supportRouteSchema = z
	.object({
		id: z.string().min(1),
		targetRepository: z.string().regex(/^[^/]+\/[^/]+$/),
		baseBranch: z.string().min(1),
		qmScope: z.string().min(1),
		automationMode: automationModeSchema,
		allowedPaths: z.array(z.string().min(1)).min(1),
		forbiddenPaths: z.array(z.string().min(1)).default([]),
		testCommands: z.array(z.string().min(1)).min(1),
		stagingEnvironment: z.string().min(1).optional(),
		productionEnvironment: z.string().min(1).optional(),
		deployAdapter: z.string().min(1).optional(),
	})
	.superRefine((route, context) => {
		if (route.automationMode !== "release" && route.automationMode !== "full") {
			return;
		}
		for (const field of [
			"stagingEnvironment",
			"productionEnvironment",
			"deployAdapter",
		] as const) {
			if (route[field]) continue;
			context.addIssue({
				code: "custom",
				path: [field],
				message: `${field} is required in ${route.automationMode} mode`,
			});
		}
	});
export type SupportRoute = z.infer<typeof supportRouteSchema>;

export const supportIssueSnapshotSchema = z.object({
	supportRepository: z.string().regex(/^[^/]+\/[^/]+$/),
	issueNumber: z.number().int().positive(),
	title: z.string().min(1),
	body: z.string(),
	labels: z.array(z.string()),
	authorId: z.string().min(1).optional(),
	latestComment: z.string().min(1).optional(),
	triggerType: z.string().min(1),
	updatedAt: z.string().datetime(),
});
export type SupportIssueSnapshot = z.infer<typeof supportIssueSnapshotSchema>;

export const workflowApprovalSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["plan", "merge", "deploy", "response"]),
	actorId: z.string().min(1),
	createdAt: z.string().datetime(),
	issueSnapshotHash: z.string().min(1),
	artifactId: z.string().min(1),
	artifactHash: z.string().min(1),
	baseSha: z.string().min(1).optional(),
	candidateSha: z.string().min(1).optional(),
	mergedSha: z.string().min(1).optional(),
	deployedSha: z.string().min(1).optional(),
	note: z.string().min(1).optional(),
});
export type WorkflowApproval = z.infer<typeof workflowApprovalSchema>;

export const workflowReviewFeedbackSchema = z.object({
	id: z.string().min(1),
	workflowId: z.string().min(1),
	kind: z.enum(["revise_plan", "request_changes"]),
	actorId: z.string().min(1),
	note: z.string().min(1).max(4_000),
	issueSnapshotHash: z.string().min(1),
	targetArtifactId: z.string().min(1),
	createdAt: z.string().datetime(),
});
export type WorkflowReviewFeedback = z.infer<
	typeof workflowReviewFeedbackSchema
>;

export const workflowLeaseSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["agent_stage", "deployment", "response_publication"]),
	idempotencyKey: z.string().min(1),
	attempt: z.number().int().positive(),
	acquiredAt: z.string().datetime(),
	expiresAt: z.string().datetime(),
	outboxId: z.string().min(1).optional(),
});
export type WorkflowLease = z.infer<typeof workflowLeaseSchema>;

export const workflowRecordSchema = z.object({
	workflowVersion: z.literal(SUPPORT_WORKFLOW_VERSION),
	id: z.string().min(1),
	version: z.number().int().nonnegative(),
	state: workflowStateSchema,
	issue: supportIssueSnapshotSchema,
	issueSnapshotHash: z.string().min(1),
	route: supportRouteSchema,
	risk: riskLevelSchema.default("r1"),
	baseSha: z.string().min(1).optional(),
	headSha: z.string().min(1).optional(),
	deployedSha: z.string().min(1).optional(),
	lastArtifactId: z.string().min(1).optional(),
	activeStage: agentStageSchema.optional(),
	activeLease: workflowLeaseSchema.optional(),
	retryState: workflowStateSchema.optional(),
	qcLoops: z.number().int().nonnegative().default(0),
	stageAttempts: z.partialRecord(
		agentStageSchema,
		z.number().int().nonnegative(),
	),
	lastError: z.string().min(1).optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type WorkflowRecord = z.infer<typeof workflowRecordSchema>;

export const workflowActivitySchema = z.object({
	id: z.string().min(1),
	workflowId: z.string().min(1),
	createdAt: z.string().datetime(),
	visibility: artifactVisibilitySchema,
	stage: workflowActivityStageSchema,
	status: z.enum([
		"pending",
		"running",
		"succeeded",
		"failed",
		"blocked",
		"needs_human",
	]),
	title: z.string().min(1),
	summary: z.string().min(1),
	details: z.string().min(1).optional(),
	actor: z.string().min(1),
	artifactId: z.string().min(1).optional(),
	links: z.array(supportLinkSchema).default([]),
});
export type WorkflowActivity = z.infer<typeof workflowActivitySchema>;

const workflowOutboxBaseShape = {
	id: z.string().min(1),
	workflowId: z.string().min(1),
	workflowVersion: z.number().int().nonnegative(),
	issueSnapshotHash: z.string().min(1),
	artifactId: z.string().min(1),
	artifactHash: z.string().min(1),
	status: z.enum(["pending", "running", "completed", "cancelled"]),
	idempotencyKey: z.string().min(1),
	attempts: z.number().int().nonnegative(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	resultUrl: httpUrlSchema.optional(),
};

export const workflowOutboxSchema = z.discriminatedUnion("kind", [
	z.object({
		...workflowOutboxBaseShape,
		kind: z.literal("deployment"),
		adapter: z.string().min(1),
		environment: z.string().min(1),
		sha: z.string().min(1),
		deployedSha: z.string().min(1).optional(),
	}),
	z.object({
		...workflowOutboxBaseShape,
		kind: z.literal("public_response"),
		body: z.string().min(1).max(20_000),
	}),
]);
export type WorkflowOutbox = z.infer<typeof workflowOutboxSchema>;

export const workflowActionSchema = z.enum([
	"run_next",
	"approve_plan",
	"revise_plan",
	"request_changes",
	"record_merge",
	"approve_deploy",
	"approve_response",
	"retry",
	"cancel",
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export interface StaffWorkflowWorkspace {
	workflow: WorkflowRecord;
	activities: WorkflowActivity[];
	artifacts: AgentArtifact[];
	approvals: WorkflowApproval[];
	feedback: WorkflowReviewFeedback[];
	outbox: WorkflowOutbox[];
	availableActions: WorkflowAction[];
}
