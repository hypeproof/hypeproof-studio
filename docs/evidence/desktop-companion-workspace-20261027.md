# DMC-1 local workspace preparation evidence

Scope: the local preparation portion of DMC-01 and DMC-14 under
`hypeproof/hypeproof-studio#2803`; preparation close target: Studio #3080;
broader DMC-1 tracking issue: Studio #3071 (remains open).
Source base: `4ff05dba`; native-observed implementation:
`b7ee35cf0adcd945d0cbc88330c2225f677d3262`;
branch: `feat/desktop-companion-workspace-20261027`.
Source/fixture checks and an actual isolated desktop development app run are
recorded separately below. Full DMC-1, installed-host DMC-T01, integrated
DMC-T14, real mobile pairing and production acceptance remain **OPEN / NOT RUN**.
In particular, current activity identity is not verified personal ownership.

Canonical mapping: `ST-IMP-COMPANION-WORKSPACE` extends the foundation's
`ST-INT-COMPANION` → `ST-REQ-COMPANION` → `ST-DES-COMPANION` chain and
existing `ST-TEST-COMPANION` contract. No separate requirement definition or
completion record is introduced. Foundation synchronization and mapping-only
commits preserved the observed source above. The subsequent scope-boundary
correction below changes the controller and its regression tests; its native
acceptance has **NOT RUN**. Studio #3071 and parent #2803 remain broader tracking
context, not a claim that this preparation completes their acceptance.

## Observable desktop flow

The command palette entry **HypeProof: 휴대폰 연결: 로컬 작업 폴더 준비**
(`hypeproof-chat.prepareCompanionWorkspace`) selects an existing folder through
the native folder picker. The folder must already belong to the current Studio
activity and be the sole local trusted workspace. Existing activity/account
entry remains responsible for opening/binding a different project; this command
does not claim folders, switch activities, migrate history or grant access.

The native review modal shows the canonical local path, current activity label,
host name and supported preparation-only behavior. Internal activity IDs, host
digests and project hashes are not shown in the review.
After explicit confirmation, the existing extension `globalState` stores a
versioned preparation under an activity+canonical-folder key. It contains only
scope, local path, project/activity/host identities and preparation time. This
key is not enrolled in Settings Sync. A fresh command/controller restores the
saved record and shows Korean copy that no phone is connected (internal state
**UNPAIRED**), with no QR, pairing success, capability
grant, file transmission or host execution claim.

No workspace files or `TaskWorkspaceStore` records are changed. Directory
inspection is limited to the selected root's canonical path, type and access
metadata. Binding checks use the established `ActivityConnections.forWorkspace`
API, including its existing legacy binding normalization behavior in extension
storage. No new network, credential, ACL or content-reading path is added.

Untrusted, remote, multi-root, mismatched activity/server/host/folder, read-only,
missing/corrupt preparation and persistence failure cannot yield a prepared
record. Scope and binding are rechecked after interaction; cancellation and
concurrent clicks preserve state. Corrupt saved preparation is preserved and
reported with Korean recovery copy (internal state BLOCKED) rather than
silently replaced.

## Integration boundary

`readPreparedCompanionWorkspace(context, connections)` in
`src/companionWorkspaceHost.ts` is the stable metadata-read entry for DMC-2.
It returns a validated `CompanionState`; only `UNPAIRED` may carry an optional
`CompanionPreparation`. No preparation means setup has not been saved.
The reader rechecks current local/trust/activity/binding state. The project ID
uses the established task scope identity `[activity.id, canonicalWorkspace]`;
existing task/history stores are untouched. Host identity is a hash of the
installation's VS Code machine identity, **not** a device attestation. The
current activity name is **not** a verified account owner or proof of a remote
account actor. DMC-2 must independently authenticate actors and confirm bounded grants.

Removal: unregister the command and remove the three `companionWorkspace*`
modules/tests. Unreferenced versioned preparation keys can remain inert; no
workspace/task rollback, migration or source deletion is needed.

## Executed local evidence

The following baseline checks precede the subsequent scope-boundary correction;
its current-source checks are recorded separately below.
Environment: Node **22.22.1**, macOS Darwin 24.6.0, arm64. Synthetic temporary
folders only. All installs/tests/builds used the shared `hype-resource` queue
(owner `codex:01a12522-7c7d-70c2-b09a-353dad5e2280`). Dependency acquisition used
the checked-in extension lockfile and the prebootstrapped pinned private cache;
no alternate credential or Service bootstrap was initiated by this writer.

