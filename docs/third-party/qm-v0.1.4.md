# QM v0.1.4 provenance and attribution

`packages/support-agent-runtime/` is an independent, Support-owned implementation. Its
signed turn protocol, asynchronous in-memory run lifecycle, abort signal, mock `!json`
convention, and isolated Codex harness were adapted from QM v0.1.4.

Upstream source:

- Project: <https://github.com/yc-software/qm>
- Release tag: `v0.1.4`
- Source commit: `7f2c916360f1797a8ff2a77ce2ce40c5fabab087`
- Archive: <https://github.com/yc-software/qm/archive/refs/tags/v0.1.4.tar.gz>
- Archive SHA-256: `871074ac2763eaeec40c4a59a28da62e4139693ff76c8f379cc8e73bac4f029e`
- Licence: MIT; the complete notice is retained in [qm-MIT.txt](./qm-MIT.txt)

The Support runtime does not import or execute upstream QM source modules. It carries only
the narrow agent-runner behaviour needed by the Support workflow. Collaboration surfaces,
deployment providers, repository provisioning, general credential brokerage, and unrelated
control-plane services were not carried into the Support runtime.

The earlier local integration also established two requirements retained in the Support-owned
implementation:

- untrusted inbound support content must pass fail-closed security screening before an agent
  receives it;
- the Bun development lane supports deterministic JSON artifacts so the signed asynchronous
  boundary and human gates can be tested without a model request.

This attribution must remain with any copied or substantially derived implementation. The MIT
licence permits modification and redistribution subject to preserving its copyright and
permission notice.
