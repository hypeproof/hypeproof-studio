# Bounded companion artifact transfer — development evidence

Parents: Studio #3072/#3073/#3079 and #2803 remain open.
Intent: learner verifies and uses an exact result while originals remain on the
computer; see DMC-03/07/08/14 in the existing companion requirements.

## Implementation boundary

The native development adapter selects saved HTML up to 24 KiB. The existing
journal/dispatcher reads once after exact native confirmation. Framing preserves
the serialized result up to 32 KiB in <=2,032-byte packets, using the existing
cipher client unchanged. A full sender window waits within the active request,
rechecks current authority before each send and reuses the already prepared
ciphertext. Framing is not encryption or authorization. The receiver withholds
partial output and verifies the complete selected artifact/version/digest.

The UI uses existing Studio tokens, presents waiting/reconnecting/denied/results,
and renders through an injected caller-owned sandbox. The owned request
controller, request budget and same-live-transport checkpoint/cleanup lifecycle
are now included in the separate #3099 source cut. No production entry point
is registered; cold process/key restoration remains unavailable.

## Observed source and integration results

- Focused host/native-API fixture/payload/consumer suite: 27/27 PASS before the
  browser-specific ArrayBuffer typing repair. Full extension TypeScript PASS.
  The independent browser TypeScript check required an owned ArrayBuffer copy
  for WebCrypto; that isolated repair was included before actual integration.
- Native producer VM initially lacked crypto/btoa/atob. Its larger-payload run
  incorrectly surfaced a size denial. The harness now exposes actual Node APIs,
  and production error classification distinguishes size from transfer failure.
- A real local Worker/D1 + reviewed cipher clients + browser integration delivered
  a larger Korean quiz, interacted with its button, hid the preview while offline,
  restored its receipt without another file read, and cleared acknowledged
  ciphertext. The final paced rerun passed all 29 observations over the actual local
  Worker/D1 and browser. Its 17,310-byte HTML used 18 encrypted packets,
  one initial file read and one confirmation; exact-repeat used neither again.
- The subsequent exact-result repeat hit the existing per-session 60/minute
  Service limit and correctly refused further release. This exposed request
  amplification. The source limits and security checks were not relaxed. The final test
  shared the product request-budget helper across pairing/status/relay per
  synthetic session, using 50 requests/rolling minute and 1,200ms admission
  spacing. It passed in 103.716 seconds overall (including initial pairing and
  later controls); this is not a production latency acceptance claim. All waits
  used real wall time, with no rate-counter reset or server-limit change.

Private evidence directory:
`/Users/jaylee/CodeWorkspace/artifacts/claude-mobile-bridge-rea-20261027/desktop-first-plan/`.
`large-preview-failures/` preserves prior runs, `companion-large-preview-integration.json`
is the latest actual run, and `companion-large-focused-r3.log` records focused checks.
The integration is explicitly a private cross-checkout test: product imports do
not depend on a private sibling checkout. Its account/native APIs are synthetic;
its host-approval HTTP route must never be copied into product code.

## Historical controller interruption evidence

The following historical controller observations explain the interruption repair
now included in #3099. Exact new-cut source validation is recorded separately;
these observations do not establish installed acceptance of the new cut.
Independent ordinary lifecycle verification found a genuine eight-part result
lost its unprocessed suffix when the fourth ACK timed out. Controller follow-up
`dbb378493838b5a1e762f356ae50e41a5bfc5af6` retains the delivered batch and cursor.
Author regression: seven lifecycle cases and six receiver regressions PASS,
full webview TypeScript PASS. Independent recheck passed the original interrupted
eight-part batch with one prepare/send/receive and eight ACKs. A subsequent actual
local Worker/D1 + cipher client + product-controller run at `856706cf` passed 30
observations. Its 17,310-byte HTML used 18 encrypted packets; after one explicit
"결과 상태 확인" gesture, request prepare/send remained one each. Offline/reconnect
restored the receipt without another file read. The new copy distinguishes an
unconfirmed request from a computer actually known offline. The 29-observation
run above used the prior private request driver; these are distinct runs.

`companion-product-controller-integration.json` records the actual controller run
and source hashes. Prior failed drivers are preserved under
`controller-integration-failures/`: the final driver waits for each explicit UI
reconciliation to settle before simulating the next offline action. Restart
persistence is still absent at this source.

## Distinct native observations

The isolated macOS source probe at `9b726d08eafce93777f10b79cbd6cb467f18deb7`
observed the real Cancel and Allow modals, zero/one delivery, and unchanged source.
It used a small artifact, synthetic identity and fixture transport; it does not
verify these later framed-transfer/controller changes or full installed pairing.

The later isolated native probe at `3b049feb` observed the real Dev extension host
with its actual WebCrypto globals. Cancel produced zero artifact contents and
zero journal entries (one 141-byte denial control was delivered). Allow produced
18 frames, one journal entry, and an exact 17,095-byte Korean HTML result visible
in the native webview. Source file hashes stayed unchanged. All 63 imported
product inputs matched the frozen revision. Only test-owned processes were
closed; the existing app binary was not rebuilt or modified.

Evidence: `/Users/jaylee/CodeWorkspace/artifacts/companion-host-native-large-20261028/native-review.md`
and its manifest. Its identity, account responses and transport were synthetic.
Do not combine this native proof and the encrypted browser proof into an
unobserved full installed-device flow.

## Explicit desktop receive turn

`CompanionHostSession` now owns a bounded, caller-initiated receive turn. It takes
only an already paired host client, refreshes that identity, calls the existing
native-policy bridge, and acknowledges a transport request after the bridge's
durable decision and reply. A lost ACK retains the delivered batch and replied
cursor; the next explicit turn does not repeat the completed local decision.
Concurrent callbacks share one turn. Pair changes, close or the bounded deadline
destroy the ephemeral client and prevent further delivery. Closing cannot undo a
read already approved and durably running. There is no background polling,
listener, host-execution HTTP endpoint, new authority or production registration.

The frozen `f857bceea` host-turn source passed a separate 31-observation local
Worker/D1 + product-controller integration, including one explicit desktop turn
without a browser host-execution endpoint. An earlier run delivered the result
but left the host turn waiting at ACK; its exact transient cause was not captured
and is not retrospectively asserted to be TTL expiry. Prior runs are retained.

Independent lifecycle controls found two reproducible defects: permanently
expired request ACKs blocked later requests, and a deadline returned zero progress
after an earlier successful ACK. The repair retires only an already-replied
expired request, retains its identity tombstone and reports `expired` separately
from `acknowledged`. It never fabricates an ACK, extends expiry or repeats the
completed local decision. Per-turn progress survives the deadline race. Seven
focused scenarios, full extension TypeScript, docs contract and scoped alignment
pass after repair. Independent repair and the later full composition are pending.

## Remaining acceptance

NOT COMPLETE: partial-transfer restart persistence, durable mobile drafts/outbox,
useful author/revise/compare loop, normal product registration, classroom isolation,
actual Android/iOS devices and production activation. Transport ACK is not host
execution acceptance. No parent or complete DMC test row is closed by this slice.