| Check | Result |
|---|---|
| Source/controller filesystem and failure behavior | PASS, 6 tests |
| Production command adapter with mocked native VS Code UI/binding APIs | PASS, 3 tests |
| Existing `task-workspace-store.test.mjs` regression | PASS, 19 tests |
| Existing workspace routing smoke | PASS, 12 checks |
| Existing workspace preparation smoke | PASS |
| `npm run build:extension` | PASS, esbuild extension bundle only |
| Extension `tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| Full extension suite, webview build and full application shell build | NOT RUN |
| Actual isolated desktop palette, folder picker, review, trust denial and process restart | PASS, bounded native observation below |
| Keyboard/screen-reader and released installed-app acceptance | NOT RUN |
| Installed-host DMC-T01 acceptance and DMC-T14 integrated status acceptance | NOT RUN |
| Mobile device connection, Service relay, execution and production release | NOT RUN |

Reproduction: `npm run test:companion-workspace` in
`extensions/hypeproof-chat/`, under the resource queue with Node 22.22.1.
The dedicated script is included in the extension's standard `npm test` chain.
Initial strip-only execution caught a TypeScript parameter property; the
controller now uses erasable syntax and the complete focused rerun passed.

Local raw logs and reproduction script:
`/Users/jaylee/CodeWorkspace/artifacts/desktop-companion-workspace-20261027/`.
The initial integration verification job was `dmc-workspace-verification-v2`.
The focused UX/authority follow-up uses `dmc-workspace-ux-authority-v1`; its
`ux-authority-*.log` files record the rerun. Tests verify Korean user messages
while internal states remain available through the metadata interface, the
current activity label without an account-owner claim, and the absence of
activity IDs, host digests and project hashes from confirmation details.

## Actual isolated desktop observation

The native observation agent used the actual isolated **HypeProof Studio Dev.app**
at source `b7ee35cf0adcd945d0cbc88330c2225f677d3262`, macOS 15.7.4 arm64,
Node 22.22.1. The prepared and observed extension bundles both have SHA-256
`d6ee1438de296027115372349647ce59efc5250c76412a0de48afe54e2d655a2`.
No source changed during the native run.

Observed in the actual app: the registered palette command; Korean refusal in
restricted mode; trust granted only to the owned synthetic workspace; the real
macOS existing-folder picker; the Korean review of local path/current activity/
computer without internal IDs; explicit save; and the message that no phone is
connected. After closing and restarting the owned process, invoking the command
restored the same preparation without reopening the folder picker. Preparation
metadata was exactly preserved. The synthetic `index.html` SHA-256 before and
after both runs was
`37c16595160f84ab89c33841db4f52af354f7a20fb0118a4ebb4434554895d3a`.

The profile authority was a synthetic loopback `/profile` fixture, committed
through the existing production `ActivityConnections` path. Credentials used
in-memory storage and were reseeded with the same synthetic identity after
restart via existing `hps-test-state.json`. This demonstrates preparation
persistence in an actual isolated desktop app; it does **not** demonstrate real
account continuity, OS keychain persistence or verified ownership. The activity
recovery warning remains visible on restart because in-memory credentials were
deliberately lost. The confirmation is the app's custom VS Code modal; only the
folder picker is a native macOS open panel.

The owned loopback fixture implemented profile/activity/health GET endpoints.
Existing access checks and trace POSTs were logged and rejected with 404. The
companion preparation feature adds no network transport; an existing updater
banner was visible, so this is not a global no-network assertion. The ordinary
installed app was unchanged at preparation. Physical mobile pairing, real
Service relay, execution, released-device and human acceptance were not run.
Read-only/wrong-scope/corrupt metadata negatives remain source/fixture evidence;
only the restricted-mode denial above was observed in the native app.

Local evidence and exact reproduction:

- `/Users/jaylee/CodeWorkspace/artifacts/desktop-companion-native-20261027/evidence/native-observation.json`
- `/Users/jaylee/CodeWorkspace/artifacts/desktop-companion-native-20261027/REPRODUCE.txt`
- `/Users/jaylee/CodeWorkspace/artifacts/desktop-companion-workspace-20261027/dmc1-independent-review.md`

These are retained local artifacts, not hosted or released acceptance evidence.
Native resource jobs were `dmc-workspace-native-prepare-b7ee35cf`,
`dmc-workspace-native-quiet-prep-v1`,
`dmc-workspace-native-observe-focusable-b7ee35cf` and
`dmc-workspace-native-reopen-b7ee35cf`, under the same resource owner above.


## Independent review correction

The independent host-adapter control reproduced a stale display when the current
activity changed during asynchronous binding verification while reopening an
existing preparation. The controller now checks the current scope after that
await, and again after the final asynchronous directory/metadata validation
before displaying a newly saved preparation. A regression control exercises
both transitions and requires a generic blocked message without stale folder
or preparation details. The saved original preparation remains in its own scope.

Resource job `dmc-workspace-async-scope-fix-v1`: PASS 9 focused companion tests,
PASS extension bundle, PASS TypeScript check. Raw logs use `async-scope-*.log`
in the existing evidence artifact directory. The independent source reviewer
re-ran all 9 focused tests and the two original race reproductions at
`b7ee35cf` with PASS. Native preparation at earlier source `e76417fa` is historical;
the separately bound `b7ee35cf` observation above covers the corrected app source
within its stated synthetic-profile boundary.

## Subsequent scope-boundary correction — Studio #3080

Before this correction, all four production-host-adapter controls reproduced
failures at source `083f21a97df4f4a8ec9be77419baf6901a9e0777`:

- A scope switch during binding validation or actual filesystem inspection after
  folder selection opened the previous activity's review.
- A scope switch during either validation after approval wrote the old activity's
  preparation metadata before the later display guard blocked it.

The controller now checks scope after awaited binding/filesystem validation and
immediately before persistence. Switching activities before review cannot open
the stale review; switching before persistence writes no preparation. Existing
cancellation, concurrent metadata preservation and scope-safe saved-state display
remain covered. These are preparation controls, not execution authorization.

The unchanged four negative controls now require no stale confirmation, no
metadata write, generic blocked copy without the old folder and unchanged fixture
bytes. The full focused run passes: **14/14 Node-reported tests** (10 top-level
scenarios including the four-subcontrol group), no skips, exit 0. Source/runtime
validation is separate from native UI acceptance; the earlier `b7ee35cf` native
run does not prove these new failure paths or the current controller bytes.

Resource jobs: `dmc-workspace-precommit-race-red-v2` (all four negative controls
failed as expected), `dmc-workspace-precommit-race-green-v1` (full focused PASS).
`dmc-workspace-precommit-race-build-v1` also passed the extension bundle and
TypeScript `--noEmit` check. Alignment of the canonical companion chain and
`git diff --check` passed. Raw logs: `precommit-race-red.log`,
`precommit-race-green.log` and `precommit-race-build.log` in
`/Users/jaylee/CodeWorkspace/artifacts/desktop-companion-workspace-20261027/`.
