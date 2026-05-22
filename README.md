# Support

GitHub-backed support issue UI and backend helpers.

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
