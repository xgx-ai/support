// GitHub Issues integration package
// Provides GitHub App authentication, REST API client, endmatter helpers,
// and a tRPC router factory for GitHub-backed issue tracking.

export { buildEndmatter, parseEndmatter } from "./endmatter";

export {
	addLabels,
	createComment,
	createIssue,
	type GHAssignee,
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
export {
	type CreateIssueWebhookHandlerOptions,
	createIssueWebhookHandler,
	type GHIssueCommentWebhookPayload,
	type GHIssueWebhookChanges,
	type GHIssueWebhookComment,
	type GHIssueWebhookIssue,
	type GHIssueWebhookPayload,
	type GHRepository,
	type SupportCommentEventType,
	type SupportCommentWebhookEvent,
	type SupportIssueEventType,
	type SupportIssueWebhookEvent,
	type SupportWebhookEvent,
	type SupportWebhookEventHandler,
	type SupportWebhookEventType,
} from "./webhooks";
