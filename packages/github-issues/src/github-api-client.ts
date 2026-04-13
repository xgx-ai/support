// GitHub REST API client
// Authenticates as a GitHub App via JWT -> installation token.

import { createGitHubAppJwt } from "./github-app-jwt";

const GH_BASE_URL = "https://api.github.com";

/** Owner is always xgx-ai for all consuming projects. */
const OWNER = "xgx-ai";

function getAppConfig() {
	const appId = process.env.GITHUB_APP_ID;
	const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
	const privateKeyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
	const repo = process.env.GITHUB_REPO_NAME;

	if (!appId || !installationId || !privateKeyBase64 || !repo) {
		throw new Error(
			"GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY_BASE64, and GITHUB_REPO_NAME must be set.",
		);
	}

	const privateKey = atob(privateKeyBase64);
	return { appId, installationId, privateKey, owner: OWNER, repo };
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
}

export interface GHIssue {
	number: number;
	title: string;
	body: string | null;
	state: "open" | "closed";
	labels: GHLabel[];
	user: GHUser | null;
	comments: number;
	created_at: string;
	updated_at: string;
}

export interface GHComment {
	id: number;
	body: string;
	user: GHUser | null;
	created_at: string;
	updated_at: string;
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

export async function listIssues(params?: {
	state?: "open" | "closed" | "all";
	page?: number;
	perPage?: number;
}): Promise<GHIssue[]> {
	const { owner, repo } = getRepo();
	const state = params?.state ?? "open";
	const page = params?.page ?? 1;
	const perPage = params?.perPage ?? 30;

	return ghFetch<GHIssue[]>(
		`/repos/${owner}/${repo}/issues?state=${state}&page=${page}&per_page=${perPage}&sort=created&direction=desc`,
	);
}

export async function getIssue(issueNumber: number): Promise<GHIssue> {
	const { owner, repo } = getRepo();
	return ghFetch<GHIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`);
}

export async function createIssue(params: {
	title: string;
	body: string;
}): Promise<GHIssue> {
	const { owner, repo } = getRepo();
	return ghFetch<GHIssue>(`/repos/${owner}/${repo}/issues`, {
		method: "POST",
		body: JSON.stringify({ title: params.title, body: params.body }),
	});
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
