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
  for (const line of match[2]!.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) meta[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return { body: match[1]!, meta };
}

export function stripPrefix(body: string, pattern: RegExp): string {
  const match = body.match(pattern);
  return match ? match[1]! : body;
}

export function parseCommentAuthor(comment: {
  body: string;
  user: { login: string } | null;
}): { author: string; body: string } {
  const { body, meta } = parseEndmatter(comment.body);
  if (meta.author) {
    return {
      author: meta.author,
      body: stripPrefix(body, /^\*\*.+?\*\* wrote:\n\n([\s\S]*)$/),
    };
  }
  return { author: comment.user?.login ?? "Unknown", body };
}

export function parseIssueBody(issue: {
  body: string | null;
  user: { login: string } | null;
}): { submitter: string | null; body: string | null } {
  if (!issue.body) return { submitter: issue.user?.login ?? null, body: null };
  const { body, meta } = parseEndmatter(issue.body);
  return {
    submitter: meta.author ?? issue.user?.login ?? null,
    body: meta.author
      ? stripPrefix(body, /^\*\*Submitted by .+?\*\*\n\n([\s\S]*)$/)
      : body,
  };
}
