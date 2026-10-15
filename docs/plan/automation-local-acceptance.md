# Conversational automation acceptance

Confirmed by TJ on 2026-10-14. Extends Epic #1603 / issue #1604 and
`apps-script-quests.md`; implementation and observed acceptance are separate.

The paid-product quality target is KRW 50,000/month, not a billing-price change.
The learner explains their own work, answers one focused question at a time,
and builds a reusable email skill while a dependency graph in the existing
preview area advances from host-observed outcomes. Google connection is reused.
Studio generates, reviews, uploads and privately deploys bounded Apps Script
code. Preview precedes a separate exact-message approval. Saved/shared recipes
contain no accounts, recipients, tokens, private project IDs or executable code.
Initial sharing is cohort-only; the confirmed trial is 30 days. Seller payouts
and support for non-Google mail providers remain separate future scope.

## Required local gate

Run the real UI and host integration before updating the Windows distribution.
Synthetic services isolate failure coverage without paid model calls or mail.
They do not establish real Google acceptance or human usability findings.

| Persona / situation | Required observable result |
| --- | --- |
| First-time office learner with vague intent | One focused question, no developer setup jargon in ordinary conversation; graph begins without fabricated completion |
| Experienced learner with complete requirements | Reuse supplied answers and existing connections; no redundant questions; saved skill advances real progress |
| Learner changing the request | Preserve unrelated verified steps; invalidate dependent code/deployment/preview; never send stale content |
| Cautious learner cancelling approval | Stop upload/deploy/send, retain work, show next safe action, retry only on renewed intent |
| Learner recovering from missing Google setup/network failure | Specific private recovery guidance; failed step stays incomplete; successful retry advances it |
| Returning/shared-skill learner | Install inert recipe, configure own account/data, restart/recheck rather than replay stale execution proof |
| Small screen / keyboard-only learner | Input, question and primary action remain reachable; no overlapping layers, duplicate action bars or trapped focus |

Across all personas, verify conversation/answer/stream transitions, draft
preservation, current-question navigation, clear primary/secondary actions,
contrast and wrapping at narrow and desktop widths. TJ also confirmed that the
learner can resize the conversation width; preserve the chosen width across
reopening rather than forcing a fixed width on each render. A plan refresh must not
erase real progress. Repeated actions and uncertain send outcomes must not
duplicate mail. Root performs direct persona acceptance; implementation agents
must not attest their own work as independent product acceptance.

## Instructor visibility gate (TJ addition, 2026-10-14)

Before Windows distribution, the real local instructor page must show each
learner's actual automation state and progress. Use distinct synthetic learners
to check running, waiting for an answer, Google setup/recovery, completion and
stale/disconnected presence without mixing identities. Compare learner-side
host results with the instructor view, including reconnect and delayed events.
Only safe stage/status/count data may leave the learner; no addresses, Sheet
rows, private identifiers, message contents or tokens. Remote troubleshooting
and instructor execution on behalf of the learner are outside this addition.
Root directly verifies the instructor UI; adapter/unit coverage alone is not PASS.

## Windows gate after local PASS

One overlapping-work-free platform pass covers:

1. Delivery: authenticated pinned update, backup, launch and exact file hashes.
2. Identity: Windows OAuth callback and OS-backed token reuse without transfer
   of another device's tokens.
3. Runtime: Windows paths/Unicode, bundled SDK and one real Google preview.
4. Presentation: actual window sizing, focus, scroll and send/reply transitions.
5. Lifecycle: close/reopen and resume own saved skill safely.

Do not rerun the local persona matrix through paid Windows conversations.
Prefer deterministic integration fixtures; use the minimum live coach turns
needed to prove the actual provider/tool path. Preserve settled and held budget;
the aggregate test ceiling is USD 3 after TJ authorized an increase on 2026-10-14. Track local
synthetic coverage, live provider cost, Google execution and actual mail
separately. Additional mail still needs exact recipient/content approval.

Local implementation → root local acceptance → isolated test deployment →
root Windows acceptance. No general production rollout or merge is authorized
by this acceptance plan. Google standard-project binding and account policy
requirements must be surfaced honestly, never hidden with IAM grants.

## Observed local acceptance — 2026-10-14

Root tested the native isolated Mac app and the real local Chalk page. One native
seat and 17 labelled synthetic seats (plus two never-connected seats) covered the
20-seat board. The native seat advanced through setup failure, upload (5/8),
private deployment approval (6/8), read-only preview review (7/8), and completion
(8/8); the instructor page matched. Search and approval filters were exercised.
Stale approvals are excluded from current counts while their last report remains
in details. Only allowlisted stage/status/count fields leave the learner.

