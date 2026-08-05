import type {
	AnyTRPCRootTypes,
	TRPCProcedureBuilder,
	TRPCRouterBuilder,
	TRPCUnsetMarker,
} from "@trpc/server";
import { z } from "zod";
import { workflowActionSchema } from "./contracts";
import type { SupportWorkflowController } from "./controller";
import { createStaffWorkflowPanelView } from "./staff-view";

const workspaceInput = z.object({
	workflowId: z.string().min(1),
});

const actionInput = z.object({
	workflowId: z.string().min(1),
	expectedVersion: z.number().int().nonnegative(),
	action: workflowActionSchema,
	note: z.string().min(1).max(4_000).optional(),
	mergedSha: z.string().min(7).max(64).optional(),
});

type WorkflowService = Pick<
	SupportWorkflowController,
	"getStaffWorkspace" | "performAction"
>;

export interface StaffWorkflowActionAuthorizationInput {
	actorId: string;
	action: z.infer<typeof workflowActionSchema>;
	workflowId: string;
}

export type StaffWorkflowActionAuthorizer = (
	input: StaffWorkflowActionAuthorizationInput,
) => void | Promise<void>;

/**
 * Creates the internal workflow router. The supplied procedure must enforce a
 * staff/admin role; never pass the customer support protected procedure here.
 */
export function createSupportWorkflowRouter<
	TRoot extends AnyTRPCRootTypes,
	TContext,
	TMeta,
	TContextOverrides extends { user: { id: string } },
>(
	router: TRPCRouterBuilder<TRoot>,
	staffProcedure: TRPCProcedureBuilder<
		TContext,
		TMeta,
		TContextOverrides,
		TRPCUnsetMarker,
		TRPCUnsetMarker,
		TRPCUnsetMarker,
		TRPCUnsetMarker,
		false
	>,
	service: WorkflowService,
	authorizeAction: StaffWorkflowActionAuthorizer,
) {
	return router({
		workspace: staffProcedure.input(workspaceInput).query(async ({ input }) => {
			try {
				const workspace = await service.getStaffWorkspace(input.workflowId);
				return workspace
					? { data: createStaffWorkflowPanelView(workspace), error: null }
					: { data: null, error: "Workflow not found" };
			} catch (error) {
				return {
					data: null,
					error:
						error instanceof Error
							? error.message
							: "Failed to load support workflow",
				};
			}
		}),

		performAction: staffProcedure
			.input(actionInput)
			.mutation(async ({ input, ctx }) => {
				try {
					await authorizeAction({
						actorId: ctx.user.id,
						action: input.action,
						workflowId: input.workflowId,
					});
					const workflow = await service.performAction({
						...input,
						actorId: ctx.user.id,
					});
					return { data: workflow, error: null };
				} catch (error) {
					return {
						data: null,
						error:
							error instanceof Error
								? error.message
								: "Failed to perform workflow action",
					};
				}
			}),
	});
}
