# Feedback native candidate acceptance slice

This runner operates the prepared desktop shell on macOS or Windows. It reuses the
existing classroom harness's OOPIF/CDP discovery, but sends native CDP keyboard and
mouse input (plus the narrowly owned Windows native quit-dialog UI Automation described below) instead of DOM events, a host command bridge, injected messages or
seeded token/history files. Foreground input is disabled by default. `--allow-foreground` requires an explicit dedicated UI slot; prefer a hosted runner. It never activates another app or uses AppleScript/System Events. It can attach without process ownership, or launch
and stop only its generated isolated profile. It never calls an external model provider or submits an image edit. The optional
owned history/streaming mode enters actual chat turns through the real SDK and
Service, with text responses supplied only by its owned scripted loopback.

Use Node 24 (built-in WebSocket, TypeScript stripping, loader hooks and SQLite), a
prepared app from `scripts/studio-dev.py`, an explicit Service manifest and private
credential files. No full desktop shell build, installed-app modification, `HOME`
replacement, shell tool permission change or provider key is required.

## Official platform baseline in hosted CI

Without an explicit tag, each hosted platform uses the newest published stable
release in `hypeproof/hypeproof-studio` that contains exactly one portable ZIP for
its platform/architecture. Mac and Windows may therefore use different release
labels. For example, stable v2026.1020.2 is Mac-only while the last published
Windows shell is v2026.1017.0; a missing latest Windows asset does not authorize a
draft, RC, arbitrary archive, mirror credential or skipped native check.

An explicit `PUBLIC_APP_TAG` remains strict: that exact published stable tag must
contain the requested platform asset. Default metadata enumeration is bounded by
30 seconds/8 MiB and 1000 releases; malformed/ambiguous or unverifiable assets fail.
The downloaded shell still requires the existing SHA-256 or published acceptance
hash checks, current extension injection and verified SDK binary before native
checks. Selection metadata is not a Windows execution pass.

Saved-activity selection compares the complete absolute path from the real button
`title`, checks its accessible name agrees, and requires one match. The visible
`small` text intentionally contains only a shortened path. No basename/suffix
matching, broader drive matching or product StartPage change is used. The actual
component DOM control covers this contract; hosted native execution remains a
separate required result.

## Existing candidate, actual local Service

The delivery owner prepares the app and starts the actual local Service. Create a
private Service manifest outside the checkout:

```json
{
  "schema": "hps-feedback-service/1",
  "origin": "http://127.0.0.1:8787",
  "source": {"repository": "hypeproof/hypeproof-service", "sha": "FULL_SHA"},
  "runtime": "actual wrangler; isolated D1",
  "evidence_level": "actual-local-wrangler-not-production",
  "provider": "configured by owner; runner sends no model requests",
  "token_a_file": "/absolute/private/token-file",
  "token_b_file": "/absolute/private/different-activity-token-file"
}
```

Credentials are read only from the explicit file, never printed or persisted in
results. Parent-provided provenance is labelled as such; preflight independently
checks both authenticated `/v1/profile` responses and requires distinct actual
`activity_id` values, even if the profile IDs/names are equal. Token B paths are
validated as absolute and both codes are included in evidence redaction. Do not claim that this metadata
request proves a provider dispatch or production deployment.

Set these two keys in the **isolated candidate** `User/settings.json`, then reload:

```json
{"window.dialogStyle":"custom", "files.simpleDialog.enable":true}
```

OS-native dialogs are outside CDP. Without these settings the folder/save slices
report `BLOCKED`; the runner does not replace them with direct file mutations.
The profile proxy must explicitly match the manifest's loopback origin plus `/v1`.
The workbench command language is English by default; set config `reloadTitle` if
the visible built-in Reload Window command uses another language.

```bash
export HPS_FEEDBACK_CDP=http://127.0.0.1:9777
node e2e/feedback-native/prepare-config.mjs /absolute/state/receipt.json /absolute/private/service.json /absolute/evidence --attach
node e2e/feedback-native/run.mjs /absolute/evidence/config.json --preflight
node e2e/feedback-native/run.mjs /absolute/evidence/config.json --allow-foreground
```

