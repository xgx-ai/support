import type {
	AgentStage,
	AutomationMode,
	WorkflowAction,
	WorkflowRecord,
	WorkflowState,
} from "./contracts";

const transitions: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
	received: ["validating", "cancelled"],
	validating: [
		"needs_info",
		"security_escalation",
		"triaging",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	needs_info: ["validating", "stale", "cancelled"],
	security_escalation: ["cancelled"],
	triaging: [
		"needs_info",
		"shadow_complete",
		"investigating",
		"response_drafting",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	shadow_complete: [],
	investigating: [
		"needs_info",
		"plan_ready",
		"restricted_proposal_only",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	plan_ready: [
		"restricted_proposal_only",
		"awaiting_plan_approval",
		"needs_human",
		"cancelled",
	],
	restricted_proposal_only: ["cancelled"],
	awaiting_plan_approval: [
		"investigating",
		"implementing",
		"stale",
		"cancelled",
	],
	implementing: [
		"draft_pr_open",
		"restricted_proposal_only",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	draft_pr_open: ["qc_running", "stale", "cancelled"],
	qc_running: [
		"changes_requested",
		"awaiting_human_review",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"stale",
		"cancelled",
	],
	changes_requested: ["implementing", "needs_human", "cancelled"],
	awaiting_human_review: ["merged", "changes_requested", "stale", "cancelled"],
	merged: ["verifying_staging", "failed_retryable", "cancelled"],
	verifying_staging: [
		"awaiting_deploy_approval",
		"restricted_proposal_only",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	awaiting_deploy_approval: ["deploying", "stale", "cancelled"],
	deploying: [
		"deployment_pending",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	deployment_pending: [
		"verifying_production",
		"failed_retryable",
		"needs_human",
		"stale",
		"cancelled",
	],
	verifying_production: [
		"response_drafting",
		"restricted_proposal_only",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	response_drafting: [
		"awaiting_response_approval",
		"security_escalation",
		"failed_retryable",
		"needs_human",
		"cancelled",
	],
	awaiting_response_approval: [
		"response_publish_pending",
		"stale",
		"cancelled",
	],
	response_publish_pending: [
		"closed",
		"failed_retryable",
		"needs_human",
		"stale",
		"cancelled",
	],
	responded: ["closed", "needs_human"],
	closed: [],
	failed_retryable: [
		"received",
		"validating",
		"triaging",
		"investigating",
		"implementing",
		"qc_running",
		"verifying_staging",
		"deploying",
		"deployment_pending",
		"verifying_production",
		"response_drafting",
		"response_publish_pending",
		"cancelled",
	],
	needs_human: [
		"received",
		"validating",
		"triaging",
		"investigating",
		"implementing",
		"qc_running",
		"verifying_staging",
		"deploying",
		"deployment_pending",
		"verifying_production",
		"response_drafting",
		"response_publish_pending",
		"cancelled",
	],
	blocked: ["received", "cancelled"],
	cancelled: [],
	stale: ["received", "cancelled"],
};

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
	return transitions[from].includes(to);
}

export function assertTransition(from: WorkflowState, to: WorkflowState): void {
	if (!canTransition(from, to)) {
		throw new Error(`Invalid support workflow transition: ${from} -> ${to}`);
	}
}

export function stageForState(state: WorkflowState): AgentStage | null {
	switch (state) {
		case "received":
		case "validating":
			return "validate";
		case "triaging":
			return "triage";
		case "investigating":
			return "investigate";
		case "implementing":
			return "implement";
		case "draft_pr_open":
		case "qc_running":
			return "qc";
		case "merged":
		case "verifying_staging":
			return "verify_staging";
		case "deploying":
			return "deploy";
		case "verifying_production":
			return "verify_production";
		case "response_drafting":
			return "respond";
		default:
			return null;
	}
}

export function runningStateForStage(
	stage: AgentStage,
	current: WorkflowState,
): WorkflowState {
	switch (stage) {
		case "validate":
			return "validating";
		case "triage":
			return "triaging";
		case "investigate":
			return "investigating";
		case "implement":
			return "implementing";
		case "qc":
			return "qc_running";
		case "verify_staging":
			return "verifying_staging";
		case "deploy":
			return "deploying";
		case "verify_production":
			return "verifying_production";
		case "respond":
			return "response_drafting";
		default:
			return current;
	}
}

const runnableStates = new Set<WorkflowState>([
	"received",
	"validating",
	"triaging",
	"investigating",
	"plan_ready",
	"implementing",
	"draft_pr_open",
	"qc_running",
	"merged",
	"verifying_staging",
	"deploying",
	"deployment_pending",
	"verifying_production",
	"response_drafting",
	"response_publish_pending",
]);

const automationRank: Record<AutomationMode, number> = {
	shadow: 0,
	plan: 1,
	code: 2,
	release: 3,
	full: 4,
};

function allowsMode(
	workflow: WorkflowRecord,
	minimum: AutomationMode,
): boolean {
	return (
		automationRank[workflow.route.automationMode] >= automationRank[minimum]
	);
}

function canRunState(workflow: WorkflowRecord): boolean {
	if (workflow.state === "deployment_pending") {
		return allowsMode(workflow, "release");
	}
	if (workflow.state === "response_publish_pending") {
		return allowsMode(workflow, "full");
	}
	const stage = stageForState(workflow.state);
	if (!stage)
		return workflow.state === "plan_ready" && allowsMode(workflow, "plan");
	if (["validate", "triage"].includes(stage)) return true;
	if (stage === "investigate") return allowsMode(workflow, "plan");
	if (["implement", "qc"].includes(stage)) return allowsMode(workflow, "code");
	return allowsMode(workflow, "release");
}

export function availableWorkflowActions(
	workflow: WorkflowRecord,
): WorkflowAction[] {
	if (workflow.activeLease) return ["run_next", "cancel"];

	const actions: WorkflowAction[] = [];
	if (runnableStates.has(workflow.state) && canRunState(workflow)) {
		actions.push("run_next");
	}

	switch (workflow.state) {
		case "awaiting_plan_approval":
			if (allowsMode(workflow, "code")) actions.push("approve_plan");
			if (allowsMode(workflow, "plan")) actions.push("revise_plan");
			break;
		case "changes_requested":
			actions.push("run_next");
			break;
		case "awaiting_human_review":
			if (allowsMode(workflow, "release")) actions.push("record_merge");
			actions.push("request_changes");
			break;
		case "awaiting_deploy_approval":
			if (allowsMode(workflow, "release")) actions.push("approve_deploy");
			break;
		case "awaiting_response_approval":
			if (allowsMode(workflow, "full")) actions.push("approve_response");
			break;
		case "failed_retryable":
		case "needs_human":
		case "blocked":
		case "stale":
			actions.push("retry");
			break;
	}

	if (!["closed", "cancelled", "shadow_complete"].includes(workflow.state)) {
		actions.push("cancel");
	}
	return [...new Set(actions)];
}

export const terminalWorkflowStates = new Set<WorkflowState>([
	"closed",
	"cancelled",
	"shadow_complete",
	"security_escalation",
	"restricted_proposal_only",
]);
