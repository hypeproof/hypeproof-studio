# Owned scripted SDK protocol fixture

`service.mjs --scripted-upstream` starts the exact pinned Service Hono/router,
SQLite/KV/session/auth adapter, then routes its existing ANTHROPIC_PROXY_URL to
an owned 127.0.0.1 text-only Anthropic protocol listener. No external provider is
called. This is not a fake SDK, native UI proof, production or live model proof.
Metadata mode without the flag retains its original no-generation behavior.

The fixture supports only messages and count_tokens, never arbitrary upstream
URLs. It counts all accepted-subject attempts (including invalid payloads,
auxiliary requests, count_tokens and retries) against one immutable 12-attempt
ledger per synthetic activity/fixture. Reusing a ledger is refused. Output must
be 1..4096; over/missing/invalid bounds fail rather than being rewritten.
The thirteenth request is recorded as rejected and cannot receive completion;
any such rejection fails the scenario. Scripted tool_use is not part of this
text-only mode. Known prompt markers and body digests are recorded; no raw
payload, credentials or arbitrary prompt text is written to evidence.

`openSyntheticControl` retains the existing canonical session control's exact
source/fixture hash, instance/PID, loopback and private-admin-file attestation.
Its canonical session end, token-B revoke and bounded scripted-turn release
wrappers do not change production credentials or profiles. Private token/admin
files remain outside evidence upload directories. The Service bridge records
actual inbound request sequence, turn hash, request class, request/usage IDs and
upstream dispatch linkage. Unexpected network is rejected. Count_tokens is a
separate endpoint and never counted as a completed generation.

Background readiness uses the actual sdkCoach and SDK/binary:

```bash
HPS_SERVICE_SOURCE=/absolute/clean-pinned-service HPS_SERVICE_SHA=FULL_SHA node e2e/feedback-native/scripted-sdk-probe.mjs /absolute/new-evidence /absolute/verified-sdk-binary
```

It enters two completed text turns through the real SDK→Service route, verifies
carried history in the actual upstream prompt, then holds three streams and
aborts each. The isolated CLI env uses output4096/retries0; source bytes are not
rewritten. Both the vendored SDK version and the binary's verified marker/hash
must match. This command does not launch a desktop or use a real provider key.

Cancellation has separate receipts: SDK abort, client disconnect, Service body
cancel, and upstream socket close. Explicit release/timeout/owned cleanup is
labelled cleanup and never satisfies cancellation. The probe's protocol
readiness is separate from cancellation verdict; missing upstream propagation
fails the cancellation check. Service #111 addresses the observed d2d48f
stream-cancel limitation. Existing r2 protocol PASS and r3/r4 limitations remain
immutable; no local fixture result substitutes for native history persistence.
