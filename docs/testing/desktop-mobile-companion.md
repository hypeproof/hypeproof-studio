# Desktop-first mobile companion test contract

Targets: [DMC requirements](../requirements/desktop-mobile-companion.md).
Plan: [delivery order](../plan/desktop-mobile-companion.md).
Product acceptance starts NOT_RUN; partial observations below do not complete
the scenarios. Unit route tests are a separate boundary.

| ID | Targets | Scenario and expected evidence | Layer |
|---|---|---|---|
| DMC-T01 | DMC-01 | Select an existing synthetic workspace, identify host/owner, restart and reopen without rewriting files or uploading content. | Installed host |
| DMC-T02 | DMC-02 | One approved device pairs; wrong/expired/reused challenge, second actor and revoked device fail. | Real Service + host + client |
| DMC-T03 | DMC-03 | Trace selected content through the relay, inspect local original and bounded relay lifecycle; test ciphertext isolation and key recovery/revocation. | Integrated transport |
| DMC-T04 | DMC-04 | Cached viewing/drafting stays local; a permitted web build executes on the host without moving screens; a permitted desktop-only edit yields handoff; unknown capability fails closed. | Pure route now; real dispatcher later |
| DMC-T05 | DMC-05 | Disconnect the host: local work remains local, host work waits, no paid/cloud route appears; reconnect explicitly reconciles. | Pure route now; transport later |
| DMC-T06 | DMC-06 | Kill/restart producer around durable write/ACK/effect/receipt boundaries. Replay identical request, conflict bytes, and simulate unknown external outcome without duplicate effects. | Persistence + real adapter |
| DMC-T07 | DMC-07 | Change scope/version, duplicate/out-of-order events, stale epoch, revocation and two devices. Preserve drafts; reject stale execution. | Pure scope/version checks now; transport later |
| DMC-T08 | DMC-08 | Learner makes a quiz, actually uses it, points to a change, compares versions and reopens; no keyboard-only step or teacher doing the task for them. | Device + supervised pilot |
| DMC-T09 | DMC-09 | Two synthetic learners cannot read/write each other or instructor data. Load the agreed class size and record wait times and host failure recovery. | Isolated host + classroom |
| DMC-T10 | DMC-10 | Adult document fixture creates a preview; unapproved or stale sending/publishing never executes. | Host + effect adapter |
| DMC-T11 | DMC-11 | Handoff the exact project/version/draft/run; offline target stays pending; continuation does not create a new execution. | Desktop + mobile |
| DMC-T12 | DMC-12 | Denied grant, wrong actor/device/workspace, expired auth, unknown action and stale decision are rejected by real host/Service regardless of planner or UI output. | Pure denial checks now; real enforcement later |
| DMC-T13 | DMC-13 | Korean IME, keyboard, 1,000-message fixture, selected attachments, accessibility, kill/reopen and push/deep link on supported physical devices. | Android/iOS devices |
| DMC-T14 | DMC-14 | Waiting/accepted/running/unknown/completed and cancellation states match measured host events, including late replies. | UI + integrated host |
| DMC-T15 | DMC-15 | Cache removal preserves source/outbox; revoked/deleted content does not return from old devices; export/backup scope is explicit. | Storage + transport |

Use synthetic data and recorded model output first. Hosted AI, external actions,
real learner data and production activation are separately evidenced. Record
exact source, OS/device, fixture and adapter versions; do not inflate one layer
into another. Child learning outcomes require a separate research protocol.

### Local dispatcher seam

`extensions/hypeproof-chat/test/companion-host-dispatch.smoke.mjs` exercises
DMC-T04/05/06/12 against real synthetic local files and the existing command
receipt journal interface: exact-byte request/result persistence, duplicate and
restart behavior, outcome-unknown recovery, offline waiting, continuation-only
handoff, revoked or changed runtime context, ungranted profile, changed consent,
path/symlink escape, unsupported tool/model/write payloads and storage failure.
Pairing preview `execution_authorized:false` is a mandatory denial control.
These checks do not establish the Service transport or device acceptance rows.
The review regressions instrument real selected-file fd reads: failed acceptance
persistence must perform zero content reads; a successful request performs one
read only after durable running and retries perform none. Recovery must reject
any continuation output and malformed or unselected preview output, preserving
normal continuation without an artifact.

