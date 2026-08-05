import type {
	AgentActivityAction,
	AgentActivityConfirmationContext,
	AgentActivityItem,
	AgentWorkflowSummary,
} from "../../../packages/support-ui/src/components/agent-activity-panel.types.ts";
import type { StaffWorkflowPanelView } from "../../../packages/support-workflow/src/staff-view.ts";

type DemoActivity = Omit<AgentActivityItem, "stage"> & {
	stage: StaffWorkflowPanelView["items"][number]["stage"];
};
type DemoWorkflow = Omit<AgentWorkflowSummary, "activeStage"> & {
	activeStage?: StaffWorkflowPanelView["workflow"]["activeStage"];
};
type DemoAction = StaffWorkflowPanelView["availableActions"][number] &
	Pick<AgentActivityAction, "disabled">;

export interface WorkflowDemoScenario {
	id: string;
	label: string;
	description: string;
	workflow: DemoWorkflow;
	items: DemoActivity[];
	actions: DemoAction[];
	confirmationContext: AgentActivityConfirmationContext;
}

const intakeActivity: DemoActivity[] = [
	{
		id: "intake-created",
		title: "Internal workflow created",
		summary:
			"Support issue #4821 was mirrored into the private workflow store. No agent output was written back to the customer-visible GitHub issue.",
		stage: "intake",
		status: "completed",
		visibility: "internal",
		occurredAt: "2026-08-05T08:04:00.000Z",
		details: [
			{ label: "Source", value: "GitHub support issue #4821" },
			{ label: "Internal run", value: "agent-run-01K1WZ8F8VM2" },
		],
	},
	{
		id: "policy-completed",
		title: "Repository policy applied",
		summary:
			"The run is limited to the existing support architecture. Database migrations, dependency changes, and deployment are blocked unless a human explicitly approves a proposal.",
		stage: "policy",
		status: "completed",
		visibility: "internal",
		occurredAt: "2026-08-05T08:05:00.000Z",
		details: [
			{ label: "Default risk", value: "R2 · elevated" },
			{
				label: "Protected changes",
				value: "Database schema, packages, secrets, CI, and production",
			},
		],
	},
	{
		id: "validation-completed",
		title: "Issue validated",
		summary:
			"The validation agent reproduced the missing priority badge and attached concise evidence for staff review.",
		stage: "validate",
		status: "completed",
		visibility: "internal",
		occurredAt: "2026-08-05T08:08:00.000Z",
		details: [
			{ label: "Confidence", value: "High" },
			{ label: "Environment", value: "Local support UI fixture" },
		],
	},
];

const investigationActivity: DemoActivity = {
	id: "investigation-completed",
	title: "Root cause isolated",
	summary:
		"The triage agent traced the regression to priority-label normalisation and limited the suggested change to the existing support UI boundary.",
	stage: "investigate",
	status: "completed",
	visibility: "internal",
	occurredAt: "2026-08-05T08:13:00.000Z",
	details: [
		{
			label: "Candidate files",
			value: "packages/support-ui/src/lib/priority.ts and its focused test",
		},
		{ label: "Schema impact", value: "None" },
		{ label: "Dependency impact", value: "None" },
	],
};

