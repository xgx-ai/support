# Experimental source dependencies

This directory contains source snapshots used to test integrations against an
upstream runtime. They are not the home for XGX support configuration or
product-specific changes.

## QM v0.1.4

`qm/` is the source archive for the upstream QM v0.1.4 release:

- project: <https://github.com/yc-software/qm>
- tag: `v0.1.4`
- tag commit: `7f2c916360f1797a8ff2a77ce2ce40c5fabab087`
- archive: <https://github.com/yc-software/qm/archive/refs/tags/v0.1.4.tar.gz>
- archive SHA-256: `871074ac2763eaeec40c4a59a28da62e4139693ff76c8f379cc8e73bac4f029e`
- license: MIT, retained in `qm/LICENSE`

The archive was extracted without its top-level `qm-0.1.4/` directory. It has
no Git remote or independent history in this repository.

### Editable-source boundary

`experimental/qm/` is intentionally a directly editable source copy. It began as
the reproducible upstream baseline above and now carries the documented core
patches below. You can change QM core here to test an idea
locally and rebuild it with `--build-from`. Keep XGX
skills, configuration, credentials, generated files, and ordinary support
workflow code in the owned extension points below so core edits stay obvious.

The owned extension points are:

- `infra/qm/` for the organization deployment config and sandbox layer;
- `packages/support-workflow/` for the support workflow and QM client;
- target repositories for their own agent policies, tests, and deployment
  adapters.

For every QM core experiment, compare it with this pinned baseline, test the
affected QM paths, and document the resulting core diff here. Re-extract the
archive to discard all local core experiments and return to upstream v0.1.4;
a reusable fix can later become a separately reviewed upstream proposal or a new
pinned release.

### Local core patch: required inbound screening

This source copy adds an optional `requireSecurityScreen` field to source-authenticated
turn requests. When enabled, QM refuses the turn before the agent runs if inbound
security screening is truncated, unavailable, unscreenable, or returns an unscreened
verdict. Requests that omit the field retain the upstream v0.1.4 fail-open behavior.

### Local core patch: Bun development hooks

This source copy accepts an optional `HOST` value for the core HTTP listener. An
unset or blank value retains QM v0.1.4's default listener behavior. The mock
harness also accepts `!json <payload>` and returns the payload verbatim, allowing
signed asynchronous boundary tests to exercise the real HTTP and workflow
contracts without making model calls.

### Build and run locally

The published `@yc-software/qm@0.1.4` dependency in `infra/qm/` remains the
control-plane CLI. `--build-from` changes only the first-party service image
build context to this source snapshot; it does not replace the CLI with an
unbuilt local copy.

Run from the repository root:

```bash
cd infra/qm
npm ci
npm run check
npm run qm -- sandbox publish
npm run plan
npm run deploy
```

`sandbox publish` is required on first use and after changing the deployment's
sandbox layer. It builds and records the digest-pinned image that agent
computers boot; `plan` intentionally refuses to continue without that pin.

The last command expands to:

```bash
qm up --build-from=../../experimental/qm
```

`npm run plan` uses the same source path in dry-run mode. To test the exact
published runtime images instead, use `npm run plan:published` and
`npm run deploy:published`.

### Tests

The support repository's normal checks exercise the QM HTTP adapter and
workflow without installing QM's development dependencies:

```bash
bun test packages
```

Keep the support test command scoped to `packages/`; an unqualified `bun test`
would also discover QM's upstream Node test files under this directory.

To validate the pinned upstream source itself, use its pinned lockfiles and the
Node/npm versions declared in `experimental/qm/package.json`:

```bash
cd experimental/qm
npm ci
npm run typecheck
node --experimental-test-module-mocks --test test/orchestrator.test.ts
node --test \
  test/source-auth.test.ts \
  test/source-auth-sign.test.ts \
  test/source-auth-sign-vendored.test.ts \
  test/turn-origin.test.ts \
  test/deployment-layer-load.test.ts \
  test/deployment-layer-store.test.ts \
  test/deployment-layer-routes.test.ts
```

The last command opens an ephemeral localhost listener. Run it in an environment
that permits local port binding. The complete upstream `npm test` and CLI test
suites remain available, but they cover QM subsystems outside this integration
and require all of QM's upstream integration prerequisites.

The deployment-level source-path check is `cd infra/qm && npm run plan`. It is
non-mutating, but it still requires the deployment config and sandbox layer to
pass QM's static checks and requires a previously published sandbox image pin.

### Removing or replacing the snapshot

There are two independent removal paths:

1. To stop building from source without deleting anything, use
   `npm run deploy:published` from `infra/qm/`. It uses the exact published
   version pinned in `infra/qm/package-lock.json`.
2. To remove the source snapshot from the repository, first stop any local QM
   stack with `npm run qm -- down`, then remove `experimental/qm/` and change
   the default `plan` and `deploy` scripts back to their published variants.
   Remove this README too only if no other experimental source snapshots remain.

Installing the upstream test dependencies creates ignored `node_modules/`
directories beneath `experimental/qm/`; they can be removed independently of
the source snapshot.
