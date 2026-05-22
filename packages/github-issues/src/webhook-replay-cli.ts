#!/usr/bin/env bun

import {
	issueWebhookReplayOptionsFromEnv,
	replayIssueWebhook,
} from "./webhook-replay";

try {
	const response = await replayIssueWebhook(issueWebhookReplayOptionsFromEnv());
	const responseText = await response.text();
	process.stdout.write(`${response.status} ${responseText}\n`);

	if (!response.ok) {
		process.exitCode = 1;
	}
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
}
