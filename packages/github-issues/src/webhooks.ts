import { parseEndmatter } from "./endmatter";
import type { GHIssueStateReason, GHLabel, GHUser } from "./github-api-client";
import {
	githubIssueCommentWebhookPayloadSchema,
	githubIssueWebhookPayloadSchema,
} from "./webhook-schema";

export interface GHRepository {
	id: number;
	name: string;
	full_name: string;
	owner?: GHUser | null;
	html_url?: string;
}

export interface GHIssueWebhookIssue {
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	labels: GHLabel[];
	user: GHUser | null;
	assignee?: GHUser | null;
	assignees?: GHUser[];
	comments?: number;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	state_reason?: GHIssueStateReason | null;
	html_url?: string;
}

export interface GHIssueWebhookComment {
	id: number;
	body: string;
	user: GHUser | null;
	created_at: string;
	updated_at: string;
	html_url?: string;
}

export interface GHIssueWebhookChanges {
	[key: string]: {
		from?: unknown;
	};
}

export interface GHIssueWebhookPayload {
	action: string;
	issue: GHIssueWebhookIssue;
	repository?: GHRepository;
	sender?: GHUser | null;
	label?: GHLabel;
	assignee?: GHUser | null;
	changes?: GHIssueWebhookChanges;
}

export interface GHIssueCommentWebhookPayload extends GHIssueWebhookPayload {
	comment: GHIssueWebhookComment;
}

export type SupportIssueEventType =
	| "issue.assigned"
	| "issue.closed"
	| "issue.deleted"
	| "issue.demilestoned"
	| "issue.edited"
	| "issue.labeled"
	| "issue.locked"
	| "issue.milestoned"
	| "issue.opened"
	| "issue.pinned"
	| "issue.reopened"
	| "issue.transferred"
	| "issue.unassigned"
	| "issue.unlabeled"
	| "issue.unlocked"
	| "issue.unpinned";

export type SupportCommentEventType =
	| "comment.created"
	| "comment.deleted"
	| "comment.edited";

export type SupportWebhookEventType =
	| SupportIssueEventType
	| SupportCommentEventType;

interface SupportWebhookEventBase {
	type: SupportWebhookEventType;
	action: string;
	githubEvent: "issues" | "issue_comment";
	deliveryId: string | null;
	issue: GHIssueWebhookIssue;
	issueBody: string | null;
	issueMeta: Record<string, string>;
	repository?: GHRepository;
	sender?: GHUser | null;
	changes?: GHIssueWebhookChanges;
	payload: unknown;
}

export interface SupportIssueWebhookEvent extends SupportWebhookEventBase {
	type: SupportIssueEventType;
	githubEvent: "issues";
	label?: GHLabel;
	assignee?: GHUser | null;
}

export interface SupportCommentWebhookEvent extends SupportWebhookEventBase {
	type: SupportCommentEventType;
	githubEvent: "issue_comment";
	comment: GHIssueWebhookComment;
	commentBody: string;
	commentMeta: Record<string, string>;
}

export type SupportWebhookEvent =
	| SupportIssueWebhookEvent
	| SupportCommentWebhookEvent;

export type SupportWebhookEventHandler = (
	event: SupportWebhookEvent,
) => void | Promise<void>;

