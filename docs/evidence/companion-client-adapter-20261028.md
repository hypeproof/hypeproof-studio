# Typed companion client adapter — local source evidence

Date: 2026-10-28. Base: `856706cf742e69da8b8b3d37b72ee9c06a2c3495`.
Scope: partial DMC client reuse, mobile transport and same-live-client reattach.

`CompanionClientAdapter` implements the existing `CompanionSessionPorts.transport`
contract through structural injection of the private `@hypeproof/companion-client`
pairing/relay API. No package pin, bootstrap, controller, host, UI or cryptography
was changed. The caller supplies the SAME exclusively owned, already paired
device pairing/relay objects and a shared `CompanionTransportBudget`. The adapter
checks the pairing reference/ID/status and wraps both clients' actual dispatch
ports, including internal current-pair status reads. Budgeting a high-level
receive/ACK alone would miss those nested HTTP requests. No HTTP retry is added.

The budget remains caller-owned and must also cover any pairing/bootstrap/status
traffic before adapter ownership and other dispatchers for that authenticated
session. Use the existing default at most 50 requests per rolling minute; callers
may explicitly select its existing 1,200 ms spacing. The adapter does not create
another budget or raise server limits. Direct calls to owned client dispatches
outside adapter operations are rejected; descriptor owners can use
`adapter.refresh(signal)` for fresh pairing status through the same queue.

One exact request ID and exact serialized request text are retained per adapter.
The relay's existing 96-character message-ID/2,032-byte plaintext bounds remain.
Changed IDs/bytes are rejected, identical prepare calls reuse the prepared value,
and send is attempted at most once even after uncertainty. Reconciliation never
implicitly sends again. Received messages remain available until an explicit
successful ACK. Repeated explicit ACK of an already confirmed ID returns its
saved receipt without HTTP. Receipt values remain transport receipts, not host
acceptance or execution authority.

Client operations serialize to isolate each operation's cancellation context,
with at most 32 active/queued calls, including aborted calls whose underlying
work has not settled. Abort stops queued dispatch and rejects the caller's wait;
an admitted injected HTTP operation may still finish if it ignores its optional
signal. The queue does not overlap that unfinished operation with another.
Completed late client receive/ACK results are retained for explicit reconciliation
if cancellation happened during client processing. There is no adapter timer,
poll, retry, token store, account permission or production entry point.

`clear()`/`dispose()` reject pending callers, permanently close the relay's
existing key/counter lifecycle and clear request bytes, receipts and received
plaintext. The owner must invoke this on logout/session loss; the adapter does
not subscribe to account events. The shared budget is not disposed by one relay.

## Same-live-client checkpoint attestation

Opt-in constructor `checkpoint: {context,currentContext(signal)}` inputs come
from the trusted live owner, never from checkpoint metadata. The bound
`adapter.reattach({context,request,messages},signal)` callback returns
`same_live_transport_verified_bytes`, `keys_lost` or `unavailable`.

The adapter retains at most 64 distinct authenticated received message IDs and
exact texts, including ACKed packets, only until clear/dispose. Reattach requires
all saved packets (duplicates included) to match that existing ledger; checkpoint
plaintext cannot create an entry. It also requires the exact original request,
captured/live account/session/device/pair/workspace/artifact/version/epoch
context, current verified pairing refresh and surviving relay cipher diagnostics.
Without the opt-in live owner/diagnostics it returns unavailable. Closed/lost
cipher state cannot reattach. No key export, counter serialization, cold restart,
durable plaintext store or trusted restore-from-file is implemented here.

## Executed checks

Node 22.22.1, shared resource owner
`codex:01a12522-7c7d-70c2-b09a-353dad5e2280`; version 1, stage work,
workload local_heavy, wait-timeout 1800, timeout 1800.
Final job: `companion-client-adapter-final-20261028`.

The focused tests cover exact ports/IDs, per-dispatch shared budgeting, current
status refresh, cancellation before admission, no retries, late receive/ACK
reconciliation, disposal, bounded queue/receive ledger, post-ACK same-live
attestation and rejection of invented/changed checkpoint bytes/context.
An explicit development-only test packs Service package source at
`d66f2ede054aaadb87af92afd18f19024d7b4e93` with offline `npm pack
--ignore-scripts`, extracts it into a temporary local `node_modules`, and compiles
actual declared pairing/relay classes into the adapter. The temporary package and
cache are removed. This is compile-only consumer compatibility, not production
installation, bootstrap, registry publication or authorization.

```bash
HPS_COMPANION_CLIENT_PACKAGE=/path/to/local/private/companion-client \
  node --experimental-strip-types --test extensions/hypeproof-chat/test/companion-client-adapter.smoke.mjs
node extensions/hypeproof-chat/node_modules/typescript/bin/tsc \
  --noEmit -p extensions/hypeproof-chat/tsconfig.json
```

The private-package compile check explicitly skips when its local package input
is unavailable. NOT RUN by this adapter slice: actual Service/Worker transport,
installed App, browser/mobile interaction, real account login/logout wiring,
cold restart, classroom or production acceptance. Existing parent actual Worker
evidence is separate; it is not relabelled as this adapter's validation.

Final results: PASS 7/7 focused tests (including the local private-package
compile check, no skips); PASS full extension TypeScript (`tsc --noEmit`, exit 0);
PASS `git diff --check`. The existing Node module-type warning is non-fatal.
