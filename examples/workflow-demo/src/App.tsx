/** @jsxImportSource @solidjs/web */
import {
	Badge,
	Button,
	Card,
	Flex,
	Page,
	PageDescription,
	PageHeader,
	PageTitle,
	Stack,
	Text,
} from "@xgx/ui";
import { createSignal, For, onSettled, Show } from "solid-js";
import { AgentActivityPanel } from "../../../packages/support-ui/src/components/agent-activity-panel.tsx";
import type { WorkflowAction } from "../../../packages/support-workflow/src/contracts.ts";
import type { StaffWorkflowPanelView } from "../../../packages/support-workflow/src/staff-view.ts";
import type { LocalScenarioName } from "../lab.ts";
import { workflowScenarios } from "./fixtures.ts";

interface DevStatus {
	runtime: {
		mode: "qm-mock" | "qm-live" | "scripted";
		qmUrl?: string;
		workflowState?: string;
		agentStages: string[];
		deployments: number;
		publicResponses: number;
	};
	qm: {
		state: "healthy" | "unhealthy" | "not_started";
		url?: string;
		error?: string;
	};
}

const localScenarios: Array<{
	id: LocalScenarioName;
	label: string;
}> = [
	{ id: "happy", label: "Happy path" },
	{ id: "shadow", label: "Shadow" },
	{ id: "answer", label: "Answer only" },
	{ id: "restricted", label: "Restricted" },
	{ id: "p0", label: "P0 stop" },
	{ id: "qc-fail", label: "QC failure" },
	{ id: "stale", label: "Stale input" },
];

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