Independent repair verification is bound to
`1b91a03b310e9b8e9ef55cc99591a94136c89a43`: the original focused dispatcher,
classroom runner, attachment and routing group passed 15/15 tests. Separate
controls confirmed zero content reads on failed acceptance, one read after
durable running, rejection of injected continuation output, current scope and
capability checks during journal/read boundaries, and duplicate/recovery paths
without another read. The previous `eeb2536f` FAIL and the two resolved findings
are retained in the [evidence record](../evidence/desktop-mobile-companion-routing.md).
These observations are source/fixture evidence only. Real authenticated runtime
integration, Service transport, installed host/mobile and complete DMC-T04/05/06/
07/12/14 acceptance remain **NOT RUN / NOT COMPLETE**. Mapping-only follow-up
commits preserve the verified implementation bytes; they are not new transport
or native acceptance runs.
## Local workspace preparation observations — 2026-10-27

[Preparation evidence](../evidence/desktop-companion-workspace-20261027.md)
binds source `b7ee35cf0adcd945d0cbc88330c2225f677d3262` to 9 passing
source/host-adapter tests and an actual isolated macOS development app run.
The run observed restricted-mode refusal, an existing-folder picker, explicit
Korean review/save, unpaired copy and preparation/file preservation after process
restart. It used a synthetic loopback profile and in-memory credentials reseeded
after restart. It did not verify a real personal account, owner, OS keychain or
released installed app.

These observations cover only the preparation part of DMC-T01 and unpaired
status part of DMC-T14. Both scenarios remain **NOT COMPLETE**. Integrated host
events, authenticated owner/device/capabilities, mobile, relay, execution and
physical-device acceptance remain **NOT RUN**. The two focused files are
`extensions/hypeproof-chat/test/companion-workspace.test.mjs` and
`extensions/hypeproof-chat/test/companion-workspace-host.test.mjs`; native artifact
paths and reproduction are in the linked evidence. Later mapping/evidence-only
commits do not turn this observed source into a new native acceptance run.
The subsequent Studio #3080 scope-boundary correction adds four host-adapter
controls for activity changes during binding/filesystem validation before review
or persistence; all four must block stale review or metadata writes. Those new
failure paths and controller bytes have source/fixture checks, with native
acceptance **NOT RUN**; the earlier native run remains bound to `b7ee35cf`.

## Development host preview composition — 2026-10-28

[Composition evidence and reproduction](../evidence/companion-host-preview-composition.md)
separate source/native-API fixture tests from a local Worker/D1 and headless
mobile-sized browser integration. The latter observed the selected same-version
HTML, explicit fixture confirmation, journaled read, source preservation and
repeat-result reuse. Final source results are bound in the PR validation record.
Installed native UI, real account/phone, classroom activity and DMC-T04/08/15
remain **NOT RUN / NOT COMPLETE**. No acceptance row is replaced.

The [bounded transfer and mobile presentation slice](../evidence/companion-artifact-transfer-20261028.md)
adds framed results and controlled result presentation while retaining the
original runtime/relay limits. Its partial source/browser evidence does not
complete device, restart, classroom or production acceptance.

## Owned mobile controller/recovery source cut — #3099

Focused source checks cover one prepare/send, interrupted eight-part ACK batches,
exact same-live-owner checkpoint restoration, stale/mutated packets, lost keys,
confirmed cleanup with storage-error retry, and successor-owner fencing. The
controlled React view tests waiting, reconciliation and explicit local removal.
Framing/2 retains decoding and exact saved bytes for historical framing/1.
The separately recorded new-cut checks do not transfer historical browser or
installed observations to a new package identity. No production/cold-key/device
acceptance row is completed by these source checks.