`prepare-config` creates unique B and empty C work folders; attach uses the preparation
state's existing `workspace` and `user-data`. It never modifies attach settings,
starts, stops or kills the attached app. Use an isolated acceptance workspace,
not a learner's live work: the suite deliberately replaces an unsent draft with a
unique marker, creates one new text file and changes selected external skills.
It preserves originals and never sends the marker. Re-create config after each
source commit/reinjection; stale source SHAs, dirty extension source and bundle
mismatch fail before native interaction. The original preparation receipt lacks
a source SHA, so results state that limitation and record clean checkout HEAD,
matching preparation stage, injected bytes and receipt hash separately.

## Portable Windows or Mac prepared copy, deterministic metadata Service

This mode uses actual Service source/token/profile/activity/router code with its
existing SQLite/KV harness adapters. Cohort/session/roster/users are **synthetic**,
real provider keys are removed and outbound provider network is rejected.
With `--scripted-upstream`, a synthetic key and the existing proxy URL bind only
the owned loopback response fixture; metadata-only mode keeps generation off. It is not a
production profile, model or installed-app proof. Keep the Service directory
outside the evidence upload, because it contains private token files.

```bash
HPS_SERVICE_SOURCE=/absolute/hypeproof-service HPS_SERVICE_SHA=FULL_SHA node --experimental-strip-types --experimental-sqlite e2e/feedback-native/service.mjs /absolute/new-private-service-dir
```

On PowerShell set `$env:HPS_SERVICE_SOURCE` and `$env:HPS_SERVICE_SHA` first, then use the same Node command.
Read the returned loopback origin and use it when preparing the copied shell:

```bash
python scripts/studio-dev.py prepare --base-app /absolute/released-app --state-dir /absolute/new-candidate-state --provider service --service local
node e2e/feedback-native/prepare-config.mjs /absolute/new-candidate-state/receipt.json /absolute/new-private-service-dir/service.json /absolute/new-evidence
node e2e/feedback-native/run.mjs /absolute/new-evidence/config.json --allow-foreground
```

On Windows `--base-app` points to the directory containing the extracted official
portable `HypeProof Studio.exe`; macOS uses the `.app`. Download/extract a chosen
release through the existing release process and retain its checksum evidence;
this runner does not fabricate release provenance from a prepared copy. The
preparation only builds/injects the extension and webview, using the released
shell. Generated profile settings point to the manifest's actual port.

An owned launch sets only `HPS_TEST_E2E=1` plus `HPS_TEST_REAL_WORKSPACE=1`. The
first suppresses analytics; the second explicitly uses the real production
`ensureWorkspace` route. Token/history/profile/coach backdoors are refused, and
real folder reload target changes are asserted. Results identify these flags;
do not combine this proof with a flag-absent actual-candidate observation. A
configured `inmemory` SecretStorage does not prove process-restart persistence.

## Covered and outstanding evidence

| Slice | Native check | Scope limit |
|---|---|---|
| T01/T02 | Files command, native Explorer, user's hidden sidebar across chat/reload, native new-file save and Explorer row | Initial first-launch default is an owner observation; no overwrites |
| T03/T04 | Native folder picker cancel, same activity B reload, no code reentry, draft carry, native File Open Folder back to A, then saved activity → activity folder chooser → B → File Open Folder A; each destination draft wins | No history is invented from an empty conversation |
| T05 | After T03 PASS: real Cmd+Q (Mac) / visible File → Exit (Windows), owned child exit 0, CDP connection refusal, same profile/binary/environment restart with different PID, visible chat and identical A draft; deliberately hidden sidebar and exact native-saved file hash survive | Owned OS-backed SecretStorage only; attach/in-memory is BLOCKED; no `ensureChat`, token entry, force-kill or reseeding may establish PASS |
| T04 independent activity | Actual Start → different activity → enter B → select bound A → visible rejection → cancel; A draft/files unchanged. Empty owned C admits B without A draft; distinct B draft survives native File Open Folder A→C→A | Requires explicit second token with different Service activity identity and generated C ownership marker; no model history inferred |
| T04 session negative | End-of-suite canonical DELETE ends only the owned synthetic fixture session; existing A profile then returns session_inactive and the actual saved-activity UI refuses admission while draft/files/bindings remain | Session ended, not JWT expiry or token revocation; never an attached/deployed Service |
| T03/T06 scripted followup | Actual native entry of completed A1/D2 turns, fresh owned D, exact history after folder reload, active Start refusal, Stop, normal quit/restart, direct File Open, revoked B admission refusal | New implementation; native execution NOT_RUN until dedicated hosted evidence. Scripted responses prove no real model behavior. Multiwindow/crash/live JWT expiry remain separate |
| T07 | Runtime skill command, public pinned import, visible revision/license/capability preview before explicit select, stored preview, disable | Import uses public GitHub; selected instructions reaching a provider and offline transport isolation remain `NOT_RUN` |
| T08/T09 | Source regressions elsewhere | Native update/revert/tamper tests not substituted by helper assertions |
| T16 capability subset | Actual native command registration and disabled-profile notification | No image is selected, uploaded or charged; enabled profile reports `BLOCKED` instead of attempting a paid request |

