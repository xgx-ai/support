// GitHub Issues integration package
// Provides GitHub App authentication, REST API client, and tRPC router factory.

export {
  createGitHubAppJwt,
  decodeJwtPayload,
} from "./github-app-jwt";

export {
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
