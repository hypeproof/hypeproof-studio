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
