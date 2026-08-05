import { describe, expect, test } from "bun:test";
import { runWorkflowDemo } from "./demo-cli";

describe("local workflow demo", () => {
	test("exercises the complete guarded workflow without external side effects", async () => {
		const result = await runWorkflowDemo("happy");
		expect(result.finalState).toBe("closed");
		expect(result.approvals).toEqual(["plan", "merge", "deploy", "response"]);
		expect(result.deployments).toBe(1);
		expect(result.publicResponses).toBe(1);
	});

	test("demonstrates response-only, restricted, P0, QC, and stale routes", async () => {
		const results = await Promise.all([
			runWorkflowDemo("shadow"),
			runWorkflowDemo("answer"),
			runWorkflowDemo("restricted"),
			runWorkflowDemo("p0"),
			runWorkflowDemo("qc-fail"),
			runWorkflowDemo("stale"),
		]);
		expect(results.map((result) => result.finalState)).toEqual([
			"shadow_complete",
			"closed",
			"restricted_proposal_only",
			"security_escalation",
			"needs_human",
			"stale",
		]);
		expect(results.every((result) => result.publicActivities <= 1)).toBe(true);
	});
});
