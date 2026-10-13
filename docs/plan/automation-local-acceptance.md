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
the previously approved aggregate test ceiling remains USD 2. Track local
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
is not evidence that 20 unrelated accounts work without setup. Latest Windows
acceptance and a second real Google learner remain unverified.