The [activated host pacing regression](../evidence/companion-dev-host-pacing-20261028.md)
executes the native entry and authenticated transport with the real budget scheduler
and an injected clock. It retains the failing burst case and passing paced case,
including same-session owner replacement. The fixed entry is a source observation;
installed Android composition and customer acceptance remain separately evidenced.

## Standalone native controls/journal source cut — #3098

Focused checks cover native identity/config/token invalidation, bounded/rejected
response-stream cleanup, explicit native comparison/approval/cancel/close/revoke,
single receive ownership and ACK-expiry retirement. Entry tests preserve exclusive
journal ownership and old-write drainage; pacing retains the same-session budget
through owner replacement. A real short session deadline must synchronously
close the native owner, erase key references and suppress late receive effects.
The isolated DEV-copy tests retain the semantic engine version separately from
its release marker. These new-cut source checks do not establish installed UI,
member identity, production deployment or stable Mac/Windows stamping.

## Initial Android debug preview source cut — #3100

Focused checks cover bounded/cancelled native RPC correlation, authenticated
selection/result demux and the actual React entry. The exact browser asset
pipeline must pin one matching React/ReactDOM graph and render its initial UI
without Node globals or native messages before an explicit gesture. Java,
manifest and Gradle inputs may reuse historical compile evidence only after
byte comparison; changed web assets remain a distinct package identity. No APK
rebuild, installation, native personal login or release acceptance is implied
by these source/asset checks.

## Local desktop handoff and packaged Android follow-up

The [local handoff evidence](../evidence/companion-desktop-handoff-local-20261028.md)
covers a bounded record in the existing TaskWorkspaceStore, explicit native review
and discard, and preservation of all desktop drafts and selected file bytes.
The final source requires the existing native owner's synchronous invalidation
lease after asynchronous storage/navigation. Independent actual-store controls
at `ca9e52b0e37b0d9a48f1a065ee86a7080d158dc8` passed original peer-discard,
replacement, access/profile/task changes during final persistence, disposal and
missing-lease cases. Earlier failing receipts remain preserved. These are local
API/fixture observations; native registration, account invalidation wiring and
desktop/mobile delivery do not yet fulfill DMC-T11.

The [Android source evidence](../../apps/companion-android/RESULT-DEMUX-EVIDENCE.md)
retains a packaged-React failure and later-selection/result interleaving failure.
Source `9a7d92771d10d1b2984da65c6c4a0338c1a7ff2f` repairs both. Real isolated
Chrome with the exact asset CSP reproduced the old APK's blank first screen and
rendered the repaired first button without native protocol calls. APK SHA-256
`724ddc17c89a5869b85a7949eaa194da4c29ef44edfaf42f6b750dd7f8ded607`
contains those same three checked assets. An owned API35 emulator then observed
the installed initial UI and invalid-provisioning refusal. The composed run
stopped waiting for the separate Studio test driver to activate: normal native
account/pass flow and installed-APK artifact delivery remain **NOT RUN** for
this package. Source, browser, packaging and initial-screen observations are not
whole mobile or physical-device acceptance.

## Reviewed draft/manual Send source cut — #3114

Focused checks cover actual TaskWorkspaceStore handoff/import, current owner
before final atomic rename, conflicting or cancelled review, native UI generation
and autosave ordering, existing Send admission and exact restore/run provenance.
SDK terminal tests distinguish measured completion, failure/refusal and unknown.
Mobile checks cover one send, bounded receipt observation, manual receive races,
explicit same-pair selection adoption, stale/retired results and preserved cached
preview/draft. The previously lifted cipher-close callback remains singular.
Historical Worker/installed/native SDK evidence is retained at its old identity;
new-cut source/React/asset checks do not imply a new installed observation,
genuine membership, provider quality or production readiness.


## Android personal-account sign-in source cut — #3115

