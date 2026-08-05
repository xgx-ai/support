/** @jsxImportSource @solidjs/web */
import {
	ActivityTimeline,
	Badge,
	Button,
	Card,
	type DialogContentProps,
	DialogFooter,
	Flex,
	Heading,
	Link,
	Section,
	SectionContent,
	SectionHeader,
	Stack,
	StatusBadge,
	Text,
	toast,
	useResponseDialog,
} from "@xgx/ui";
import { createSignal, For, Show } from "solid-js";
import {
	type AgentActivityAction,
	type AgentActivityConfirmationContext,
	type AgentActivityItem,
	type AgentActivityLink,
	type AgentActivityPanelProps,
	type AgentActivityStage,
	type AgentRiskLevel,
	getAgentActivityStatusMeta,
	getAgentActivityVisibilityMeta,
	getSafeAgentActivityHref,
	requiresAgentActivityConfirmation,
} from "./agent-activity-panel.types";

export type {
	AgentActivityAction,
	AgentActivityConfirmationContext,
	AgentActivityDetail,
	AgentActivityItem,
	AgentActivityLink,
	AgentActivityPanelProps,
	AgentActivityStage,
	AgentActivityStatus,
	AgentActivityVisibility,
	AgentRiskLevel,
	AgentWorkflowSummary,
} from "./agent-activity-panel.types";

function SafeAgentActivityLink(props: AgentActivityLink) {
	const href = () => getSafeAgentActivityHref(props.href);
	return (
		<Show when={href()}>
			{(safeHref) => <Link href={safeHref()}>{props.label}</Link>}
		</Show>
	);
}

function ConfirmationContextRow(props: {
	label: string;
	value: string | number;
}) {
	return (
		<Flex align="baseline" gap="2" wrap="wrap">
			<Text size="xs" weight="semibold">
				{props.label}
			</Text>
			<Text size="xs">{props.value}</Text>
		</Flex>
	);
}

function AgentActionConfirmation(
	props: DialogContentProps<boolean> & {
		action: AgentActivityAction;
		context: AgentActivityConfirmationContext;
	},
) {
	return (
		<Stack gap="4">
			<Text as="p" size="sm">
				Review the immutable workflow context before continuing. The server will
				re-authorise this exact version.
			</Text>
			<Stack gap="2">
				<ConfirmationContextRow
					label="Workflow"
					value={props.context.workflowId}
				/>
				<ConfirmationContextRow
					label="Version"
					value={props.context.expectedVersion}
				/>
				<Show when={props.context.target}>
					{(target) => (
						<ConfirmationContextRow label="Target" value={target()} />
					)}
				</Show>
				<Show when={props.context.destination}>
					{(destination) => (
						<ConfirmationContextRow label="Destination" value={destination()} />
					)}
				</Show>
			</Stack>
			<DialogFooter>
				<Button variant="outline" onClick={() => props.reject()}>
					Cancel
				</Button>
				<Button
					variant={props.action.id === "cancel" ? "destructive" : "default"}
					onClick={() => props.resolve(true)}
				>
					Confirm {props.action.label}
				</Button>
			</DialogFooter>
		</Stack>
	);
}

const stageLabels: Record<AgentActivityStage, string> = {
	intake: "Intake",
	policy: "Policy gate",
	validate: "Validation",
	triage: "Triage",
	investigate: "Investigation",
	implement: "Implementation",
	qc: "Quality control",
	human_review: "Human review",
	verify_staging: "Staging verification",
	deploy: "Deployment",
	verify_production: "Production verification",
	respond: "Response",
};

const riskLabels: Record<AgentRiskLevel, string> = {
	r0: "R0 · Support only",
	r1: "R1 · Low risk",
	r2: "R2 · Elevated",
	r3: "R3 · Proposal only",
};