Google execution history confirmed version 1 `hpsPreview`, API execution,
2026-10-14 02:09:57 KST, completed in 1.066 seconds. The native private card showed
one preview; confirmation did not send mail. Saved-recipe reuse and setup recovery
advanced the graph from host results. Native sidebar resize from 300 to 480 px and
width retention were observed. The local-subscription UI now hides the inapplicable
server-funding picker and keeps optional settings folded.

Validation: extension typecheck/build and 56 automation tests; Chalk typecheck,
classroom-ops and eight forwarding tests; launcher 19 passed/one Windows-only skip;
Service full premerge passed (77.5 seconds); registry check passed. Earlier focused
Chromium persona/transition and graph viewport coverage is synthetic, not a claim
of human usability research. Screenshots and execution records are retained in the
local evidence folder, with private data removed.

The development app deliberately uses in-memory secrets: window reload lost its
Google connection and private deployment receipt. This does not establish OS
credential persistence; Windows must verify its own protected store. Google
standard-project binding still requires a supported account/project setup. This
is not evidence that 20 unrelated accounts work without setup. The subsequent Windows and second-participant observations below supersede
the earlier missing-device evidence; they do not establish a twenty-person class.

## Observed Windows acceptance — 2026-10-14

The private shell remains `682dfd37`; the accepted extension source is
`8844c233`, packaged by Studio PR head `92df6169`. Service is `c455865`.
Root matched all seven installed file SHA-256 values after the authenticated
copy-command update and full app restart. The extension archive is 587,047 bytes,
SHA-256 `3d7933d458a549f1d3b1c5f9e9c30276fefdfd3845e05ca561876ae8d6fd55b7`.
This is an isolated installed-shell update, not a new signed release or merge.

Windows PowerShell 5.1 UTF-8 metadata handling, offline SDK installation, Korean
workspace paths, width/draft retention, public-question recovery and cancellation
of the real OAuth wait were exercised. Opening a restored activity makes no
new AI/tool request. Interrupted tools remain unconfirmed rather than complete.
Editor chat and the quest graph now occupy separate editor groups; sidebar chat
also remains visible. The latest maximized app showed the conversation beside the
8/8 read-only preview workflow with optional help/settings folded.

A distinct Studio participant installed the original learner's cohort recipe
(`mine:false`) through explicit inline confirmation. That participant used the
bot's own Google account and separate synthetic one-row Sheet, created a separate
Apps Script project, reviewed/uploaded the generated source and approved an
owner-only immutable version. No author credentials or recipient data came from
the shared recipe. The bot Google identity differs from the original author.

The sponsor authorized temporary Browser and OAuth Config Editor roles on the
Studio test project to complete Google's standard-project binding. Root removed
both roles after verification and read the IAM list back: only the original
owner remained. The bot remains an authorized OAuth tester with the previously
approved user scopes. This privileged test setup is not proof that unrelated
commercial learners can bind projects without operator assistance.

Google execution history confirmed version 1 `hpsPreview`, API execution,
2026-10-14 09:00:43 KST, completed in 1.267 seconds. After full app restart and IAM
role removal, the saved Google connection, Sheet and deployment were reused:
version 1 `hpsPreview`, API, 09:11:37 KST, completed in 2.827 seconds. Root confirmed
the private one-message preview and observed 8/8 after its read-only confirmation.
That graph completion means preview-workflow completion, not email delivery.

Studio checks at `92df6169`: 17/17 success. Service checks at `c455865`: 12/12
success. Local coverage includes shared-install receipt invalidation, stale
activity isolation, missing-funding refusal and safe SDK budget failure handling.
These checks supplement, rather than replace, the native observations above.

The active test ledger settled USD 0.311521 with zero held (original participant
0.178273; second participant 0.133248). The active caps total USD 1, unchanged by
rebalancing them equally. Historical settled USD 0.102024 and held USD 0.436280
remain preserved; the combined maximum is USD 1.538304 within the approved USD 2.
These are token-accounting amounts, not provider invoices. No additional email
was sent. A separate exact-message self-test approval is pending.

## Requirement-by-requirement completion audit

