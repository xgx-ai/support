import { buildEndmatter } from "./endmatter";
import type { GHIssueWebhookPayload, GHRepository } from "./webhooks";

export interface IssueWebhookReplayOptions {
	/** Local or deployed webhook endpoint, for example http://localhost:8787/api/webhooks/support. */
	url: string;
	/** GitHub webhook secret used to sign the replay payload. */
	secret: string;
	/** User id written into support endmatter as authorId. */
	authorId: string;
	/** Display author written into support endmatter as author. */
	author?: string;
	/** Optional tenant/subdomain metadata for multi-tenant consuming apps. */
	tenant?: string;
	/** GitHub issue action. Defaults to closed. */
	action?: string;
	/** Issue number used in the replay payload. Defaults to the current timestamp. */
	issueNumber?: number;
	/** Issue title used in the replay payload. */
	title?: string;
	/** Issue body before hidden support endmatter. */
	body?: string;
	/** Extra hidden support endmatter values. */
	issueMeta?: Record<string, string>;
	/** Repository metadata. Defaults to GITHUB_REPOSITORY or owner/name env vars. */
	repository?: Partial<GHRepository>;
	/** GitHub delivery id. Defaults to a local replay id. */
	deliveryId?: string;
	/** Timestamp used for created_at, updated_at, and closed_at. Defaults to now. */
	now?: Date | string;
}

export interface IssueWebhookReplayEnv {
	GITHUB_REPOSITORY?: string;
	GITHUB_REPO_OWNER?: string;
	GITHUB_REPO_NAME?: string;
	GITHUB_WEBHOOK_SECRET?: string;
	SUPPORT_WEBHOOK_ACTION?: string;
	SUPPORT_WEBHOOK_AUTHOR?: string;
	SUPPORT_WEBHOOK_AUTHOR_ID?: string;
	SUPPORT_WEBHOOK_BODY?: string;
	SUPPORT_WEBHOOK_ISSUE_META_JSON?: string;
	SUPPORT_WEBHOOK_ISSUE_NUMBER?: string;
	SUPPORT_WEBHOOK_TENANT?: string;
	SUPPORT_WEBHOOK_TITLE?: string;
	SUPPORT_WEBHOOK_URL?: string;
}

function requireEnv(
	env: IssueWebhookReplayEnv,
	name: keyof IssueWebhookReplayEnv,
) {
	const value = env[name];
	if (!value) {
		throw new Error(
			`Missing ${name}. Set ${name} to replay a support webhook locally.`,
		);
	}
	return value;
}

function optionalInteger(value: string | undefined, name: string) {
	if (!value) return undefined;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return parsed;
}

function parseRepository(env: IssueWebhookReplayEnv): Partial<GHRepository> {
	if (env.GITHUB_REPOSITORY) {
		const [owner, name, extra] = env.GITHUB_REPOSITORY.split("/");
		if (!owner || !name || extra) {
			throw new Error("GITHUB_REPOSITORY must be in owner/repo format.");
		}
		return {
			name,
			full_name: env.GITHUB_REPOSITORY,
			html_url: `https://github.com/${env.GITHUB_REPOSITORY}`,
		};
	}

	if (env.GITHUB_REPO_OWNER && env.GITHUB_REPO_NAME) {
		const fullName = `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`;
		return {
			name: env.GITHUB_REPO_NAME,
			full_name: fullName,
			html_url: `https://github.com/${fullName}`,
		};
	}

	return {
		name: "support",
		full_name: "local/support",
		html_url: "https://github.com/local/support",
	};
}

function parseIssueMetaJson(value: string | undefined): Record<string, string> {
	if (!value) return {};

	const parsed = JSON.parse(value) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("SUPPORT_WEBHOOK_ISSUE_META_JSON must be a JSON object.");
	}

	return Object.fromEntries(
		Object.entries(parsed).map(([key, entry]) => [key, String(entry)]),
	);
}

function toIsoString(value: Date | string | undefined): string {
	if (!value) return new Date().toISOString();
	if (value instanceof Date) return value.toISOString();
	return value;
}

function toHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
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

export function issueWebhookReplayOptionsFromEnv(
	env: IssueWebhookReplayEnv = process.env as IssueWebhookReplayEnv,
): IssueWebhookReplayOptions {
	return {
		url: requireEnv(env, "SUPPORT_WEBHOOK_URL"),
		secret: requireEnv(env, "GITHUB_WEBHOOK_SECRET"),
		authorId: requireEnv(env, "SUPPORT_WEBHOOK_AUTHOR_ID"),
		author: env.SUPPORT_WEBHOOK_AUTHOR,
		tenant: env.SUPPORT_WEBHOOK_TENANT,
		action: env.SUPPORT_WEBHOOK_ACTION,
		issueNumber: optionalInteger(
			env.SUPPORT_WEBHOOK_ISSUE_NUMBER,
			"SUPPORT_WEBHOOK_ISSUE_NUMBER",
		),
		title: env.SUPPORT_WEBHOOK_TITLE,
		body: env.SUPPORT_WEBHOOK_BODY,
		issueMeta: parseIssueMetaJson(env.SUPPORT_WEBHOOK_ISSUE_META_JSON),
		repository: parseRepository(env),
	};
}

export function createIssueWebhookReplayPayload(
	options: IssueWebhookReplayOptions,
): GHIssueWebhookPayload {
	const issueNumber = options.issueNumber ?? Date.now();
	const action = options.action ?? "closed";
	const title = options.title ?? "Local support webhook replay";
	const body = options.body ?? "Local webhook replay";
	const timestamp = toIsoString(options.now);
	const repository = {
		id: 1,
		name: "support",
		full_name: "local/support",
		html_url: "https://github.com/local/support",
		...options.repository,
	};
	const issueMeta = {
		...options.issueMeta,
		author: options.author ?? "Local Replay",
		authorId: options.authorId,
		...(options.tenant ? { tenant: options.tenant } : {}),
	};

	return {
		action,
		issue: {
			number: issueNumber,
			title,
			body: `${body}${buildEndmatter(issueMeta)}`,
			state: action === "closed" ? "closed" : "open",
			labels: [],
			user: { login: "local-replay", avatar_url: "" },
			assignee: null,
			assignees: [],
			comments: 0,
			created_at: timestamp,
			updated_at: timestamp,
			closed_at: action === "closed" ? timestamp : null,
			html_url: `${repository.html_url}/issues/${issueNumber}`,
		},
		repository,
		sender: { login: "local-replay", avatar_url: "" },
	};
}

export async function createIssueWebhookReplayRequest(
	options: IssueWebhookReplayOptions,
): Promise<Request> {
	const body = JSON.stringify(createIssueWebhookReplayPayload(options));
	const signature = await signBody(options.secret, body);
	const deliveryId =
		options.deliveryId ??
		`local-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

	return new Request(options.url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "support-github-webhook-replay",
			"X-GitHub-Delivery": deliveryId,
			"X-GitHub-Event": "issues",
			"X-Hub-Signature-256": signature,
		},
		body,
	});
}

export async function replayIssueWebhook(
	options: IssueWebhookReplayOptions,
): Promise<Response> {
	return fetch(await createIssueWebhookReplayRequest(options));
}
