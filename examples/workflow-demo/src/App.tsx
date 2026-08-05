/** @jsxImportSource @solidjs/web */
import type { DialogContentProps } from "@xgx/ui";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
	Badge,
	Button,
	Callout,
	CalloutContent,
	CalloutTitle,
	Card,
	Center,
	createForm,
	DialogFooter,
	Flex,
	Grid,
	Heading,
	Link,
	Page,
	PageDescription,
	PageHeader,
	Form as SchemaForm,
	SearchBar,
	Section,
	Separator,
	Stack,
	StatusBadge,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRoot,
	TableRow,
	Text,
	TextAreaForm,
	useResponseDialog,
} from "@xgx/ui";
import { ArrowLeft, Bot } from "@xgx/ui/icons";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { z } from "zod";
import type {
	AgentActivityAction,
	AgentActivityItem,
	AgentActivityStage,
	AgentRiskLevel,
} from "../../../packages/support-ui/src/components/agent-activity-panel.types.ts";
import {
	getAgentActivityStatusMeta,
	getSafeAgentActivityHref,
	requiresAgentActivityConfirmation,
} from "../../../packages/support-ui/src/components/agent-activity-panel.types.ts";
import type {
	LocalSupportAppSummary,
	LocalSupportTicketDetail,
	LocalSupportTicketSummary,
	LocalTicketStatus,
} from "../inbox.ts";
import type { LocalScenarioName } from "../lab.ts";

interface DevStatus {
	runtime: {
		mode: "agent-mock" | "agent-live" | "scripted";
		agentUrl?: string;
		workflowState?: string;
		agentStages: string[];
		deployments: number;
		publicResponses: number;
	};
	agent: {
		state: "healthy" | "unhealthy" | "not_started";
		url?: string;
		error?: string;
		sandbox?: {
			required: boolean;
			configured: boolean;
			access: Array<"read_only" | "candidate_write">;
		};
	};
}

type InboxRoute =
	| { screen: "apps" }
	| { screen: "tickets"; appId: string }
	| { screen: "ticket"; appId: string; issueNumber: number };

type TicketFilter = "review" | "active" | "completed";

const revisionSchema = z.object({
	note: z
		.string()
		.trim()
		.min(8, "Tell the agent what needs to change")
		.max(1_000, "Keep feedback under 1,000 characters"),
});

type RevisionValues = z.infer<typeof revisionSchema>;

const localScenarios: Array<{ id: LocalScenarioName; label: string }> = [
	{ id: "happy", label: "Happy path" },
	{ id: "shadow", label: "Shadow" },
	{ id: "answer", label: "Answer only" },
	{ id: "restricted", label: "Restricted" },
	{ id: "p0", label: "P0 stop" },
	{ id: "qc-fail", label: "QC failure" },
	{ id: "stale", label: "Stale input" },
];

const ticketStatusMeta: Record<
	LocalTicketStatus,
	{
		label: string;
		variant: "primary" | "info" | "warning" | "danger" | "success";
	}
> = {
	new: { label: "New", variant: "primary" },
	working: { label: "Agents working", variant: "info" },
	needs_review: { label: "Needs review", variant: "warning" },
	blocked: { label: "Blocked", variant: "danger" },
	resolved: { label: "Resolved", variant: "success" },
};

const stageLabels: Record<AgentActivityStage, string> = {
	intake: "Ticket received",
	policy: "Repository policy",
	validate: "Validation",
	triage: "Triage",
	investigate: "Investigation",
	implement: "Implementation",
	qc: "Quality control",
	human_review: "Human review",
	verify_staging: "Staging verification",
	deploy: "Deployment",
	verify_production: "Production verification",
	respond: "Customer response",
};

const riskLabels: Record<AgentRiskLevel, string> = {
	r0: "R0 · Support only",
	r1: "R1 · Low risk",
	r2: "R2 · Elevated",
	r3: "R3 · Proposal only",
};

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatShortDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
}

function priorityLabel(
	priority: LocalSupportTicketSummary["priority"],
): string {
	return priority.toUpperCase();
}

function actionLabel(action: AgentActivityAction): string {
	if (action.id === "run_next") return "Start review";
	if (action.id === "approve_plan") return "Approve plan";
	if (action.id === "revise_plan" || action.id === "request_changes") {
		return "Request changes";
	}
	if (action.id === "record_merge") return "Record merge";
	if (action.id === "approve_deploy") return "Approve deployment";
	if (action.id === "approve_response") return "Send response";
	if (action.id === "retry") return "Retry stage";
	if (action.id === "cancel") return "Stop workflow";
	return action.label;
}

