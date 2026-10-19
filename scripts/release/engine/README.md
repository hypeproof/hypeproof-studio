# @hypeproof/release-engine-core

Version 0.1.0 packages Studio's existing `core.mjs` without a second engine.
Only `@hypeproof/release-engine-core` and `@hypeproof/release-engine-core/core`
are public entry points. Local filesystem storage and the CLI are not included.
No install scripts or runtime dependencies are required. Packaging is local;
this source change does not publish a registry package or release asset.

Pin the exact package version and tarball integrity in the consumer lockfile.
Compare `provenance.json`'s source SHA-256 to the packed `core.mjs`; retain the
source commit and tarball SHA-256 with release evidence. Never use a mutable
branch URL or a sibling Studio source import as the consumer dependency.

All exports remain synchronous, including SHA-256 canonical JSON digests and
Ed25519 verification through `node:crypto`. Workers require `nodejs_compat` and
a tested compatibility date. No crypto algorithm or signature encoding changes.
`canonical(body)` UTF-8 and strict canonical base64 signatures remain the wire
contract. Existing ledger, policy, evidence and promotion schemas are preserved.

Storage belongs to the host adapter. Serialize read/apply/commit atomically;
`applyEvent` returns `{state, result}` without persisting or doing network IO.
Use the same policy, event, clock and verified bytes in each runtime.

Every gate that observes files requires a **synchronous** `checkFile(record)`
callback. It must verify the actual bytes match both `record.sha256` and
`record.size`, throwing on missing/mismatched bytes. Returning `false`, a Promise,
or another thenable is refused. Existing synchronous void callbacks remain valid.
A remote adapter must fetch bytes first, then run this synchronous check against
its verified snapshot inside its transactional decision; it must not pass an
async fetch callback. The callback and snapshot freshness remain trusted adapter
responsibilities. A local path or stored digest alone is not byte verification.

Package/runtime fixture tests do not establish installed-App acceptance, live
Service deployment, manager approval, billing allowance or release publication.