export default function App() {
	const [selectedId, setSelectedId] = createSignal("live");
	const [liveView, setLiveView] = createSignal<StaffWorkflowPanelView>();
	const [devStatus, setDevStatus] = createSignal<DevStatus>();
	const [lastAction, setLastAction] = createSignal<string>();
	const [error, setError] = createSignal<string>();
	const [loading, setLoading] = createSignal(true);
	const selectedScenario = () =>
		workflowScenarios.find((scenario) => scenario.id === selectedId());
	const isLive = () => selectedId() === "live";

	const refreshStatus = async () => {
		const status = await requestJson<DevStatus>("/api/dev/status");
		setDevStatus(status);
	};

	const refresh = async () => {
		setLoading(true);
		setError(undefined);
		try {
			const [{ view }, status] = await Promise.all([
				requestJson<{ view: StaffWorkflowPanelView | null }>("/api/workflow"),
				requestJson<DevStatus>("/api/dev/status"),
			]);
			setLiveView(view ?? undefined);
			setDevStatus(status);
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not load the local workflow",
			);
		} finally {
			setLoading(false);
		}
	};

	const resetLiveWorkflow = async (scenario: LocalScenarioName) => {
		setLoading(true);
		setError(undefined);
		setLastAction(undefined);
		try {
			const result = await requestJson<{ view: StaffWorkflowPanelView }>(
				"/api/workflow/reset",
				{
					method: "POST",
					body: JSON.stringify({ scenario }),
				},
			);
			setLiveView(result.view);
			await refreshStatus();
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

	const performLiveAction = async (
		action: { id: WorkflowAction; label: string },
		expectedVersion: number,
	) => {
		setLoading(true);
		setError(undefined);
		try {
			const result = await requestJson<{ view: StaffWorkflowPanelView }>(
				"/api/workflow/action",
				{
					method: "POST",
					body: JSON.stringify({
						action: action.id,
						expectedVersion,
					}),
				},
			);
			setLiveView(result.view);
			setLastAction(action.label);
			await refreshStatus();
		} catch (requestError) {
			setError(
				requestError instanceof Error
					? requestError.message
					: "Could not perform the local workflow action",
			);
		} finally {
			setLoading(false);
		}
	};

	onSettled(() => {
		void refresh();
	});

	return (
		<Page size="xl">
			<Stack gap="6">
				<PageHeader>
					<Stack gap="2">
						<Flex align="center" gap="2" wrap="wrap">
							<PageTitle>Private QM workflow activity</PageTitle>
							<Badge variant="warning">Staff only</Badge>
						</Flex>
						<PageDescription>
							Run the private workflow locally through Bun, inspect every agent
							artifact, and exercise human gates without changing GitHub or a
							deployment.
						</PageDescription>
					</Stack>
				</PageHeader>

				<Card padding="md">
					<Stack gap="3">
						<Flex align="center" gap="2" wrap="wrap">
							<Badge variant="success">Bun development stack</Badge>
							<Show when={devStatus()?.runtime.mode === "qm-mock"}>
								<Badge variant="secondary">QM mock · signed HTTP</Badge>
							</Show>
							<Show when={devStatus()?.runtime.mode === "qm-live"}>
								<Badge variant="warning">QM live · real model</Badge>
							</Show>
							<Show when={devStatus()?.runtime.mode === "scripted"}>
								<Badge variant="secondary">Scripted fallback</Badge>
							</Show>
							<Show when={devStatus()?.qm.state === "healthy"}>
								<Badge variant="success">QM connected</Badge>
							</Show>
							<Show when={devStatus()?.qm.state === "unhealthy"}>
								<Badge variant="danger">QM unavailable</Badge>
							</Show>
						</Flex>
						<Text as="p" size="sm" variant="muted">
							Mock mode runs the vendored QM core, HMAC source authentication,
							fail-closed input screening, and async run worker under Bun. Its
							artifacts are deterministic and perform no repository mutation.
						</Text>
						<Show when={devStatus()?.qm.error}>
							{(message) => (
								<Text as="p" size="sm" variant="destructive">
									{message()}
								</Text>
							)}
						</Show>
					</Stack>
				</Card>

				<Card padding="md">
					<Stack gap="3">
						<Text size="xs" weight="semibold" variant="muted">
							Workflow view
						</Text>
						<Flex align="center" gap="2" wrap="wrap">
							<Button
								size="sm"
								aria-pressed={isLive() ? "true" : "false"}
								variant={isLive() ? "default" : "outline"}
								onClick={() => setSelectedId("live")}
							>
								Live Bun workflow
							</Button>
							<For each={workflowScenarios}>
								{(scenario) => (
									<Button
										size="sm"
										aria-pressed={
											selectedId() === scenario.id ? "true" : "false"
										}
										variant={
											selectedId() === scenario.id ? "default" : "outline"
										}
										onClick={() => {
											setSelectedId(scenario.id);
											setLastAction(undefined);
										}}
									>
										{scenario.label}
									</Button>
								)}
							</For>
						</Flex>

						<Show when={isLive()}>
							<Stack gap="3">
								<Text as="p" size="sm" variant="muted">
									Start a fresh in-memory workflow at any guarded path.
								</Text>
								<Flex align="center" gap="2" wrap="wrap">
									<For each={localScenarios}>
										{(scenario) => (
											<Button
												size="sm"
												variant="outline"
												disabled={loading()}
												onClick={() => void resetLiveWorkflow(scenario.id)}
											>
												{scenario.label}
											</Button>
										)}
									</For>
								</Flex>
							</Stack>
						</Show>

						<Show when={selectedScenario()}>
							{(scenario) => (
								<Text as="p" size="sm" variant="muted">
									{scenario().description}
								</Text>
							)}
						</Show>
						<Show when={loading()}>
							<Text as="p" size="sm" variant="muted">
								Running the local workflow…
							</Text>
						</Show>
						<Show when={error()}>
							{(message) => (
								<Text as="p" size="sm" variant="destructive">
									{message()}
								</Text>
							)}
						</Show>
						<Show when={lastAction()}>
							{(action) => (
								<Text as="p" size="sm">
									Local action completed: {action()}. External adapters remain
									record-only.
								</Text>
							)}
						</Show>
					</Stack>
				</Card>

				<Show when={isLive()}>
					<Show when={liveView()}>
						{(view) => (
							<AgentActivityPanel
								workflow={view().workflow}
								items={view().items}
								availableActions={view().availableActions}
								confirmationContext={view().confirmationContext}
								onAction={(action, confirmation) =>
									performLiveAction(
										action,
										confirmation?.expectedVersion ?? view().expectedVersion,
									)
								}
							/>
						)}
					</Show>
				</Show>

				<Show when={selectedScenario()}>
					{(scenario) => (
						<AgentActivityPanel
							workflow={scenario().workflow}
							items={scenario().items}
							availableActions={scenario().actions}
							confirmationContext={scenario().confirmationContext}
							onAction={(action) => {
								setLastAction(action.label);
							}}
						/>
					)}
				</Show>
			</Stack>
		</Page>
	);
}
