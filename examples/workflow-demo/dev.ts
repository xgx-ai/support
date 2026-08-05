import { resolve, sep } from "node:path";
import { z } from "zod";
import { workflowActionSchema } from "../../packages/support-workflow/src/contracts.ts";
import { buildDemo, demoDist } from "./build.ts";
import {
	createLocalWorkflowLab,
	type LocalAgentMode,
	localScenarioNames,
} from "./lab.ts";

await buildDemo();

const configuredMode = Bun.env.SUPPORT_AGENT_MODE;
const mode: LocalAgentMode =
	configuredMode === "mock"
		? "agent-mock"
		: configuredMode === "live"
			? "agent-live"
			: "scripted";
const agentUrl = Bun.env.SUPPORT_AGENT_BASE_URL;
const lab = createLocalWorkflowLab({
	mode,
	agentUrl,
	agentSigningSecret: Bun.env.SUPPORT_AGENT_SIGNING_SECRET,
	workspaceRoot: Bun.env.SUPPORT_AGENT_WORKSPACE_ROOT,
});
if (mode === "agent-live") await lab.initialize("happy");
else await lab.reset("happy");

const resetInputSchema = z.object({
	scenario: z.enum(localScenarioNames).default("happy"),
});
const actionInputSchema = z.object({
	action: workflowActionSchema,
	expectedVersion: z.number().int().nonnegative(),
	note: z.string().trim().min(1).max(4_000).optional(),
});
const appIdSchema = z.string().regex(/^[a-z0-9-]+$/);
const issueNumberSchema = z.coerce.number().int().positive();
const runtimeHealthSchema = z.object({
	sandbox: z
		.object({
			required: z.boolean(),
			configured: z.boolean(),
			access: z.array(z.enum(["read_only", "candidate_write"])),
		})
		.optional(),
});

function pathSegments(pathname: string): string[] | null {
	try {
		return pathname
			.split("/")
			.filter(Boolean)
			.map((segment) => decodeURIComponent(segment));
	} catch {
		return null;
	}
}

function json(value: unknown, status = 200): Response {
	return Response.json(value, {
		status,
		headers: { "cache-control": "no-store" },
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Local workflow request failed";
}

let mutationTail: Promise<unknown> = Promise.resolve();
function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
	const pending = mutationTail.then(operation, operation);
	mutationTail = pending.catch(() => undefined);
	return pending;
}

async function agentHealth() {
	if (!agentUrl || mode === "scripted")
		return { state: "not_started" as const };
	try {
		const response = await fetch(`${agentUrl.replace(/\/$/, "")}/healthz`, {
			signal: AbortSignal.timeout(1_000),
		});
		if (!response.ok) return { state: "unhealthy" as const, url: agentUrl };
		const health = runtimeHealthSchema.safeParse(await response.json());
		return {
			state: "healthy" as const,
			url: agentUrl,
			...(health.success && health.data.sandbox
				? { sandbox: health.data.sandbox }
				: {}),
		};
	} catch (error) {
		return {
			state: "unhealthy" as const,
			url: agentUrl,
			error: errorMessage(error),
		};
	}
}

const requestedPort = Number.parseInt(
	Bun.env.SUPPORT_WORKFLOW_DEMO_PORT ?? "4174",
	10,
);
const port = Number.isFinite(requestedPort) ? requestedPort : 4174;

const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request) {
		const url = new URL(request.url);
		const segments = pathSegments(url.pathname);
		if (request.method === "GET" && url.pathname === "/api/dev/status") {
			return json({
				runtime: await lab.status(),
				agent: await agentHealth(),
			});
		}
		if (request.method === "GET" && url.pathname === "/api/workflow") {
			return json({ view: await lab.getView() });
		}
		if (request.method === "GET" && url.pathname === "/api/apps") {
			return json({ apps: await lab.listApps() });
		}
		if (
			segments?.[0] === "api" &&
			segments[1] === "apps" &&
			segments[3] === "tickets"
		) {
			const appId = appIdSchema.safeParse(segments[2]);
			if (!appId.success) return json({ error: "App not found" }, 404);

			if (request.method === "GET" && segments.length === 4) {
				const tickets = await lab.listTickets(appId.data);
				return tickets
					? json({ tickets })
					: json({ error: "App not found" }, 404);
			}

			const issueNumber = issueNumberSchema.safeParse(segments[4]);
			if (!issueNumber.success) {
				return json({ error: "Support ticket not found" }, 404);
			}
			if (request.method === "GET" && segments.length === 5) {
				const detail = await lab.getTicket(appId.data, issueNumber.data);
				return detail
					? json({ detail })
					: json({ error: "Support ticket not found" }, 404);
			}
			if (
				request.method === "POST" &&
				segments.length === 6 &&
				segments[5] === "action"
			) {
				const existing = await lab.getTicket(appId.data, issueNumber.data);
				if (!existing) {
					return json({ error: "Support ticket not found" }, 404);
				}
				try {
					const input = actionInputSchema.parse(await request.json());
					const detail = await serializeMutation(() =>
						lab.performTicketAction({
							appId: appId.data,
							issueNumber: issueNumber.data,
							...input,
						}),
					);
					return json({ detail });
				} catch (error) {
					return json({ error: errorMessage(error) }, 400);
				}
			}

			return json({ error: "Support inbox route not found" }, 404);
		}
		if (request.method === "POST" && url.pathname === "/api/workflow/reset") {
			try {
				const input = resetInputSchema.parse(await request.json());
				const view = await serializeMutation(() =>
					mode === "agent-live"
						? lab.initialize(input.scenario)
						: lab.reset(input.scenario),
				);
				return json({ view });
			} catch (error) {
				return json({ error: errorMessage(error) }, 400);
			}
		}
		if (request.method === "POST" && url.pathname === "/api/workflow/action") {
			try {
				const input = actionInputSchema.parse(await request.json());
				const view = await serializeMutation(() => lab.performAction(input));
				return json({ view });
			} catch (error) {
				return json({ error: errorMessage(error) }, 400);
			}
		}
		if (url.pathname === "/favicon.ico")
			return new Response(null, { status: 204 });

		const requestedAsset =
			url.pathname === "/"
				? "index.html"
				: decodeURIComponent(url.pathname.slice(1));
		const assetPath = resolve(demoDist, requestedAsset);
		const insideDist =
			assetPath === resolve(demoDist, "index.html") ||
			assetPath.startsWith(`${resolve(demoDist)}${sep}`);

		if (!insideDist) return new Response("Not found", { status: 404 });

		const asset = Bun.file(assetPath);
		if (!(await asset.exists()))
			return new Response("Not found", { status: 404 });

		return new Response(asset);
	},
});

console.log(
	`Staff workflow demo available at ${server.url} (runtime=${mode}${agentUrl ? `, agent=${agentUrl}` : ""})`,
);
