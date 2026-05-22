// GitHub REST API client
// Authenticates as a GitHub App via JWT -> installation token.

import { createGitHubAppJwt } from "./github-app-jwt";

const GH_BASE_URL = "https://api.github.com";

function parseRepository(value: string): { owner: string; repo: string } {
	const [owner, repo, extra] = value.split("/");
	if (!owner || !repo || extra) {
		throw new Error("GitHub repository must be in owner/repo format.");
	}
	return { owner, repo };
}

function getRepositoryConfig(): { owner: string; repo: string } {
	const repository = process.env.GITHUB_REPOSITORY;
	if (repository) {
		return parseRepository(repository);
	}

	const owner = process.env.GITHUB_REPO_OWNER;
	const repo = process.env.GITHUB_REPO_NAME;
	if (owner && repo) {
		return { owner, repo };
	}

	throw new Error(
		"GITHUB_REPOSITORY or both GITHUB_REPO_OWNER and GITHUB_REPO_NAME must be set.",
	);
}

function getAppConfig() {
	const appId = process.env.GITHUB_APP_ID;
	const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
	const privateKeyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
	const { owner, repo } = getRepositoryConfig();

	if (!appId || !installationId || !privateKeyBase64 || !repo) {
		throw new Error(
			"GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY_BASE64, and GitHub repository config must be set.",
		);
	}

	const privateKey = atob(privateKeyBase64);
	return { appId, installationId, privateKey, owner, repo };
}

// --- Installation Token Cache ---

let cachedToken: { token: string; expiresAt: number } | null = null;

function createAppJwt(): string {
	const { appId, privateKey } = getAppConfig();
	return createGitHubAppJwt(appId, privateKey);
}

async function getInstallationToken(): Promise<string> {
	if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
		return cachedToken.token;
	}

	const { installationId } = getAppConfig();
	const jwt = await createAppJwt();

	const res = await fetch(
		`${GH_BASE_URL}/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
			},
		},
	);

	if (!res.ok) {
		throw new Error(
			`Failed to get installation token: ${res.status} ${res.statusText}`,
		);
	}

	const data = (await res.json()) as { token: string; expires_at: string };
	cachedToken = {
		token: data.token,
		expiresAt: new Date(data.expires_at).getTime(),
	};

	return cachedToken.token;
}

// --- GitHub API Response Types ---

export interface GHLabel {
	id: number;
	name: string;
	color: string;
}

export interface GHUser {
	login: string;
	avatar_url: string;
	name?: string | null;
}

interface GHRawIssue {
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	labels: GHLabel[];
	user: GHUser | null;
	assignee: GHUser | null;
	assignees: GHUser[];
	comments: number;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
}

export interface GHAssignee extends GHUser {
	assigned_at: string | null;
}

export interface GHIssue extends Omit<GHRawIssue, "assignee" | "assignees"> {
	assignee: GHAssignee | null;
	assignees: GHAssignee[];
	assigned_at: string | null;
}

export interface GHComment {
	id: number;
	body: string;
	user: GHUser | null;
	created_at: string;
	updated_at: string;
}

interface GHIssueEvent {
	id: number;
	event: string;
	created_at: string;
	assignee?: GHUser | null;
}

interface GHUserProfile {
	name: string | null;
}

// --- Fetch Wrapper ---

async function ghFetch<T>(path: string, options?: RequestInit): Promise<T> {
	const token = await getInstallationToken();

	const res = await fetch(`${GH_BASE_URL}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
			...options?.headers,
		},
	});

	if (res.status === 404) {
		throw new Error("Not found on GitHub");
	}

	if (res.status === 403 || res.status === 429) {
		throw new Error("GitHub API rate limit exceeded. Try again shortly.");
	}

	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
	}

	return res.json() as Promise<T>;
}

// --- Convenience Functions ---

function getRepo() {
	const { owner, repo } = getAppConfig();
	return { owner, repo };
}

const userProfileCache = new Map<string, Promise<GHUserProfile>>();

async function getUserProfile(login: string): Promise<GHUserProfile> {
	const cached = userProfileCache.get(login);
	if (cached) return cached;

	const request = ghFetch<GHUserProfile>(`/users/${login}`).catch((error) => {
		console.error(`Error getting GitHub user profile for ${login}:`, error);
		return { name: null };
	});
	userProfileCache.set(login, request);
	return request;
}

async function listIssueEvents(issueNumber: number): Promise<GHIssueEvent[]> {
	const { owner, repo } = getRepo();
	const perPage = 100;
	let page = 1;
	const allEvents: GHIssueEvent[] = [];

	for (;;) {
		const events = await ghFetch<GHIssueEvent[]>(
			`/repos/${owner}/${repo}/issues/${issueNumber}/events?page=${page}&per_page=${perPage}`,
		);
		allEvents.push(...events);
		if (events.length < perPage) break;
		page += 1;
	}

	return allEvents;
}