| Requirement | Evidence and remaining boundary |
| --- | --- |
| EA-01 conversation and layout | Actual local and Windows focused questions, saved skill, separated chat/graph; short-viewport transitions and errors covered locally. No claim of a human usability study. |
| EA-02 reusable Google connection | Windows browser OAuth and protected-store reuse after full exit/update; scopes, callback state and isolation also have local negative controls. |
| EA-03 private questions and immutable recipe | Local private-routing/transcript tests; actual own-Sheet read and shared-recipe preview. Editor/sidebar graph-placement defect fixed. |
| EA-04 exact send approval | Local stale/edit/expiry/cancel controls pass. Actual exact-message approval, Apps Script send and matching inbox receipt passed on Windows at 13:06 KST; see final acceptance below. |
| EA-05 no automatic duplicate send | Local durable ledger, cross-window serialization and unknown-result controls; no deliberate real duplicate sends. |
| EA-06 cohort store | Actual conversation publication and second-participant confirmed installation; isolation, unsafe payload and unpublish controls are local/Service tests. |
| EA-07 own-account reuse | Different Studio participant, different Google identity from author, own Sheet and separate script/deployment; actual preview succeeds. |
| EA-08 trial and costs | Dedicated 30-day grants and server budget controls; legacy trial preserved by tests. Live accounting above; no monthly billing change. |
| EA-09 Windows and two learners | Actual private installation, update, second-participant install/run and restart pass. End-to-end Apps Script email receipt passed on the second account; no general-release completion attestation. |
| EA-10 observed quest graph | Root native local and Windows graph observations; shared-install success now advances only goal/skill, invalidating old runtime proofs. Local failure/cancel/stale controls. |
| EA-11 Apps Script execution | Actual generated-source upload, owner-only immutable deployment and Google preview; one approved send and inbox receipt passed. Standard-project setup constraint remains visible. |
| Instructor addition | Root local native seat plus labelled synthetic class; learner stages match instructor progress, including stale and disconnected states. Remote instructor deployment not claimed. |
| Resizable conversation | Native local and Windows resize/reopen observed; editor chat remains beside graph. |

Local evidence is retained in the sponsor's private acceptance bundle under
`2026-10-13_Studio_AppsScript_퀘스트`, especially the 2026-10-14 cross-participant
verification JSON and masked final-screen/hash images. The repository contains
no test credentials, private project IDs, account addresses or recipient rows.

The scoped local/Windows MVP acceptance is complete. Commercial Google onboarding
policy and separately authorized merge/general rollout remain outside this test
completion. The implementation packet remains in review.


## Final Windows send acceptance — 2026-10-14

This observation supersedes the earlier approval-wait and failed-send state;
historical execution and budget records remain intact. TJ explicitly approved
one exact self-addressed test message and a test-budget increase. No further
message is authorized.

- Installed extension `463e8529`, shell `682dfd37`, Service `ffef7bc`;
  all seven installed extension SHA-256 values matched the published manifest.
- The bundled SDK had issued a paid session-title request concurrently with the
  main request. Studio now disables that optional title call. Service awaits
  durable settlement/lease release before forwarding terminal protocol output.
  A zero-cost actual-SDK probe changed peak concurrency from two to one; the
  subsequent real Windows conversation/tool flow completed without 429.
- Generated-script approval hashing now uses ordered value tuples rather than
  object-key order. The earlier version-1 send execution failed at 11:25:33 KST.
  The same original script's read-only remote ledger confirmed `not_attempted`;
  this was required before a new exact-message approval. Unknown delivery and
  different/missing original-project provenance remain blocked, not erased.
- Version 2 `hpsGetSendStatus` completed at 12:45:36 KST (0.526 s), preview
  completed at 12:52:55 (1.144 s), and status was rechecked at 13:01:41 (0.784 s).
  The user approved the identical recipient and content through the private card.
- Version 2 `hpsSendApproved` completed at **13:06:22 KST in 1.94 s**. Studio
  reported **sent 1, unknown 0**. Bot Gmail showed exactly one matching message
  in Inbox; the approved subject and all seven body lines matched. Root checked
  the self-recipient against the protected local account value. No connector
  send or additional retry was used.
- Root local verification: automation tests 68/68, TypeScript check, extension
  build, actual-SDK concurrency probe and updater fixtures passed. These are
  separate from the real Windows/Google/Gmail observations above.

The overall ceiling is USD 3; the active contract cap is USD 1 and conservative
combined maximum exposure is USD 2.3155. Settled token-accounting cost is
USD 0.568366; unresolved historical/current reservations total USD 1.347240 and
are preserved. The current contract settled USD 0.144626. These values are not a
provider invoice; the existing HypeProof provider account remains the payer.

