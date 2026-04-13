// GitHub App JWT creation using RS256
// Used to authenticate as a GitHub App before exchanging for an installation token.

import crypto from "node:crypto";

function base64url(data: string | Buffer): string {
	const buf = typeof data === "string" ? Buffer.from(data) : data;
	return buf.toString("base64url");
}

export function createGitHubAppJwt(
	appId: string,
	privateKeyPem: string,
): string {
	const now = Math.floor(Date.now() / 1000);

	const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const payload = base64url(
		JSON.stringify({ iss: appId, iat: now - 60, exp: now + 600 }),
	);

	const signature = crypto
		.sign("sha256", Buffer.from(`${header}.${payload}`), privateKeyPem)
		.toString("base64url");

	return `${header}.${payload}.${signature}`;
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
	const parts = jwt.split(".");
	if (parts.length !== 3) throw new Error("Invalid JWT");
	const payload = parts[1];
	if (!payload) throw new Error("Invalid JWT: missing payload");
	return JSON.parse(Buffer.from(payload, "base64url").toString());
}
