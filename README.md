# Support

GitHub-backed support issue UI and backend helpers.

## Experimental QM workflow

The repository now contains a local-only, removable QM support workflow experiment with
private validation, triage, investigation, implementation, QC, staging, deployment,
production verification, and response stages. Agent activity stays in a staff-only panel;
it is not written to customer-visible GitHub issue comments.

Start the complete disposable development stack:

```sh
bun run dev
```

This starts the editable QM core and the interactive staff workflow app under
Bun. Open <http://127.0.0.1:4174>. The default QM mock mode crosses the real
signed HTTP, input-screening, async-worker, controller, and approval boundaries,
but uses deterministic artifacts and record-only external adapters. On a clean
checkout, the launcher installs any missing locked dependencies before starting.
Provider credentials are read from the ignored `infra/qm/.env` and are passed
only to the QM process when a non-mock harness is selected. Put
`SUPPORT_QM_HARNESS=codex` in that file to make Codex the persistent local mode;
otherwise the clean-checkout default remains mock.

The command-line scenario runner remains available:

```sh
bun run demo:workflow --scenario=happy
```

See [the QM support workflow plan](./docs/qm-support-workflow.md) for architecture,
visibility boundaries, rollout modes, production integration points, live QM source
testing, and removal instructions.

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
