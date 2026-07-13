import type { JSX } from "@solidjs/web";
import {
	Badge,
	Box,
	Button,
	Card,
	Flex,
	Heading,
	Stack,
	SuspenseFallback,
	Text,
	toast,
} from "@xgx/ui";
import { ArrowLeft } from "@xgx/ui/icons";
import {
	createMutation,
	createValueQuery,
	useQueryClient,
} from "@xgx/ui/query";
import { For, Show } from "solid-js";
import {
	getAssigneeDisplayName,
	getIssueAssignees,
	type IssueAssignee,
} from "../lib/assignee";
import { parseCommentAuthor, parseIssueBody } from "../lib/parse-endmatter";
import type { PriorityLabel } from "../lib/priority";
import { filterNonPriorityLabels, getPriority } from "../lib/priority";
import type { UploadImageFn } from "../lib/use-image-upload";
import { CommentForm } from "./comment-form";
import { MarkdownBody } from "./markdown-body";
import { PriorityPicker } from "./priority-picker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	created_at: string;
	closed_at?: string | null;
	labels: { name: string; color: string }[];
	user: { login: string } | null;
	assignee?: IssueAssignee | null;
	assignees?: IssueAssignee[];
	assigned_at?: string | null;
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
	/** Close a ticket submitted by the current user. */
	closeIssue?: (input: { issueNumber: number }) => Promise<Envelope<Issue>>;
	/** Update the priority of an issue. */
	setPriority?: (input: {
		issueNumber: number;
		priority: PriorityLabel;
	}) => Promise<Envelope<unknown>>;
	/** Upload an image (for the comment form). */
	uploadImage: UploadImageFn;

	/** Query key builders. */
	queryKeys: {
		detail: (issueNumber: number) => readonly unknown[];
		comments: (issueNumber: number) => readonly unknown[];
		/** Optional list key to invalidate after closing a ticket. */
		all?: readonly unknown[];
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

	const issueQuery = createValueQuery(() => ({
		queryKey: props.queryKeys.detail(props.issueNumber),
		queryFn: () => props.getIssue({ issueNumber: props.issueNumber }),
	}));

	const commentsQuery = createValueQuery(() => ({
		queryKey: props.queryKeys.comments(props.issueNumber),
		queryFn: () => props.listComments({ issueNumber: props.issueNumber }),
	}));

	const issue = () => issueQuery.data?.data;
	const comments = () => commentsQuery.data?.data ?? [];

	const priorityMutation = createMutation(() => ({
		mutationFn: async (priority: PriorityLabel) => {
			if (!props.setPriority) return;
			const result = await props.setPriority({
				issueNumber: props.issueNumber,
				priority,
			});
			if (result.error) throw new Error(result.error);
			return result;
		},
		invalidates: [props.queryKeys.detail(props.issueNumber)],
	}));

	const closeMutation = createMutation(() => ({
		mutationFn: async () => {
			if (!props.closeIssue) return;
			const result = await props.closeIssue({
				issueNumber: props.issueNumber,
			});
			if (result.error) throw new Error(result.error);
			return result;
		},
		invalidates: [
			props.queryKeys.detail(props.issueNumber),
			...(props.queryKeys.all ? [props.queryKeys.all] : []),
		],
	}));

	const handleClose = async () => {
		if (!window.confirm("Close this ticket?")) return;

		try {
			await closeMutation.mutateAsync(undefined);
			toast.success("Ticket closed");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to close ticket",
			);
		}
	};

	const handleSubmitComment = async (body: string) => {
		const result = await props.createComment({
			issueNumber: props.issueNumber,
			body,
		});
		if (result.error) {
			return { error: result.error };
		}
		queryClient.invalidateQueries(props.queryKeys.comments(props.issueNumber));
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
							const assignees = () => getIssueAssignees(i());
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
											{(() => {
												const p = getPriority(i().labels);
												return (
													<Show
														when={props.setPriority}
														fallback={
															<Badge
																variant="outline"
																class="font-normal"
																style={{
																	"border-color": p.color,
																	color: p.color,
																}}
															>
																{p.displayText} Priority
															</Badge>
														}
													>
														<PriorityPicker
															value={p.label}
															onChange={(v) =>
																void priorityMutation.mutateAsync(v)
															}
															disabled={priorityMutation.isPending}
														/>
													</Show>
												);
											})()}
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
										<Show when={filterNonPriorityLabels(i().labels).length > 0}>
											<Flex gap="1.5" class="flex-wrap pt-1">
												<For each={filterNonPriorityLabels(i().labels)}>
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

									<Box class="grid gap-3 border-y py-3 sm:grid-cols-2">
										<Stack class="gap-1">
											<Text size="xs" weight="medium">
												Assignee
											</Text>
											<Show
												when={assignees().length > 0}
												fallback={
													<Text size="xs" class="text-muted-foreground">
														Unassigned
													</Text>
												}
											>
												<Stack class="gap-1.5">
													<For each={assignees()}>
														{(assignee) => (
															<Text size="xs" class="truncate">
																{getAssigneeDisplayName(assignee)}
															</Text>
														)}
													</For>
												</Stack>
											</Show>
										</Stack>

										<Stack class="gap-1">
											<Text size="xs" weight="medium">
												Closed
											</Text>
											<Text size="xs" class="text-muted-foreground">
												<Show when={i().closed_at} fallback="Open">
													{(value) => fmt()(value())}
												</Show>
											</Text>
										</Stack>
									</Box>

									<Show when={i().state === "open" && props.closeIssue}>
										<Flex justify="end">
											<Button
												variant="outline"
												size="sm"
												class="text-destructive hover:text-destructive"
												onClick={() => void handleClose()}
												disabled={closeMutation.isPending}
											>
												{closeMutation.isPending
													? "Closing..."
													: "Close ticket"}
											</Button>
										</Flex>
									</Show>

									<Show when={parsed().body}>
										{(body) => (
											<MarkdownBody
												text={body()}
												class="text-sm leading-relaxed text-foreground/90 py-2"
											/>
										)}
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
