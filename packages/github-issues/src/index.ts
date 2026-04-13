// GitHub Issues integration package
// Provides GitHub App authentication, REST API client, endmatter helpers,
// and a tRPC router factory for GitHub-backed issue tracking.

export { buildEndmatter, parseEndmatter } from "./endmatter";

export {
	addLabels,
	createComment,
	createIssue,
	type GHComment,
	type GHIssue,
	type GHLabel,
	type GHUser,
	getIssue,
	listComments,
	listIssues,
	setLabels,
} from "./github-api-client";
export {
	createGitHubAppJwt,
	decodeJwtPayload,
} from "./github-app-jwt";

export { createIssuesRouter } from "./trpc";
