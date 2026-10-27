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
and renders through an injected sandbox. A subscribed controller now owns one
request and bounded receipt reconciliation, not account authentication or host
execution. Neither component registers a production entry point.

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

## Mobile controller interruption correction

Independent ordinary lifecycle verification found a genuine eight-part result
lost its unprocessed suffix when the fourth ACK timed out. Controller follow-up
`dbb378493838b5a1e762f356ae50e41a5bfc5af6` retains the delivered batch and cursor.
Author regression: seven lifecycle cases and six receiver regressions PASS,
full webview TypeScript PASS. Independent repair and actual controller/Worker
composition are pending; the above 29-observation integration used the prior
private request driver, not this new controller. Restart persistence is absent.

## Distinct earlier native observation

The isolated macOS source probe at `9b726d08eafce93777f10b79cbd6cb467f18deb7`
observed the real Cancel and Allow modals, zero/one delivery, and unchanged source.
It used a small artifact, synthetic identity and fixture transport; it does not
verify these later framed-transfer/controller changes or full installed pairing.

## Remaining acceptance

NOT COMPLETE: partial-transfer restart persistence, durable mobile drafts/outbox,
useful author/revise/compare loop, normal product registration, classroom isolation,
actual Android/iOS devices and production activation. Transport ACK is not host
execution acceptance. No parent or complete DMC test row is closed by this slice.
