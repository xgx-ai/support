import type {
  AnyTRPCRootTypes,
  TRPCProcedureBuilder,
  TRPCRouterBuilder,
  TRPCUnsetMarker,
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

const uploadImageInput = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  base64: z
    .string()
    .min(1)
    .max(10 * 1024 * 1024),
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
  authorId: string,
): Promise<Envelope<GHIssue>> {
  try {
    const meta: Record<string, string> = { author, authorId };
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
  authorId: string,
): Promise<Envelope<GHComment>> {
  try {
    const meta: Record<string, string> = { author, authorId };
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
// Image upload handler
// ---------------------------------------------------------------------------

async function handleUploadImage(
  input: z.infer<typeof uploadImageInput>,
): Promise<Envelope<string>> {
  try {
    const bucket = process.env.S3_BUCKET;
    const publicUrl = process.env.S3_PUBLIC_URL ?? `${process.env.S3_ENDPOINT}/${bucket}`;
    if (!bucket || !publicUrl) {
      return { data: null, error: "Image upload is not configured (S3_BUCKET / S3_PUBLIC_URL env vars missing)" };
    }

    const bytes = Uint8Array.from(atob(input.base64), (c) =>
      c.charCodeAt(0),
    );
    const key = `support-images/${crypto.randomUUID()}/${input.fileName}`;

    await Bun.s3.write(key, bytes, {
      bucket,
      type: input.contentType,
      acl: "public-read",
    });

    const url = `${publicUrl}/${key}`;
    return { data: url, error: null };
  } catch (error) {
    console.error("issues.uploadImage failed", error);
    return { data: null, error: "Failed to upload image" };
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates a fully typed tRPC issues router.
 *
 * Image upload reads S3 config from env vars: `S3_BUCKET`, `S3_PUBLIC_URL`
 * (or `S3_ENDPOINT`). `Bun.s3` reads credentials from `S3_ACCESS_KEY_ID`,
 * `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION` automatically.
 *
 * The `protectedProcedure` context must include
 * `{ user: { id: string; name?: string | null } }`.
 */
export function createIssuesRouter<
  TRoot extends AnyTRPCRootTypes,
  TContext,
  TMeta,
  TContextOverrides extends { user: { id: string; name?: string | null } },
>(
  router: TRPCRouterBuilder<TRoot>,
  protectedProcedure: TRPCProcedureBuilder<
    TContext,
    TMeta,
    TContextOverrides,
    TRPCUnsetMarker,
    TRPCUnsetMarker,
    TRPCUnsetMarker,
    TRPCUnsetMarker,
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
        handleCreateIssue(input, ctx.user.name ?? "Unknown", ctx.user.id),
      ),

    listComments: protectedProcedure
      .input(listCommentsInput)
      .query(({ input }) => handleListComments(input)),

    createComment: protectedProcedure
      .input(createCommentInput)
      .mutation(({ input, ctx }) =>
        handleCreateComment(input, ctx.user.name ?? "Unknown", ctx.user.id),
      ),

    uploadImage: protectedProcedure
      .input(uploadImageInput)
      .mutation(({ input }) => handleUploadImage(input)),
  });
}
