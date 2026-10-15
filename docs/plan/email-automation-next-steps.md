# Studio email automation: goal and remaining delivery plan

Updated: 2026-10-15 KST. Sponsor: TJ. The sponsor authorized continuing
implementation and delivery with minimal approval interruptions. Exact email
content approval and required external permission/release gates still apply.
Scope: Epic1603 / issue1604, Studio1605 / Service50 / Ops2, EA-01–11 and DEC-023.

## Goal extension: integrated skill store — 2026-10-15

DEC-025 adds an explicit completion gate to the active objective: after feature
implementation, Mac-created workplace automation must be published in the Studio
store, then downloaded, privately configured and successfully run in Windows
Studio by a different person. Use all three existing test account aliases
(locolor, locolorbot, TJ) with distinct Studio principals and Google connections.
The [cross-platform store contract](skill-store-cross-platform.md) defines
SS-01–12, including third-user isolation, version/update/rollback, withdrawal,
package integrity, source privacy, permissions and incremental storage costs.

[Completed research](skill-store-distribution-research.md) compares current Service/D1,
private Cloudflare R2, Supabase, Google and GitHub/open-source distribution patterns.
Use current D1 for bounded recipes; add private R2 only when larger reviewed assets
justify it. Final audience remains a product question; use cohort-only visibility
until decided. Public discovery and generic executable packages are not implemented.

Completion order: close local lifecycle gaps (including re-publication and
version/update/rollback), freeze the Windows candidate, then run the three-account
Studio journey on Windows. Latest extension e3ab008b is staged locally but the
served installer still contains32ba0ac2. Private R2 download-handler controls now
pass locally; no R2 deployment or new-candidate download/Windows PASS is claimed.
Installer ZIP transport and the D1 skill catalog are distinct delivery surfaces.

Latest main integration: `05efefdb` adds project switching and release operations.
The PR merge typecheck exposed a new `voiceLogChannel` call against this branch's
renamed `coachLogChannel`; integration preserves main's switch behavior and uses
the existing coach channel. Local types, automation90 checks, publish/local-runtime
controls and webview/extension builds pass. The single native Mac app now runs
9b4dd233; its actual A02 classroom reconnect reports2/6 to the instructor board.
The Windows e3ab008b candidate predates this integration; its evidence does not
cover the integrated extension. No fresh Google execution or mail was performed.

Current partial evidence, all dated2026-10-15:

- Single Mac Dev runtime `3f1a3f20`, SDK0.3.299: during store validation normal activity setup targeted
  the same private online Service as Windows. A new synthetic recipe was authored,
  saved and published through the actual conversation and private review card.
  The coach correctly acknowledged completed sharing. Three distinct Studio
  principals listed/fetched the exact version1; only the author had ownership.
  Both distinct recipients subsequently found and imported it through actual
  Mac conversations/review cards. Read-only persisted-state checks at20:57KST
  found the exact reviewed recipe in three separate activity namespaces; the
  author and first recipient copies remained unchanged. Neither recipient owns
  the publication. Google setup and execution remain pending.
- The native attempt exposed a missing SDK recipe contract and misleading save
  recovery. The fixed tool declares the exact schema and stage-specific recovery.
  Automation89/89, types/build pass. All18 runtime CI checks pass after the single
  classroom-browser failed-job rerun. A test helper race that could select the
  preceding command is corrected separately; it changes no packaged runtime.
- Store/API controls pass19 publication/ownership/withdrawal and23 access/download
  checks. Common client validation rejects unsafe or mismatched recipes. These
  checks and API recipient reads do not prove Windows recipient installation or Google execution.
- Windows candidate `3f1a3f20` on shell720be661 is prepared locally with matching
  SDK0.3.299. Actual archive/integrity, backup and exact-receipt upgrade fixtures
  pass, including priorf90b65e3. The private installer now serves3f1a3f20; all23
  three-principal access checks pass. Complete authenticated archive readback now matches both pinned
  hashes:196646585 app bytes in76.39s and121940997 SDK bytes in35.41s. Earlier
  slow/timeout attempts remain recorded; their cause is unconfirmed. Actual Windows execution is NOT_RUN.