export const workflowScenarios: WorkflowDemoScenario[] = [
	{
		id: "plan",
		label: "Plan approval",
		description:
			"A proposed code change is waiting for a staff member before implementation begins.",
		confirmationContext: {
			workflowId: "agent-workflow-4821",
			expectedVersion: 7,
			target: "plan-sha256:7ee4b83",
		},
		workflow: {
			title: "Issue #4821 · Priority badge missing",
			summary:
				"Agents have validated and triaged the report. The implementation plan is private and paused at the human approval gate.",
			status: "awaiting_approval",
			risk: "r2",
			updatedAt: "2026-08-05T08:17:00.000Z",
		},
		items: [
			...intakeActivity,
			investigationActivity,
			{
				id: "plan-awaiting-approval",
				title: "Code change proposed",
				summary:
					"Normalise priority label casing at the existing parsing boundary and add regression coverage. No customer comment will be created by this action.",
				stage: "human_review",
				status: "awaiting_approval",
				visibility: "internal",
				occurredAt: "2026-08-05T08:17:00.000Z",
				details: [
					{ label: "Scope", value: "2 existing files" },
					{ label: "Estimated diff", value: "+18 / -4 lines" },
					{
						label: "Guardrail",
						value: "No database, package, API contract, or deployment change",
					},
				],
				links: [
					{
						label: "Review suggested diff",
						href: "https://example.invalid/suggested-diff",
					},
				],
			},
		],
		actions: [
			{
				id: "approve_plan",
				label: "Approve plan",
				description:
					"Allows implementation in an isolated candidate workspace.",
				variant: "default",
			},
			{
				id: "revise_plan",
				label: "Request changes",
				description: "Returns private feedback to the planning agent.",
				variant: "outline",
			},
		],
	},
	{
		id: "qc",
		label: "QC failure",
		description:
			"Implementation remains private after an automated check finds a regression.",
		confirmationContext: {
			workflowId: "agent-workflow-4821",
			expectedVersion: 11,
			target: "commit 82b1f7c",
		},
		workflow: {
			title: "Issue #4821 · Priority badge missing",
			summary:
				"An approved patch was produced in an isolated candidate workspace, but QC has blocked it before human review.",
			status: "failed",
			risk: "r2",
			updatedAt: "2026-08-05T08:31:00.000Z",
		},
		items: [
			...intakeActivity,
			investigationActivity,
			{
				id: "implementation-completed",
				title: "Patch prepared",
				summary:
					"The implementation agent changed only the approved files in an isolated candidate workspace. Nothing was deployed or posted to GitHub.",
				stage: "implement",
				status: "completed",
				visibility: "internal",
				occurredAt: "2026-08-05T08:26:00.000Z",
				details: [
					{ label: "Branch", value: "support/agent-4821-priority-label" },
					{ label: "Diff", value: "+17 / -4 lines across 2 files" },
				],
			},
			{
				id: "qc-failed",
				title: "Regression test failed",
				summary:
					"The QC agent found that labels containing leading whitespace still bypass normalisation. The patch cannot advance to human review.",
				stage: "qc",
				status: "failed",
				visibility: "internal",
				occurredAt: "2026-08-05T08:31:00.000Z",
				details: [
					{
						label: "Failed check",
						value: "priority.test.ts · trims label names",
					},
					{
						label: "Passed checks",
						value: "Typecheck, lint, and 46 other tests",
					},
				],
				links: [
					{
						label: "Open test evidence",
						href: "https://example.invalid/test-evidence",
					},
				],
			},
		],
		actions: [
			{
				id: "retry",
				label: "Retry stage",
				description:
					"Lets the implementation agent address only this QC finding.",
				variant: "secondary",
			},
			{
				id: "cancel",
				label: "Cancel workflow",
				description: "Stops agent work and preserves the evidence for staff.",
				variant: "destructive",
			},
		],
	},
	{
		id: "restricted",
		label: "Restricted proposal",
		description:
			"A database or dependency requirement is documented, but never applied autonomously.",
		confirmationContext: {
			workflowId: "agent-workflow-4870",
			expectedVersion: 4,
			target: "proposal-sha256:1db21f0",
		},
		workflow: {
			title: "Issue #4870 · Search results are stale",
			summary:
				"The agent found that the requested fix would require a protected database change, so the run is stopped as an R3 proposal.",
			status: "needs_human",
			risk: "r3",
			updatedAt: "2026-08-05T09:12:00.000Z",
		},
		items: [
			{
				...intakeActivity[0],
				id: "restricted-intake",
				summary:
					"Support issue #4870 was mirrored into the private workflow store. No agent output was written back to the customer-visible GitHub issue.",
				occurredAt: "2026-08-05T08:52:00.000Z",
				details: [
					{ label: "Source", value: "GitHub support issue #4870" },
					{ label: "Internal run", value: "agent-run-01K1X2YJ0YKW" },
				],
			},
			{
				id: "restricted-policy",
				title: "Protected change detected",
				summary:
					"The policy gate classified the proposed index migration and search dependency upgrade as R3. Autonomous implementation is prohibited.",
				stage: "policy",
				status: "needs_human",
				visibility: "internal",
				occurredAt: "2026-08-05T09:07:00.000Z",
				details: [
					{
						label: "Database proposal",
						value: "Add a concurrent search index",
					},
					{
						label: "Package proposal",
						value: "Evaluate search client upgrade",
					},
					{ label: "Applied changes", value: "None" },
				],
			},
			{
				id: "restricted-review",
				title: "Architecture proposal ready",
				summary:
					"Impact, rollback, migration order, and alternatives are recorded for staff. A new approved work item is required before any change can begin.",
				stage: "human_review",
				status: "awaiting_approval",
				visibility: "internal",
				occurredAt: "2026-08-05T09:12:00.000Z",
				links: [
					{
						label: "Review architecture proposal",
						href: "https://example.invalid/architecture-proposal",
					},
				],
			},
		],
		actions: [
			{
				id: "cancel",
				label: "Reject scope expansion",
				description:
					"Closes the internal proposal without changing the product.",
				variant: "destructive",
			},
		],
	},
	{
		id: "deploy",
		label: "Deploy verification",
		description:
			"A reviewed change has passed staging and is waiting for a separate deploy decision.",
		confirmationContext: {
			workflowId: "agent-workflow-4821",
			expectedVersion: 16,
			target: "commit 82b1f7c",
			destination: "production",
		},
		workflow: {
			title: "Issue #4821 · Priority badge missing",
			summary:
				"Human review and staging verification passed. Production deployment remains a distinct staff-authorised action.",
			status: "awaiting_approval",
			risk: "r2",
			updatedAt: "2026-08-05T10:06:00.000Z",
		},
		items: [
			...intakeActivity,
			investigationActivity,
			{
				id: "human-review-completed",
				title: "Patch approved by staff",
				summary:
					"A support engineer reviewed the final diff, test evidence, and repository-policy report.",
				stage: "human_review",
				status: "completed",
				visibility: "internal",
				occurredAt: "2026-08-05T09:46:00.000Z",
				details: [{ label: "Reviewer", value: "A. Engineer" }],
			},
			{
				id: "staging-verified",
				title: "Staging checks passed",
				summary:
					"The priority badge was verified in the issue list and detail views; smoke tests and rollback readiness also passed.",
				stage: "verify_staging",
				status: "succeeded",
				visibility: "internal",
				occurredAt: "2026-08-05T10:03:00.000Z",
				details: [
					{ label: "Checks", value: "6 / 6 passed" },
					{ label: "Rollback", value: "Previous artefact available" },
				],
			},
			{
				id: "deploy-awaiting-approval",
				title: "Production deploy waiting",
				summary:
					"The deploy agent has prepared a release plan but cannot publish it without fresh staff authorisation.",
				stage: "deploy",
				status: "awaiting_approval",
				visibility: "internal",
				occurredAt: "2026-08-05T10:06:00.000Z",
			},
		],
		actions: [
			{
				id: "approve_deploy",
				label: "Approve deployment",
				description: "Authorises this reviewed artefact and environment only.",
				variant: "default",
			},
			{
				id: "cancel",
				label: "Cancel deployment",
				description: "Stops the release while preserving its evidence.",
				variant: "destructive",
			},
		],
	},
	{
		id: "response",
		label: "Response draft",
		description:
			"A verified fix has a customer-safe draft, but publishing remains a human action.",
		confirmationContext: {
			workflowId: "agent-workflow-4821",
			expectedVersion: 20,
			target: "response-sha256:3cc9c8a",
			destination: "customer issue #4821",
		},
		workflow: {
			title: "Issue #4821 · Priority badge missing",
			summary:
				"Production verification passed. The response agent has prepared a concise public draft without internal reasoning or code details.",
			status: "awaiting_approval",
			risk: "r2",
			updatedAt: "2026-08-05T10:42:00.000Z",
		},
		items: [
			...intakeActivity,
			{
				id: "production-verified",
				title: "Production behaviour verified",
				summary:
					"The deployed version shows the expected priority badge and monitoring has remained healthy through the observation window.",
				stage: "verify_production",
				status: "succeeded",
				visibility: "internal",
				occurredAt: "2026-08-05T10:37:00.000Z",
				details: [
					{ label: "Observation window", value: "15 minutes" },
					{ label: "Customer data check", value: "No unexpected change" },
				],
			},
			{
				id: "response-awaiting-approval",
				title: "Customer response drafted",
				summary:
					"Draft: We have fixed the missing priority badge and verified it in production. Thanks for reporting this — please let us know if it still looks incorrect.",
				stage: "respond",
				status: "awaiting_approval",
				visibility: "public_candidate",
				occurredAt: "2026-08-05T10:42:00.000Z",
				details: [
					{ label: "Published", value: "No" },
					{
						label: "Internal details removed",
						value: "Run IDs, branch, diff, and tests",
					},
				],
			},
		],
		actions: [
			{
				id: "approve_response",
				label: "Approve and publish",
				description:
					"Publishes only the reviewed public draft to the customer issue.",
				variant: "default",
			},
			{
				id: "request_changes",
				label: "Edit draft",
				description: "Keeps the response private while staff amend it.",
				variant: "outline",
			},
		],
	},
];