Run `apps/companion-android/test/device-sign-in.test.sh` with Java17 under the
shared resource lease. Seven protocol groups cover exact browser origin/code,
slow-down and expiry, cancelled/late credentials, active account/session matching
and canonical debug-only loopback. Two real owned loopback HTTP controls exercise
whole-call drip deadline and explicit cancellation; neither invokes an account,
Service model endpoint, browser or Android runtime. Compare all Java/manifest/
Gradle inputs with the reviewed native sign-in source before reusing its debug
Java compilation and processed release-manifest evidence. This cut keeps web
and extension bytes unchanged from #3114. Historical installed synthetic-login
observations remain bound to their original source/package; new source checks
and reused compile evidence do not establish installed or genuine-member acceptance.

## Scoped execution source contract

`companion-execution-record.smoke.mjs` exercises real local persistence: one-shot
binding, exact text including whitespace, retained terminal history, replay,
unknown outcomes, draft conflict and owner invalidation. The `created:false`
return is a no-dispatch instruction, not permission to resume an interrupted run.
`companion-execution-policy.test.mjs` covers selected-file tool restrictions and
live scope checks; it does not establish an OS filesystem sandbox.
`companion-execution-authority.smoke.mjs` compares authenticated Service evidence
against independently held native scope, activated-pass identity and exact packet
bytes, including terminal/expired/mismatched evidence and bounded ASCII headers.
Its parser performs no network authentication and cannot execute a request.

`companion-normal-turn.test.mjs` exercises the unregistered development entry
through the same provider path as desktop Send. It checks admission before any
await, empty-draft and current-scope checks, reservation replay suppression,
durable binding, cancellation and measured terminal records. The SDK tests
check the fixed reservation header on the actual SDK option builder: ambient
companion headers are removed, mismatched turn/request/file fields fail closed,
and caller mutation cannot replace the captured binding. A scripted SDK module
is used for these controls; this is not installed-CLI or live Service acceptance.
The prepared entry carries no browser, shell, orchestration or proxy fallback.

Execution-owner tests exercise cancelled consent, native zero epoch and 48-bit
consent revision, foreign/stale scope, repeated exact requests, two successive
versions, lost replies, wrong terminal proof and synchronous session-close
cancellation. They use local files and scripted client/SDK ports. Native owner
wiring controls exercise the actual account/profile/preparation composition
with fixture HTTP and native UI. Android source controls check the new receipt
schema, ACK-before-display, stale-result isolation and retained draft/preview.
These checks do not replace fresh ephemeral D1/actual SDK/installed Android
acceptance for the newly composed execution path.

Complete acceptance additionally needs the actual shared Send path, Service
atomic model admission, installed host/Android flow, original-version restoration
and a second version without replay. Source controls alone do not close those
rows; real provider quality, physical devices, iOS and classroom outcomes remain
separate from synthetic-account and scripted-upstream observations.


## Selected execution cut validation and evidence identity — #3097

The split source retains exactly one previously lifted synchronous HostSession
close callback and one generic deadline test. Focused controls exercise actual
TaskWorkspaceStore persistence, provider normal Send admission/restore/terminal
mapping, selected SDK tool policy and per-tool live reservation checks, owner
composition, bounded native transport and verified Android receipt rendering.
Use the exact explicitly supplied private client from repaired Service
`c9714c86bc8ccd9471806287a02e962a7100af70` for local ABI/types/assets checks.
The prior Service `c066ca17655cb618730632238a8a08519da7c310` late-model-revocation
failure stays preserved; its atomic live-reservation repair and independent
Hono/D1 controls are separate Service evidence, not a new worker deployment.
Historical installed runs remain bound to their original source/APK/Service
identities. This cut runs source/React/scripted-SDK/bundle checks only and does
not make a new installed CLI, model quality, physical/iOS, genuine-member,
classroom or production claim.

## Required source CI inputs

The normal extension `npm test` command includes the existing companion execution
host, selected-file SDK policy and normal-turn admission `.test.mjs` suites once,
before the smoke glob. These tests use synthetic SDK/transport ports; they do not
claim installed execution.