function actionVariant(
	action: AgentActivityAction,
): "default" | "outline" | "secondary" | "destructive" {
	if (
		action.id === "run_next" ||
		action.id === "approve_plan" ||
		action.id === "approve_deploy" ||
		action.id === "approve_response"
	) {
		return "default";
	}
	if (action.id === "revise_plan" || action.id === "request_changes") {
		return "outline";
	}
	return action.variant ?? "outline";
}

function isRevisionAction(action: AgentActivityAction): boolean {
	return action.id === "revise_plan" || action.id === "request_changes";
}

function isMeaningfulAgentItem(item: AgentActivityItem): boolean {
	return Boolean(item.id);
}

function isSuggestionStage(stage: AgentActivityStage): boolean {
	return [
		"policy",
		"investigate",
		"implement",
		"qc",
		"human_review",
		"verify_staging",
		"deploy",
		"verify_production",
		"respond",
	].includes(stage);
}

function latestSuggestion(
	items: AgentActivityItem[],
): AgentActivityItem | undefined {
	return [...items]
		.reverse()
		.find((item) => isSuggestionStage(item.stage) && item.status !== "running");
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: {
			accept: "application/json",
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers,
		},
	});
	const result = (await response.json()) as T & { error?: string };
	if (!response.ok) {
		throw new Error(result.error ?? `Local server returned ${response.status}`);
	}
	return result;
}

function RevisionDialog(
	props: DialogContentProps<RevisionValues> & { actionLabel: string },
) {
	const form = createForm(revisionSchema, {
		initialValues: { note: "" },
	});
	const note = form.field("note");

	return (
		<SchemaForm form={form} onSubmit={(values) => props.resolve(values)}>
			<TextAreaForm
				label="Feedback for the agent"
				description="This stays private and is included in the next planning or implementation attempt."
				placeholder="Explain what is wrong or what must change before approval."
				rows={5}
				required
				value={note.value()}
				onChange={note.onInput}
				onBlur={() => note.onBlur()}
				error={note.errorMessage()}
			/>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={() => props.reject()}>
					Cancel
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={!form.isValid() || form.isSubmitting()}
				>
					{props.actionLabel}
				</Button>
			</DialogFooter>
		</SchemaForm>
	);
}

function ActionConfirmation(
	props: DialogContentProps<boolean> & { action: AgentActivityAction },
) {
	const confirmVariant = () =>
		props.action.id === "cancel" ? "destructive" : "default";

	return (
		<Stack gap="4">
			<Text as="p" size="sm">
				This action is bound to the exact workflow version currently shown. The
				server will reject it if the ticket or proposal has changed.
			</Text>
			<DialogFooter>
				<Button variant="outline" onClick={() => props.reject()}>
					Cancel
				</Button>
				<Button variant={confirmVariant()} onClick={() => props.resolve(true)}>
					Confirm {actionLabel(props.action)}
				</Button>
			</DialogFooter>
		</Stack>
	);
}

function TicketStatusBadge(props: { status: LocalTicketStatus }) {
	const meta = () => ticketStatusMeta[props.status];
	return (
		<StatusBadge dot dotColor={meta().variant} variant={meta().variant}>
			{meta().label}
		</StatusBadge>
	);
}

function activateRow(event: KeyboardEvent, action: () => void) {
	if (event.key !== "Enter" && event.key !== " ") return;
	event.preventDefault();
	action();
}