`result.json` distinguishes `PASS`, `FAIL`, `BLOCKED` and `NOT_RUN` per slice.
`PASS_SELECTED_SLICE` is execution success for the selected deterministic checks;
overall acceptance remains `PARTIAL`. Screenshots and hashes are supporting
candidate evidence, not release, production, human usability or quality acceptance.
A bounded local native attempt observed chat entry, then was interrupted at user
request because foreground changes were disruptive. No further local foreground
testing is authorized. Completed results are retained separately; remaining native
slices are pending a hosted/dedicated runner. Default invocation now performs only
read-only preflight, even when a config requests native scenarios.

```bash
node --test e2e/feedback-native/*.test.mjs
npm --prefix /absolute/hypeproof-service run setup:packages -- worker
HPS_SERVICE_SOURCE=/absolute/hypeproof-service HPS_SERVICE_SHA=FULL_SHA node --experimental-strip-types --experimental-sqlite e2e/feedback-native/service.mjs /absolute/new-probe-dir --probe
```

The test command checks endpoint/path isolation, credential redaction, backdoor
refusal, receipt/build/hash/source guards. Service setup builds its canonical
measurement-core and service-contracts public exports before installing the Worker.
Installing only the Worker leaves a fresh checkout without required `dist` exports;
the hosted workflow uses the same `setup:packages -- worker` path and runs the
probe with the scrubbed child environment before downloading or preparing a shell.
The probe executes actual Service
source auth/profile/activity reads for two synthetic users without any desktop or
provider call. Neither is reported as a native UI pass.

The optional `feedback-candidate.yml` workflow runs on scoped harness PRs or manual dispatch and has read-only GitHub permissions. It requires `HYPEPROOF_READ_TOKEN` for pinned private Service packages/source, the exact `config/service-deployment.json` Service SHA and published official shell assets. The shell comes from the stable source release in `hypeproof/hypeproof-studio`, using the current-repository contents-read job token; the private mirror is not an authentication fallback. Asset digest/acceptance hash verification still precedes extraction. Only GitHub metadata/download commands receive that token; extraction, preparation, Service and native runner subprocesses use an environment without token/secret/password/PAT/key fields. Root checkout credentials are not persisted. This environment filter is not a filesystem or process sandbox. It confines explicit native foreground input to hosted Mac/Windows desktops. The workflow and hosted native slices are NOT_RUN until an actual run completes; missing credentials, download hashes or a usable desktop remain explicit blockers.

Service provenance is explicit: `service.mjs` refuses an unspecified or mismatched `HPS_SERVICE_SHA`. Hosted checkout derives that SHA from `config/service-deployment.json`; a dispatch assertion must match it. A probe of another explicitly named checkout is only that checkout's synthetic metadata result and cannot stand in for reviewed candidate or deployed Service evidence.

## Full process restart and independent activity fixtures

New configurations select `restart` and `activity-isolation` in addition to the
existing folder slice. They require the folder test to reach T03 PASS first. The
hosted entry point already explicitly selects `--secret-storage=os-keychain`;
local config generation still defaults to in-memory storage and the restart slice
must report BLOCKED there. Attach mode cannot prove owned exit/relaunch and cannot
use the generated-owned-C isolation slice. Old explicit configs may omit these
scenarios, leaving them unexecuted rather than claiming coverage.

The Windows quit path clicks the actual visible File → Exit menu item; CDP
Alt+F4 is not assumed to reach the OS window manager. The Mac path uses its
registered Cmd+Q binding. Neither path uses an extension-host quit command.