Private local evidence: `2026-10-14_429해결_메일발송수신.json` and masked
`2026-10-14_본인메일_수신확인.png` in the sponsor's acceptance bundle. Raw account,
recipient, project and credential values remain outside Git. Temporary project
IAM roles were already revoked and were not regranted. Commercial Google
verification and standard-project onboarding for 20 unrelated learners remain
unverified; no merge or general production release is asserted.

## Integrated native observation — 2026-10-15

The isolated Mac copy at Studio `5838f1bc` and local Service `21033b32`
used a distinct synthetic workshop participant and the bot Google identity.
After the sponsor approved Sheets read access, the native flow read one row
from the bot's private synthetic Sheet and obtained one preview through the
managed shared runner. The private review card was acknowledged; no mail was
sent. The graph displayed6/8, with send and sharing still optional and pending.
The composer returned after review. The official installed app was unchanged.

A real column-name clarification (`기한` to `마감일`) incorrectly reset the
independent Google/Sheet progress indicators. The follow-up fix retains those
receipts while reopening recipe/preparation/preview/send evidence, including
cancellation. Automation86/86 and typecheck pass; native verification of this
fix and the second-identity imported-recipe path remain open. The native copy
uses local Claude CLI and in-memory secrets, so this observation does not
establish production SDK packaging, persistent credentials or Windows parity.

The bot published the inert recipe at `5838f1bc` (7/8). A distinct synthetic
participant in an isolated `9e43a9c8` copy installed that exact recipe (2/6),
then connected the TJ Google identity with the sponsor's explicit Sheets-read
and Gmail-send scope approval. The author Google connection and Sheet were
not inherited. TJ's private synthetic Sheet produced one real shared-runner
preview with its own distinct content (6/8); no mail was sent. Trying the bot's
private Sheet failed and reset Sheet/preview progress. The old generic error
caused the coach to incorrectly describe this as an input-card failure. The
follow-up fix exposes only a typed public Sheet-read failure classification,
never provider payloads, private IDs or contacts. Its live native retest remains
open; do not infer an HTTP status from the older generic-error observation.

The current Chalk page displayed20 synthetic seats: A01 was the real bot app
reporting7/8, A02–A18 were explicitly synthetic reports, and A19/A20 never
connected. A01 matched the native graph. When the17 fixtures stopped reporting,
the board changed them to disconnected/unknown while the actual app stayed
current; stale approvals disappeared from current approval counts. This is one
actual local app plus fixtures, not20 real learners.

At `351b27e1`, the TJ native copy reported `sheet_access_denied` for the bot's
private Sheet, then recovered to its own one-message preview and6/6 completion.
The rebuilt extension SHA256 is
`22a013e8049fe422bb7c4c14452f6989a0facbdfef619a8380eaa97d6b52a690`.
Clarification cancellation was also exercised at `9e43a9c8`: goal/Google/Sheet
remained confirmed (3/8) and downstream execution required fresh evidence.
A subsequent Google account change exposed a separate graph bug: old completion
remained visible although runtime identity checks invalidated execution data.
The correction now invalidates caller-bound progress through the actual connect
tool, retaining the saved recipe. Verified same-connection reuse retains progress;
a reconnect reached through reuse also clears earlier execution. Automation88/88,
typecheck and extension build pass; native account-change graph retest is pending.


At `624b214f`, the isolated bot copy completed a fresh own-Sheet preview. A
subsequent explicit Google change reopened caller-bound stages (2/6 while waiting,
3/6 after successful reconnection), retaining the goal and saved recipe. A new
Sheet selection/preview restored completion. Its installed extension SHA256 was
`e874019ee80bd093139031e342921f870e308b431b125759ee9e5c41885a0530`.

The sponsor explicitly approved one exact bot self-mail after reviewing its
recipient/content. The native final approval card matched that one recipient and
unchanged subject/body. One click sent one message through the shared runner;
the app reported sent1/unknown0 and its durable local ledger contains exactly
one `sent` record. Root opened the matching message in the bot Gmail Inbox at
2026-10-15 15:04 KST and checked its subject/body. No repeat send was attempted.
Raw account/address, IDs and screenshots stay in protected local storage; a
masked Inbox proof was shown to the sponsor. This supersedes the earlier open
shared-runner delivery gate, without asserting Windows or commercial readiness.