function AppsScreen(props: {
	apps: LocalSupportAppSummary[];
	onOpenApp: (app: LocalSupportAppSummary) => void;
}) {
	const [search, setSearch] = createSignal("");
	const visibleApps = createMemo(() => {
		const query = search().trim().toLocaleLowerCase();
		if (!query) return props.apps;
		return props.apps.filter((app) =>
			[app.name, app.description, app.targetRepository].some((value) =>
				value.toLocaleLowerCase().includes(query),
			),
		);
	});

	return (
		<Stack gap="5">
			<PageHeader>
				<Stack gap="1">
					<Heading level={1} size="lg">
						Support
					</Heading>
					<PageDescription>
						Review customer requests and the private agent work behind them.
					</PageDescription>
				</Stack>
			</PageHeader>

			<Card padding="none">
				<Section padding="md">
					<Flex align="center" justify="between" gap="3" wrap="wrap">
						<Stack gap="0.5">
							<Text size="sm" weight="semibold">
								Applications
							</Text>
							<Text size="xs" variant="muted">
								{props.apps.length} connected
							</Text>
						</Stack>
						<SearchBar
							size="sm"
							value={search()}
							onChange={setSearch}
							placeholder="Search applications"
							aria-label="Search applications"
						/>
					</Flex>
				</Section>
				<Separator />
				<Show
					when={visibleApps().length > 0}
					fallback={
						<Section padding="lg">
							<Text as="p" size="sm" variant="muted">
								No applications match your search.
							</Text>
						</Section>
					}
				>
					<TableRoot>
						<TableHeader>
							<TableRow>
								<TableHead>Application</TableHead>
								<TableHead>Repository</TableHead>
								<TableHead>Tickets</TableHead>
								<TableHead>For review</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<For each={visibleApps()}>
								{(app) => (
									<TableRow
										tabindex={0}
										aria-label={`Open ${app.name} support requests`}
										onClick={() => props.onOpenApp(app)}
										onKeyDown={(event) =>
											activateRow(event, () => props.onOpenApp(app))
										}
									>
										<TableCell>
											<Stack gap="0.5">
												<Text size="sm" weight="medium">
													{app.name}
												</Text>
												<Text size="xs" variant="muted">
													{app.description}
												</Text>
											</Stack>
										</TableCell>
										<TableCell>
											<Text size="sm" variant="muted">
												{app.targetRepository}
											</Text>
										</TableCell>
										<TableCell>{app.ticketCount}</TableCell>
										<TableCell>
											<Show
												when={app.needsReviewCount > 0}
												fallback={
													<Text size="sm" variant="muted">
														—
													</Text>
												}
											>
												<Badge variant="warning" round>
													{app.needsReviewCount}
												</Badge>
											</Show>
										</TableCell>
									</TableRow>
								)}
							</For>
						</TableBody>
					</TableRoot>
				</Show>
			</Card>
		</Stack>
	);
}

function TicketsScreen(props: {
	app: LocalSupportAppSummary;
	tickets: LocalSupportTicketSummary[];
	filter: TicketFilter;
	onFilterChange: (filter: TicketFilter) => void;
	onBack: () => void;
	onOpenTicket: (ticket: LocalSupportTicketSummary) => void;
}) {
	const [search, setSearch] = createSignal("");
	const visibleTickets = createMemo(() => {
		const filtered = props.tickets.filter((ticket) => {
			if (props.filter === "review") return ticket.requiresReview;
			if (props.filter === "completed") return ticket.status === "resolved";
			return ticket.status !== "resolved" && !ticket.requiresReview;
		});
		const query = search().trim().toLocaleLowerCase();
		if (!query) return filtered;
		return filtered.filter((ticket) =>
			[
				ticket.title,
				ticket.report,
				ticket.submittedBy,
				String(ticket.issueNumber),
			].some((value) => value.toLocaleLowerCase().includes(query)),
		);
	});
	const filterOptions: ReadonlyArray<{ id: TicketFilter; label: string }> = [
		{ id: "review", label: "For review" },
		{ id: "active", label: "Active" },
		{ id: "completed", label: "Completed" },
	];

	return (
		<Stack gap="5">
			<Flex align="center">
				<Button variant="ghost" size="sm" onClick={props.onBack}>
					<ArrowLeft size={14} />
					All applications
				</Button>
			</Flex>
			<PageHeader>
				<Stack gap="1">
					<Heading level={1} size="lg">
						{props.app.name} support
					</Heading>
					<PageDescription>{props.app.description}</PageDescription>
				</Stack>
			</PageHeader>
			<Card padding="none">
				<Section padding="md">
					<Flex align="center" justify="between" gap="3" wrap="wrap">
						<Flex align="center" gap="1" wrap="wrap">
							<For each={filterOptions}>
								{(option) => (
									<Button
										size="sm"
										variant={props.filter === option.id ? "secondary" : "ghost"}
										aria-pressed={props.filter === option.id ? "true" : "false"}
										onClick={() => props.onFilterChange(option.id)}
									>
										{option.label}
									</Button>
								)}
							</For>
						</Flex>
						<SearchBar
							size="sm"
							value={search()}
							onChange={setSearch}
							placeholder="Search requests"
							aria-label="Search requests"
						/>
					</Flex>
				</Section>
				<Separator />
				<Show
					when={visibleTickets().length > 0}
					fallback={
						<Section padding="lg">
							<Text as="p" size="sm" variant="muted">
								No requests match this view.
							</Text>
						</Section>
					}
				>
					<TableRoot>
						<TableHeader>
							<TableRow>
								<TableHead>Request</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Submitted by</TableHead>
								<TableHead>Priority</TableHead>
								<TableHead>Updated</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<For each={visibleTickets()}>
								{(ticket) => (
									<TableRow
										tabindex={0}
										aria-label={`Open request ${ticket.issueNumber}: ${ticket.title}`}
										onClick={() => props.onOpenTicket(ticket)}
										onKeyDown={(event) =>
											activateRow(event, () => props.onOpenTicket(ticket))
										}
									>
										<TableCell>
											<Stack gap="0.5">
												<Text size="sm" weight="medium">
													{ticket.title}
												</Text>
												<Text size="xs" variant="muted">
													#{ticket.issueNumber}
												</Text>
											</Stack>
										</TableCell>
										<TableCell>
											<TicketStatusBadge status={ticket.status} />
										</TableCell>
										<TableCell>{ticket.submittedBy}</TableCell>
										<TableCell>{priorityLabel(ticket.priority)}</TableCell>
										<TableCell>{formatShortDate(ticket.updatedAt)}</TableCell>
									</TableRow>
								)}
							</For>
						</TableBody>
					</TableRoot>
				</Show>
			</Card>
		</Stack>
	);
}

