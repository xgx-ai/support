import { describe, expect, test } from "bun:test";
import {
	parseCommentAuthor,
	parseIssueBody,
} from "../../support-ui/src/lib/parse-endmatter";

describe("related ticket UI metadata", () => {
	test("parses a related source ticket and removes the GitHub-only prefix", () => {
		const parsed = parseIssueBody({
			body: "**Submitted by Ada**\n\nRelated to #42\n\nA different export problem\n\n<!--meta\nauthor: Ada\nauthorId: user_123\nrelatedIssueNumber: 42\n-->",
			user: null,
		});

		expect(parsed).toEqual({
			submitter: "Ada",
			body: "A different export problem",
			relatedIssueNumber: 42,
		});
	});

	test("parses a related-ticket backlink comment", () => {
		const parsed = parseCommentAuthor({
			body: "**Ada** wrote:\n\nRelated ticket created: #57\n\n<!--meta\nauthor: Ada\nauthorId: user_123\nfollowUpIssueNumber: 57\n-->",
			user: null,
		});

		expect(parsed).toEqual({
			author: "Ada",
			body: "",
			followUpIssueNumber: 57,
		});
	});

	test("ignores malformed relationship metadata", () => {
		const parsed = parseIssueBody({
			body: "Description\n\n<!--meta\nrelatedIssueNumber: not-a-ticket\n-->",
			user: { login: "ada" },
		});

		expect(parsed.relatedIssueNumber).toBeNull();
		expect(parsed.body).toBe("Description");
	});
});
