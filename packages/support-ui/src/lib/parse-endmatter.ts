/**
 * Frontend helpers for parsing endmatter metadata from GitHub issue/comment
 * bodies. These complement the `parseEndmatter` / `buildEndmatter` functions
 * in `@xgx-ai/support/github-issues` (which are backend-focused).
 */

export function parseEndmatter(raw: string): {
	body: string;
	meta: Record<string, string>;
} {
	const match = raw.match(/^([\s\S]*?)\n?\n?<!--meta\n([\s\S]*?)\n-->$/);
	if (!match) return { body: raw, meta: {} };

	const meta: Record<string, string> = {};
	for (const line of match[2]?.split("\n") ?? []) {
		const idx = line.indexOf(": ");
		if (idx > 0) meta[line.slice(0, idx)] = line.slice(idx + 2);
	}
	return { body: match[1] ?? raw, meta };
}

export function stripPrefix(body: string, pattern: RegExp): string {
	const match = body.match(pattern);
	return match?.[1] ?? body;
}

function parseIssueNumber(value: string | undefined): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const issueNumber = Number(value);
	return Number.isSafeInteger(issueNumber) && issueNumber > 0
		? issueNumber
		: null;
}

export function parseCommentAuthor(comment: {
	body: string;
	user: { login: string } | null;
}): { author: string; body: string; followUpIssueNumber: number | null } {
	const { body, meta } = parseEndmatter(comment.body);
	const followUpIssueNumber = parseIssueNumber(meta.followUpIssueNumber);
	const authoredBody = meta.author
		? stripPrefix(body, /^\*\*.+?\*\* wrote:\n\n([\s\S]*)$/)
		: body;
	const backlinkText = followUpIssueNumber
		? `Related ticket created: #${followUpIssueNumber}`
		: null;

	if (meta.author) {
		return {
			author: meta.author,
			body: authoredBody === backlinkText ? "" : authoredBody,
			followUpIssueNumber,
		};
	}
	return {
		author: comment.user?.login ?? "Unknown",
		body,
		followUpIssueNumber,
	};
}

export function parseIssueBody(issue: {
	body: string | null;
	user: { login: string } | null;
}): {
	submitter: string | null;
	body: string | null;
	relatedIssueNumber: number | null;
} {
	if (!issue.body) {
		return {
			submitter: issue.user?.login ?? null,
			body: null,
			relatedIssueNumber: null,
		};
	}
	const { body, meta } = parseEndmatter(issue.body);
	const relatedIssueNumber = parseIssueNumber(meta.relatedIssueNumber);
	const submittedBody = meta.author
		? stripPrefix(body, /^\*\*Submitted by .+?\*\*\n\n([\s\S]*)$/)
		: body;
	const relatedPrefix = relatedIssueNumber
		? `Related to #${relatedIssueNumber}\n\n`
		: null;
	const displayBody =
		relatedPrefix && submittedBody.startsWith(relatedPrefix)
			? submittedBody.slice(relatedPrefix.length)
			: submittedBody;

	return {
		submitter: meta.author ?? issue.user?.login ?? null,
		body: displayBody,
		relatedIssueNumber,
	};
}