function AgentWork(props: { items: AgentActivityItem[] }) {
	const meaningfulItems = () => props.items.filter(isMeaningfulAgentItem);

	return (
		<Stack gap="0">
			<Text as="p" size="sm" variant="muted">
				Private agent work. Nothing here is visible to the customer.
			</Text>
			<For each={meaningfulItems()}>
				{(item, index) => {
					const status = () => getAgentActivityStatusMeta(item.status);
					return (
						<Stack gap="2" py="3" borderTop={index() > 0}>
							<Flex align="center" justify="between" gap="3" wrap="wrap">
								<Stack gap="0.5">
									<Text size="xs" weight="semibold" variant="muted">
										{stageLabels[item.stage]}
									</Text>
									<Text size="xs" variant="muted">
										{formatDate(item.occurredAt)}
									</Text>
								</Stack>
								<StatusBadge
									dot
									dotColor={status().variant}
									variant={status().variant}
								>
									{status().label}
								</StatusBadge>
							</Flex>
							<Stack gap="1">
								<Text size="sm" weight="medium">
									{item.title}
								</Text>
								<Text as="p" size="sm" variant="muted">
									{item.summary}
								</Text>
							</Stack>
							<Grid cols="1" smCols="2" gap="3">
								<For each={item.details}>
									{(detail) => (
										<Stack gap="0.5">
											<Show when={detail.label}>
												{(label) => (
													<Text size="xs" weight="semibold">
														{label()}
													</Text>
												)}
											</Show>
											<Text as="p" size="xs" variant="muted">
												{detail.value}
											</Text>
										</Stack>
									)}
								</For>
							</Grid>
							<Flex align="center" gap="3" wrap="wrap">
								<For each={item.links}>
									{(link) => (
										<Show when={getSafeAgentActivityHref(link.href)}>
											{(href) => <Link href={href()}>{link.label}</Link>}
										</Show>
									)}
								</For>
							</Flex>
						</Stack>
					);
				}}
			</For>
		</Stack>
	);
}

