# Staff support workflow

This local Solid application presents the support workflow as an inbox:

1. Choose an application.
2. Review its new and active support tickets.
3. Open a ticket to see the customer report, the suggested fix, and the private agent activity.
4. Approve the current proposal or reject it with structured feedback when the workflow is at a human gate.

Agent evidence, code suggestions, check results, and review notes remain in this staff-only
surface. They are not posted to the customer-visible GitHub issue. Publishing a response is
a separate, explicit human-gated action.

## Run locally

From the repository root:

```sh
bun run dev
```

Open <http://127.0.0.1:4174>. The launcher starts the Support-owned runtime from
`packages/support-agent-runtime/` and the staff application. It installs missing locked
dependencies on first use. No external chat app, cloud machine, deployment stack, or new
Git repository is created. In particular, this package contains no Slack or Fly integration.

The safe default is `SUPPORT_AGENT_HARNESS=mock`. It returns deterministic artifacts while
exercising the runtime, controller, private activity model, and human gates without making a
model request or external change, and automatically prepares the live fixture at its first
review gate. Codex mode opens at intake and waits for **Run agents**.

To use Codex locally, copy the root `.env.example` to the ignored root `.env` and set:

```dotenv
SUPPORT_AGENT_HARNESS=codex
OPENAI_API_KEY=your-local-key
```

Then run `bun run dev` again. `SUPPORT_AGENT_CODEX_BIN` can select a specific executable;
otherwise the pinned local installation is used. The key is passed only to the agent process.

## Execution boundaries

The local flow keeps three different concepts separate. The Codex CLI read-only process
sandbox is always on for every current model turn. An existing application repository is
optional, read-only investigation context; reasoning, security screening, validation,
triage, and non-repository planning work without that external workspace. Implementation and
QC are different again: they require a future trusted adapter with an isolated writable
candidate, a fresh read-only QC view, and server-owned Nix checks. That capability is not
enabled by relaxing the Codex process sandbox.

| Work | Codex process sandbox | Repository or candidate context | Nix/check runner |
| --- | --- | --- | --- |
| Screening, reasoning, validation, and triage | Read-only, always on | None | None |
| Investigation and planning | Read-only, always on | Optional existing repository, read-only | None |
| Implementation | Not enabled locally | Future isolated writable candidate | Required |
| QC | Not enabled locally | Future fresh read-only candidate view | Required |
| Verification, deploy-intent review, and response drafting | Read-only, always on | None | None |

Live investigation uses an explicitly mapped existing sibling app repository beneath
`SUPPORT_AGENT_WORKSPACE_ROOT` (Support's parent directory by default). It verifies the Git
top-level, records the current HEAD, and exposes the existing working tree read-only; it does
not clone, create, branch, commit, or push. The app opens before making any live model request.
Click **Run agents** on the live ticket to start validation, triage, and investigation. Only
the repository-backed investigation step receives that mapped application context.

The local Codex harness accepts read-only turns and always invokes the Codex CLI read-only
process sandbox. Implementation and QC remain disabled until a trusted repository adapter can
provide a disposable candidate, a fresh review workspace, and isolated Nix execution;
writable execution is not inferred from a credential or from ticket text.

## Nix checks

Each application has a server-owned Nix execution profile contract containing a named dev
shell, flake and workspace subdirectories, a timeout, and exact check argument arrays. The
model cannot change that profile or substitute a command. A production implementation/QC
adapter must run those checks in the isolated candidate workspace and return the observations.
The local Codex lane does not yet run implementation or QC; mock mode uses deterministic fake
results to demonstrate the checks and review gates.

Checks run from the Support repository during local development validate Support itself. They
are not evidence that a ticket candidate passed its application profile. Candidate check
evidence must come from the future trusted adapter running that exact profile in the isolated
candidate environment.

Nix files, `.envrc`, dependency manifests, lockfiles, migrations, database code, CI,
infrastructure, authentication, secrets, and release files are protected. A ticket that needs
one of those changes is shown as a proposal for separate human work rather than applied by an
agent.

## Useful local commands

Run only the agent process:

```sh
bun run dev:agent
```

Run only the staff application with its clearly labelled scripted fallback:

```sh
bun run dev:ui
```

Build the application without starting a server:

```sh
bun run --cwd examples/workflow-demo build
```

All demo deployment and publication adapters are record-only. Nothing in this application
pushes a branch, opens a pull request, deploys, or comments on a customer issue.
