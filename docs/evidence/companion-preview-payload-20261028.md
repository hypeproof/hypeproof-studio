# Companion preview payload framing — local helper evidence

Date: 2026-10-28. Base: `9b726d08eafce93777f10b79cbd6cb467f18deb7`.
Scope: source-only partial support for [DMC-03/07/08](../requirements/desktop-mobile-companion.md).
This does not complete a parent issue or establish relay, host/mobile, device or production acceptance.

## Contract

`packCompanionPreviewPayload(rawEnvelope, expectedRequestId)` preserves the exact
serialized `hps-companion-host-result/1` envelope. Existing envelopes of at most
2,032 UTF-8 bytes remain a single unchanged packet. Larger envelopes use explicit
`hps-companion-result-part/1` framing: expected request ID, complete-envelope
SHA-256, byte length, part count/index and canonical base64 of 1,024-byte slices.
The serialized envelope is capped at 32 KiB; this framing requires at most 32
parts, below the explicit 48-part ceiling and existing 64-message relay lifetime.
Every serialized packet is checked against the unchanged 2,032-byte relay limit.
These are developer transfer bounds, not an increased HTML/artifact limit.

`CompanionPreviewPayloadReceiver(expectedRequestId)` accepts reordered parts,
ignores exact duplicates and emits the complete exact serialized text once only
after metadata, lengths, UTF-8, envelope request identity and full SHA-256 agree.
Incomplete inputs emit `null`. Conflicting or invalid inputs discard held parts
and block that instance until explicit `reset()`. `discard()` explicitly clears
held data and blocks acceptance; reset/discard invalidate queued or in-flight
completion. `progress` returns a frozen count/byte/completion snapshot without
exposing partial content. Packet byte/type checks happen before queueing; at
most 48 accepts may be pending, including an in-flight digest. Overflow discards
the current transfer. Reset uses a new accounting generation, so old callbacks
cannot alter its pending count. There is no durable storage, timer, retry or retention
policy. Callers own lifecycle and must explicitly discard/reset as appropriate.

This helper performs framing, not result authorization or artifact verification.
SHA-256 here checks whole-transfer integrity, not sender identity or encryption.
No existing host, relay client or UI was changed. The existing
`verifyCompanionPreviewResult(raw, expected, cryptoApi?)` entry point retains its
2,032-byte ceiling and previous callers. The subsequent request-bound semantic
composition below is opt-in. No artifact limits or authority checks were widened.

## Executed validation

PASS: six focused Node 22.22.1 tests. The Korean interactive HTML fixtures are
8,204 and 20,264 UTF-8 bytes, including an actual button handler and emoji.
Tests cover exact reconstruction, partial withholding, reversed ordering,
deduplication, concurrent accepts, exact 32 KiB envelope/32-part ceiling with a
128-character request ID, oversize rejection, wrong request identity,
conflicting parts/metadata, full digest mismatch, bounded pending accepts, discard/reset and unchanged
single-packet compatibility with the existing browser result verifier.

Executed from the isolated worktree using the shared resource queue:

```bash
~/.local/bin/hype-resource run \
  --owner codex:01a12522-7c7d-70c2-b09a-353dad5e2280 \
  --job companion-preview-payload-focused-r4-20261028 --version 1 \
  --stage work --workload local_heavy --wait-timeout 1800 --timeout 1800 -- \
  /Users/jaylee/.nvm/versions/node/v22.22.1/bin/node \
  --experimental-strip-types --test \
  extensions/hypeproof-chat/test/companion-preview-payload.smoke.mjs
```

The initial runs exposed unsupported strip-only parameter properties and an
undersized test fixture; both were corrected before the final 6/6 pass.
The existing package emits Node's module-type warning; the test exits zero.
NOT RUN at this initial helper stage: full extension build/typecheck, full suite, browser UI, installed app,
actual mobile device, live relay and production validation. No fetch, push,
GitHub writes or production changes were performed.


## Request-bound semantic composition

`CompanionPreviewResultReceiver(expected, cryptoApi?)` composes the framing
receiver with the existing result, artifact ID/version and artifact SHA-256
checks. It snapshots the expected request context at construction. Its
`accept(packet)` returns only a fully reconstructed and semantically verified
`CompanionDispatchResult`, or `null` for incomplete/duplicate input. `progress`
reports complete only after semantic verification, while `reset()` and
`discard()` invalidate in-flight semantic checks as well as framed transfer work.
Invalid semantics discard the transfer. Partial or unverified artifact text is
never returned. There is no rendering, durable storage or transport integration.

The internal shared semantic check accepts a 32 KiB reconstructed envelope only
through this bounded receiver. The original exported verifier still uses 2,032
bytes. Host/UI/relay integration, actual authorization, device acceptance and DMC
parent completion remain separate work.

Executed validation for this composition: PASS 12/12 focused payload/result
tests on Node 22.22.1, including 8–24 KiB Korean interactive HTML,
pack→reassembly→semantic result verification, unchanged legacy compatibility,
mutated caller context, wrong artifact ID/version/content, and explicit
discard/reset while the semantic artifact digest is awaiting completion.
PASS: full extension TypeScript validation (`tsc --noEmit`) using the existing
prepared dependency tree (exit 0). No dependency installation was
performed. Two initial TypeScript issues (unknown narrowing in the framing
helper and a DOM-only Crypto type annotation) were corrected without changing
the protocol contract.

Focused command: the resource wrapper above with job
`companion-preview-semantic-focused-r2-20261028` and command:

```bash
/Users/jaylee/.nvm/versions/node/v22.22.1/bin/node --experimental-strip-types --test \
  extensions/hypeproof-chat/test/companion-preview-result.smoke.mjs \
  extensions/hypeproof-chat/test/companion-preview-payload.smoke.mjs
```

Full TypeScript command: the same wrapper with job
`companion-preview-semantic-full-ts-r2-20261028` and command:

```bash
/Users/jaylee/.nvm/versions/node/v22.22.1/bin/node \
  extensions/hypeproof-chat/node_modules/typescript/bin/tsc \
  --noEmit -p extensions/hypeproof-chat/tsconfig.json
```

NOT RUN for this composition: full extension build/test suite, browser UI,
installed app, actual mobile device, live relay or production validation.
