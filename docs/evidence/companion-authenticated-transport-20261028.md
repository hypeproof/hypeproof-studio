# Native authenticated DEV companion transport boundary

This unregistered native module supplies the missing HTTP boundary for the
existing companion protocol clients. It neither creates accounts/grants nor
implements another auth store, pairing/relay crypto, browser cookie adapter,
background poll, listener or production permission. No private package pin or
extension activation is added.

The existing AccountSession supplies accessToken(), exact service/site matching
and a narrow sessionIdentity() accessor. The accessor reads existing stored
service/session metadata without token disclosure, refresh, network, storage
mutation or last-session tracking. Stored identity is routing metadata, not live
server authority.

The factory itself does no credential read or HTTP. Explicit resolveIdentity()
performs one bounded authenticated /me and checks the expected already-resolved
account/session. Successful resolution binds only that routing identity for this
factory lifetime. A new account/session needs a new explicit factory session;
there is no silent rebind. Later operations check actual Development mode, exact
configured loopback Service/site, current stored session and access token before
and after one protocol HTTP operation. Configuration/session/account mismatch or
mid-operation token change invalidates the transport. No uncertain operation is
automatically resent. A previously successful /me is never treated as evidence
of post-response live authority: each actual Service endpoint still validates
its bearer, account, endpoint sessions and current grant for that operation.

Only fixed pairing/relay role/actions and invitation IDs construct paths beneath
the configured /v1/companion/invitations endpoint. No arbitrary URL/Origin is
accepted. Bearer headers remain in native dispatch; redirects fail. Requests
are capped at 8192 UTF-8 bytes, JSON responses at 64 KiB while streaming (large
enough for eight ciphertext messages), and the 12-second operation deadline/cancellation cover credential
reads, dispatch and response consumption. If dispatch owns budget admission,
that wait is inside this deadline; an existing adapter admission owner can invoke
the boundary only after admission, as described below. Denied/malformed responses fail closed;
raw fetch/account/parser errors and response bodies are not echoed. The existing
protocol clients retain semantic, signature and ciphertext verification.

## One request-budget owner

There is no internal/new budget and no retry. Choose one existing caller-owned
session admission point:

- Direct native pairing/relay clients can pass a dispatch port that wraps each
  actual fetch with the shared CompanionTransportBudget.run(). Initial /me then
  consumes one admission, and each protocol operation consumes one admission.
- If the existing CompanionClientAdapter already budgets pairing/relay transport
  calls, give this helper raw fetch; explicitly admit resolveIdentity() once
  through that same owner before using the adapter. Each later adapter transport
  call contains exactly one protocol HTTP, so no extra admission is nested.

Do not combine those two admission layers. The module is not wired to either
owner by this change, and the existing adapter/budget implementation is unchanged.
AccountSession's existing refresh machinery remains its owner; this helper does
not implement credential rotation or add per-packet /me requests.

## Validation and evidence limits

The focused source controls use a test VS Code Development enum/context and
injected native HTTP fixtures; they are not installed-app evidence. They exercise
initial identity, request counts, role/path/body denial, mode/config/token/session
changes during an awaited response, cancellation/timeout, malformed/denied and
streaming-size responses, non-echoing errors, an eight-message-sized relay
response, and the readonly existing AccountSession accessor. The existing account
session regression is included.

A private local Worker control uses the actual bundled Service Worker/workerd/D1,
legitimate synthetic account sessions seeded into real AccountSession RAM secret
ports, and an actual loopback HTTP server forwarding unchanged native bearer
headers. It exercises /me, signed pairing, encrypted relay/send/receive/ACK,
revoked-session denial, foreign-owner mismatch and missing-token refusal. The
product factory creates none of those test accounts/grants. This is not real
member login, installed Studio activation, browser-direct authentication, mobile
acceptance or production readiness.

Executed exact-head results and commands are recorded in the private artifact
report returned with the commit. Existing ST-REQ-COMPANION/ST-DES-COMPANION and
ST-TEST-COMPANION remain canonical context; DMC-02/03/14 acceptance is unchanged
and open. This supporting evidence adds no new acceptance definition or owner.