The later Google recovery fix32ba0ac2 is now in the single Mac Dev app; relaunch
restored the existing conversation and2/6 recipe progress. Its Windows package
and actual archive/backup/upgrade fixtures pass locally, including3f1a3f20
handover. The private installer now serves32ba0ac2;23 online access controls and
all16 uploaded-chunk readback hashes pass. Complete HTTP/2 app readback was
cancelled after563.56s/13238272 bytes; it is incomplete, with the transfer
bottleneck unconfirmed (same-artifact HEAD200 in4.680s). No replacement was started. Runtime32ba0ac2 and installer87f75b6b each have18 CI checks
passing. Fresh Google callback and native Windows acceptance remain pending; see the
[recovery packaging record](automation-local-acceptance.md#recovery-explanation-follow-up).

The current Mac also includes conversational owner withdrawal: native62aff11d
confirmed the private card, future list/detail denial, four saved recipes and one
send ledger unchanged. A3d8c0b38 summary check verifies learner-facing wording.
These are local-Service observations; the served Windows32 candidate still needs
this follow-up packaged before its final store lifecycle run. Full three-account
Same-content re-publication now has a local recovery implementation and Service
route proof; native re-publication, Windows acceptance and update/rollback remain open.

The full Mac→store→Windows gate is NOT_RUN. Actual Google alias mapping, recipient
private setup/execution, restart, update/rollback and withdrawal still require
native evidence. The new online activity has no Google connection. Earlier local
Google preview evidence remains valid only at its recorded revision; restarting
the memory-only Dev app does not preserve its credentials. No new mail was sent.

Three subjects share aUSD1 sequential test pool under the existingUSD3 ceiling.
The117-record historical audit retainedUSD1.972794 prior spent/held exposure;
prior exposure plus the full new pool remainsUSD2.972794. At20:58KST, native
author/recipient work has settledUSD0.113022 across the pool, held0 and
overrun0. The author spentUSD0.060136, first recipientUSD0.026030 and
third principalUSD0.026856. Pool remaining isUSD0.886978.
No limit increased and no usage/token reset occurred. This does not provision the
real20-person class budget. Preserve the native publication for Windows reuse.

A20:14KST default Service deployment removed the pilot zero-percent version.
Its exact existing version was reattached while retaining the new default at100%;
all three profile reads recovered. This temporary version-routing dependency must
be checked before Windows acceptance; no participant code or budget was reset.

Evidence and exact revision boundaries: [store acceptance](skill-store-cross-platform.md).

## Latest design priority — 2026-10-15

DEC-024 expands the intended learner experience beyond the email implementation
below. The canonical [workplace automation journey](../requirements/workplace-automation-journey.md)
specifies all five requested stages, four proposed template families covering ten
curriculum cases, one representative outcome image, nine evidence-based quests,
six learner-owned Google assets, the 120-minute lab and improvement/version recovery.
Its target is personal Google integration and Apps Script web-app deployment,
including background data processing. Exact customer-send approval remains required.

The former personal-script/unattended-schedule deferral below describes the current
email baseline only; it is superseded for the expanded design destination.
P0 design is documented; P1–P5 implementation and WAJ acceptance are NOT_RUN.
DEC-024 requested design work; DEC-025 adds store research and post-implementation cross-platform acceptance. Existing email delivery, Windows readiness,
commercial consent and billing remain separate outstanding work, not proof that
the new learner journey is already delivered. Implement future packets separately
and preserve the current email runner and ledgers during that transition.

## Existing email implementation outcome

Twenty office workers install Studio during a seven-hour Windows workshop,
describe their own task, answer one relevant question at a time and create a
reusable email skill. The adjacent algorithm graph advances only on confirmed
host results. Learners connect their own Google account/Sheet, review the exact
messages and explicitly approve sending while their PC is running. They can
publish the inert recipe inside Studio and another learner reuses it with their
own identity and data. Instructors see stage, last activity and blockers without
recipient rows or credentials. The business objective is retained Studio
subscriptions; KRW50,000/month is the sponsor's quality benchmark, not evidence
of willingness to pay or a currently implemented commercial offer.

For this existing email baseline, default execution is the managed immutable Google
runner. Learners receive no company IAM or script editing access. Personal script
export and unattended schedules were deferred in this baseline; DEC-024 now includes
personal deployment and scheduled data processing in the expanded design.
Arbitrary generated code, non-Google mail and public seller payouts remain outside
the bounded email implementation.
The original skill-sales ambition remains a later product outcome; the current
cohort-sharing MVP does not implement buying, selling or settlement.

Trial decisions need distinct names: the original request named a seven-day trial;
the later approved workshop requirement is a dedicated 30-day grant, preserving
the ordinary one-hour trial. Keep that implemented workshop contract. Before a
public offer, explicitly decide whether its free trial is seven days; do not
silently interpret the workshop grant as paid recurring subscription consent.

## Verified state and evidence limits

| Area | State as inspected | Limit |
| --- | --- | --- |
| Studio source | Main `171279dc` integrated at `0b57074d`, retaining the learner-journey design and existing automation diagnostics | Full extension tests, types/build and four actual SDK paid-ending controls pass; all18 remote CI checks pass at0b57074d. Current single Mac Dev app is9b4dd233; native online save/share and both-recipient import passed earlier at3f1a3f20. Runtime32ba0ac2 and installer87f75b6b each passed18 CI checks. Bot reconnect/own-preview passed earlier at0b57074d; Google execution remains revision-bound |
| Main integration | Main browser/subagent age policy and outbox drain retained; email-specific minor gate remains; SDK0.3.299 pinned | Automation88/88, orchestrator6/6 and automation-SDK12/12, SDK/browser helpers, types/build pass. Independent pre-A4 characterization updated only for main's policy delta; no current-output baseline recording |
| Service | Main `38d8879` integrated at `acfd637`; revoked-grant checks and agent routing retained alongside workshop model/output bounds and terminal settlement. Typecheck/build and focused42 checks pass; full independent run125 commands passed plus the corrected nine-command orchestrator group rerun. Documentation head2ce0b2e passed all13 CI checks, including premerge | Local Dev server watches the integrated checkout and reloads code. A21:01KST read-only instructor refresh agrees with live API:20 unknown/0 normal; staleA02 keeps6/6 only as a last report. At21:16KST, actual nativeA02 classroom reconnect produced fresh running/connect2/6 in both API and UI. The21:16 Google request later failed before callback completion; current32ba0ac2 native classroom reconnect and Google preview remain pending; earlier successful preview belongs toabf79a8. Existing DB/20-seat roster and online pilot unchanged; no new migration or remote deployment. Earlier local migrations0043–0045 and13 CI checks belong toabf79a8 |
| Ops | PR2 `8b7344cc`; existing schema supports class readiness | No production migration claimed |
| Local product | Earlier native acceptance at720be661 and0b57074d remains revision-bound; current Peer Check app is9b4dd233 against local Service2ce0b2e; relaunch restored dialogue, saved recipe and2/6 progress | Recovery32ba0ac2 has launch/state-restoration evidence; a fresh Google callback and coach recovery wording are not yet verified. Earlier start-page and coach observations are revision-bound. Google-dependent stages reset; a non-owner private-Sheet read is denied. After the user completed fresh login, bot own-Sheet read and exact one-recipient preview passed at0b57074d; no new two-account run is claimed |
| Windows | Historical shell `682dfd37`; full shell720be661 build run38694734487 passed packaging/CI smoke. Latest private candidate contains shell720be661 / extension32ba0ac2 / SDK0.3.299; installer87f75b6b | Gateway391ecb1f serves the new candidate;23 access controls and16 uploaded-chunk readbacks pass. Complete32ba0ac2 HTTP/2 readback was operator-cancelled at563.56s/13238272 bytes; same-artifact HEAD200 took4.680s. Root cause is unconfirmed and no full-download PASS is claimed. Prior3f1a3f20 full-download evidence (76.39s/35.41s) does not cover these new bytes. PowerShell archive/backup and exact-receipt handover from682dfd37,9d535c87,0b57074d,f90b65e3 and3f1a3f20 pass. No20-seat bandwidth guarantee follows. Actual Windows install/update/credential reuse remain NOT_RUN |
| Account isolation | Bot and TJ connected with sponsor-approved scopes; separate participant imported an inert recipe earlier; latest `720be661` real Google execution denies cross-Sheet reads in both directions | One durable sent record and Inbox receipt remain at `624b214f`; latest sequential account-switch test is not a new two-participant store-sharing pass. Credentials remain in-memory in Dev |
| Store/instructor | Twenty synthetic signed grants and real local D1 cap tests pass; 720be661 actual A02 previously reported failed read4/6, answer wait4/6 and restored preview6/6; after0b57074d restart, native classroom reconnect reports blocked Google connection2/6 then restored preview6/6 | Only Peer Check runs. Refreshed board changed blocked1/normal0/unknown19 → normal1/unknown19 after real preview, and labels the old6/6 as last report while disconnected; not20 actual users. Progress is mail-only; CSV correctness is not automatically observed |
| Sending | Sponsor-approved exact bot self-mail sent once through shared runner at `624b214f`; durable ledger sent1/unknown0 and matching Gmail Inbox at15:04 KST | No repeat send; source integration, Windows and general rollout remain separately gated |
| Cost | Workshop pins Haiku4.5; class estimate USD30–60, proposed cap USD100 total / USD5 per seat | Estimate assumptions below; not an applied spending authorization or measured class total |
| Real lecture need | Coding-beginner order clerk created a CSV order/ERP comparison tool through Studio; first/second inputs, repeated runs, reports and error handling verified in browser | Course inputs are synthetic. Standalone local HTML delivered; not a shared email recipe, unattended automation, Windows or real-company-data acceptance |
| Existing billing | Service purchase8/8, Studio purchase/start-page checks and Lab checkout/offer15/15 pass; current public catalogue matches the website's three one-time passes | No real payment. Stable workshop-to-paid account binding and selected email-enabled profile remain incomplete; see the billing audit |

Authoritative acceptance: [shared runner](google-shared-runner-isolation-evidence.md),
[local/Windows/instructor audit](automation-local-acceptance.md),
[requirements](../requirements/email-automation.md). Historical Google console
inspection on 2026-10-14 found Testing mode and unfinished branding; it is not a
fresh console inspection in this audit.

## Ordered work and observable completion

| Order / repository | Work | Completion criterion |
| --- | --- | --- |
| 1 / Studio, with Service/Ops compatibility | Integrate current main preserving both start-page work and automation capabilities; resolve dependency/SDK conflicts; reconcile stale owner-script docs | New exact SHA passes focused local regressions and required CI; no discarded unrelated work; reviewer can assess a conflict-free PR |
| 2 / Studio + Service | After feature implementation, perform DEC-025 three-account Mac→store→Windows reuse per SS-01–12, including recipient-owned setup, third-user isolation, update/rollback and withdrawal. Validate the final shared path with two real learner identities: publish/import the same recipe, own private Sheets, cross-account denial, separate preview/ledger; new-answer invalidation and reconnect recovery | Three distinct Studio/Google identities; Mac author and actual Windows recipients execute the same pinned package using their own data. Unauthorized audiences and shared approval are denied; no new mail required. Expanded WAJ packages repeat this gate after implementation |
| 3 / Studio + Google runner | Prepare one exact self-mail preview, request recipient/content approval, then send once and inspect Inbox | Same pinned runner/version, one sent result and matching receipt; ambiguous outcome stays unknown with no automatic retry. Do not reuse the prior owner-script approval |
| 4 / Service + Ops + instructor UI | Twenty distinct identities/grants, cohort separation, individual and total budget caps, expiry/revocation, stale/disconnected/in-progress/failed/completed states | Unpaid synthetic20-seat failure/concurrency matrix; real local stage receipts match instructor display. Roster/date/aggregate class budget are required before provisioning actual seats |
| 5 / product site + Google operations | Final runner scopes and branding, public support/privacy/deletion facts, test versus production setup and OAuth review evidence | Accurate reachable pages, operator-configured consent, actual submission/approval receipts. Managed-company blocks produce an actionable stop. Review completion is an external dependency |
| 6 / Studio release + operations | Fresh Windows installation and credential-preserving update/rollback from a pinned production-intended package; per-seat pre-class checks | Clean install and existing-install upgrade pass;20 actual learners each connect their account and complete no-send preview before class. Pilot exceptions are explicit, never labelled commercial approval |
| 7 / Service + existing billing + product site | Define trial/paid transition, price, usage entitlement, renewal/cancellation and support; audit existing billing before adding flows | Existing purchase/grant path is mapped, consent and expiry/renewal tested, and a small real pilot measures creation, reuse and paid conversion. No unattended new subscription charging |

Sequence: integration → final local product gate → bounded Windows gate →
class readiness/release decision. Prepare Google review materials in parallel
with integration because external review can dominate the schedule. A registered
pilot and general commercial publication are different releases, with separate
readiness evidence. Do not promise either in one day from current evidence.

## Work split, verification and cost controls

For subsequent implementation, use at most three non-overlapping implementation
assignments: Studio integration/UX; Service/Ops class admission and status; public
onboarding/release documentation. Assign precise files before parallel edits.
The parent performs final verification directly, not a subagent rechecking its
own work. Cross-repository contract changes are serialized before packaging.

Local tests carry the broad MECE failure matrix. Windows covers installation, credential reuse, the shared preview/graph/composer
path, and DEC-025 actual store download/configure/run/update/rollback with distinct
recipients. A new send requires separate exact approval.
Re-run only tests affected by a new SHA or unresolved failure. Use synthetic data
and no paid AI for concurrency tests. Preserve unknown cost/send reservations;
keep the existing USD3 test cap unless a concrete new budget is approved.

Collect setup/authoring token cost, deterministic Google execution/quota, support
minutes, storage and failed/retried runs separately. Recompute the prior operating
cost and break-even model using these observations; one successful USD0.057188
conversation cannot establish the margin of a KRW50,000 monthly subscription.

Class date is confirmed as **2026-10-16**. No fixed learner PC or shared filesystem
path is assumed. Assign seats01–20 and let each learner connect on their own Windows
session. The operator-only roster location is a storage decision, not a classroom
prerequisite: use the protected local task directory, outside Git; retain only
seat/account mapping needed for access. Do not invent real learner identities.

Class cost model:20 learners ×60–120 model calls ×(15,000 uncached input +2,000
output tokens) ×Haiku4.5 prices gives USD30–60. Each call is USD0.025; the proposed
USD100 aggregate / USD5 individual caps leave room for retries and longer contexts.
The call count and context length are planning assumptions, not measured usage.
Longer conversations or extra model calls can reach the cap sooner. Deterministic
Sheet preview and approved send use Google execution, not an AI call; account
quota and operator effort are separate. The30-day/600-attempt grant is not a
30-day USD5 guarantee. Keep workshop-day and post-class budgets distinct.
Sources: [Haiku4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing), checked2026-10-15.
Existing development cap remains USD3; no new live class budget was applied.

Missing human facts: real learner identities when registering the pilot, actual
class time if a scheduled window is used, accepted class/post-class spending caps,
public offer and privacy/support ownership. Obtain exact mail approval when its
reviewable preview exists. Prepared commercial evidence and billing findings:
[operator packet](email-commercial-operator-packet.md),
[billing continuity](email-commercial-billing-map.md).
