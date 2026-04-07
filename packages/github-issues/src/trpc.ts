import type {
  AnyRootTypes,
  ProcedureBuilder,
  RouterBuilder,
  UnsetMarker,
} from "@trpc/server";
import { z } from "zod";
import { buildEndmatter } from "./endmatter";
import {
  createComment,
  createIssue,
  getIssue,
  listComments,
  listIssues,
  type GHComment,
  type GHIssue,
} from "./github-api-client";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const listIssuesInput = z
  .object({
    state: z.enum(["open", "closed", "all"]).optional(),
    page: z.number().int().positive().optional(),
    perPage: z.number().int().min(1).max(100).optional(),
  })
  .optional();

const getIssueInput = z.object({
  issueNumber: z.number().int().positive(),
});

const createIssueInput = z.object({
  title: z.string().min(1).max(256),
  body: z.string().min(1),
});

const listCommentsInput = z.object({
  issueNumber: z.number().int().positive(),
  page: z.number().int().positive().optional(),
  perPage: z.number().int().min(1).max(100).optional(),
});

const createCommentInput = z.object({
  issueNumber: z.number().int().positive(),
  body: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Handlers (envelope-style return)
// ---------------------------------------------------------------------------

type Envelope<T> = { data: T; error: null } | { data: null; error: string };

async function handleListIssues(
  input?: z.infer<typeof listIssuesInput>,
): Promise<Envelope<GHIssue[]>> {
  try {
    const issues = await listIssues({
      state: input?.state,
      page: input?.page,
      perPage: input?.perPage,
    });
    return { data: issues, error: null };
  } catch (error) {
    console.error("Error listing issues:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to list issues",
    };
  }
}

async function handleGetIssue(
  input: z.infer<typeof getIssueInput>,
): Promise<Envelope<GHIssue>> {
  try {
    const issue = await getIssue(input.issueNumber);
    return { data: issue, error: null };
  } catch (error) {
    console.error("Error getting issue:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to get issue",
    };
  }
}

async function handleCreateIssue(
  input: z.infer<typeof createIssueInput>,
  author: string,
): Promise<Envelope<GHIssue>> {
  try {
    const meta: Record<string, string> = { author };
    const body = `**Submitted by ${author}**\n\n${input.body}${buildEndmatter(meta)}`;
    const issue = await createIssue({ title: input.title, body });
    return { data: issue, error: null };
  } catch (error) {
    console.error("Error creating issue:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to create issue",
    };
  }
}

async function handleListComments(
  input: z.infer<typeof listCommentsInput>,
): Promise<Envelope<GHComment[]>> {
  try {
    const comments = await listComments(input.issueNumber, {
      page: input.page,
      perPage: input.perPage,
    });
    return { data: comments, error: null };
  } catch (error) {
    console.error("Error listing comments:", error);
    return {
      data: null,
      error:
        error instanceof Error ? error.message : "Failed to list comments",
    };
  }
}

async function handleCreateComment(
  input: z.infer<typeof createCommentInput>,
  author: string,
): Promise<Envelope<GHComment>> {
  try {
    const meta: Record<string, string> = { author };
    const body = `**${author}** wrote:\n\n${input.body}${buildEndmatter(meta)}`;
    const comment = await createComment({
      issueNumber: input.issueNumber,
      body,
    });
    return { data: comment, error: null };
  } catch (error) {
    console.error("Error creating comment:", error);
    return {
      data: null,
      error:
        error instanceof Error ? error.message : "Failed to create comment",
    };
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates a fully typed tRPC issues router.
 *
 * The `protectedProcedure` context must include
 * `{ user: { name?: string | null } }`.
 */
export function createIssuesRouter<
  TRoot extends AnyRootTypes,
  TContext extends { user: { name?: string | null } },
  TMeta,
  TContextOverrides extends TContext,
>(
  router: RouterBuilder<TRoot>,
  protectedProcedure: ProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    UnsetMarker,
    false
  >,
) {
  return router({
    list: protectedProcedure
      .input(listIssuesInput)
      .query(({ input }) => handleListIssues(input)),

    get: protectedProcedure
      .input(getIssueInput)
      .query(({ input }) => handleGetIssue(input)),

    create: protectedProcedure
      .input(createIssueInput)
      .mutation(({ input, ctx }) =>
        handleCreateIssue(input, ctx.user.name ?? "Unknown"),
      ),

    listComments: protectedProcedure
      .input(listCommentsInput)
      .query(({ input }) => handleListComments(input)),

    createComment: protectedProcedure
      .input(createCommentInput)
      .mutation(({ input, ctx }) =>
        handleCreateComment(input, ctx.user.name ?? "Unknown"),
      ),
  });
}