export function findCurrentAssigneeAssignedAt(
	events: GHIssueEvent[],
	login: string,
): string | null {
	const sortedEvents = [...events].sort(
		(a, b) =>
			new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
	);
	let assignedAt: string | null = null;

	for (const event of sortedEvents) {
		if (event.assignee?.login !== login) continue;

		if (event.event === "assigned") {
			assignedAt = event.created_at;
		}
		if (event.event === "unassigned") {
			assignedAt = null;
		}
	}

	return assignedAt;
}

function getCurrentAssigneeLogins(issue: GHRawIssue): Set<string> {
	const logins = new Set<string>();
	if (issue.assignee) {
		logins.add(issue.assignee.login);
	}
	for (const assignee of issue.assignees ?? []) {
		logins.add(assignee.login);
	}
	return logins;
}

async function hydrateIssueAssignment(issue: GHRawIssue): Promise<GHIssue> {
	const logins = getCurrentAssigneeLogins(issue);
	if (logins.size === 0) {
		return {
			...issue,
			assignee: null,
			assignees: [],
			assigned_at: null,
		};
	}

	let events: GHIssueEvent[] = [];
	try {
		events = await listIssueEvents(issue.number);
	} catch (error) {
		console.error(
			`Error getting issue #${issue.number} assignment events:`,
			error,
		);
	}

	const withAssignedAt = async (user: GHUser): Promise<GHAssignee> => {
		const profile = await getUserProfile(user.login);
		return {
			...user,
			name: profile.name ?? user.name ?? null,
			assigned_at: findCurrentAssigneeAssignedAt(events, user.login),
		};
	};
	const assignees = await Promise.all(
		(issue.assignees ?? []).map(withAssignedAt),
	);
	const assignee = issue.assignee
		? await withAssignedAt(issue.assignee)
		: (assignees[0] ?? null);

	return {
		...issue,
		assignee,
		assignees,
		assigned_at: assignee?.assigned_at ?? assignees[0]?.assigned_at ?? null,
	};
}

export async function listIssues(params?: {
	state?: "open" | "closed" | "all";
	page?: number;
	perPage?: number;
}): Promise<GHIssue[]> {
	const { owner, repo } = getRepo();
	const state = params?.state ?? "open";
	const page = params?.page ?? 1;
	const perPage = params?.perPage ?? 30;

	const issues = await ghFetch<GHRawIssue[]>(
		`/repos/${owner}/${repo}/issues?state=${state}&page=${page}&per_page=${perPage}&sort=created&direction=desc`,
	);
	return Promise.all(issues.map((issue) => hydrateIssueAssignment(issue)));
}

export async function getIssue(issueNumber: number): Promise<GHIssue> {
	const { owner, repo } = getRepo();
	const issue = await ghFetch<GHRawIssue>(
		`/repos/${owner}/${repo}/issues/${issueNumber}`,
	);
	return hydrateIssueAssignment(issue);
}

export async function createIssue(params: {
	title: string;
	body: string;
}): Promise<GHIssue> {
	const { owner, repo } = getRepo();
	const issue = await ghFetch<GHRawIssue>(`/repos/${owner}/${repo}/issues`, {
		method: "POST",
		body: JSON.stringify({ title: params.title, body: params.body }),
	});
	return hydrateIssueAssignment(issue);
}

export async function listComments(
	issueNumber: number,
	params?: { page?: number; perPage?: number },
): Promise<GHComment[]> {
	const { owner, repo } = getRepo();
	const page = params?.page ?? 1;
	const perPage = params?.perPage ?? 50;

	return ghFetch<GHComment[]>(
		`/repos/${owner}/${repo}/issues/${issueNumber}/comments?page=${page}&per_page=${perPage}`,
	);
}

export async function createComment(params: {
	issueNumber: number;
	body: string;
}): Promise<GHComment> {
	const { owner, repo } = getRepo();
	return ghFetch<GHComment>(
		`/repos/${owner}/${repo}/issues/${params.issueNumber}/comments`,
		{
			method: "POST",
			body: JSON.stringify({ body: params.body }),
		},
	);
}

/**
 * Replace the entire label set on an issue.
 * Accepts an array of label names. GitHub will create labels that don't exist
 * yet in the repo.
 */
export async function setLabels(params: {
	issueNumber: number;
	labels: string[];
}): Promise<GHLabel[]> {
	const { owner, repo } = getRepo();
	return ghFetch<GHLabel[]>(
		`/repos/${owner}/${repo}/issues/${params.issueNumber}/labels`,
		{
			method: "PUT",
			body: JSON.stringify({ labels: params.labels }),
		},
	);
}

/**
 * Add labels to an issue (without removing existing ones).
 */
export async function addLabels(params: {
	issueNumber: number;
	labels: string[];
}): Promise<GHLabel[]> {
	const { owner, repo } = getRepo();
	return ghFetch<GHLabel[]>(
		`/repos/${owner}/${repo}/issues/${params.issueNumber}/labels`,
		{
			method: "POST",
			body: JSON.stringify({ labels: params.labels }),
		},
	);
}