export interface CreateIssueWebhookHandlerOptions {
	/** GitHub webhook secret used for the X-Hub-Signature-256 HMAC. */
	secret: string;
	/** Durable dispatcher called for every supported event. Mutually exclusive with handlers. */
	onEvent?: SupportWebhookEventHandler;
	/** Per-type durable dispatchers. Mutually exclusive with onEvent. */
	handlers?: Partial<
		Record<SupportWebhookEventType, SupportWebhookEventHandler>
	>;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function toHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let diff = 0;
	for (let index = 0; index < a.length; index += 1) {
		diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return diff === 0;
}

async function signBody(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return `sha256=${toHex(signature)}`;
}

async function verifySignature(
	req: Request,
	secret: string,
	body: string,
): Promise<boolean> {
	const signature = req.headers.get("x-hub-signature-256");
	if (!signature?.startsWith("sha256=")) return false;

	const expected = await signBody(secret, body);
	return timingSafeEqual(signature, expected);
}

function parseIssueBody(issue: GHIssueWebhookIssue): {
	body: string | null;
	meta: Record<string, string>;
} {
	if (!issue.body) return { body: null, meta: {} };
	return parseEndmatter(issue.body);
}

type NormalisedWebhookResult =
	| { event: SupportWebhookEvent; error: null }
	| { event: null; error: string | null };

function normaliseWebhookEvent(
	githubEvent: string | null,
	deliveryId: string | null,
	payload: unknown,
): NormalisedWebhookResult {
	const parsed =
		githubEvent === "issues"
			? githubIssueWebhookPayloadSchema.safeParse(payload)
			: githubEvent === "issue_comment"
				? githubIssueCommentWebhookPayloadSchema.safeParse(payload)
				: null;
	if (!parsed) return { event: null, error: null };
	if (!parsed.success) {
		return { event: null, error: "Invalid GitHub webhook payload" };
	}

	const issuePayload = parsed.data as GHIssueWebhookPayload;
	const parsedIssue = parseIssueBody(issuePayload.issue);
	const base = {
		action: issuePayload.action,
		deliveryId,
		issue: issuePayload.issue,
		issueBody: parsedIssue.body,
		issueMeta: parsedIssue.meta,
		repository: issuePayload.repository,
		sender: issuePayload.sender,
		changes: issuePayload.changes,
		payload,
	};

	if (githubEvent === "issues") {
		return {
			event: {
				...base,
				type: `issue.${issuePayload.action}` as SupportIssueEventType,
				githubEvent,
				label: issuePayload.label,
				assignee: issuePayload.assignee,
			},
			error: null,
		};
	}

	if (githubEvent === "issue_comment" && "comment" in parsed.data) {
		const commentPayload = parsed.data as GHIssueCommentWebhookPayload;
		const parsedComment = parseEndmatter(commentPayload.comment.body);
		return {
			event: {
				...base,
				type: `comment.${commentPayload.action}` as SupportCommentEventType,
				githubEvent,
				comment: commentPayload.comment,
				commentBody: parsedComment.body,
				commentMeta: parsedComment.meta,
			},
			error: null,
		};
	}

	return { event: null, error: null };
}

export function createIssueWebhookHandler(
	options: CreateIssueWebhookHandlerOptions,
): (req: Request) => Promise<Response> {
	if (options.onEvent && Object.values(options.handlers ?? {}).some(Boolean)) {
		throw new Error(
			"Configure one durable webhook dispatcher: onEvent or handlers, not both",
		);
	}
	return async function handleIssueWebhook(req: Request): Promise<Response> {
		if (req.method !== "POST") {
			return json({ data: null, error: "Method not allowed" }, 405);
		}

		if (!options.secret) {
			return json(
				{ data: null, error: "Webhook secret is not configured" },
				500,
			);
		}

		const body = await req.text();
		const signatureValid = await verifySignature(req, options.secret, body);
		if (!signatureValid) {
			return json({ data: null, error: "Invalid webhook signature" }, 401);
		}

		const githubEvent = req.headers.get("x-github-event");
		const deliveryId = req.headers.get("x-github-delivery");
		if (githubEvent === "ping") {
			return json({ data: { handled: true, event: "ping" }, error: null });
		}

		let payload: unknown;
		try {
			payload = JSON.parse(body);
		} catch {
			return json({ data: null, error: "Invalid JSON payload" }, 400);
		}

		const normalised = normaliseWebhookEvent(githubEvent, deliveryId, payload);
		if (normalised.error) {
			return json({ data: null, error: normalised.error }, 400);
		}
		const event = normalised.event;
		if (!event) {
			return json(
				{ data: { handled: false, event: githubEvent }, error: null },
				202,
			);
		}

		try {
			const dispatch = options.onEvent ?? options.handlers?.[event.type];
			await dispatch?.(event);
		} catch (error) {
			console.error("Support webhook dispatch failed", error);
			return json({ data: null, error: "Webhook dispatch failed" }, 503);
		}

		return json(
			{ data: { handled: true, event: event.type, deliveryId }, error: null },
			200,
		);
	};
}
