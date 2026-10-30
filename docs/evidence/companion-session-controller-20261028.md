# Controlled companion session lifecycle (DMC-4/5 partial)

`CompanionMobileSessionController` in `webview-ui/src/companionSessionController.ts`
implements the existing presentation controller. A caller injects the current
authenticated descriptor and transport ports; this module creates no account,
authentication, pairing, encryption, host approval, executor, server or store.
No App entry point or production flag is wired by this slice.

## Integration contract

Construct with `{ descriptor(signal), transport: { prepare(text, id, signal),
send(id, signal), receive(signal), acknowledge(id, signal) } }`. The descriptor
returns `{ computerName, online, selection }` or null through the existing current
session. `selection` is the existing typed request plus project/artifact labels.
`receive` supplies only already authenticated/decrypted peer messages as
`{ message_id, text }[]`. The host listener independently receives and approves
requests on the computer. A mobile send starts delivery, never computer execution.
There is no mobile host-execute/approve endpoint here.

Use `getSnapshot()` plus `subscribe(listener)` with the existing
`CompanionSessionView`; mounting/subscription starts no work. Call `reconnect()`
to resolve current selection, then the explicit view gesture calls
`requestPreview(request)`. The instance pins that exact request before its first
delivery await and prepares/sends at most once. Later gestures/reconnects only
reconcile the same identity, receive, and retry transport ACKs. A changed scope,
selection, version, epoch or consent does not replace the pinned request. Create
a new controller only for an explicitly new request lifecycle; this is not a
cross-restart persistence guarantee.

The existing `CompanionPreviewResultReceiver` validates bounded fragments,
complete envelope and selected artifact version before any artifact enters the
snapshot. Accepted temporary fragments may receive transport ACKs. Invalid bytes
receive none. An ACK never means host durable acceptance, adoption or consent.
ACK uncertainty retains the validated bytes/result privately for a later ACK
retry. Late receives are preserved for reconnect when a transport ignores abort,
so client receive deduplication does not silently drop a timed-out delivery.
A delivered batch and explicit processing cursor survive operation timeout. The
cursor advances only once validation and its ACK obligation are retained locally;
reconnect drains the unprocessed suffix before receiving another batch. Terminal
disposal clears both the batch and cursor.

Each operation has a 25-second default deadline (configurable up to 60 seconds)
and 100ms polling interval. There are at most 64 validated messages per
instance, each bounded by the existing receiver and 64 messages per batch, layered over the existing receiver limits.
The controller adds no persistent retention policy. Offline/reconnecting state
continues to hide cached receipts through the existing presentation policy.
The optional `waitingReason` preserves existing callers while distinguishing an
unconfirmed request result from an explicitly offline descriptor. A timeout or
failed attempted request without confirmed offline evidence offers result-state
reconciliation, without claiming host acceptance or asking to turn on an online
computer. A successful descriptor reconciliation clears that reason; an explicit
`online: false` retains the computer-offline guidance.
`dispose()`/`cancel()` is terminal: aborts waits, discards receiver/cache references,
clears listeners and prevents late UI emissions or initiation of later ACKs.
Caller-owned transport disposal remains the caller's responsibility.

## Verification boundary

Deterministic async tests cover one delivery with framed completion,
invalid fragment refusal and oversized-result denial, ignored-abort timeout,
disposal/late callbacks, ACK retry without resend, and late delivery reconciliation
with changed-descriptor refusal. A genuine eight-part result also pauses its
fourth ACK past the deadline after transport deduplication of all eight messages;
reconnect must complete the exact result with all fragment ACKs, one prepare/send,
one transport receive and one verified outcome identity. They use the real browser-safe result receiver
and WebCrypto hashing, with injected transport and clock. Full webview TypeScript
and unchanged result-receiver regressions are required alongside these tests.
Actual Worker/D1 relay composition, installed app/phone, human/child acceptance,
production activation and completion of parent #3073/#3074 require separate
revision-bound evidence; this slice does not establish them.