The existing `worker / test` job runs the required companion source checks first
through `npm run test:service-integration`, after its existing private Service
bootstrap and dependency setup. It uses an immutable `companion-client` pin in
`config/service-packages.json`. `scripts/companion-ci.mjs` requires the tag, SHA256
and Service source-commit metadata, validates the cached archive, installs it
offline with scripts disabled in a temporary directory, and checks the real
pairing/relay/execution exports and TypeScript adapter ABI. Missing or wrong
inputs fail; no local sibling checkout or optional package skip supplies a pass.

The same job typechecks Android web source, runs all existing Android `.test.mjs`
files including the actual private-client browser-bundle first render, and runs
the existing JVM sign-in/deadline controls with Java17 or newer. Its temporary dependency
link is removed after the run. It does not assemble an APK, execute Android's
platform lifecycle, connect an account, or deploy Service. Earlier independent
source evidence and installed failures remain bound to their original versions.

## Bounded receiving controls — #3135

DMC-T04/05/06/07/12/14 add `companion-receiving-lifetime.smoke.mjs`, real owner,
entry/command, host-session and unchanged shared-budget controls. Exercise zero
receives before Start, duplicate Start/manual receive exclusion, ten-second idle,
sixty empties, monotonic deadline without renewal, hung/late callbacks, sticky
unknown/closed fences, busy Stop/revoke, signer retention through a confirmed or
lost reply, exact status/revoke-only authenticated transports and batch retention.
The native status is an observation of existing approvals, never a decision.

Installed acceptance must use one Start plus an explicit phone Submit without
the one-shot command, preserve normal file/SDK approval and unknown no-replay,
observe focus/browser/modal transitions without renewal, and exercise Stop and
revocation while busy. Source fixtures do not establish physical reachability,
latency, installed selected execution or classroom acceptance. #3135 remains
open until its exact source and installed evidence are independently reviewed.

The independent DEV Stop/Revoke command admission is source-tested while the menu is busy. Actual access through a native modal is NOT RUN: the OS modal may require Cancel before Stop; command registration and status visibility do not prove clickable controls during that modal.


A15 at `98645c411aea6fa0c21395d6365d326594c8c29b` passed 37 observed checks,
including phone intent → real SDK selected-file write → phone result/ACK, then
failed clicking the receiver Stop: Studio defaults `workbench.statusBar.visible`
to false. Hidden status-item DOM text was not physical reachability. Preserve
that FAIL and do not force-click, invoke the handler from the test, or enable the
status bar only in the fixture.

The repair adds `companion-receiving-controls.smoke.mjs` (actual provider source,
DEV/owned-view/nonce fences), command controls for replacement, busy admission and
truthful failed revoke, and `companion-receiving-controls-render.smoke.mjs`
(actual ChatPanel, shipped CSS, hidden shell bar, narrow/wide keyboard controls
while the normal composer is busy). Absent/closed state hides actions; stopped
and unknown state disable Stop. No start/Send/grant action crosses this bridge.
Installed A16 must click the visible control and observe no later work, then
separately establish confirmed or unconfirmed remote revocation. Source render
controls do not prove Electron/modal reachability or installed Stop acceptance.

### Receiver chat selection regression (A17)

`companion-dev-host-owner.smoke.mjs` drives the real native owner and authority
snapshot with fixture-owned VS Code surfaces: explicitly select and authorize
the saved HTML, clear `activeTextEditor`, and focus the same provider-owned chat.
The exact request must reach authenticated reservation and the existing prepared
Send port once. The fixture intentionally stops at Send; it runs no SDK. Refuse
reservation/Send for foreign chat/webviews, a different editor, same-URI document
replacement, closed/dirty/untitled documents, changed content/version, changed
task/epoch/profile, expired pair, and document/focus drift during awaited account
resolution. A real-owner source control completes two measured versions through
one max-two-turn grant, with no regrant. It also delays the live document update
after filesystem measurement and checks one-time adoption when that exact hash
arrives. An observed unrelated edit before catch-up fences adoption. Between-turn
external edits, duplicate completion replay, failed and unknown results cannot
advance that pin or reserve another turn. Retain the existing preview-active-editor controls. An installed App
run must separately exercise the real chat tab, execution, result, Stop and revoke.
