import { describe, expect, test } from "bun:test";
import type { AgentClient, AgentTurnRequest } from "./agent-client";
import {
	createAgentRuntime,
	parseAgentStageOutput,
	stageWorkspaceRequirement,
} from "./agent-runtime";
import { SUPPORT_WORKFLOW_VERSION, type WorkflowRecord } from "./contracts";
import type { AgentStageRequest } from "./ports";
import {
	createAgentMockRuntime,
	createManualClock,
	createSequentialIdGenerator,
} from "./testing";

const workflow: WorkflowRecord = {
	workflowVersion: SUPPORT_WORKFLOW_VERSION,
	id: "support:example/support#42",
	version: 2,
	state: "validating",
	issue: {
		supportRepository: "example/support",
		issueNumber: 42,
		title: "Export fails",
		body: "Export returns a 500.",
		labels: ["p2"],
		triggerType: "issue.opened",
		updatedAt: "2026-08-05T09:00:00.000Z",
	},
	issueSnapshotHash: "snapshot-hash",
	route: {
		id: "product",
		targetRepository: "example/product",
		baseBranch: "main",
		agentScope: "team:support",
		automationMode: "full",
		allowedPaths: ["src/**"],
		forbiddenPaths: [],
		executionProfile: {
			kind: "nix-dev-shell",
			profileId: "product-v1",
			flakeSubdir: ".",
			workspaceSubdir: ".",
			devShell: "support",
			timeoutMs: 300_000,
			checks: [
				{
					id: "tests",
					label: "Unit tests",
					argv: ["bun", "test"],
				},
			],
		},
		stagingEnvironment: "staging",
		productionEnvironment: "production",
		deployAdapter: "github-actions",
	},
	risk: "r1",
	baseSha: "base-sha",
	activeStage: "validate",
	activeLease: {
		id: "lease-1",
		kind: "agent_stage",
		idempotencyKey: "stage-key",
		attempt: 1,
		acquiredAt: "2026-08-05T09:00:00.000Z",
		expiresAt: "2026-08-05T09:05:00.000Z",
	},
	qcLoops: 0,
	stageAttempts: { validate: 1 },
	createdAt: "2026-08-05T09:00:00.000Z",
	updatedAt: "2026-08-05T09:00:00.000Z",
};

function output(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		decision: "pass",
		risk: "r1",
		confidence: 0.9,
		title: "Complete",
		summary: "Stage complete",
		evidence: [],
		changedPaths: [],
		tests: [],
		restrictedChanges: [],
		links: [],
		...overrides,
	});
}

function request(
	overrides: Partial<AgentStageRequest> = {},
): AgentStageRequest {
	return {
		workflow,
		stage: "validate",
		attempt: 1,
		idempotencyKey: "stage-key",
		previousArtifacts: [],
		reviewFeedback: [],
		readOnly: true,
		capabilities: ["issue_read"],
		...overrides,
	};
}

function recordingClient(reply: string) {
	const turns: AgentTurnRequest[] = [];
	const client = {
		async runTurn(turn: AgentTurnRequest) {
			turns.push(turn);
			return { runId: "agent-run-1", reply };
		},
	} as unknown as AgentClient;
	return { client, turns };
}

