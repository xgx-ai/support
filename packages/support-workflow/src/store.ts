import type { StaffWorkflowWorkspace } from "./contracts";
import type { WorkflowStore } from "./ports";
import { availableWorkflowActions } from "./state-machine";

export async function getStaffWorkflowWorkspace(
	store: WorkflowStore,
	workflowId: string,
): Promise<StaffWorkflowWorkspace | null> {
	const workflow = await store.get(workflowId);
	if (!workflow) return null;

	const [activities, artifacts, approvals, feedback, outbox] =
		await Promise.all([
			store.listActivities(workflowId),
			store.listArtifacts(workflowId),
			store.listApprovals(workflowId),
			store.listFeedback(workflowId),
			store.listOutbox(workflowId),
		]);

	return {
		workflow,
		activities,
		artifacts,
		approvals,
		feedback,
		outbox,
		availableActions: availableWorkflowActions(workflow),
	};
}