Main `21bd15ba` was subsequently integrated at `3bd59281` and classroom outbox
drain fix `c18ef5db` at `65c5f1c9`. Email/browser/orchestrator grants remain separate;
classroom disconnect both drains pending storage and resets automation progress.
Root passed automation88/88, orchestrator-switch6/6 and classroom review47/47;
typecheck and extension build passed. Final integrated native smoke and exact-head
CI are tracked separately from the `624b214f` live-send receipt.


At integrated source `65c5f1c9`, the rebuilt isolated native app launched, restored
its conversation, executed real `email_skill_list` and `email_workflow_plan`
through the coach, rendered the graph and restored the composer. No reconnect,
Sheet execution or additional send was requested. Installed extension SHA256:
`920523cef141537a2a3119ddc2129d9ff370d47f2ece8174820173c00e48fa27`.
The durable one-message `sent` ledger survived this update. This focused
integration smoke covers tool registration/graph after the orchestrator merge;
the actual Google execution/delivery evidence remains bound to `624b214f`.

### Actual lecture need rehearsal — 2026-10-15

The sponsor supplied the local `업무자동화_강의_재설계_20261015` course redesign.
Its order-versus-ERP comparison need (PAD-88) was exercised as a coding-beginner
order clerk, using the course's explicitly synthetic first/second CSV sets.
Root entered the need through the actual `65c5f1c9` Studio coach, selected an
installation-free HTML tool, supplied the four inputs in the learner workspace,
and fed back business rules and observed defects through the same conversation.
Studio's coach authored the tool; root did not replace it with an externally
authored implementation. The local subscription CLI provider was used.

Root selected files and ran the generated page in a real browser. First input:
missing1, quantity mismatch1, duplicate review1, additional registration1, match1.
Second input: missing2, duplicate review1, additional registration1, match2.
Both downloaded CSV reports match the source answer key (5 and6 distinct keys).
Repeating inputs does not accumulate rows. Additional real browser checks passed:
blank/non-numeric quantity holds the key without false missing classification;
blank keys mark the entire validation incomplete; independently ordered columns
work; quoted multiline fields preserve physical source lines; unclosed quotes and
duplicate required headers stop with download disabled; changing inputs clears
the previous result and download. Original inputs remain unchanged.

The final generated HTML SHA256 is
`9dfbe22ecedb3c36ff225a6fc938ef0b7fe408c4d022f251621430ac65d503a7`.
Local delivery: `~/Downloads/Studio_발주대조_20261015.zip`, containing the standalone
HTML, synthetic inputs, two actual downloaded reports, screenshots and a JSON
verification receipt. No additional email was sent. This is a completed local
file-processing rehearsal, not a published email recipe, scheduled ERP job,
Windows acceptance or proof against actual company data. Excel UI encoding,
OS file-read failure injection and interaction during an in-flight read were
not exercised.

A02 was replaced with an actual second native connection (not a fixture). The
instructor board observed its question wait, cancellation, disconnect and fresh
pairing. After the150-second stale threshold, current normal count changed2→1
and unknown18→19; the normal filter excluded A02 and the unknown filter showed
its lost signal. Reconnection restored normal2/unknown18. A03–A18 remain stale
fixtures and A19–A20 unconnected; this is still not20 real learner devices.

The rehearsal exposed a scope ambiguity: the existing email graph remains when
the learner creates a CSV tool. Chalk now explicitly labels these rows/details
as **mail automation**, uses “실행 준비” for managed execution preparation, and
states that the count cannot measure CSV work or its correctness. Root verified
the live page and the classroom-ops surface contract test passed. General
non-email workflow telemetry and automatic result checking remain unimplemented;
the label correction does not claim to add them.

## 2026-10-15: current-main integration and single-app update

Studio `720be6610200bc8da81686bd3eb20591d6407d88` integrates main `fbde0482`.
Main's browser/subagent policy is retained; the email-only minor restriction no
longer returns early and removes unrelated browser grants. Automation88/88,
orchestrator6/6, automation-SDK12/12 and affected SDK helpers passed, as did
typecheck/build and all18 exact-head CI checks. The independent pre-A4 fixture
was recomputed from `624b214f` plus main's approved age-policy changes; only
kidsPolluted/unknownTier profiles changed, not adult baselines.

At the sponsor's request, original Dev and Local Check were closed. Root
updated only Peer Check using `studio-dev.py prepare`, then relaunched it with
the existing isolated workspace/user data. Exactly one Dev main process remains.
The installed extension equals the prepared build, SHA256
`7974ee9a009507fe4456d06b058a970c1d8c10824d29304c79a7443b6ea0f2e9`.
Actual native UI shows the workshop start page, retained conversation and saved
recipe graph2/6 with Google reconnect required. CSV HTML remains byte-identical
to the prior artifact (`9dfbe22e…`), and the existing durable ledger still has
one sent entry. This is retained historical send protection, not a new send.
Google credentials remain in-memory in this development mode; latest-SHA real
Google execution and production credential persistence are not claimed.

