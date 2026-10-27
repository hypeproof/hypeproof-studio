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
No existing host, browser verifier, relay client or UI was changed. In particular,
`verifyCompanionPreviewResult` still rejects envelopes above 2,032 bytes; larger
payload consumer integration and its semantic verification remain follow-up
work. No artifact limits or authority checks were widened.

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
NOT RUN: full extension build/typecheck, full suite, browser UI, installed app,
actual mobile device, live relay and production validation. No fetch, push,
GitHub writes or production changes were performed.
