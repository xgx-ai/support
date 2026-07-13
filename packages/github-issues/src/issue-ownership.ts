import { parseEndmatter } from "./endmatter";

/** Whether an issue was submitted by the given application user. */
export function isIssueAuthor(
	body: string | null | undefined,
	userId: string,
): boolean {
	const { meta } = parseEndmatter(body ?? "");
	return meta.authorId === userId;
}
