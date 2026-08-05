import { describe, expect, test } from "bun:test";
import { createLocalWorkflowLab } from "./lab.ts";

describe("Bun local workflow lab", () => {
	test("moves through every human gate without external side effects", async () => {
		const lab = createLocalWorkflowLab({ mode: "scripted" });
		let view = await lab.reset("happy");
		expect(view.availableActions.map((action) => action.id)).toContain(
			"approve_plan",
		);

		view = await lab.performAction({
			action: "approve_plan",
			expectedVersion: view.expectedVersion,
		});
		expect(view.availableActions.map((action) => action.id)).toContain(
			"record_merge",
		);

		view = await lab.performAction({
			action: "record_merge",
			expectedVersion: view.expectedVersion,
		});
		expect(view.availableActions.map((action) => action.id)).toContain(
			"approve_deploy",
		);

		view = await lab.performAction({
			action: "approve_deploy",
			expectedVersion: view.expectedVersion,
		});
		expect(view.availableActions.map((action) => action.id)).toContain(
			"approve_response",
		);

		view = await lab.performAction({
			action: "approve_response",
			expectedVersion: view.expectedVersion,
		});
		expect(view.workflow.status).toBe("completed");
		const status = await lab.status();
		expect(status.deployments).toBe(1);
		expect(status.publicResponses).toBe(1);
	});

	test("keeps restricted scenarios proposal-only", async () => {
		const lab = createLocalWorkflowLab({ mode: "scripted" });
		const view = await lab.reset("restricted");
		expect(view.workflow.risk).toBe("r3");
		expect(view.workflow.status).toBe("blocked");
		expect(view.availableActions.map((action) => action.id)).toEqual([
			"cancel",
		]);
	});

	test("groups the live and sample tickets by application", async () => {
		const lab = createLocalWorkflowLab({ mode: "scripted" });
		await lab.reset("happy");

		const apps = await lab.listApps();
		expect(apps.map((app) => app.id)).toEqual(["ama", "dms", "support"]);
		expect(apps.find((app) => app.id === "ama")).toMatchObject({
			ticketCount: 2,
			needsReviewCount: 2,
		});

		const amaTickets = await lab.listTickets("ama");
		expect(amaTickets?.map((ticket) => ticket.issueNumber)).toEqual([
			4821, 4819,
		]);
		expect(
			amaTickets?.find((ticket) => ticket.source === "live"),
		).toMatchObject({
			appId: "ama",
			status: "needs_review",
		});
		expect(await lab.listTickets("missing")).toBeNull();
	});

	test("returns ticket detail with a curated agent workflow", async () => {
		const lab = createLocalWorkflowLab({ mode: "scripted" });
		await lab.reset("happy");

		const live = await lab.getTicket("ama", 4821);
		expect(live?.ticket.source).toBe("live");
		expect(
			live?.workflow.items.some((item) => item.stage === "investigate"),
		).toBe(true);

		const sample = await lab.getTicket("dms", 2306);
		expect(sample).toMatchObject({
			app: { id: "dms" },
			ticket: { source: "sample", status: "blocked" },
		});
		expect(sample?.workflow.items.some((item) => item.stage === "qc")).toBe(
			true,
		);
		expect(await lab.getTicket("dms", 9999)).toBeNull();
	});

	test("records a sample decision in memory and removes its actions", async () => {
		const lab = createLocalWorkflowLab({ mode: "scripted" });
		await lab.reset("happy");
		const before = await lab.getTicket("ama", 4819);
		if (!before) throw new Error("Sample ticket was not created");

		const after = await lab.performTicketAction({
			appId: "ama",
			issueNumber: 4819,
			action: "approve_plan",
			expectedVersion: before.workflow.expectedVersion,
		});
		expect(after.decision).toMatchObject({
			action: "approve_plan",
			label: "Approve plan",
		});
		expect(after.ticket).toMatchObject({
			status: "resolved",
			requiresReview: false,
		});
		expect(after.workflow.availableActions).toEqual([]);
		expect(after.workflow.expectedVersion).toBe(
			before.workflow.expectedVersion + 1,
		);
		expect((await lab.status()).deployments).toBe(0);
		expect((await lab.status()).publicResponses).toBe(0);
	});

	test("requires actionable feedback for a sample rejection", async () => {
		const lab = createLocalWorkflowLab({ mode: "scripted" });
		await lab.reset("happy");
		const detail = await lab.getTicket("ama", 4819);
		if (!detail) throw new Error("Sample ticket was not created");

		await expect(
			lab.performTicketAction({
				appId: "ama",
				issueNumber: 4819,
				action: "revise_plan",
				expectedVersion: detail.workflow.expectedVersion,
			}),
		).rejects.toThrow("requires actionable feedback");
	});
});
