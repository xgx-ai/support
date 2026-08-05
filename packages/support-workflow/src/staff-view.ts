import type {
	AgentArtifact,
	StaffWorkflowWorkspace,
	WorkflowAction,
	WorkflowActivityStage,
	WorkflowState,
} from "./contracts";

export type StaffActivityStage = WorkflowActivityStage;
export type StaffActivityStatus =
	| "pending"
	| "running"
	| "awaiting_approval"
	| "completed"
	| "succeeded"
	| "failed"
	| "blocked"
	| "needs_human"
	| "cancelled"
	| "stale";

export interface StaffWorkflowPanelView {
	workflowId: string;
	expectedVersion: number;
	confirmationContext: {
		workflowId: string;
		expectedVersion: number;
		target?: string;
		destination?: string;
	};
	workflow: {
		title: string;
		summary: string;
		status: StaffActivityStatus;
		activeStage?: StaffActivityStage;
		risk: "r0" | "r1" | "r2" | "r3";
		updatedAt: string;
		links: Array<{ label: string; href: string }>;
	};
	items: Array<{
		id: string;
		title: string;
		summary: string;
		stage: StaffActivityStage;
		status: StaffActivityStatus;
		visibility: "internal" | "public_candidate" | "public";
		occurredAt: string;
		details: Array<{ label?: string; value: string }>;
		links: Array<{ label: string; href: string }>;
	}>;
	availableActions: Array<{
		id: WorkflowAction;
		label: string;
		description: string;
		variant: "default" | "outline" | "secondary" | "destructive";
	}>;
}

const stateSummary: Record<WorkflowState, string> = {
	received: "Waiting for validation",
	validating: "QM is validating the support issue",
	needs_info: "Waiting for more customer information",
	security_escalation: "Escalated for urgent or security review",
	triaging: "QM is classifying and routing the issue",
	shadow_complete:
		"Shadow validation and triage completed without taking action",
	investigating: "QM is investigating the target codebase",
	plan_ready: "The proposed change plan is ready",
	restricted_proposal_only: "A restricted change was proposed for manual work",
	awaiting_plan_approval: "Waiting for human plan approval",
	implementing: "QM is implementing the approved change",
	draft_pr_open: "A draft pull request is ready for independent QC",
	qc_running: "An independent QM agent is reviewing the exact candidate SHA",
	changes_requested: "QC requested another implementation pass",
	awaiting_human_review: "Waiting for human code review and merge",
	merged: "The approved change was merged",
	verifying_staging: "QM is verifying the merged SHA in staging",
	awaiting_deploy_approval: "Waiting for production deployment approval",
	deploying: "QM is validating the approved deployment intent",
	deployment_pending: "The trusted deployment is queued or being reconciled",
	verifying_production: "QM is verifying the deployed production SHA",
	response_drafting: "QM is drafting a customer-safe response",
	awaiting_response_approval: "Waiting for customer response approval",
	response_publish_pending:
		"The approved customer response is queued or being reconciled",
	responded: "The approved customer response was published",
	closed: "The verified workflow is complete",
	failed_retryable: "A stage failed and can be retried",
	needs_human: "The workflow needs human intervention",
	blocked: "The workflow is blocked",
	cancelled: "The workflow was cancelled",
	stale: "The issue or candidate changed and approvals are stale",
};

function workflowStatus(
	state: WorkflowState,
	hasActiveStage: boolean,
): StaffActivityStatus {
	if (hasActiveStage) return "running";
	if (["deployment_pending", "response_publish_pending"].includes(state)) {
		return "running";
	}
	if (
		[
			"awaiting_plan_approval",
			"awaiting_human_review",
			"awaiting_deploy_approval",
			"awaiting_response_approval",
		].includes(state)
	) {
		return "awaiting_approval";
	}
	if (["closed", "responded", "shadow_complete"].includes(state)) {
		return "completed";
	}
	if (state === "failed_retryable") return "failed";
	if (state === "needs_human") return "needs_human";
	if (
		["blocked", "security_escalation", "restricted_proposal_only"].includes(
			state,
		)
	) {
		return "blocked";
	}
	if (state === "cancelled") return "cancelled";
	if (state === "stale") return "stale";
	return "pending";
}