describe("support agent runtime", () => {
	test("uses stage-specific optional sandbox policy", () => {
		expect(stageWorkspaceRequirement).toEqual({
			validate: "none",
			triage: "none",
			investigate: "optional_read_only",
			implement: "required_candidate",
			qc: "required_read_only",
			verify_staging: "none",
			deploy: "none",
			verify_production: "none",
			respond: "none",
		});
	});

	test("requires fail-closed screening and technical read-only mode", async () => {
		const recorded = recordingClient(output());
		const runtime = createAgentRuntime({
			client: recorded.client,
			clock: createManualClock().clock,
			ids: createSequentialIdGenerator(),
		});
		await runtime.execute(request());
		expect(recorded.turns).toHaveLength(1);
		expect(recorded.turns[0]?.readOnly).toBe(true);
		expect(recorded.turns[0]?.workspace).toBeUndefined();
		expect(recorded.turns[0]?.requireSecurityScreen).toBe(true);
		expect(recorded.turns[0]?.origin.screenData).toContain("Export fails");
	});

	test("allows investigation without a repository workspace", async () => {
		const recorded = recordingClient(
			output({
				decision: "needs_info",
				summary: "Repository context is not attached.",
			}),
		);
		const runtime = createAgentRuntime({
			client: recorded.client,
			clock: createManualClock().clock,
			ids: createSequentialIdGenerator(),
		});
		await runtime.execute(
			request({
				stage: "investigate",
				workflow: { ...workflow, state: "investigating" },
			}),
		);
		expect(recorded.turns[0]?.workspace).toBeUndefined();
		expect(recorded.turns[0]?.text).toContain(
			'"workspaceRequirement":"optional_read_only"',
		);
	});

	test("rejects workspaces for reasoning-only stages and requires them for QC", async () => {
		const recorded = recordingClient(output());
		const runtime = createAgentRuntime({
			client: recorded.client,
			clock: createManualClock().clock,
			ids: createSequentialIdGenerator(),
		});
		await expect(
			runtime.execute(
				request({
					workspace: {
						id: "unexpected",
						targetRepository: "example/product",
						revision: "base-sha",
						access: "read_only",
						workspaceRef: "/workspace/unexpected",
					},
				}),
			),
		).rejects.toThrow("does not accept an external repository workspace");
		await expect(
			runtime.execute(
				request({
					stage: "qc",
					workflow: { ...workflow, state: "qc_running" },
				}),
			),
		).rejects.toThrow("requires its stage-specific isolated workspace");
		expect(recorded.turns).toHaveLength(0);
	});

	test("runs deterministic local artifacts through the signed agent mock boundary", async () => {
		const turns: AgentTurnRequest[] = [];
		const client = {
			async runTurn(turn: AgentTurnRequest) {
				turns.push(turn);
				return {
					runId: "agent-dev-run-1",
					reply: turn.text.slice("!json ".length),
				};
			},
		} as unknown as AgentClient;
		const runtime = createAgentMockRuntime({
			client,
			clock: createManualClock().clock,
			ids: createSequentialIdGenerator(),
		});
		const artifact = await runtime.execute(
			request({
				stage: "triage",
				workflow: { ...workflow, state: "triaging" },
			}),
		);

		expect(turns[0]?.text.startsWith("!json {")).toBe(true);
		expect(turns[0]?.requireSecurityScreen).toBe(true);
		expect(turns[0]?.origin.screenData).toContain("Export fails");
		expect(artifact.stage).toBe("triage");
		expect(artifact.triageRoute).toBe("code");
		expect(artifact.runId).toBe("agent-dev-run-1");
	});

	test("keeps writable implementation disabled until explicitly configured", async () => {
		const recorded = recordingClient(
			output({ baseSha: "base-sha", headSha: "candidate-sha" }),
		);
		const runtime = createAgentRuntime({
			client: recorded.client,
			clock: createManualClock().clock,
			ids: createSequentialIdGenerator(),
		});
		const implementation = request({
			workflow: {
				...workflow,
				state: "implementing",
				activeStage: "implement",
			},
			stage: "implement",
			readOnly: false,
			capabilities: ["issue_read", "candidate_write"],
			workspace: {
				id: "workspace-1",
				targetRepository: "example/product",
				revision: "base-sha",
				access: "candidate_write",
				workspaceRef: "/workspace/candidate",
			},
		});
		await expect(runtime.execute(implementation)).rejects.toThrow(
			"Writable agent stage implement is disabled",
		);
		expect(recorded.turns).toHaveLength(0);

		const enabled = createAgentRuntime({
			client: recorded.client,
			clock: createManualClock().clock,
			ids: createSequentialIdGenerator(),
			writableStages: ["implement"],
		});
		await enabled.execute(implementation);
		expect(recorded.turns[0]?.readOnly).toBe(false);
		expect(recorded.turns[0]?.workspace).toEqual({
			path: "/workspace/candidate",
			access: "candidate_write",
		});
	});

	test("rejects a decision that is invalid for the requested stage", () => {
		expect(() =>
			parseAgentStageOutput(
				output({ decision: "changes_requested" }),
				"verify_staging",
			),
		).toThrow();
	});
});
