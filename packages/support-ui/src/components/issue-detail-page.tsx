import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  Badge,
  Box,
  Card,
  Flex,
  Heading,
  Stack,
  SuspenseFallback,
  Text,
} from "@xgx/ui";
import { ArrowLeft } from "@xgx/ui/icons";
import { For, Show, type JSX } from "solid-js";
import { CommentForm } from "./comment-form";
import { MarkdownBody } from "./markdown-body";
import { parseCommentAuthor, parseIssueBody } from "../lib/parse-endmatter";
import type { UploadImageFn } from "../lib/use-image-upload";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  labels: { name: string; color: string }[];
  user: { login: string } | null;
}

interface Comment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string } | null;
}

type Envelope<T> = { data: T | null; error: string | null };

export interface IssueDetailPageProps {
  /** Current issue number from route params. */
  issueNumber: number;

  /** Fetch a single issue. */
  getIssue: (input: { issueNumber: number }) => Promise<Envelope<Issue>>;
  /** Fetch comments for an issue. */
  listComments: (input: {
    issueNumber: number;
  }) => Promise<Envelope<Comment[]>>;
  /** Post a new comment. */
  createComment: (input: {
    issueNumber: number;
    body: string;
  }) => Promise<Envelope<Comment>>;
  /** Upload an image (for the comment form). */
  uploadImage: UploadImageFn;

  /** Query key builders. */
  queryKeys: {
    detail: (issueNumber: number) => readonly unknown[];
    comments: (issueNumber: number) => readonly unknown[];
  };

  /** Optional date formatter. Defaults to `en-GB` locale string. */
  formatDate?: (iso: string) => string;
  /** Optional override for the "back to list" link. Rendered as-is. */
  backLink?: JSX.Element;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const defaultFormatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function IssueDetailPage(props: IssueDetailPageProps) {
  const queryClient = useQueryClient();
  const fmt = () => props.formatDate ?? defaultFormatDate;

  const issueQuery = createQuery(() => ({
    queryKey: props.queryKeys.detail(props.issueNumber),
    queryFn: () => props.getIssue({ issueNumber: props.issueNumber }),
  }));

  const commentsQuery = createQuery(() => ({
    queryKey: props.queryKeys.comments(props.issueNumber),
    queryFn: () => props.listComments({ issueNumber: props.issueNumber }),
  }));

  const issue = () => issueQuery.data?.data;
  const comments = () => commentsQuery.data?.data ?? [];

  const handleSubmitComment = async (body: string) => {
    const result = await props.createComment({
      issueNumber: props.issueNumber,
      body,
    });
    if (result.error) {
      return { error: result.error };
    }
    queryClient.invalidateQueries({
      queryKey: props.queryKeys.comments(props.issueNumber),
    });
    return { error: null };
  };

  return (
    <SuspenseFallback>
      <Stack class="gap-6 h-full pb-6 max-w-3xl mx-auto w-full overflow-auto">
        {/* Back link */}
        {props.backLink ?? (
          <a
            href="/support"
            class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft class="size-3" />
            All issues
          </a>
        )}

        <Card padding="lg" class="flex-1">
          {/* Issue header */}
          <Show when={issue()}>
            {(i) => {
              const parsed = () => parseIssueBody(i());
              return (
                <Stack class="gap-4">
                  <Stack class="gap-2">
                    <Heading level={1} size="lg">
                      {i().title}
                    </Heading>
                    <Flex align="center" gap="2" class="flex-wrap">
                      <Badge
                        variant={i().state === "open" ? "success" : "secondary"}
                      >
                        {i().state}
                      </Badge>
                      <Text size="xs" class="text-muted-foreground">
                        #{i().number}
                      </Text>
                      <Text size="xs" class="text-muted-foreground">
                        &middot;
                      </Text>
                      <Text size="xs" class="text-muted-foreground">
                        {fmt()(i().created_at)}
                      </Text>
                      <Show when={parsed().submitter}>
                        {(submitter) => (
                          <>
                            <Text size="xs" class="text-muted-foreground">
                              &middot;
                            </Text>
                            <Text size="xs" class="text-muted-foreground">
                              {submitter()}
                            </Text>
                          </>
                        )}
                      </Show>
                    </Flex>
                    <Show when={i().labels.length > 0}>
                      <Flex gap="1.5" class="flex-wrap pt-1">
                        <For each={i().labels}>
                          {(label) => (
                            <Badge
                              variant="outline"
                              class="font-normal"
                              style={{ "border-color": `#${label.color}` }}
                            >
                              {label.name}
                            </Badge>
                          )}
                        </For>
                      </Flex>
                    </Show>
                  </Stack>

                  <Show when={parsed().body}>
                    <MarkdownBody
                      text={parsed().body!}
                      class="text-sm leading-relaxed text-foreground/90 py-2"
                    />
                  </Show>
                </Stack>
              );
            }}
          </Show>

          {/* Divider */}
          <Box class="border-t my-6" />

          {/* Comments */}
          <Stack class="gap-6">
            <Text
              as="p"
              size="sm"
              weight="medium"
              class="text-muted-foreground"
            >
              {comments().length}{" "}
              {comments().length === 1 ? "comment" : "comments"}
            </Text>

            <Show when={comments().length > 0}>
              <Stack class="gap-6">
                <For each={comments()}>
                  {(comment) => {
                    const parsed = () => parseCommentAuthor(comment);
                    return (
                      <Stack class="gap-1.5 pl-4 border-l-2 border-border">
                        <Flex justify="between" align="center">
                          <Text size="xs" weight="medium">
                            {parsed().author}
                          </Text>
                          <Text size="xs" class="text-muted-foreground">
                            {fmt()(comment.created_at)}
                          </Text>
                        </Flex>
                        <MarkdownBody
                          text={parsed().body}
                          class="text-sm leading-relaxed text-foreground/90"
                        />
                      </Stack>
                    );
                  }}
                </For>
              </Stack>
            </Show>

            {/* Add comment form */}
            <CommentForm
              onSubmit={handleSubmitComment}
              uploadImage={props.uploadImage}
            />
          </Stack>
        </Card>
      </Stack>
    </SuspenseFallback>
  );
}