For the Windows streaming-quit scenario only, the shipped core quit guard requires
an explicit native confirmation after File → Exit. The driver captures the already
spawned process PID, executable and UTC start stamp before input. A bounded 10s
UI Automation observation reads only top-level dialogs of that process and requires
one visible `#32770` dialog owned by a window of the same process, the exact
`Studio를 끝낼까요?` message and running-turn detail, and exactly the enabled
`계속하기` / `끝내기` choices. It rechecks identity, dialog ownership and contents in
the OS process immediately before invoking `끝내기` once. Missing, changed,
foreign or ambiguous UI fails; an unconfirmed invocation is never retried. No
Enter/Escape default, other-app activation, AppleScript, security-policy change or
process termination can establish quit acceptance. The existing 30s normal child
exit and CDP-refusal checks are unchanged. UIA probe receipts prove only observed
UI/action; history, cancellation and no-replay still require their separate checks.
The Windows-only port is source-tested with injected observations; its new real
native UI behavior must be verified by the next hosted run.

The Mac streaming-quit scenario uses a run-owned Objective-C Accessibility helper
compiled from tracked source before Cmd+Q. It reads only the spawned PID
(`proc_pidinfo` start stamp and exact `proc_pidpath`) and that application’s own
windows/sheets. It requires one visible owned AXSheet/AXDialog with exactly the
same message, detail and two enabled, visible AXPress choices above. A bounded
10s observation repeats identity, parent/window ownership, unique dialog and
content checks immediately before one AXPress on `끝내기`. Unknown layouts,
permission denial, missing dialogs and unconfirmed invocation fail closed without
retry. `AXIsProcessTrusted()` is read-only: no permission prompt, TCC changes,
AppleScript/System Events or other-app activation. The compiled pure contract
mode tests strict dialog classification without accessing native UI; it is not
installed acceptance. Hosted Accessibility trust is unverified; absent trust
reports BLOCKED without changing permissions. The real hosted Mac dialog remains
NOT RUN for this repair.
Failure of streaming normal-quit recovery blocks subsequent foreground scenarios.


The full restart reuses the A draft already persisted during the actual A→B→A
folder test. It performs the platform quit action once, waits for normal exit of
the exact spawned child and connection refusal from the prior CDP endpoint, then
launches the same prepared executable, profile, launch args and scrubbed
credentials-free environment. The new PID must differ. It only observes
the directly restored chat and its draft; it never calls the initial admission
helper or enters a code after restart. Process cleanup in `finally` is separately
labelled and never contributes to restart PASS. A hung endpoint, signal kill,
nonzero exit, reused PID or missing draft cannot satisfy the proof.

The third fresh C folder is necessary because A and B are both bound to activity
A after T03. Preparation records all three paths in its owned-profile marker.
Absolute paths, distinct real folders (including linked C aliases), C's initial
emptiness and distinct authenticated Service identities are checked before B is
admitted. The actual visible StartPage labels are used; no extension host command
bridge, DOM event/field mutation or token storage write substitutes for UI input.
Cancel after rejected B preserves A's actual file hashes and draft. Successful B
admission must create a new visible extension target and an empty draft. After a
unique B draft, real File Open Folder A→C→A restores each saved draft without code
entry. Tests finish on A so later native checks keep their original activity.

Background tests use synthetic process/transport/UI-transition fixtures only.
They validate ordering, negative controls and refusal; they do not prove native
restart, OS keychain persistence or actual activity navigation. These new native
slices remain NOT RUN until the delivery owner executes the committed candidate
on a dedicated hosted desktop. No local foreground execution, provider call or
GitHub write is part of the implementation handoff.

Restart observation deliberately sends **no Focus command or keyboard input** after
relaunch. It waits for the actual visible restored chat textarea and its expected
persisted A draft. The d84cec88 Mac run 38843826441 reached relaunch but failed its
extra Focus/F1 wait while the screenshot already showed A's draft; that historical
FAIL remains unchanged. The revised runner records normal child exit, prior CDP
connection refusal and new PID incrementally before the final draft probe, so a
later failure retains those observations without claiming full restart PASS.

The Windows d84cec88 run 38843826441 remains FAIL. Its T02 screenshot showed an
already focused textarea partly below the viewport; readiness now observes the
Focus command's actual document/textarea focus without clicking to manufacture
that result. Explicit input still uses the unchanged visibility, bounds and
hit-test checks. A missing actual focus remains a failure.

The same run displayed the selected folder with lowercase `d:` while its explicit
configuration used uppercase `D:`. Candidate-folder comparison now checks the
complete absolute Windows path with drive-letter/separator normalization; it
never uses a suffix match or equates other drives, folders, URI text or relative
paths. Case in the remaining path is not broadly folded.

