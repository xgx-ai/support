export type AgentActivityVisibility =
	| "internal"
	| "public_candidate"
	| "public";

export type AgentActivityStage =
	| "intake"
	| "policy"
	| "validate"
	| "triage"
	| "investigate"
	| "implement"
	| "qc"
	| "human_review"
	| "verify_staging"
	| "deploy"
	| "verify_production"
	| "respond";

export type AgentActivityStatus =
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

export type AgentRiskLevel = "r0" | "r1" | "r2" | "r3";

export interface AgentActivityLink {
	label: string;
	href: string;
}

export function getSafeAgentActivityHref(href: string): string | undefined {
	try {
		const url = new URL(href);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: undefined;
	} catch {
		return undefined;
	}
}

export interface AgentActivityDetail {
	label?: string;
	value: string;
}

export interface AgentActivityItem {
	id: string;
	title: string;
	summary: string;
	stage: AgentActivityStage;
	status: AgentActivityStatus;
	visibility: AgentActivityVisibility;
	occurredAt: string;
	details?: AgentActivityDetail[];
	links?: AgentActivityLink[];
}

export interface AgentWorkflowSummary {
	title?: string;
	summary: string;
	status: AgentActivityStatus;
	activeStage?: AgentActivityStage;
	risk?: AgentRiskLevel;
	updatedAt?: string;
	links?: AgentActivityLink[];
}

export interface AgentActivityAction {
	id:
		| "run_next"
		| "approve_plan"
		| "revise_plan"
		| "request_changes"
		| "record_merge"
		| "approve_deploy"
		| "approve_response"
		| "retry"
		| "cancel";
	label: string;
	description?: string;
	variant?: "default" | "outline" | "secondary" | "destructive";
	disabled?: boolean;
}

export function requiresAgentActivityConfirmation(
	actionId: AgentActivityAction["id"],
): boolean {
	return ["approve_deploy", "approve_response", "cancel"].includes(actionId);
}

export interface AgentActivityConfirmationContext {
	/** Stable server workflow identifier. */
	workflowId: string;
	/** Optimistic-concurrency version that the server must recheck. */
	expectedVersion: number;
	/** Optional immutable target, such as a commit SHA or response artifact hash. */
	target?: string;
	/** Optional deployment environment or publication destination. */
	destination?: string;
}

export interface AgentActivityPanelProps {
	/** Server-curated workflow summary. Raw model reasoning must not be supplied. */
	workflow: AgentWorkflowSummary;
	/** Ordered, server-curated activity shown only to authorised staff. */
	items: AgentActivityItem[];
	/** Actions the server currently permits for this staff member and workflow version. */
	availableActions?: AgentActivityAction[];
	/** Required before deploy, publish, or cancel actions can be confirmed. */
	confirmationContext?: AgentActivityConfirmationContext;
	/** Called with a server-provided action and the context shown during confirmation. */
	onAction?: (
		action: AgentActivityAction,
		confirmationContext?: AgentActivityConfirmationContext,
	) => void | Promise<void>;
	/** Optional date formatter. Defaults to an en-GB date and time. */
	formatDate?: (iso: string) => string;
}

export type AgentActivityBadgeVariant =
	| "default"
	| "primary"
	| "secondary"
	| "success"
	| "warning"
	| "error"
	| "danger"
	| "info";

export interface AgentActivityDisplayMeta {
	label: string;
	variant: AgentActivityBadgeVariant;
}

const statusMeta: Record<AgentActivityStatus, AgentActivityDisplayMeta> = {
	pending: { label: "Pending", variant: "secondary" },
	running: { label: "Running", variant: "info" },
	awaiting_approval: { label: "Awaiting approval", variant: "warning" },
	completed: { label: "Completed", variant: "success" },
	succeeded: { label: "Succeeded", variant: "success" },
	failed: { label: "Failed", variant: "error" },
	blocked: { label: "Blocked", variant: "danger" },
	needs_human: { label: "Needs human", variant: "warning" },
	cancelled: { label: "Cancelled", variant: "secondary" },
	stale: { label: "Stale", variant: "secondary" },
};

const visibilityMeta: Record<
	AgentActivityVisibility,
	AgentActivityDisplayMeta
> = {
	internal: { label: "Internal", variant: "default" },
	public_candidate: { label: "Public draft", variant: "warning" },
	public: { label: "Published", variant: "success" },
};

/** @internal Exported for focused display-contract tests. */
export function getAgentActivityStatusMeta(
	status: AgentActivityStatus,
): AgentActivityDisplayMeta {
	return statusMeta[status];
}

/** @internal Exported for focused display-contract tests. */
export function getAgentActivityVisibilityMeta(
	visibility: AgentActivityVisibility,
): AgentActivityDisplayMeta {
	return visibilityMeta[visibility];
}
