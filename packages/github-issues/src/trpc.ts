import { z } from "zod";
import {
  buildEndmatter,
  createComment,
  createIssue,
  getIssue,
  listComments,
  listIssues,
} from "./index";

type AnyRouter = (...args: any[]) => any;
type AnyProcedure = {
  input: (schema: any) => any;
  query: (fn: any) => any;
  mutation: (fn: any) => any;
};

/**
 * Creates a tRPC router for GitHub Issues.
 *
 * Pass in `router` and `protectedProcedure` from your tRPC setup.
 * The `protectedProcedure` context must include `user: { name?: string | null }`.
 */
export function createIssuesRouter<
  TRouter extends AnyRouter,
  TProcedure extends AnyProcedure,
>(deps: { router: TRouter; protectedProcedure: TProcedure }) {
  const { router, protectedProcedure } = deps;

  const list = (protectedProcedure as any)
    .input(
      z
        .object({
          state: z.enum(["open", "closed", "all"]).optional(),
          page: z.number().int().positive().optional(),
          perPage: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ input }: { input?: { state?: "open" | "closed" | "all"; page?: number; perPage?: number } }) => {
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
          error:
            error instanceof Error ? error.message : "Failed to list issues",
        };
      }
    });

  const get = (protectedProcedure as any)
    .input(z.object({ issueNumber: z.number().int().positive() }))
    .query(async ({ input }: { input: { issueNumber: number } }) => {
      try {
        const issue = await getIssue(input.issueNumber);
        return { data: issue, error: null };
      } catch (error) {
        console.error("Error getting issue:", error);
        return {
          data: null,
          error:
            error instanceof Error ? error.message : "Failed to get issue",
        };
      }
    });

  const create = (protectedProcedure as any)
    .input(
      z.object({
        title: z.string().min(1).max(256),
        body: z.string().min(1),
      }),
    )
    .mutation(
      async ({
        input,
        ctx,
      }: {
        input: { title: string; body: string };
        ctx: { user: { name?: string | null } };
      }) => {
        try {
          const meta: Record<string, string> = {
            author: ctx.user.name ?? "Unknown",
          };

          const userName = meta.author;
          const body = `**Submitted by ${userName}**\n\n${input.body}${buildEndmatter(meta)}`;

          const issue = await createIssue({
            title: input.title,
            body,
          });
          return { data: issue, error: null };
        } catch (error) {
          console.error("Error creating issue:", error);
          return {
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Failed to create issue",
          };
        }
      },
    );

  const listIssueComments = (protectedProcedure as any)
    .input(
      z.object({
        issueNumber: z.number().int().positive(),
        page: z.number().int().positive().optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(
      async ({
        input,
      }: {
        input: { issueNumber: number; page?: number; perPage?: number };
      }) => {
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
              error instanceof Error
                ? error.message
                : "Failed to list comments",
          };
        }
      },
    );

  const createIssueComment = (protectedProcedure as any)
    .input(
      z.object({
        issueNumber: z.number().int().positive(),
        body: z.string().min(1),
      }),
    )
    .mutation(
      async ({
        input,
        ctx,
      }: {
        input: { issueNumber: number; body: string };
        ctx: { user: { name?: string | null } };
      }) => {
        try {
          const meta: Record<string, string> = {
            author: ctx.user.name ?? "Unknown",
          };

          const userName = meta.author;
          const body = `**${userName}** wrote:\n\n${input.body}${buildEndmatter(meta)}`;

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
              error instanceof Error
                ? error.message
                : "Failed to create comment",
          };
        }
      },
    );

  return (router as any)({
    list,
    get,
    create,
    listComments: listIssueComments,
    createComment: createIssueComment,
  });
}
