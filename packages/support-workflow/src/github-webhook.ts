import type { SupportIssueSnapshot } from "./contracts";
import { githubEventKey } from "./idempotency";
import type { SupportRouteResolver, WorkflowQueue } from "./ports";

export interface SupportWebhookEventLike {
	type: string;
	deliveryId: string | null;
	issue: {
		number: number;
		title: string;
		updated_at: string;
		labels: Array<{ name: string }>;
	};
	issueBody: string | null;
	issueMeta: Record<string, string>;
	repository?: { full_name: string };
	sender?: { login: string } | null;
	commentBody?: string;
	commentMeta?: Record<string, string>;
	comment?: { updated_at: string };
}

export type ControllerAuthoredResponsePredicate = (
	event: SupportWebhookEventLike,
) => boolean | Promise<boolean>;

export interface CreateSupportWorkflowWebhookEnqueuerOptions {
	queue: WorkflowQueue;
	routes: SupportRouteResolver;
	/**
	 * Trusted, application-owned check for comments published by this workflow.
	 * Sender names are not sufficient because customer actions are also proxied by
	 * the GitHub App. Callers should validate controller metadata against their
	 * durable publication record before returning true.
	 */
	isControllerAuthoredResponse?: ControllerAuthoredResponsePredicate;
	now?: () => Date;
}

const supportedEvents = new Set([
	"issue.opened",
	"issue.edited",
	"issue.closed",
	"issue.deleted",
	"issue.reopened",
	"issue.transferred",
	"issue.labeled",
	"issue.unlabeled",
	"comment.created",
	"comment.edited",
	"comment.deleted",
]);

/**
 * Creates the fast webhook-to-queue adapter. It deliberately does not call QM
 * or execute a workflow while the GitHub request is open.
 */
export function createSupportWorkflowWebhookEnqueuer(
	options: CreateSupportWorkflowWebhookEnqueuerOptions,
): (event: SupportWebhookEventLike) => Promise<void> {
	const now = options.now ?? (() => new Date());

	return async (event) => {
		if (!supportedEvents.has(event.type)) return;
		if (!event.deliveryId) {
			throw new Error("Workflow ingress requires X-GitHub-Delivery");
		}
		if (!event.repository?.full_name) {
			throw new Error("Workflow ingress requires a GitHub repository");
		}

		if (
			event.type.startsWith("comment.") &&
			(await options.isControllerAuthoredResponse?.(event))
		) {
			return;
		}

		const issue: SupportIssueSnapshot = {
			supportRepository: event.repository.full_name,
			issueNumber: event.issue.number,
			title: event.issue.title,
			body: event.issueBody ?? "",
			labels: event.issue.labels.map((label) => label.name),
			authorId: event.issueMeta.authorId,
			latestComment:
				event.type === "comment.deleted" ? undefined : event.commentBody,
			triggerType: event.type,
			updatedAt: event.comment?.updated_at ?? event.issue.updated_at,
		};
		const route = await options.routes.resolve(issue);
		if (!route) {
			throw new Error(
				`No support workflow route for ${issue.supportRepository}#${issue.issueNumber}`,
			);
		}

		await options.queue.enqueue({
			idempotencyKey: githubEventKey(issue.supportRepository, event.deliveryId),
			deliveryId: event.deliveryId,
			eventType: event.type,
			issue,
			route,
			receivedAt: now().toISOString(),
		});
	};
}