function SuggestedFix(props: {
	detail: LocalSupportTicketDetail;
	busyActionId?: string;
	onAction: (action: AgentActivityAction) => void;
}) {
	const suggestion = () => latestSuggestion(props.detail.workflow.items);
	const actions = () => props.detail.workflow.availableActions;
	const approveAction = () =>
		actions().find((action) => action.id === "approve_plan");
	const canStartAgents = () =>
		Boolean(actions().find((action) => action.id === "run_next"));
	const requiresDecision = () => actions().length > 0;
	const reviewDescription = () => {
		if (canStartAgents()) {
			return "Start a private review to validate, triage, and investigate this request.";
		}
		if (actions().some((action) => action.id === "approve_plan")) {
			return "The agents have proposed a fix and need your decision.";
		}
		if (actions().some((action) => action.id === "approve_deploy")) {
			return "The change is ready for a human deployment decision.";
		}
		if (actions().some((action) => action.id === "approve_response")) {
			return "The customer response is ready for approval.";
		}
		if (props.detail.workflow.workflow.status === "failed") {
			return "A check failed. Review the evidence before choosing what happens next.";
		}
		return "The latest private recommendation and decision are shown below.";
	};
	const awaitingApprovalWithoutApprove = () =>
		props.detail.workflow.workflow.status === "awaiting_approval" &&
		!approveAction() &&
		props.detail.ticket.source === "live";

	return (
		<Section variant="muted" padding="lg">
			<Stack gap="4">
				<Stack gap="1">
					<Heading level={2} size="sm">
						Agent review
					</Heading>
					<Text as="p" size="xs" variant="muted">
						{reviewDescription()}
					</Text>
				</Stack>

				<Show
					when={suggestion()}
					fallback={
						<Stack gap="1">
							<Text size="sm" weight="medium">
								No proposal yet
							</Text>
							<Text as="p" size="sm" variant="muted">
								No code or customer content will be changed by starting the
								review.
							</Text>
						</Stack>
					}
				>
					{(item) => (
						<Stack gap="3">
							<Stack gap="1">
								<Text size="sm" weight="semibold">
									{item().title}
								</Text>
								<Text as="p" size="sm">
									{item().summary}
								</Text>
							</Stack>
							<Accordion collapsible>
								<AccordionItem value="proposal-details">
									<AccordionTrigger>
										<Text size="xs" weight="medium">
											View proposal details
										</Text>
									</AccordionTrigger>
									<AccordionContent>
										<Stack gap="3">
											<Grid cols="1" smCols="2" gap="3">
												<For each={item().details}>
													{(detail) => (
														<Stack gap="0.5">
															<Show when={detail.label}>
																{(label) => (
																	<Text size="xs" weight="semibold">
																		{label()}
																	</Text>
																)}
															</Show>
															<Text as="p" size="xs" variant="muted">
																{detail.value}
															</Text>
														</Stack>
													)}
												</For>
											</Grid>
											<Flex align="center" gap="3" wrap="wrap">
												<For each={item().links}>
													{(link) => (
														<Show when={getSafeAgentActivityHref(link.href)}>
															{(href) => (
																<Link href={href()}>{link.label}</Link>
															)}
														</Show>
													)}
												</For>
											</Flex>
										</Stack>
									</AccordionContent>
								</AccordionItem>
							</Accordion>
						</Stack>
					)}
				</Show>

				<Show when={requiresDecision()}>
					<Flex align="center" gap="2" wrap="wrap">
						<For each={actions()}>
							{(action) => (
								<Button
									size="sm"
									variant={actionVariant(action)}
									loading={props.busyActionId === action.id}
									disabled={Boolean(props.busyActionId)}
									onClick={() => props.onAction(action)}
								>
									{actionLabel(action)}
								</Button>
							)}
						</For>
					</Flex>
				</Show>

				<Show when={awaitingApprovalWithoutApprove()}>
					<Text as="p" size="xs" variant="muted">
						Planning only · Applying and testing stays disabled until the
						isolated candidate and trusted Nix runner are connected.
					</Text>
				</Show>

				<Show when={props.detail.decision}>
					{(decision) => (
						<Flex align="center" gap="2" wrap="wrap" role="status">
							<Badge variant="success" round>
								Recorded
							</Badge>
							<Text size="xs" variant="muted">
								{decision().label} · {formatDate(decision().recordedAt)} · No
								repository, customer, or deployment change was made.
							</Text>
						</Flex>
					)}
				</Show>
			</Stack>
		</Section>
	);
}

