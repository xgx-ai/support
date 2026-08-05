import { describe, expect, test } from "bun:test";
import {
	getAgentActivityStatusMeta,
	getAgentActivityVisibilityMeta,
	getSafeAgentActivityHref,
	requiresAgentActivityConfirmation,
} from "./agent-activity-panel.types";

describe("AgentActivityPanel display contract", () => {
	test("uses attention and failure variants for gated workflow states", () => {
		expect(getAgentActivityStatusMeta("awaiting_approval")).toEqual({
			label: "Awaiting approval",
			variant: "warning",
		});
		expect(getAgentActivityStatusMeta("failed")).toEqual({
			label: "Failed",
			variant: "error",
		});
		expect(getAgentActivityStatusMeta("succeeded")).toEqual({
			label: "Succeeded",
			variant: "success",
		});
	});

	test("allows only absolute HTTP(S) activity links", () => {
		expect(getSafeAgentActivityHref("https://example.com/evidence")).toBe(
			"https://example.com/evidence",
		);
		expect(getSafeAgentActivityHref("http://localhost:3000/check")).toBe(
			"http://localhost:3000/check",
		);
		expect(getSafeAgentActivityHref("javascript:alert(1)")).toBeUndefined();
		expect(getSafeAgentActivityHref("data:text/html,unsafe")).toBeUndefined();
		expect(getSafeAgentActivityHref("#local-fragment")).toBeUndefined();
	});

	test("requires review for actions with external or destructive effects", () => {
		expect(requiresAgentActivityConfirmation("approve_deploy")).toBe(true);
		expect(requiresAgentActivityConfirmation("approve_response")).toBe(true);
		expect(requiresAgentActivityConfirmation("cancel")).toBe(true);
		expect(requiresAgentActivityConfirmation("approve_plan")).toBe(false);
		expect(requiresAgentActivityConfirmation("retry")).toBe(false);
	});

	test("keeps internal artifacts visually distinct from public output", () => {
		expect(getAgentActivityVisibilityMeta("internal")).toEqual({
			label: "Internal",
			variant: "default",
		});
		expect(getAgentActivityVisibilityMeta("public_candidate")).toEqual({
			label: "Public draft",
			variant: "warning",
		});
		expect(getAgentActivityVisibilityMeta("public")).toEqual({
			label: "Published",
			variant: "success",
		});
	});
});