const defaultFormatDate = (iso: string) =>
	new Date(iso).toLocaleString("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

function AgentActivityEntry(props: {
	item: AgentActivityItem;
	formatDate: (iso: string) => string;
}) {
	const status = () => getAgentActivityStatusMeta(props.item.status);
	const visibility = () =>
		getAgentActivityVisibilityMeta(props.item.visibility);

	return (
		<Section padding="md" variant="card">
			<Stack gap="3">
				<Flex align="center" justify="between" gap="3" wrap="wrap">
					<Stack gap="1">
						<Heading level={3} size="sm">
							{props.item.title}
						</Heading>
						<Text size="xs" variant="muted">
							{props.formatDate(props.item.occurredAt)}
						</Text>
					</Stack>

					<Flex align="center" gap="2" wrap="wrap">
						<Badge variant="outline">{stageLabels[props.item.stage]}</Badge>
						<StatusBadge
							dot
							dotColor={status().variant}
							variant={status().variant}
						>
							{status().label}
						</StatusBadge>
						<Badge variant={visibility().variant}>{visibility().label}</Badge>
					</Flex>
				</Flex>

				<Text as="p" size="sm">
					{props.item.summary}
				</Text>

				<Show when={(props.item.details?.length ?? 0) > 0}>
					<Stack gap="2">
						<For each={props.item.details}>
							{(detail) => (
								<Flex align="baseline" gap="2" wrap="wrap">
									<Show when={detail.label}>
										<Text size="xs" weight="semibold">
											{detail.label}
										</Text>
									</Show>
									<Text size="xs" variant="muted">
										{detail.value}
									</Text>
								</Flex>
							)}
						</For>
					</Stack>
				</Show>

				<Show when={(props.item.links?.length ?? 0) > 0}>
					<Flex align="center" gap="3" wrap="wrap">
						<For each={props.item.links}>
							{(link) => <SafeAgentActivityLink {...link} />}
						</For>
					</Flex>
				</Show>
			</Stack>
		</Section>
	);
}

/**
 * Staff-only presentation of curated agent workflow activity.
 *
 * This component intentionally has no issue-comment or agent runtime API access. Render it
 * only from a staff-authorised route and supply data from a staff-authorised
 * server procedure.
 */
export function AgentActivityPanel(props: AgentActivityPanelProps) {
	const [pendingActionId, setPendingActionId] = createSignal<string>();
	const { showResponseDialog, DialogResponse } = useResponseDialog();
	const fmt = () => props.formatDate ?? defaultFormatDate;
	const workflowStatus = () =>
		getAgentActivityStatusMeta(props.workflow.status);

	const handleAction = async (action: AgentActivityAction) => {
		if (!props.onAction || action.disabled || pendingActionId()) return;
		setPendingActionId(action.id);
		try {
			const confirmationContext = props.confirmationContext;
			if (requiresAgentActivityConfirmation(action.id)) {
				if (!confirmationContext) return;
				const confirmed = await showResponseDialog<boolean>({
					title: action.label,
					description: action.description ?? "Confirm this workflow action.",
					content: (dialogProps) => (
						<AgentActionConfirmation
							{...dialogProps}
							action={action}
							context={confirmationContext}
						/>
					),
				});
				if (!confirmed) return;
			}
			await props.onAction(action, confirmationContext);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "The agent workflow action failed",
			);
		} finally {
			setPendingActionId(undefined);
		}
	};

	return (
		<Stack gap="4">
			<Card padding="none">
				<SectionHeader
					title={props.workflow.title ?? "Agent activity"}
					badge={
						<StatusBadge
							dot
							dotColor={workflowStatus().variant}
							variant={workflowStatus().variant}
						>
							{workflowStatus().label}
						</StatusBadge>
					}
					action={<Badge variant="warning">Staff only</Badge>}
				/>
				<SectionContent>
					<Stack gap="3">
						<Text as="p" size="sm">
							{props.workflow.summary}
						</Text>

						<Flex align="center" gap="2" wrap="wrap">
							<Show when={props.workflow.activeStage}>
								{(stage) => (
									<Badge variant="outline">{stageLabels[stage()]}</Badge>
								)}
							</Show>
							<Show when={props.workflow.risk}>
								{(risk) => (
									<Badge variant={risk() === "r3" ? "warning" : "outline"}>
										{riskLabels[risk()]}
									</Badge>
								)}
							</Show>
							<Show when={props.workflow.updatedAt}>
								{(updatedAt) => (
									<Text size="xs" variant="muted">
										Updated {fmt()(updatedAt())}
									</Text>
								)}
							</Show>
						</Flex>

						<Show when={(props.workflow.links?.length ?? 0) > 0}>
							<Flex align="center" gap="3" wrap="wrap">
								<For each={props.workflow.links}>
									{(link) => <SafeAgentActivityLink {...link} />}
								</For>
							</Flex>
						</Show>
					</Stack>
				</SectionContent>
			</Card>

			<ActivityTimeline
				items={props.items}
				hasMore={false}
				isFetching={false}
				onFetchMore={() => undefined}
				emptyMessage="No agent activity has been recorded."
				renderItem={(item) => (
					<AgentActivityEntry item={item} formatDate={fmt()} />
				)}
			/>

			<Show when={(props.availableActions?.length ?? 0) > 0}>
				<Card padding="md">
					<Stack gap="3">
						<Heading level={2} size="sm">
							Available actions
						</Heading>
						<For each={props.availableActions}>
							{(action) => (
								<Flex align="center" justify="between" gap="3" wrap="wrap">
									<Stack gap="1">
										<Text size="sm" weight="medium">
											{action.label}
										</Text>
										<Show when={action.description}>
											{(description) => (
												<Text size="xs" variant="muted">
													{description()}
												</Text>
											)}
										</Show>
									</Stack>
									<Button
										variant={action.variant ?? "outline"}
										size="sm"
										disabled={
											!props.onAction ||
											action.disabled ||
											(requiresAgentActivityConfirmation(action.id) &&
												!props.confirmationContext) ||
											Boolean(pendingActionId())
										}
										loading={pendingActionId() === action.id}
										onClick={() => void handleAction(action)}
									>
										{action.label}
									</Button>
								</Flex>
							)}
						</For>
					</Stack>
				</Card>
			</Show>
			<DialogResponse />
		</Stack>
	);
}
