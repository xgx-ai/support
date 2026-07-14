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
	useResponseDialog,
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
import { type CloseIssueChoice, CloseIssueDialog } from "./close-issue-dialog";
import { CommentForm } from "./comment-form";
import { CreateIssueDialog, type CreateIssueFn } from "./create-issue-dialog";
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
	/** Reopen a closed ticket. */
	reopenIssue?: (input: { issueNumber: number }) => Promise<Envelope<Issue>>;
	/** Create a new ticket, including one related to this ticket. */
	createIssue?: CreateIssueFn;
	/** Navigate to another ticket after creation or from a relationship link. */
	onNavigateToIssue?: (issueNumber: number) => void;
	/** Optional app-specific transformation for newly created tickets. */
	onBeforeCreateIssue?: (params: { title: string; body: string }) => {
		title: string;
		body: string;
	};
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
		/** Optional list key to invalidate after changing or creating a ticket. */
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
	const { showResponseDialog, DialogResponse } = useResponseDialog();
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

	const reopenMutation = createMutation(() => ({
		mutationFn: async () => {
			if (!props.reopenIssue) return;
			const result = await props.reopenIssue({
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

	const handleReopen = async () => {
		try {
			await reopenMutation.mutateAsync(undefined);
			toast.success("Ticket reopened");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to reopen ticket",
			);
		}
	};

	const handleCreateRelatedIssue = async (initialBody?: string) => {
		if (!props.createIssue || !props.onNavigateToIssue) return;

		let createdIssueNumber: number | undefined;
		const created = await showResponseDialog({
			title: "Tell us about the related issue",
			description: `We’ll create a separate ticket and link it to #${props.issueNumber}.`,
			class: "max-w-lg w-full",
			content: (dialogProps) => (
				<CreateIssueDialog
					{...dialogProps}
					initialBody={initialBody}
					uploadImage={props.uploadImage}
					createIssue={props.createIssue as CreateIssueFn}
					relatedIssueNumber={props.issueNumber}
					onBeforeCreate={props.onBeforeCreateIssue}
					onCreated={(issue) => {
						createdIssueNumber = issue.number;
					}}
				/>
			),
		});

		if (!created || createdIssueNumber === undefined) return;
		queryClient.invalidateQueries(props.queryKeys.comments(props.issueNumber));
		if (props.queryKeys.all) {
			queryClient.invalidateQueries(props.queryKeys.all);
		}
		props.onNavigateToIssue(createdIssueNumber);
	};

	const handleClose = async (body: string) => {
		if (!props.closeIssue) return false;

		const choice = await showResponseDialog<CloseIssueChoice>({
			title: "Close support ticket",
			description:
				"Use your draft as the final comment, or carry it into a separate linked ticket.",
			class: "max-w-lg w-full",
			content: (dialogProps) => (
				<CloseIssueDialog
					{...dialogProps}
					closeTicket={async (resolution) => {
						if (resolution === "closed") {
							const result = await props.createComment({
								issueNumber: props.issueNumber,
								body,
							});
							if (result.error) throw new Error(result.error);
							queryClient.invalidateQueries(
								props.queryKeys.comments(props.issueNumber),
							);
						}
						await closeMutation.mutateAsync(undefined);
					}}
				/>
			),
		});

		if (!choice) return false;
		toast.success("Ticket closed");
		if (choice === "related") await handleCreateRelatedIssue(body);
		return true;
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

									<Show when={parsed().relatedIssueNumber}>
										{(relatedIssueNumber) => (
											<Show
												when={props.onNavigateToIssue}
												fallback={
													<Text size="xs" class="text-muted-foreground">
														Related ticket #{relatedIssueNumber()}
													</Text>
												}
											>
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														props.onNavigateToIssue?.(relatedIssueNumber())
													}
												>
													Related ticket #{relatedIssueNumber()}
												</Button>
											</Show>
										)}
									</Show>

									<Show
										when={
											i().state === "closed" &&
											(props.reopenIssue ||
												(props.createIssue && props.onNavigateToIssue))
										}
									>
										<Box class="rounded-md border bg-muted/30 p-4">
											<Stack class="gap-3">
												<Stack class="gap-1">
													<Text size="sm" weight="medium">
														What would you like to do?
													</Text>
													<Text size="xs" class="text-muted-foreground">
														Tell us whether this ticket needs more help or
														whether you have a related issue.
													</Text>
												</Stack>
												<Flex gap="2" class="flex-col sm:flex-row">
													<Show when={props.reopenIssue}>
														<Button
															variant="outline"
															size="sm"
															class="w-full sm:w-auto"
															onClick={() => void handleReopen()}
															disabled={reopenMutation.isPending}
														>
															{reopenMutation.isPending
																? "Reopening..."
																: "My issue isn’t solved"}
														</Button>
													</Show>
													<Show
														when={props.createIssue && props.onNavigateToIssue}
													>
														<Button
															size="sm"
															class="w-full h-auto whitespace-normal sm:w-auto"
															onClick={() => void handleCreateRelatedIssue()}
															disabled={reopenMutation.isPending}
														>
															This is solved, but I have a related issue
														</Button>
													</Show>
												</Flex>
											</Stack>
										</Box>
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
												<Show when={parsed().body}>
													{(body) => (
														<MarkdownBody
															text={body()}
															class="text-sm leading-relaxed text-foreground/90"
														/>
													)}
												</Show>
												<Show when={parsed().followUpIssueNumber}>
													{(followUpIssueNumber) => (
														<Show
															when={props.onNavigateToIssue}
															fallback={
																<Text size="xs" class="text-muted-foreground">
																	Related ticket #{followUpIssueNumber()}
																</Text>
															}
														>
															<Button
																variant="outline"
																size="sm"
																onClick={() =>
																	props.onNavigateToIssue?.(
																		followUpIssueNumber(),
																	)
																}
															>
																Open related ticket #{followUpIssueNumber()}
															</Button>
														</Show>
													)}
												</Show>
											</Stack>
										);
									}}
								</For>
							</Stack>
						</Show>

						{/* Add comment form */}
						<Show when={issue()?.state === "open"}>
							<CommentForm
								onClose={props.closeIssue ? handleClose : undefined}
								onSubmit={handleSubmitComment}
								uploadImage={props.uploadImage}
							/>
						</Show>
					</Stack>
				</Card>
				<DialogResponse />
			</Stack>
		</SuspenseFallback>
	);
}
