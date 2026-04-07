// GitHub Issues integration package
// Provides GitHub App authentication, REST API client, endmatter helpers,
// and a tRPC router factory for GitHub-backed issue tracking.

export {
  createGitHubAppJwt,
  decodeJwtPayload,
} from "./github-app-jwt";

export {
  setRepoName,
  listIssues,
  getIssue,
  createIssue,
  listComments,
  createComment,
  type GHLabel,
  type GHUser,
  type GHIssue,
  type GHComment,
} from "./github-api-client";

export { buildEndmatter, parseEndmatter } from "./endmatter";

export { createIssuesRouter } from "./trpc";