A failed owned activity sequence cancels only its actual visible `선택 취소`
candidate and waits for that state to disappear. It never clicks `연결 해제`.
The skill slice requires the original A workspace/chat rather than continuing in
a pending B candidate; missing prerequisites report BLOCKED. T07's historical
phases show its import prompt was accepted but no preview was observed. The
artifact does not establish whether the pending candidate or public download
caused that failure. Canonical public-download warning outcomes are now captured
as failures rather than missed until the preview timeout. No automatic import or
network retry is added; the actual provenance preview is still required to pass.

## Additional continuity and session-negative slices

The third same-activity route selects the saved activity by its complete displayed
workspace path (the list deduplicates an activity to its latest saved B folder),
then uses its actual activity folder chooser. It does not enter a token or seed
credentials. Existing B's distinct draft must survive; public File Open Folder A
must restore A's original draft. A missing/ambiguous saved path cannot select a
neighboring activity. Restart proof additionally requires the native-saved file
and an explicitly hidden sidebar before quit, then unchanged bytes/layout after
actual direct chat restoration.

Only this metadata fixture opts generated owned configurations into
`session-ended`, always after all other UI scenarios. The fixture writes its
existing synthetic admin credential to `admin-control` beside its private token
files, outside uploaded evidence. The runner verifies the exact fixture source
hash, preflight Service source receipt, private credential hash and live
instance/PID attestation before any canonical mutation. It checks existing A is
valid, sends exactly one `DELETE /admin/cohorts/synthetic-release-acceptance/session`,
then requires A's actual profile 403 `session_inactive`. A public saved-activity
selection must display the App's canonical `classifyProfileFailure` mapping for
that response (not the raw Service message), plus its existing-connection
preservation line and no admitted candidate. It must preserve A's visible draft, actual
workspace files and persistent binding files, and create no candidate admission.
There is no automatic retry, token reissue, session reopen or provider request.
An absent control receipt leaves this slice NOT_RUN; attach cannot mutate it.

This represents an **ended classroom session**, not a JWT expiry or revocation
proof. The Service currently describes an absent session as “수업이 아직 시작 전이에요.”;
the harness checks the actual canonical response and records the distinction.
The native UI assertions remain NOT_RUN until an actual hosted execution.
A standalone background probe tests only the canonical fixture path:

```bash
HPS_SERVICE_SOURCE=/absolute/pinned-service HPS_SERVICE_SHA=FULL_SHA node --experimental-strip-types --experimental-sqlite e2e/feedback-native/service.mjs /absolute/new-private-probe --probe-session-ended
```

It starts and closes its own synthetic SQLite/KV fixture, reports no provider
calls and makes no desktop interaction. Its result cannot stand in for native UI
refusal, credential persistence or full T01–T06 acceptance. The separate scripted
follow-up below enters actual SDK turns through the Service. Its native history
and active-streaming assertions remain NOT_RUN until dedicated hosted evidence.

## Scripted history / streaming follow-up (#1718)

See [the fixture contract](SCRIPTED.md). The hosted entry point seeds/checks the
actual SDK version vendored in the official shell, then executes the real-SDK
background protocol probe against its own pinned actual Service fixture. Native
configuration binds the immutable probe hash, source commit, Service SHA, actual
SDK binary/version and fixture file hashes. Missing/stale/failed protocol or
upstream-cancellation proof fails before UI input. It does not retry or rewrite
requests. The same fixed output4096/retry0 env reaches the owned SDK child.

The original twelve selected native checks remain. New history/streaming checks
run before skill previews create unsaved documents, and before final A session
shutdown. Fresh owned D has never been opened; existing B's own state is not
misclassified as empty. Two real native SDK turns establish A1 and carried A1+D2
history, then actual File Open Folder restores each exact set. Three further
held turns test actual Start refusal/Stop, normal quit/restart and direct File
Open while active. Each counts against one same-activity 12-attempt upstream
ceiling including auxiliary/count_tokens/retries. Exhaustion remains explicit;
no activity reissue/reset or model fallback is a successful substitute.