function actionMeta(action: WorkflowAction) {
	const meta: Record<
		WorkflowAction,
		{
			label: string;
			description: string;
			variant: "default" | "outline" | "secondary" | "destructive";
		}
	> = {
		run_next: {
			label: "Run next stage",
			description: "Run the next server-authorised workflow stage.",
			variant: "default",
		},
		approve_plan: {
			label: "Approve plan",
			description:
				"Authorise implementation of this exact plan and issue snapshot.",
			variant: "default",
		},
		revise_plan: {
			label: "Revise plan",
			description: "Return the plan to investigation with human feedback.",
			variant: "outline",
		},
		request_changes: {
			label: "Request changes",
			description:
				"Return the candidate to implementation with human feedback.",
			variant: "outline",
		},
		record_merge: {
			label: "Record merge",
			description: "Record the reviewed merge SHA before staging verification.",
			variant: "default",
		},
		approve_deploy: {
			label: "Approve deployment",
			description: "Authorise deployment of the exact verified SHA.",
			variant: "default",
		},
		approve_response: {
			label: "Publish response",
			description:
				"Publish the reviewed customer response and close the workflow.",
			variant: "default",
		},
		retry: {
			label: "Retry stage",
			description: "Retry from the last safe workflow boundary.",
			variant: "secondary",
		},
		cancel: {
			label: "Cancel workflow",
			description: "Stop this support automation workflow.",
			variant: "destructive",
		},
	};
	return meta[action];
}

function artifactDetails(artifact: AgentArtifact | undefined) {
	if (!artifact) return [];
	const details: Array<{ label?: string; value: string }> = [];
	if (artifact.details)
		details.push({ label: "Details", value: artifact.details });
	if (artifact.changedPaths.length > 0) {
		details.push({
			label: "Changed paths",
			value: artifact.changedPaths.join(", "),
		});
	}
	if (artifact.tests.length > 0) {
		details.push({
			label: "Tests",
			value: artifact.tests
				.map((test) => `${test.command}: ${test.status} — ${test.summary}`)
				.join("\n"),
		});
	}
	if (artifact.restrictedChanges.length > 0) {
		details.push({
			label: "Restricted proposals",
			value: artifact.restrictedChanges
				.map((change) =>
					[change.category, change.path, change.reason, change.proposal]
						.filter(Boolean)
						.join(" · "),
				)
				.join("\n"),
		});
	}
	return details;
}

/** Produces the only workflow shape intended for a staff browser. */
export function createStaffWorkflowPanelView(
	workspace: StaffWorkflowWorkspace,
): StaffWorkflowPanelView {
	const artifacts = new Map(
		workspace.artifacts.map((artifact) => [artifact.artifactId, artifact]),
	);
	const workflowLinks = workspace.artifacts
		.flatMap((artifact) => artifact.links)
		.filter(
			(link, index, links) =>
				links.findIndex((candidate) => candidate.url === link.url) === index,
		)
		.map((link) => ({ label: link.label, href: link.url }));

	return {
		workflowId: workspace.workflow.id,
		expectedVersion: workspace.workflow.version,
		confirmationContext: {
			workflowId: workspace.workflow.id,
			expectedVersion: workspace.workflow.version,
			target:
				workspace.workflow.deployedSha ??
				workspace.workflow.headSha ??
				workspace.workflow.baseSha ??
				workspace.workflow.lastArtifactId,
			destination:
				workspace.workflow.state === "awaiting_deploy_approval"
					? workspace.workflow.route.productionEnvironment
					: workspace.workflow.state === "awaiting_response_approval"
						? `${workspace.workflow.issue.supportRepository}#${workspace.workflow.issue.issueNumber}`
						: undefined,
		},
		workflow: {
			title: `Agent activity for issue #${workspace.workflow.issue.issueNumber}`,
			summary: `${stateSummary[workspace.workflow.state]} · ${workspace.workflow.route.targetRepository}`,
			status: workflowStatus(
				workspace.workflow.state,
				Boolean(workspace.workflow.activeLease),
			),
			activeStage: workspace.workflow.activeStage,
			risk: workspace.workflow.risk,
			updatedAt: workspace.workflow.updatedAt,
			links: workflowLinks,
		},
		items: workspace.activities.map((activity) => {
			const artifact = activity.artifactId
				? artifacts.get(activity.artifactId)
				: undefined;
			return {
				id: activity.id,
				title: activity.title,
				summary: activity.summary,
				stage: activity.stage,
				status: activity.status,
				visibility: activity.visibility,
				occurredAt: activity.createdAt,
				details: artifactDetails(artifact),
				links: activity.links.map((link) => ({
					label: link.label,
					href: link.url,
				})),
			};
		}),
		availableActions: workspace.availableActions.map((action) => ({
			id: action,
			...actionMeta(action),
		})),
	};
}
