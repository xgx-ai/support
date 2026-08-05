import type { WorkflowAction } from "../../packages/support-workflow/src/contracts.ts";
import type { StaffWorkflowPanelView } from "../../packages/support-workflow/src/staff-view.ts";

export type LocalTicketStatus =
	| "new"
	| "working"
	| "needs_review"
	| "blocked"
	| "resolved";

export type LocalTicketSource = "live" | "sample";

export interface LocalSupportAppSummary {
	id: string;
	name: string;
	description: string;
	targetRepository: string;
	ticketCount: number;
	needsReviewCount: number;
}

export interface LocalSupportTicketSummary {
	id: string;
	appId: string;
	issueNumber: number;
	title: string;
	report: string;
	submittedBy: string;
	priority: "p0" | "p1" | "p2" | "p3";
	labels: string[];
	updatedAt: string;
	status: LocalTicketStatus;
	risk?: "r0" | "r1" | "r2" | "r3";
	requiresReview: boolean;
	source: LocalTicketSource;
}

export interface LocalTicketDecision {
	action: WorkflowAction;
	label: string;
	note?: string;
	recordedAt: string;
}

export interface LocalSupportTicketDetail {
	app: LocalSupportAppSummary;
	ticket: LocalSupportTicketSummary;
	workflow: StaffWorkflowPanelView;
	decision?: LocalTicketDecision;
}

/** Body accepted by a ticket-scoped local inbox action endpoint. */
export interface LocalTicketActionInput {
	action: WorkflowAction;
	expectedVersion: number;
	note?: string;
}

/** Internal lab input after the app and issue route parameters are parsed. */
export interface LocalPerformTicketActionInput extends LocalTicketActionInput {
	appId: string;
	issueNumber: number;
}