Rendered user/assistant marker occurrences must be exact after actual reload.
The merged stopped-conversation contract (#1834; `docs/studio-requirements.md`
and `docs/testing/task-workspace.md`) preserves the original user message and
any partial answer actually received before interruption. The real SDK probe
records `sdk_delta_observed`; an active held upstream can produce no rendered
assistant text, which is valid. Readiness requires the actual Stop control and
upstream streaming, never an invented partial delta. The harness captures the
user and any observed assistant `data-message-id` identities and exact body text
before Stop, quit or direct folder open, then requires each once after restoring
the owning workspace. If no assistant bytes were observed, no assistant reply
may appear on restoration.
Duplicates, replacement identities, changed partial text and foreign-workspace
history fail. Explicit Stop must first show the product's stop notice; when a
partial assistant was observed, its stopped elapsed receipt is required in that
mounted view; a completed elapsed receipt cannot stand in for an interrupted
answer. These UI receipts belong to
the mounted view, so the harness does not invent a persistent stop/completion
marker after reload. An interrupted transcript is preserved context, never a
completed model turn or a request to execute it again. Native unsent drafts
must survive, and the unchanged ten-second restored-idle observation windows
must show no new generation. The Service and scripted listener separately report client close,
response-reader cancellation and exact linked upstream socket closure, with a
bounded wait before cleanup. Missing propagation fails its native step; cleanup
is never PASS. If an earlier history/streaming step did not settle, dependent
image-denial testing is BLOCKED while the original failure remains; on an idle
path the exact capability-denied notice is still required.
SDK onDelta before a completed assistant block is not assumed or fabricated.
Existing B is canonically revoked last, and actual opening C must refuse automatic
admission without new generation or binding/file changes. A returns with its
history/draft, then the original ended-session check still runs against A.

Receipts retain request sequence, turn hash, request class, actual accounting
registration/parent IDs verified in synthetic SQLite, and count_tokens separately.
Raw response headers that omit an ID remain null. Title/auxiliary T18 is only
OBSERVED if it naturally occurs; a quiet two-turn probe does not invent it.
These are synthetic protocol/native proofs; real model quality, real provider
billing/cancellation, crash recovery and active-stream token revocation are not
claimed. No new native result is PASS until the hosted run actually executes.

The owned HTTP bridge awaits its once-only response-reader cancellation promise
before settling the actual Service context and taking the ledger snapshot. This
orders fixture observation; it does not change Service runtime accounting.

### Hosted simultaneous-window scope

The normal full-process restart now observes restored textarea focus without a
focus command, click, or `Page.bringToFront` repair. A visible draft alone cannot
satisfy that focus check.

With scripted hosted mode, the suite opens the already-bound C folder through the
owned binary's public `--new-window` argument using the same isolated user-data
profile. It pins each workbench and its webviews to the observed window target ID;
ambiguous unscoped discovery refuses input. The original window follows the real
saved-activity chooser A→B and public File Open Folder back to A. The other C
window must keep its frame, independent draft, binding-file hash and workspace
files throughout. A ten-second destination observation rejects repeated reloads. Existing binding selection accepts only the exact physical
C root's two Windows drive-letter spellings and requires one regular file with
its actual Service/activity identity and credential-reference shape. It never
reads SecretStorage or folds other path casing; the selected raw hash must remain
unchanged throughout observation.
The currently focused owned window opens the public `Switch Window...` picker
and selects the exact observed destination title; the destination must then report
actual focus. Inactive C observation retains its already observed frame identity
and checks ownership without claiming that its control is visible. Cleanup uses
the public `Close Window` palette action on the focused, explicitly scoped
secondary only and observes that exact target disappear. Per-phase progress,
both window screenshots and target/focus metadata are captured before cleanup.
The primary error is retained even if diagnostics or cleanup also fail.

This is a new hosted scenario, not executed by background helper tests. Its result
records `pending_marker_consumption: NOT_OBSERVED`: UI preservation does not
expose the transient global memento. Existing actual-module controls separately
cover destination-bound one-shot consumption, stale/expired markers, delayed
restore, symlink/Korean paths and the 61-second acceptance boundary. Actual native
slow activation and the expiry notification remain separate unobserved conditions
in that ordinary scenario. Its simultaneous-window path adds no ten-minute wait,
seeded app state or product test backdoor.

### Optional hosted delayed activation and real expiry (#1725)

`HPS_NATIVE_DELAYED_RESUME=1` on the dedicated `hosted.mjs` execution step adds
one scenario before final synthetic-session shutdown. It defaults off, refuses
attach/local/in-memory credential modes, and adds no provider or SDK query.
Keep the existing18 checks and the source-bound actual-Service fixture. Root's
workflow must allow35 minutes; this mode adds roughly12–15 minutes per OS.
Do not set the option on background-control steps or launch a local desktop.

