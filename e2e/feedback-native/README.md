# Feedback native candidate acceptance slice

This runner operates the prepared desktop shell on macOS or Windows. It reuses the
existing classroom harness's OOPIF/CDP discovery, but sends native CDP keyboard and
mouse input instead of DOM events, a host command bridge, injected messages or
seeded token/history files. Foreground input is disabled by default. `--allow-foreground` requires an explicit dedicated UI slot; prefer a hosted runner. It never activates another app or uses AppleScript/System Events. It can attach without process ownership, or launch
and stop only its generated isolated profile. It never calls an external model provider or submits an image edit. The optional
owned history/streaming mode enters actual chat turns through the real SDK and
Service, with text responses supplied only by its owned scripted loopback.

Use Node 24 (built-in WebSocket, TypeScript stripping, loader hooks and SQLite), a
prepared app from `scripts/studio-dev.py`, an explicit Service manifest and private
credential files. No full desktop shell build, installed-app modification, `HOME`
replacement, shell tool permission change or provider key is required.

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

Rendered user/assistant marker occurrences must be exact after actual reload;
interrupted turns must not reappear as committed history. This checks the existing
`chatPanelProvider.ts` `!ctrl.signal.aborted` guard around `appendHistory` (and its
explicit truncated-turn comment), not a requirement to hide arbitrary transcripts. Native unsent drafts
must survive, and ten-second restored-idle observation windows must show no new
generation. The Service and scripted listener separately report client close,
response-reader cancellation and exact linked upstream socket closure, with a
bounded wait before cleanup. Missing propagation fails its native step; cleanup
is never PASS.
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
slow activation and the expiry notification remain separate unobserved conditions;
no ten-minute wait, seeded app state or product test backdoor is added.
