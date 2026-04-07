// GitHub Issues integration package
// Provides GitHub App authentication, REST API client, endmatter helpers,
// and pre-built handler functions + Zod schemas for tRPC wiring.

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

export {
  // Zod schemas
  listIssuesInput,
  getIssueInput,
  createIssueInput,
  listCommentsInput,
  createCommentInput,
  // Handler functions
  handleListIssues,
  handleGetIssue,
  handleCreateIssue,
  handleListComments,
  handleCreateComment,
} from "./trpc";