The scenario normally quits the owned candidate, observes its exit/CDP shutdown,
and relaunches the same profile with public `--inspect-brk-extensions=9788`.
An occupied/fallback/unowned inspector port refuses. Mac listener PID plus process
ancestry comes from `lsof`/`ps`; Windows uses `Get-NetTCPConnection`/`Get-CimInstance`.
The Node inspector must return the same PID. Initial startup is released promptly,
not held through the shell's60s connection/initialization deadlines.

The gate sets a pending breakpoint at the verified candidate bundle statement
immediately before `consumeActivityResume`, after `activationRoot` exists. It
requires one recognizable call, exact loaded source hash, exact script/location,
new owned extension-host PID and the expected root scalar. The only inspector
evaluations read `process.pid` and local `activationRoot`; arbitrary expressions,
product-function calls, clocks, mementos and credential reads are not allowed.
The post-initialization ordering is source evidence; IPC packets are not intercepted.

Actual Start → folder picker → current-activity confirmation creates each marker
and binding through production code. Three fresh owned destinations E/F/G test
2s propagation,61s valid draft checkpoint import, then610s real expiry. Each phase
must pass before the next starts. Wall and monotonic elapsed time are recorded;
the hold is not shortened or replaced by a Service HTTP delay. A first failure
retains partial evidence and stops further native input. Bindings/files are hashed
while paused before consumption and compared before explicit saved-activity
recovery. After that public entry transaction, the same physical root, binding
path, Service/activity identity and files must remain; only a well-formed
credential reference may rotate through the existing commit path. The expiry case requires
the exact existing Korean notification, actual Start, no automatically resumed
chat or `/v1/profile` connection, then explicit saved-activity recovery without code
entry. The discarded checkpoint draft must remain absent in the fresh destination.
Each successful phase returns through public File Open Folder to A. Successful
completion closes the debugger, normally restarts without inspector flags and
restores the original draft for the ordinary final session check.

Progress persists at most15s apart during holds, including script/PID/breakpoint,
durations, notification screenshots, request-count metadata and preservation
hashes. It never dumps debugger scopes/protocol bodies. Only verified gate pauses
are resumed. Breakpoints and sockets close before public quit; cleanup failure
cannot pass and does not replace the primary error. A final owned-child stop request is cleanup only; it is never restart evidence.
Final cleanup records child exit and CDP connection refusal separately, with a 10s
exit wait and 5s endpoint wait (plus an in-flight bounded probe). A sent signal
alone cannot set `owned_process_stopped`; timeout remains FAIL. For the captured
Mac streaming-quit child only, an expired SIGTERM exit wait may invoke a cleanup-only
SIGKILL after re-reading the exact PID/start/executable and checking the same child
object. A second bounded exit wait and the same CDP-refusal check are required;
the initial timeout and escalation remain in evidence. This never satisfies the
normal-quit/restart step or changes its FAIL. If cleanup still fails, the owned
child stays attached and `owned_process_stopped` stays false; no unref/detach or
peer/tree sweep is used. `extension-inspector.test.mjs` uses disposable Node children for
protocol/PID/replacement/cleanup controls, not a native App or T05 acceptance pass.
Actual hosted0.1.56 propagation and long-held behavior remain NOT RUN until root
executes this exact candidate. The existing ordinary native proof stays separate.


T07 closes each of its newly created untouched Untitled skill-preview editors
through the public **View: Revert and Close Editor** command. Before the command,
the preview must be the exact newly observed focused resource with unchanged
rendered content; all other editor resources must match the prior snapshot and
no foreign dirty editor may exist. Cleanup refuses rather than answering a
blanket save/discard dialog. T05 also refuses to begin with dirty editors. Saved
user files, activity drafts, skill storage and history are not rewritten by this
cleanup; native preservation checks remain required.

Inspector breakpoint URLs admit only literal/percent-encoded spellings generated
from the exact trusted file path, with existing drive-letter case equivalence.
At pause, raw URL validation rejects authority, query/fragment, encoded path
separators, dot segments and ambiguous second decoding. Decoded path equality,
physical regular-file identity, loaded-source SHA, owned PID, exact statement and
destination root are still mandatory. Directory case is not relaxed. Portable
Windows URL controls and actual owned Node controls on Mac are background proof;
Windows inspector/native execution and the complete T05 holds still require the
exact candidate's hosted run. The prior raw Windows URL spelling remains unknown;
this change does not claim a specific encoding was observed.