function TicketDetailScreen(props: {
	detail: LocalSupportTicketDetail;
	busyActionId?: string;
	onBack: () => void;
	onAction: (action: AgentActivityAction) => void;
}) {
	const activityCount = () =>
		props.detail.workflow.items.filter(isMeaningfulAgentItem).length;
	const sourceDescription = () =>
		props.detail.ticket.source === "sample"
			? "Demo data"
			: "Current private workflow";

	return (
		<Stack gap="4">
			<Flex align="center">
				<Button variant="ghost" size="sm" onClick={props.onBack}>
					<ArrowLeft size={14} />
					All {props.detail.app.name} requests
				</Button>
			</Flex>

			<Card padding="lg">
				<Stack gap="5">
					<Stack gap="2">
						<Heading level={1} size="xl">
							{props.detail.ticket.title}
						</Heading>
						<Flex align="center" gap="2" wrap="wrap">
							<TicketStatusBadge status={props.detail.ticket.status} />
							<Text size="xs" variant="muted">
								#{props.detail.ticket.issueNumber} ·{" "}
								{props.detail.ticket.submittedBy} ·{" "}
								{priorityLabel(props.detail.ticket.priority)} · Updated{" "}
								{formatDate(props.detail.ticket.updatedAt)}
							</Text>
						</Flex>
					</Stack>

					<Text as="p" size="base">
						{props.detail.ticket.report}
					</Text>

					<SuggestedFix
						detail={props.detail}
						busyActionId={props.busyActionId}
						onAction={props.onAction}
					/>
				</Stack>
			</Card>

			<Card padding="lg">
				<Accordion multiple collapsible>
					<AccordionItem value="agent-activity">
						<AccordionTrigger>
							<Text size="sm" weight="semibold">
								Agent activity · {activityCount()} steps
							</Text>
						</AccordionTrigger>
						<AccordionContent>
							<AgentWork items={props.detail.workflow.items} />
						</AccordionContent>
					</AccordionItem>
					<AccordionItem value="workflow-details">
						<AccordionTrigger>
							<Text size="sm" weight="semibold">
								Workflow details
							</Text>
						</AccordionTrigger>
						<AccordionContent>
							<Section variant="muted" padding="md">
								<Stack gap="4">
									<Grid cols="1" smCols="2" gap="4">
										<Stack gap="1">
											<Text size="xs" weight="semibold" variant="muted">
												Repository
											</Text>
											<Text size="sm">{props.detail.app.targetRepository}</Text>
										</Stack>
										<Stack gap="1">
											<Text size="xs" weight="semibold" variant="muted">
												Source
											</Text>
											<Text size="sm">{sourceDescription()}</Text>
										</Stack>
										<Stack gap="1">
											<Text size="xs" weight="semibold" variant="muted">
												Risk policy
											</Text>
											<Text size="sm">
												{props.detail.ticket.risk
													? riskLabels[props.detail.ticket.risk]
													: "Not assessed"}
											</Text>
										</Stack>
										<Stack gap="1">
											<Text size="xs" weight="semibold" variant="muted">
												Workflow state
											</Text>
											<Text size="sm">
												{props.detail.workflow.workflow.status.replaceAll(
													"_",
													" ",
												)}
											</Text>
										</Stack>
									</Grid>
									<Flex align="center" gap="2" wrap="wrap">
										<For each={props.detail.ticket.labels}>
											{(label) => <Badge variant="outline">{label}</Badge>}
										</For>
									</Flex>
								</Stack>
							</Section>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</Card>
		</Stack>
	);
}

