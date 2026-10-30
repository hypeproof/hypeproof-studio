# Opt-in local companion data checkpoint (DMC-4 partial)

`CompanionLocalCheckpoint` and the controller's explicit `restore(reattach)` add
local data continuity without another transport, authority or production entry.
Default controller behavior remains RAM-only. An opt-in controller starts held:
its caller must explicitly call restore even for an empty local store before a
new preview request can start. A forgotten restore call cannot resend an old ID. Source owner supplies an isolated
atomic local `read/replace/remove` storage port, never generic browser storage or
cloud sync. Across remounts, the native owner must serialize operations for the
same storage namespace (the same in-process port object also shares its queue).

The strict closed schema stores the full single request, nonsecret exact
account/session/device/pair/cipher-context/workspace/artifact/epoch binding,
validated original packets, pending transport ACK IDs, and bounded received batch
with processing cursor. There are no token/key/counter/path fields or stored
complete/accepted authority flag. Selected artifact plaintext may be present in
packet bytes; only an opt-in private local owner should persist it. The desktop
remains canonical. 15 minutes and 256 KiB are implementation bounds, not a
subscription, cloud retention or recovery policy. Expired/invalid data is lazily
removed on access; awaited forget explicitly erases it. No background deletion
or guaranteed physical secure erasure is claimed.

Writes precede transport ACKs. Data restore replays saved packets through the
existing semantic receiver and selected artifact hash verifier; saved receipt
metadata cannot make a preview complete. Restored receipts and artifact objects
are frozen. Reconnect never prepares or sends the restored request. Disposal
releases page state while retaining opt-in checkpoint for remount; `cancel()` and
`forget()` terminally discard runtime state and return the awaited local erase.
Already-started writes are ordered before erase, preventing resurrection. Erase
is idempotent per owner and retains its completion promise. A superseded owner
cannot advance the generation or remove data written by a newer lifecycle.

## Exact reattachment boundary

A fresh authenticated descriptor includes optional `checkpointContext` when this
feature is enabled. It must match every saved account/session/device/pair/cipher
identity and the full original selected request, including artifact/version,
epoch and consent. `restore` passes frozen `{context, request, messages}` plus an
AbortSignal to an explicitly injected reattach function. Success is the literal
`same_live_transport_verified_bytes`: the surviving native transport owner must
check its current authenticated identity, live cipher diagnostics and every saved
packet's ID and exact text against its bounded original authenticated receive
ledger, including ACKed packets. Neither checkpoint text nor saved context is
proof. Duplicate entries must agree exactly. `keys_lost` or `unavailable` holds
without ACK, receive, execution or request resend. Scope/session changes hold;
invalid/expired checkpoints are discarded. The caller can await forget to erase
held state. The controller does not fabricate such an attestation itself.

The reviewed DEV cipher client keeps private keys, sequence counters, ciphertext
retries and receive/ACK records in memory. Immutable offers prohibit rebuilding
lost keys under the old pair. A remounted page can recover only while its trusted
native owner and same cipher lifecycle survive, with the explicit contract above.
Cold process/key loss requires re-pairing; secure native key/session persistence
and full cold-restart recovery are unsupported. No new pairing or restart policy
is activated here. No host source, Service or ordinary registration is changed.

## Focused validation

Deterministic tests use real framing/semantic receiver/WebCrypto and injected local
storage/current descriptor/surviving authenticated-byte ledger. They exercise an
eight-part remount during the fourth ACK, exact immutable completed receipt,
accepted-but-unconfirmed identity, stale context/key loss, forged bytes, closed
schema/TTL/size bounds, and awaited erase after in-flight writes across remount.
Existing controller lifecycle and full webview TypeScript checks remain required.
Actual Worker/native adapter/persistence composition, installed phone/app, cold
restart, human acceptance and production activation require separate evidence.
