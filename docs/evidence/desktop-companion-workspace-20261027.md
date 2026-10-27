# DMC-1 local workspace preparation evidence

Scope: DMC-01 and the preparation portion of DMC-14 under Studio #2803.
Source base: `4ff05dba`; branch: `feat/desktop-companion-workspace-20261027`.
This is implementation and synthetic local evidence. Installed-host DMC-T01,
real mobile pairing and production activation remain **NOT RUN**.

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

Environment: Node **22.22.1**, macOS Darwin 24.6.0, arm64. Synthetic temporary
folders only. All installs/tests/builds used the shared `hype-resource` queue
(owner `codex:01a12522-7c7d-70c2-b09a-353dad5e2280`). Dependency acquisition used
the checked-in extension lockfile and the prebootstrapped pinned private cache;
no alternate credential or Service bootstrap was initiated by this writer.

| Check | Result |
|---|---|
| Source/controller filesystem and failure behavior | PASS, 5 tests |
| Production command adapter with mocked native VS Code UI/binding APIs | PASS, 3 tests |
| Existing `task-workspace-store.test.mjs` regression | PASS, 19 tests |
| Existing workspace routing smoke | PASS, 12 checks |
| Existing workspace preparation smoke | PASS |
| `npm run build:extension` | PASS, esbuild extension bundle only |
| Extension `tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| Full extension suite, webview build and full application shell build | NOT RUN |
| Native dialog layout, keyboard/screen reader and real app restart | NOT RUN |
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

## Remaining native acceptance

In an authorized isolated development app, open a synthetic activity's existing
folder. Invoke the palette command, select that same folder, and review the
activity/path/host before saving. Confirm the Korean message that no phone is
connected, restart only the isolated app, then reopen the same activity/folder and invoke again. Record native screenshots,
identity, unchanged fixture bytes and absence of companion content transmission.
Then repeat with untrusted/read-only/wrong-scope/corrupt metadata fixtures.
Mocked host API tests above do not substitute for these native observations.
No production activation, merge or installed-app changes were performed.

The canonical DMC REA and requirement/traceability indexes are maintained by the
Delivery Captain on the separate planning branch; this bounded writer did not
modify those shared records or the cloud-record work.
