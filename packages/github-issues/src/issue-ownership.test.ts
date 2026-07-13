import { describe, expect, test } from "bun:test";
import { isIssueAuthor } from "./issue-ownership";

describe("isIssueAuthor", () => {
	test("matches the embedded application user ID", () => {
		const body = "Help me\n\n<!--meta\nauthor: Ada\nauthorId: user_123\n-->";

		expect(isIssueAuthor(body, "user_123")).toBe(true);
		expect(isIssueAuthor(body, "user_456")).toBe(false);
	});

	test("fails closed when ownership metadata is missing", () => {
		expect(isIssueAuthor("Help me", "user_123")).toBe(false);
		expect(isIssueAuthor(null, "user_123")).toBe(false);
	});
});
