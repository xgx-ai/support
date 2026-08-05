import { describe, expect, test } from "bun:test";
import {
	agentArtifactSchema,
	assertStageDecision,
	httpUrlSchema,
	SUPPORT_WORKFLOW_VERSION,
	supportRouteSchema,
} from "./contracts";

const route = {
	id: "product",
	targetRepository: "example/product",
	baseBranch: "main",
	qmScope: "team:support",
	allowedPaths: ["src/**"],
	forbiddenPaths: [],
	testCommands: ["bun test"],
};

describe("support route contract", () => {
	test.each([
		"shadow",
		"plan",
		"code",
	] as const)("allows %s mode without deployment coordinates", (automationMode) => {
		expect(
			supportRouteSchema.safeParse({ ...route, automationMode }).success,
		).toBe(true);
	});

	test.each([
		"release",
		"full",
	] as const)("requires all deployment coordinates in %s mode", (automationMode) => {
		const result = supportRouteSchema.safeParse({ ...route, automationMode });
		expect(result.success).toBe(false);
		if (result.success) throw new Error("Expected route validation to fail");
		expect(result.error.issues.map((issue) => issue.path)).toEqual([
			["stagingEnvironment"],
			["productionEnvironment"],
			["deployAdapter"],
		]);
	});

	test.each([
		"release",
		"full",
	] as const)("accepts complete deployment coordinates in %s mode", (automationMode) => {
		expect(
			supportRouteSchema.safeParse({
				...route,
				automationMode,
				stagingEnvironment: "staging",
				productionEnvironment: "production",
				deployAdapter: "github-actions",
			}).success,
		).toBe(true);
	});
});

describe("agent artifact contract", () => {
	test("allows changes_requested only for QC", () => {
		expect(() => assertStageDecision("qc", "changes_requested")).not.toThrow();
		for (const stage of [
			"validate",
			"triage",
			"investigate",
			"implement",
			"verify_staging",
			"deploy",
			"verify_production",
			"respond",
		] as const) {
			expect(() => assertStageDecision(stage, "changes_requested")).toThrow();
		}
	});

	test("requires stage-specific evidence for passing artifacts", () => {
		const shared = {
			workflowVersion: SUPPORT_WORKFLOW_VERSION,
			artifactId: "artifact-1",
			workflowId: "workflow-1",
			issueSnapshotHash: "snapshot-1",
			runId: "run-1",
			stage: "verify_staging" as const,
			createdAt: "2026-08-05T09:00:00.000Z",
			visibility: "internal" as const,
			decision: "pass" as const,
			risk: "r1" as const,
			confidence: 0.9,
			title: "Verified",
			summary: "Verified staging",
			evidence: [],
			changedPaths: [],
			tests: [],
			restrictedChanges: [],
			links: [],
		};
		expect(agentArtifactSchema.safeParse(shared).success).toBe(false);
		expect(
			agentArtifactSchema.safeParse({ ...shared, headSha: "merged-sha" })
				.success,
		).toBe(true);
	});

	test("accepts only absolute HTTP(S) links", () => {
		expect(httpUrlSchema.safeParse("https://qm.example/run/1").success).toBe(
			true,
		);
		expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
		expect(httpUrlSchema.safeParse("data:text/html,unsafe").success).toBe(
			false,
		);
	});
});