function DeveloperTools(props: {
	status?: DevStatus;
	loading: boolean;
	onReset: (scenario: LocalScenarioName) => void;
}) {
	return (
		<Accordion collapsible>
			<AccordionItem value="developer-tools">
				<AccordionTrigger>Local developer tools</AccordionTrigger>
				<AccordionContent>
					<Section variant="muted" padding="md">
						<Stack gap="4">
							<Flex align="center" gap="2" wrap="wrap">
								<Badge variant="secondary">Bun development stack</Badge>
								<Show when={props.status?.runtime.mode === "agent-live"}>
									<Badge variant="warning">Agent live · real model</Badge>
								</Show>
								<Show when={props.status?.runtime.mode === "agent-mock"}>
									<Badge variant="secondary">Agent mock · signed HTTP</Badge>
								</Show>
								<Show when={props.status?.runtime.mode === "scripted"}>
									<Badge variant="secondary">Scripted fallback</Badge>
								</Show>
								<Show when={props.status?.agent.state === "healthy"}>
									<Badge variant="success">Agent runtime connected</Badge>
								</Show>
								<Show when={props.status?.agent.state === "unhealthy"}>
									<Badge variant="danger">Agent unavailable</Badge>
								</Show>
								<Show when={props.status?.agent.sandbox?.configured === true}>
									<Badge variant="secondary">
										Read-only repository context
									</Badge>
								</Show>
								<Show when={props.status?.agent.sandbox?.configured === false}>
									<Badge variant="secondary">
										No external workspace · planning available
									</Badge>
								</Show>
								<Show
									when={
										props.status?.agent.state === "healthy" &&
										!props.status?.agent.sandbox?.access.includes(
											"candidate_write",
										)
									}
								>
									<Badge variant="secondary">
										Code/testing sandbox not configured
									</Badge>
								</Show>
							</Flex>
							<Text as="p" size="sm" variant="muted">
								Resetting returns the live ticket to intake without making a
								model request. Start review begins the selected path. Repository
								and execution sandboxes are attached only to stages that need
								them.
							</Text>
							<Flex align="center" gap="2" wrap="wrap">
								<For each={localScenarios}>
									{(scenario) => (
										<Button
											size="sm"
											variant="outline"
											disabled={props.loading}
											onClick={() => props.onReset(scenario.id)}
										>
											{scenario.label}
										</Button>
									)}
								</For>
							</Flex>
						</Stack>
					</Section>
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}

export default function App() {
	const [route, setRoute] = createSignal<InboxRoute>({ screen: "apps" });
	const [apps, setApps] = createSignal<LocalSupportAppSummary[]>([]);
	const [tickets, setTickets] = createSignal<LocalSupportTicketSummary[]>([]);
	const [ticketDetail, setTicketDetail] =
		createSignal<LocalSupportTicketDetail>();
	const [ticketFilter, setTicketFilter] = createSignal<TicketFilter>("review");
	const [devStatus, setDevStatus] = createSignal<DevStatus>();
	const [loading, setLoading] = createSignal(true);
	const [busyActionId, setBusyActionId] = createSignal<string>();
	const [error, setError] = createSignal<string>();
	const { showResponseDialog, DialogResponse } = useResponseDialog();

	const selectedApp = createMemo(() => {
		const current = route();
		if (current.screen === "apps") return undefined;
		return apps().find((app) => app.id === current.appId);
	});

	const refreshApps = async () => {
		const result = await requestJson<{ apps: LocalSupportAppSummary[] }>(
			"/api/apps",
		);
		setApps(result.apps);
	};

	const refreshStatus = async () => {
		setDevStatus(await requestJson<DevStatus>("/api/dev/status"));
	};

	const initialise = async () => {
		setLoading(true);
		setError(undefined);
		try {
			await Promise.all([refreshApps(), refreshStatus()]);
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not load the support inbox",
			);
		} finally {
			setLoading(false);
		}
	};

	const openApp = async (app: LocalSupportAppSummary) => {
		setLoading(true);
		setError(undefined);
		try {
			const result = await requestJson<{
				tickets: LocalSupportTicketSummary[];
			}>(`/api/apps/${encodeURIComponent(app.id)}/tickets`);
			setTickets(result.tickets);
			setTicketFilter("review");
			setRoute({ screen: "tickets", appId: app.id });
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not load application tickets",
			);
		} finally {
			setLoading(false);
		}
	};

	const openTicket = async (ticket: LocalSupportTicketSummary) => {
		setLoading(true);
		setError(undefined);
		try {
			const result = await requestJson<{ detail: LocalSupportTicketDetail }>(
				`/api/apps/${encodeURIComponent(ticket.appId)}/tickets/${ticket.issueNumber}`,
			);
			setTicketDetail(result.detail);
			setRoute({
				screen: "ticket",
				appId: ticket.appId,
				issueNumber: ticket.issueNumber,
			});
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not load the support ticket",
			);
		} finally {
			setLoading(false);
		}
	};

	const performTicketAction = async (action: AgentActivityAction) => {
		const detail = ticketDetail();
		if (!detail || busyActionId()) return;
		let note: string | undefined;
		if (isRevisionAction(action)) {
			const response = await showResponseDialog<RevisionValues>({
				title: actionLabel(action),
				description:
					"Explain what the agent must change before this suggestion can be approved.",
				content: (dialogProps) => (
					<RevisionDialog {...dialogProps} actionLabel={actionLabel(action)} />
				),
			});
			if (!response) return;
			note = response.note;
		} else if (requiresAgentActivityConfirmation(action.id)) {
			const confirmed = await showResponseDialog<boolean>({
				title: actionLabel(action),
				description: action.description ?? "Confirm this workflow action.",
				content: (dialogProps) => (
					<ActionConfirmation {...dialogProps} action={action} />
				),
			});
			if (!confirmed) return;
		}

		setBusyActionId(action.id);
		setError(undefined);
		try {
			const result = await requestJson<{ detail: LocalSupportTicketDetail }>(
				`/api/apps/${encodeURIComponent(detail.app.id)}/tickets/${detail.ticket.issueNumber}/action`,
				{
					method: "POST",
					body: JSON.stringify({
						action: action.id,
						expectedVersion: detail.workflow.expectedVersion,
						...(note ? { note } : {}),
					}),
				},
			);
			setTicketDetail(result.detail);
			await Promise.all([refreshApps(), refreshStatus()]);
			const ticketsResult = await requestJson<{
				tickets: LocalSupportTicketSummary[];
			}>(`/api/apps/${encodeURIComponent(detail.app.id)}/tickets`);
			setTickets(ticketsResult.tickets);
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not perform the ticket action",
			);
		} finally {
			setBusyActionId(undefined);
		}
	};

	const resetLiveWorkflow = async (scenario: LocalScenarioName) => {
		setLoading(true);
		setError(undefined);
		try {
			await requestJson("/api/workflow/reset", {
				method: "POST",
				body: JSON.stringify({ scenario }),
			});
			await Promise.all([refreshApps(), refreshStatus()]);
			const current = route();
			if (current.screen !== "apps") {
				const ticketsResult = await requestJson<{
					tickets: LocalSupportTicketSummary[];
				}>(`/api/apps/${encodeURIComponent(current.appId)}/tickets`);
				setTickets(ticketsResult.tickets);
			}
			if (current.screen === "ticket" && current.issueNumber === 4821) {
				const detailResult = await requestJson<{
					detail: LocalSupportTicketDetail;
				}>(
					`/api/apps/${encodeURIComponent(current.appId)}/tickets/${current.issueNumber}`,
				);
				setTicketDetail(detailResult.detail);
			}
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not reset the local workflow",
			);
		} finally {
			setLoading(false);
		}
	};

	onSettled(() => {
		void initialise();
	});

	return (
		<Center w="full">
			<Page size={route().screen === "ticket" ? "md" : "full"}>
				<Stack gap="5">
					<Show when={loading()}>
						<Card padding="md" role="status" aria-live="polite">
							<Flex align="center" gap="2">
								<Bot size={16} />
								<Text size="sm" variant="muted">
									Loading private support activity…
								</Text>
							</Flex>
						</Card>
					</Show>

					<Show when={error()}>
						{(message) => (
							<Callout variant="error" role="alert">
								<CalloutTitle>Support inbox could not continue</CalloutTitle>
								<CalloutContent>{message()}</CalloutContent>
							</Callout>
						)}
					</Show>

					<Show when={!loading() && !error()}>
						<Show when={route().screen === "apps"}>
							<AppsScreen
								apps={apps()}
								onOpenApp={(app) => void openApp(app)}
							/>
							<DeveloperTools
								status={devStatus()}
								loading={loading()}
								onReset={(scenario) => void resetLiveWorkflow(scenario)}
							/>
						</Show>

						<Show when={route().screen === "tickets" && selectedApp()}>
							<Show when={selectedApp()}>
								{(app) => (
									<TicketsScreen
										app={app()}
										tickets={tickets()}
										filter={ticketFilter()}
										onFilterChange={setTicketFilter}
										onBack={() => setRoute({ screen: "apps" })}
										onOpenTicket={(ticket) => void openTicket(ticket)}
									/>
								)}
							</Show>
						</Show>

						<Show when={route().screen === "ticket" && ticketDetail()}>
							<Show when={ticketDetail()}>
								{(detail) => (
									<TicketDetailScreen
										detail={detail()}
										busyActionId={busyActionId()}
										onBack={() =>
											setRoute({ screen: "tickets", appId: detail().app.id })
										}
										onAction={(action) => void performTicketAction(action)}
									/>
								)}
							</Show>
						</Show>
					</Show>
				</Stack>
				<DialogResponse />
			</Page>
		</Center>
	);
}