Ownership refusal diagnostics retain only bounded numeric listener/parent chains,
sampling timestamps, the declared phase and previous verified host PID. One
immediate read-only resample (at most 1.5s per platform command) is diagnostic only:
even if it now shows a valid owned host or no listener, the original refusal
still stops the gate. No retry, attach, resume, deadline or ownership rule changes.
This distinguishes lifecycle sampling gaps from a stable foreign listener on a
future run; it does not assign a cause to an earlier unrecorded rejecting PID.

Windows physical-path comparison also permits drive-letter spelling only: Node
realpath can return lowercase `d:` for the same pinned uppercase `D:` path. The
remaining returned physical path bytes, regular-file/non-symlink checks, loaded
source SHA, owned listener PID and destination root remain exact. This addresses
the observed 96c864 Windows physical-path refusal; actual hosted proof is pending.

## Provider-free render-feedback transport proof

`render-feedback-probe.mjs` takes a new absolute evidence directory, the verified
SDK binary and an immutable source HTML path. `HPS_SERVICE_SOURCE`/`SHA` pin the
actual Service source. It copies that HTML into an owned temporary workspace and
serves exactly that resource on loopback. Owned headless Chromium is the only
browser launched; no native Studio window or existing browser is attached.

The structural BrowserTab/raw-CDP transport is the explicit host seam. Actual
production `CdpSession`, `BrowserControl`, `toMcpToolResult`, browser MCP factory,
real SDK and actual Service process the tool call/results. The host never inserts
an image tool_result. The already-open owned page is a precondition; SDK
`browser_open` uses the existing already-open policy, then `browser_screenshot`
captures it. Screenshots are saved as real JPEGs, and their byte hashes must appear
in actual upstream tool_result image blocks. This proves pixel transport, not
semantic design quality, a full judge/fix loop, native integration or acceptance.

The explicit `--scripted-render` Service mode runs only the bounded owned render
protocol, never arbitrary upstream traffic. Four actual SDK queries share one
12-attempt ledger:390/1280 positives and no-browser-grant/no-host negatives, three
scripted dispatches each. Output4096/retry0 remains fixed; any auxiliary call or
retry consumes the same ceiling and can fail the proof. Negatives must advertise
no screenshot tool, invoke no host capture and return actual SDK error tool results
without images. Existing profile permissions and canUseTool are not bypassed;
the no-grant control only lowers the existing browser grant. Approval requests are
denied and recorded. Renderer network interception allows only the owned HTML.

```bash
HPS_SERVICE_SOURCE=/absolute/clean-service HPS_SERVICE_SHA=FULL_SHA node e2e/feedback-native/render-feedback-probe.mjs /absolute/new-evidence /absolute/verified-claude /absolute/frozen-candidate.html
```

When the configured scripted history chain has not passed, delayed activation
is BLOCKED before inspector or UI admission and preserves the earlier state.
Focus-readiness diagnostics record only the first and terminal owned-target DOM
sample; they never focus, retry or extend the original deadline. Error categories
are allowlisted, and returned sampling failures omit original error text.

### Explicit focus lifecycle diagnostics

For the owned synthetic T05 inspector scenario, fixed phase/boolean records in the existing HypeProof Coach output channel distinguish command entry, restore completion, editor reveal, message send/delivery and command return. Host records are gated by `HPS_TEST_E2E=1` and capped per extension activation. The runner retains only that prefix from its owned log directory, never raw output or credentials.

A temporary read-only observer on the actual chat frame records scope-match booleans for received focus/config messages and textarea/document focus/blur, capped at64 events and removed in finally. It does not call focus, click, postMessage, change an input, retry a command or alter its30second assertion. Missing logs/failed observer cleanup stay explicit diagnostic limits. This instrumentation changes the extension bundle: prepare a new clean candidate/source receipt and never reuse the historical190ac5 bundle proof. Native validation remains NOT_RUN until an actual hosted execution.

### Pinned public import quota (2026-10-18)

Full commit-SHA imports now use one bounded recursive Git tree response instead of
separate commit and directory metadata requests. Ancestor tree modes, truncation,
selected file modes/paths and downloaded blob hashes remain mandatory. Branch/tag
imports still resolve the commit before walking its trees. T07 continues to download
from public GitHub in the native app; no token or prerecorded transport is injected.
HTTP 403/429 failures now include the status, host and public rate-reset delay in the
customer error, so a runner's anonymous quota problem can be distinguished from a
native UI failure. This reduces quota use but does not claim public availability.
