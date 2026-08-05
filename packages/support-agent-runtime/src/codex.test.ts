import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
	CodexTurnTimeoutError,
	codexArguments,
	executeCodexTurn,
	finalCodexMessage,
	isolatedCodexEnvironment,
} from "./codex";

const skillsRoot = resolve(import.meta.dir, "../skills");

describe("Support Codex harness", () => {
	test("is ephemeral, non-interactive, read-only, and disables connected tools", () => {
		const args = codexArguments({ prompt: "plan", readOnly: true });
		expect(args).toContain("--json");
		expect(args).toContain("--ephemeral");
		expect(args).toContain("--ignore-user-config");
		expect(args).toContain("--ignore-rules");
		expect(args).toContain("read-only");
		expect(args).toContain('approval_policy="never"');
		expect(args).toContain('web_search="disabled"');
		expect(args).toContain("features.apps=false");
		expect(args).toContain("features.plugins=false");
		expect(args).toContain("features.browser_use=false");
		expect(args).toContain("features.in_app_browser=false");
		expect(args).not.toContain("--skip-git-repo-check");
		expect(
			codexArguments(
				{ prompt: "plan", readOnly: true },
				{ skipGitRepositoryCheck: true },
			),
		).toContain("--skip-git-repo-check");
		expect(() => codexArguments({ prompt: "write", readOnly: false })).toThrow(
			"only accepts read-only turns",
		);
	});

	test("passes provider auth but not unrelated process secrets", () => {
		const environment = isolatedCodexEnvironment(
			{
				PATH: "/bin",
				OPENAI_API_KEY: "provider-key",
				SLACK_BOT_TOKEN: "must-not-leak",
				GITHUB_TOKEN: "must-not-leak",
			},
			"/tmp/isolated",
		);
		expect(environment).toEqual({
			HOME: "/tmp/isolated",
			CODEX_HOME: "/tmp/isolated/codex-home",
			PATH: "/bin",
			OPENAI_API_KEY: "provider-key",
		});
	});

	test("extracts the final agent message from Codex JSONL", () => {
		const output = [
			JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
			JSON.stringify({
				type: "item.completed",
				item: { type: "agent_message", text: "first" },
			}),
			JSON.stringify({
				type: "item.completed",
				item: { type: "agent_message", text: '{"decision":"pass"}' },
			}),
		].join("\n");
		expect(finalCodexMessage(output)).toBe('{"decision":"pass"}');
	});

	test("materializes only Support skills in an ephemeral Codex home", async () => {
		const reply = await executeCodexTurn(
			{ prompt: "plan", readOnly: true },
			{
				skillsRoot,
				timeoutMs: 1_000,
				environment: { PATH: "/bin", OPENAI_API_KEY: "test-key" },
				spawn: (input) => {
					expect(input.stdin).toBe("plan");
					expect(input.command).toContain("--skip-git-repo-check");
					expect(input.cwd.startsWith(input.environment.HOME as string)).toBe(
						true,
					);
					expect(readdirSync(input.cwd)).toEqual([]);
					expect(
						readdirSync(
							resolve(input.environment.CODEX_HOME as string, "skills"),
						).sort(),
					).toEqual([
						"support-deploy",
						"support-implement",
						"support-investigate",
						"support-qc",
						"support-respond",
						"support-triage",
						"support-validate",
						"support-verify-production",
						"support-verify-staging",
					]);
					const stdout = JSON.stringify({
						type: "item.completed",
						item: { type: "agent_message", text: "complete" },
					});
					return {
						stdout: new Response(stdout).body as ReadableStream<Uint8Array>,
						stderr: new Response("").body as ReadableStream<Uint8Array>,
						exited: Promise.resolve(0),
						kill: () => undefined,
					};
				},
			},
			new AbortController().signal,
		);
		expect(reply).toBe("complete");
	});

	test("keeps an attached repository workspace without skipping its Git check", async () => {
		const reply = await executeCodexTurn(
			{ prompt: "inspect", readOnly: true },
			{
				workingDirectory: skillsRoot,
				skillsRoot,
				timeoutMs: 1_000,
				spawn: (input) => {
					expect(input.cwd).toBe(skillsRoot);
					expect(input.command).not.toContain("--skip-git-repo-check");
					const stdout = JSON.stringify({
						type: "item.completed",
						item: { type: "agent_message", text: "inspected" },
					});
					return {
						stdout: new Response(stdout).body as ReadableStream<Uint8Array>,
						stderr: new Response("").body as ReadableStream<Uint8Array>,
						exited: Promise.resolve(0),
						kill: () => undefined,
					};
				},
			},
			new AbortController().signal,
		);
		expect(reply).toBe("inspected");
	});

	test("terminates Codex at the bounded wall-clock timeout", async () => {
		let stop!: () => void;
		const exited = new Promise<number>((resolveExit) => {
			stop = () => resolveExit(143);
		});
		const execution = executeCodexTurn(
			{ prompt: "plan", readOnly: true },
			{
				skillsRoot,
				timeoutMs: 1,
				spawn: () => ({
					stdout: new Response("").body as ReadableStream<Uint8Array>,
					stderr: new Response("").body as ReadableStream<Uint8Array>,
					exited,
					kill: () => stop(),
				}),
			},
			new AbortController().signal,
		);
		await expect(execution).rejects.toBeInstanceOf(CodexTurnTimeoutError);
	});
});
