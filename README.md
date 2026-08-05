# Support

GitHub-backed support issue UI and backend helpers.

## Support agent workflow

Support includes a private, human-gated agent workflow for validating, triaging,
investigating, implementing, reviewing, verifying, and responding to support tickets.
The orchestration belongs to Support, and the small agent process lives in
`packages/support-agent-runtime/`. It has no Slack integration, Fly machinery, cloud
deployment engine, or repository-creation feature.

Start the local stack:

```sh
bun run dev
```

Open <http://127.0.0.1:4174>, choose an application, open a ticket, and review the
suggested fix or the agent activity. The default `mock` harness is deterministic and
makes no model request. It still exercises the private runtime boundary, workflow
controller, and human gates, and automatically prepares a fixture at its first review gate.
Codex mode instead opens at intake and remains idle until **Run agents** is clicked.

For local Codex turns, copy [`.env.example`](./.env.example) to the ignored root
`.env`, then set `SUPPORT_AGENT_HARNESS=codex` and `OPENAI_API_KEY`. Plain
`bun run dev` will use that configuration. The launcher passes the key only to the
agent process; it is never returned to the browser.

The agent harness does not require an external repository or code sandbox for every
turn. Validation, triage, verification, deployment planning, and response drafting run
without one. Investigation may optionally attach an existing repository read-only.
Implementation and QC fail closed until a separate isolated candidate/check runner is
available. Codex itself still runs each local process with its built-in read-only
security sandbox; that process boundary is distinct from optional repository context
and the future writable test runner.

For live investigation, the launcher resolves an explicitly mapped existing sibling
repository beneath `SUPPORT_AGENT_WORKSPACE_ROOT` (the parent of Support by default), verifies
its Git top-level, and records its current HEAD without cloning, creating, committing, or
pushing anything. Codex can read the existing working tree but cannot write it. The UI opens
before any model request; click **Run agents** on the live ticket to start the private plan.
Writable candidate execution remains disabled locally.

Every application route owns an explicit Nix execution profile contract: a named dev shell,
repository-relative working directory, timeout, and exact check argument arrays. Agents
cannot invent commands or alter the profile. A production repository adapter must run those
checks and replace model-reported test claims with observed results. The local Codex lane
stops before implementation; mock mode uses deterministic fake check receipts to exercise the
review UI. Changes to flakes, lockfiles, package manifests, migrations, databases, CI,
infrastructure, authentication, secrets, or releases remain proposal-only.

The command-line scenario runner remains available:

```sh
bun run demo:workflow --scenario=happy
```

See [the support agent workflow plan](./docs/support-agent-workflow.md) for the
architecture, visibility boundary, approval gates, Nix check profiles, rollout modes,
and production integration points. Upstream attribution for the small amount adapted
from QM is recorded in [the third-party provenance note](./docs/third-party/qm-v0.1.4.md).

## Webhook Setup

1. Configure the consuming app:

```sh
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY_BASE64=...
GITHUB_WEBHOOK_SECRET=...
GITHUB_REPOSITORY=owner/repo
```

Alternatively, replace `GITHUB_REPOSITORY` with:

```sh
GITHUB_REPO_OWNER=owner
GITHUB_REPO_NAME=repo
```

2. Add a GitHub webhook for the support issue repository:

```text
Payload URL: https://your-api.example.com/api/webhooks/support
Content type: application/json
Secret: same value as GITHUB_WEBHOOK_SECRET
Events: Issues, Issue comments
```

3. Mount the handler in the consuming backend:

```ts
import { createIssueWebhookHandler } from "@xgx-ai/support/github-issues";

const handleSupportWebhook = createIssueWebhookHandler({
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  handlers: {
    "issue.closed": async (event) => {
      const userId = event.issueMeta.authorId;
      if (!userId) return;

      // Create an in-app notification, send email, etc.
    },
  },
});

if (url.pathname === "/api/webhooks/support") {
  return handleSupportWebhook(req);
}
```

## Local Webhook Replay

Replay a signed `issues.closed` webhook directly from the package:

```sh
SUPPORT_WEBHOOK_URL=http://localhost:8787/api/webhooks/support \
GITHUB_WEBHOOK_SECRET=... \
SUPPORT_WEBHOOK_AUTHOR_ID=... \
SUPPORT_WEBHOOK_TENANT=demo \
support-github-webhook-replay
```

Required environment variables:

```text
SUPPORT_WEBHOOK_URL
GITHUB_WEBHOOK_SECRET
SUPPORT_WEBHOOK_AUTHOR_ID
```

Optional environment variables include `SUPPORT_WEBHOOK_TENANT`,
`SUPPORT_WEBHOOK_AUTHOR`, `SUPPORT_WEBHOOK_ISSUE_NUMBER`,
`SUPPORT_WEBHOOK_TITLE`, `SUPPORT_WEBHOOK_BODY`, and
`SUPPORT_WEBHOOK_ISSUE_META_JSON`.