Full Windows build
[38694734487](https://github.com/hypeproof/hypeproof-studio/actions/runs/38694734487)
targets the full40-character `720be661` commit. The first dispatch
38694625591 failed at checkout because a short SHA was treated as a branch;
the corrected dispatch passed checkout and was still building at this audit.
No release/tag was published. Official SDK0.3.299 win32-x64 package download
matched lockfile SHA512 (121,929,597 bytes); it was not executed on this Mac.
The prior private updater's SDK0.3.207 and old shell do not prove parity with
this candidate. Fresh install, upgrade/rollback, Google resource packaging and
real Windows login/preview still require the completed candidate and host.

At16:28 KST, root completed latest-implementation Google execution in the one
running Dev: TJ and bot each previewed their own private synthetic Sheet; both
cross-account directions returned `sheet_access_denied`. Google account change
retained the recipe and reset caller-dependent graph evidence to3/6; recovery
to the bot's own Sheet completed6/6. No new mail was sent; durable sent count
remains1. See [shared-runner evidence](google-shared-runner-isolation-evidence.md)
for the distinction between this sequential Google-identity pass and the earlier
two-Studio-participant publish/import pass.

Restart had also ended the live classroom connection, so root issued a fresh
ticket for existing synthetic seatA02 and connected the actual app through its
native command. The instructor board then matched actual host transitions:
failed Sheet read4/6, private input `waiting_user`4/6, then completed preview6/6.
It shows exactly normal1 / unknown19: the other app was closed,16 fixture reports
are stale and2 seats were never connected. The board's six completed steps cover
the preview plan, not sending or all workshop work. Current screenshot and
redacted receipt: `/tmp/hps-email-mvp/final-720be661-acceptance/`.


## Integrated local Service runtime (2026-10-15, 16:45 KST)

The isolated server on127.0.0.1:8794 now loads Service `abf79a8` directly. The
previous temporary profile wrapper is no longer needed: the integrated workshop
profile already grants the approved shared-runner capability. Existing D1/KV/R2
state and operator credentials were backed up before transition. Additive local
migrations0043–0045 preserved every record in116 pre-existing tables; SQLite
integrity_check returned `ok`. No production resources were changed.

GET /v1/health returns200 with `local-email-abf79a8`. The same instructor token
still retrieves the identical run and20-seat roster. The existing single native
Peer Check retains6/6 and its classroom connection. After re-entering the existing
operator credentials following a browser reload, the live instructor board shows
A02 completed6/6, normal1 / unknown19. No learner grant was reissued and no mail
was sent. This verifies local state continuity, not Windows credential persistence.

Local receipt: `/tmp/hps-email-mvp/local/integrated-service-upgrade.json`.
Screenshot: `/tmp/hps-email-mvp/final-720be661-acceptance/instructor-integrated-service.png`.
Rollback retains the pre-transition config, launcher and persistence snapshot in
the owner-only backup directory named in the receipt.


## Main A5 compatibility and Windows package (2026-10-15)

PR CI run38699388441 exposed a real integration mismatch with newly merged
main `b7977629`: the new orchestrator-panel negative control injected429 into
non-orchestrator seats and expected a successful retry. The email branch already
ends these budget/concurrency refusals immediately. Preserve that behavior and
the orchestrator's bounded retry policy. The negative control now checks529
recovery without orchestrator UI and separately requires SdkApiError429 on every
non-orchestrator fixture. No runtime policy was weakened to satisfy the test.
The focused panel suite passes14 checks. Full `npm test`, extension typecheck,
and webview/extension builds all pass on this merged tree. Remote CI is pending.
The native app remains720be661, so its earlier UI evidence does not cover A5.

Windows run38694734487 completed successfully at source720be661 and produced
artifact11956496826 (`hypeproof-studio-windows-x64`). The CI smoke validates
packaged branding/version and vendored SDK JS, then launches the executable with
`--disable-extensions`; this is not an email/Google/native-SDK acceptance. The
native SDK binary is seeded separately. Operator Google resources are not supplied
by that workflow. New A5 extension changes and private pilot resources must be
staged before the user-PC installation/upgrade check. No public release was made.


## Current private Windows candidate (2026-10-15)

The downloaded portable archive from run38694734487 contains shell720be661 and
vendor SDK JS0.3.299. An external staging copy overlays the clean9d535c87 field
bundle, packages the approved Desktop OAuth identity and shared-runner resource,
and uses the isolated test Service as its default. No user Google credentials
are packaged. The shell source and extension source are recorded separately in
`.email-candidate-source.json`; this is not a new full-shell build or public release.

Candidate artifacts in `/tmp/hps-email-mvp/windows-current-9d535c87/upload/`:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| app.zip | 196644907 | 9bf8d7f49f3dfcf00eeba349460c7820bc8a0237b156ce46841dfa30f517e168 |
| sdk.zip | 121940997 | 24be58876b19c2b957a8ed4601b9e62aa20bbc979f55dfbd527965fa6577de2e |

`scripts/install-email-test.ps1` now pins these complete archives and SDK0.3.299.
It installs to a new9d535c87 directory and retains the previous shell/SDK.
Shortcut handover accepts only the current target or the exact682dfd37 pilot
receipt; unrelated targets and custom shortcut/profile routing are refused.
Before launch it requires all Studio windows closed and preserves the full
default roaming profile in an owner-local rollback directory. A rerun does not
overwrite that original snapshot; an incomplete snapshot prevents launch.
The old extension-only quest updater remains specific to682dfd37 and must not
be used to establish0.3.299 package parity.

Actual PowerShell fixture runs on macOS passed manifest/hash/traversal/redirect
checks, legacy shortcut recognition, profile-copy/rerun/incomplete-backup checks,
real SDK tarball extraction/marker/reuse and real app ZIP extraction. Extracted
shell/extension/SDK versions, all seven field-file hashes and operator resources
match. Windows executable and DPAPI credential reuse/rollback were NOT RUN.
The9d535c87 download was subsequently uploaded and both full authenticated
archive hashes passed. It is superseded by the0b57074d package below.


## Paid-pass integration and online full installer (2026-10-15)

Runtime source0b57074df2b916fa47be077a8b56dc1df56fdd03 integrates main171279dc.
The only merge conflict retained both the existing safe SDK diagnostic phase type
and main's SdkGatewayAuthError. Full extension tests, typecheck and webview/host
build pass. Four actual SDK paid-ending controls pass: authoritative revocation,
authoritative expiry, cancellation during lookup and generic negative controls.
All18 remote CI checks passed at this runtime SHA. No production merge was made.

The sole Mac Peer Check was closed, its extension and full user-data directory
backed up, then restaged and ad-hoc signature verified. Installed extension SHA256
is15969519c2f853f5d2eefdb7fdadbe2e3399c53e8d956af9a35876cc3c109a67.
The start page, saved dialogue/skill and new real coach request were observed.
Google-dependent stages reset instead of preserving old completed previews.
A non-owner private-Sheet read denied access at the read stage without a send.
The first profile-selection attempt did not establish the intended bot identity;
its denial is not a fresh two-account pass. A new bot connection reached Google's
unverified-app warning and requires native completion; Browser Use paused that
response. Own-preview recovery on this source remains pending. Dev secrets are
still in-memory; no Windows credential-persistence claim follows.

The private Windows package combines the unchanged720be661 shell, clean0b57074d
field bundle and SDK0.3.299. Approved Desktop/runner resources match; no user
Google credentials are included. Both prior682dfd37 and intermediate9d535c87
shortcut targets require their exact installation receipts. The current installer
backs up the complete profile and shortcut under version-specific names, retains
old apps/SDKs and refuses custom routing or incomplete backups.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| app.zip | 196645359 | cb0faa1c19bd710833a6539a5f31d8f1e224d20946da67c60493cf0592da0fff |
| sdk.zip | 121940997 | 24be58876b19c2b957a8ed4601b9e62aa20bbc979f55dfbd527965fa6577de2e |

PowerShell fixtures executed on both actual archives on macOS: hash/extraction,
seven field-file hashes, resources, SDK marker/reuse, shortcut ownership and full
profile backup/rerun/refusal passed. Fourteen download-handler tests and the
private gateway delegation/authentication controls passed. The real Windows
executable, DPAPI reuse, restart and rollback remain NOT_RUN.

Sixteen immutable chunks were uploaded to email-test-download/0b57074d with
readback hashes and the manifest published last. Only the existing private test
gateway was switched, version e5ef94e3-43ee-4994-9175-3b594b85e56d. Existing
participant authentication, service binding and version-pinned Service routing
were retained; no default production traffic or Google permissions changed.

Real endpoint verification passed: anonymous manifest/app/SDK requests return401;
authenticated HEAD size/digest metadata match; both complete downloads match the
pinned bytes/hashes; install.ps1 and update.ps1 match the canonical installer.
The public installation page and copy button were observed in the browser.
Evidence: /tmp/hps-email-mvp/windows-current-0b57074d/{candidate.json,
online-verification.json,installer-online.json,powershell-archives.log,upload-receipt.json}.
The earlier visually identical page screenshot is retained at
/tmp/hps-email-mvp/windows-current-9d535c87/install-page.png. This is a protected
pilot download, not a public release or completed Windows acceptance.


At17:56 KST, root reconnected the sole0b57074d native app to existing synthetic
seatA02 using a fresh one-use pairing ticket. Before reconnect, the refreshed
board correctly marked the seat unavailable and labelled6/6 as its last report.
After the actual app connected, the board showed blocked Google connection2/6,
normal0 and unknown19, matching the host's incomplete OAuth state. The pairing
was real; no fixture progress was injected and no mail was sent. Evidence:
/tmp/hps-email-mvp/final-0b57074d-acceptance/instructor-reconnect.{png,json}.
All18 CI checks also passed at installer/documentation headc724b743.

At18:03 KST, the user completed a fresh Google login after the earlier listener
had expired. The same0b57074d native app then read the protected bot-owned Sheet
and created one fresh shared-runner preview. Recipient, subject and body matched
the protected synthetic fixture; the private card explicitly said no mail had
been sent. Acknowledging this preview did not send mail. The connected instructor
board changed to A02 completed6/6, normal1/unknown19. This closes bot reconnect
and own-preview recovery for0b57074d, not a new two-account isolation run or
Windows persistence. Evidence: /tmp/hps-email-mvp/final-0b57074d-acceptance/
bot-preview-restored.json and instructor-preview-restored.png.

## Current integrated Service: stale instructor state — 2026-10-15 21:01KST

The existing instructor browser at127.0.0.1:8796/manage was refreshed against
the local Service watching integration checkout2ce0b2e (runtime mergeacfd637).
The live API and rendered board agree on20 seats,20 unknown,0 normal and2 never
connected. Eighteen seats have stale signals. Native seatA02 retains its earlier
6/6 result, but the UI explicitly labels it “마지막 보고 (현재 확인 불가)” and
does not count it as currently normal. The detail explains that mail-stage
progress does not establish CSV correctness or learning completion.

This is a read-only post-integration instructor observation, with no fabricated
fresh learner events or altered roster. It verifies current stale-state reporting,
not a fresh native reconnect/Google preview or20 actual learner readiness. The
private online three-principal store activity remains a separate environment.
Evidence: `/tmp/hps-email-mvp/instructor-integrated/current-main-stale-board.json`,
plus `.txt` and `.png` captures. The Service health label is still the historical
local configuration string; it must not be treated as the running source SHA.

## Current integrated Service: native reconnect — 2026-10-15 21:16KST

The same single Mac Dev app3f1a3f20 now targets local Service2ce0b2e for fresh
acceptance. Its earlier online settings were backed up; online store recipes and
all three activity namespaces remain retained. The machine-scoped Service setting
was changed explicitly in this isolated app: a workspace setting cannot redirect
the Service. The local participant code still returned200 and was not reissued.
The unchanged runtime was relaunched with the existing local-subscription coach
and memory-only development storage; no new gateway allocation was made.

A fresh pairing for existing synthetic seatA02 connected through the actual Studio
command. The app's pending Google reconnect emitted running/connect2/6. Both the
live Service API and actual instructor board report fresh/normalA02 and19 unknown,
replacing the historical6/6 display with this current host result. This closes the
latest-integration native classroom reconnect observation, not Google completion.

The existing bot-account OAuth flow reached Google's re-login page without a new
scope request. After Continue, the browser remained at Google and Studio's callback
was pending; human completion was requested. An earlier attempt used the external
dialog's shortened display URL and was stopped; the replacement uses the complete
original URL. No Google success, Sheet read, preview or new send is claimed.
The10-minute callback request may expire; do not reuse an expired request as success.

Evidence: `instructor-integrated/current-main-native-reconnect.{json,txt,png}`,
`current-main-reconnect-pending.txt` and
`integrated-peer/current-local-revalidation.json` under `/tmp/hps-email-mvp/`.
