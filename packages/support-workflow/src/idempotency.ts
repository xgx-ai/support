function canonicalise(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalise);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalise(child)]),
		);
	}
	return value;
}

export function stableJson(value: unknown): string {
	return JSON.stringify(canonicalise(value));
}

export async function sha256(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function hashValue(value: unknown): Promise<string> {
	return sha256(stableJson(value));
}

export function githubEventKey(
	supportRepository: string,
	deliveryId: string,
): string {
	return `github:${supportRepository}:${deliveryId}`;
}

export function stageIdempotencyKey(input: {
	workflowId: string;
	stage: string;
	inputHash: string;
	attempt: number;
}): string {
	return `support-stage:${input.workflowId}:${input.stage}:${input.inputHash}:${input.attempt}`;
}

export function publicResponseKey(
	workflowId: string,
	artifactHash: string,
): string {
	return `support-response:${workflowId}:${artifactHash}`;
}

export function deploymentKey(
	workflowId: string,
	adapter: string,
	environment: string,
	sha: string,
): string {
	return `support-deploy:${workflowId}:${adapter}:${environment}:${sha}`;
}
