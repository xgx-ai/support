import { describe, expect, test } from "bun:test";
import {
	type AutomationMode,
	SUPPORT_WORKFLOW_VERSION,
	type WorkflowRecord,
} from "./contracts";
import {
	assertTransition,
	availableWorkflowActions,
	canTransition,
	stageForState,
} from "./state-machine";

const workflow = (
	state: WorkflowRecord["state"],
	automationMode: AutomationMode = "full",
): WorkflowRecord => ({
	workflowVersion: SUPPORT_WORKFLOW_VERSION,
	id: "support:example/support#42",
	version: 3,
	state,
	issue: {
		supportRepository: "example/support",
		issueNumber: 42,
		title: "Export fails",
		body: "Steps",
		labels: [],
		triggerType: "issue.opened",
		updatedAt: "2026-08-05T09:00:00.000Z",
	},
	issueSnapshotHash: "snapshot",
	route: {
		id: "product",
		targetRepository: "example/product",
		baseBranch: "main",
		qmScope: "team:support",
		automationMode,
		allowedPaths: ["src/**"],
		forbiddenPaths: [],
		testCommands: ["bun test"],
	},
	risk: "r1",
	baseSha: "base",
	qcLoops: 0,
	stageAttempts: {},
	createdAt: "2026-08-05T09:00:00.000Z",
	updatedAt: "2026-08-05T09:00:00.000Z",
});

describe("support workflow state machine", () => {
	test("allows the guarded happy-path transitions", () => {
		expect(canTransition("received", "validating")).toBe(true);
		expect(canTransition("awaiting_plan_approval", "investigating")).toBe(true);
		expect(canTransition("awaiting_plan_approval", "implementing")).toBe(true);
		expect(canTransition("awaiting_deploy_approval", "deploying")).toBe(true);
		expect(
			canTransition("awaiting_response_approval", "response_publish_pending"),
		).toBe(true);
		expect(canTransition("response_publish_pending", "closed")).toBe(true);
	});

	test("rejects state-machine gate skips", () => {
		expect(canTransition("implementing", "merged")).toBe(false);
		expect(canTransition("qc_running", "deploying")).toBe(false);
		expect(() =>
			assertTransition("awaiting_human_review", "deploying"),
		).toThrow("Invalid support workflow transition");
		expect(canTransition("awaiting_plan_approval", "triaging")).toBe(false);
	});

	test("maps runnable states to one agent stage", () => {
		expect(stageForState("received")).toBe("validate");
		expect(stageForState("draft_pr_open")).toBe("qc");
		expect(stageForState("awaiting_plan_approval")).toBeNull();
	});

	test("exposes only server-authorised staff actions", () => {
		expect(
			availableWorkflowActions(workflow("awaiting_plan_approval")),
		).toEqual(["approve_plan", "revise_plan", "cancel"]);
		expect(
			availableWorkflowActions(workflow("awaiting_deploy_approval")),
		).toEqual(["approve_deploy", "cancel"]);
		expect(availableWorkflowActions(workflow("closed"))).toEqual([]);
	});

	test("enforces the configured rollout ceiling", () => {
		expect(
			availableWorkflowActions(workflow("investigating", "shadow")),
		).toEqual(["cancel"]);
		expect(
			availableWorkflowActions(workflow("awaiting_plan_approval", "plan")),
		).toEqual(["revise_plan", "cancel"]);
		expect(
			availableWorkflowActions(workflow("awaiting_plan_approval", "shadow")),
		).toEqual(["cancel"]);
		expect(
			availableWorkflowActions(workflow("awaiting_plan_approval", "code")),
		).toEqual(["approve_plan", "revise_plan", "cancel"]);
		expect(
			availableWorkflowActions(workflow("awaiting_human_review", "code")),
		).toEqual(["request_changes", "cancel"]);
		expect(
			availableWorkflowActions(
				workflow("awaiting_response_approval", "release"),
			),
		).toEqual(["cancel"]);
	});
});
