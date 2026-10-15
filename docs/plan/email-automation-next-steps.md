# Studio email automation: goal and remaining delivery plan

Updated: 2026-10-16 KST. Sponsor: TJ. The sponsor authorized continuing
implementation and delivery with minimal approval interruptions. Exact email
content approval and required external permission/release gates still apply.
Scope: Epic1603 / issue1604, Studio1605 / Service50 / Ops2, EA-01–11 and DEC-023.

Current checkpoint (2026-10-16): development/test ceiling is USD10, including
historical charges and unresolved holds. The reconciled maximum exposure is
USD5.972794 (USD4 in unique active root grants plus USD1.972794 historical
charges/holds); this is not actual spending. Evidence:
`/tmp/hps-email-mvp/reconciled-budget-20261016.json`. The proposed live-class
budget remains separate. No further mail is authorized.

Studio checkpoint dbff37ed integrates main6ad5f9f8 and passes all18 CI checks.
The following fork-provenance change has local validation; its CI/native acceptance
are separate from that checkpoint. Windows
659de97d passed verified install/update, portable-profile restoration, non-owner
store import and private Google preview, then explicit v2 update and v1 rollback
with fresh previews and unchanged private configuration. Publisher `peer` owns
the Mac-authored item; `original` is the verified non-owner recipient. Earlier
peer Windows evidence proves author cross-device reuse, not another recipient.

The single Mac Dev app now runs dbff37ed against the private online Service.
The third principal's retained v1 pinning was verified at b0cc15a0. On dbff37ed,
a failed invented version ID recovered through the actual catalogue and returned
both real revisions without installation or Google actions. The coach still
invented the first ID and exposed internal IDs in its final table: recovery passes,
but the complete presentation criterion remains PARTIAL. TJ OAuth expired before
completion; the old browser tab is closed. A fresh user-ready connection and
third-principal execution remain open. Windows still runs659de97d.

SS-08 fork provenance is implemented locally in Studio and Service9618d234:
an installed exact revision is retained with the activity's recipe, shown during
private publication review, and sent as sourceId for a new recipient-owned family.
Owner updates retain the family's server-side origin. Recipe/Google data are not
added to provenance. Ops0047 is prepared; no database migration or runtime rollout
of this change has occurred. Automation92, types, extension/webview builds and
Service automation/workshop suites pass. Actual Mac/Windows fork reuse remains open.

Private Service781b639f is based on d63d5d7 with main9dbe15c and bounded test
routes. Production d34da3a5 remains at100%; the test target takes0% normal
traffic. Ops0046 is applied only to the backed-up isolated database. Remaining
gates: distinct Google identities and different private datasets, third-recipient
execution, recipient fork provenance, final matching app candidates,
class/instructor readiness and the separately scoped expanded WAJ design/runtime gates. Current evidence and
individual boundaries: [store contract](skill-store-cross-platform.md).

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

Completion order: finish the native three-account store journey and coach
regression, preserve author/recipient identity evidence, then close remaining
class/commercial requirements. SS-11 applies after the expanded WAJ runtime is
implemented; DEC-024 design completion does not claim runtime completion. Private R2 distributes the
Windows installer; D1 distributes inert recipes. Installer transport alone does
not pass store execution. The current artifact and runtime checkpoints above
supersede the earlier version references below.

Historical integration: main05efefdb introduced project switching. The
voiceLogChannel/coachLogChannel conflict was resolved, and native Mac9b4dd233
completed a bot-owned one-row preview with App/instructor6/6. Its saved send
ledger stayed unchanged. That evidence remains tied to9b4dd233 and the old
local Service; it is not current online Mac acceptance.

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

Three subjects currently share aUSD1 sequential test pool. The user raised the overall development/test ceiling to USD10 on2026-10-16; a verified additional USD1 Windows-recipient allocation is active.
The117-record historical audit retainedUSD1.972794 prior spent/held exposure;
prior exposure plus the full new pool remainsUSD2.972794. At20:58KST, native
author/recipient work has settledUSD0.113022 across the pool, held0 and
overrun0. The author spentUSD0.060136, first recipientUSD0.026030 and
third principalUSD0.026856. Pool remaining isUSD0.886978.
The pool figures above predate the approved USD10 ceiling and additional USD1 allocation; no usage/token reset occurred. This does not provision the
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
| Studio source | Main05efefdb integrated at9b4dd233; current622cc4e4 adds renewed-approval re-publication recovery | All18 CI checks pass at622cc4e4. Automation91, types/build and actual Service-route/SQLite re-publication controls pass. Native9b4dd233 and Windows e3ab008b remain distinct revision evidence |
| Main integration | Main browser/subagent age policy and outbox drain retained; email-specific minor gate remains; SDK0.3.299 pinned | Automation88/88, orchestrator6/6 and automation-SDK12/12, SDK/browser helpers, types/build pass. Independent pre-A4 characterization updated only for main's policy delta; no current-output baseline recording |
| Service | Active local server remains2ce0b2e with13 passing CI checks. Isolated follow-up e76d1c2 adds immutable recipe revisions and re-runnable metadata migration0046 | Local API15, readiness3, classroom-ops10 independent commands, types and dry-run build pass. Migration0046 is not applied to the running local or remote Service; canonical Ops DDL and coordinated deployment remain pending |
| Ops | PR2 `8b7344cc`; existing schema supports class readiness | No production migration claimed |
| Local product | Single Mac Dev app9b4dd233 against local Service2ce0b2e, local subscription coach | Fresh Google callback, bot-owned Sheet and exact1-recipient preview pass; native App and instructor both6/6. One durable send ledger hash is unchanged; no new mail. Source622cc4e4 native re-publication and two-recipient Windows reuse remain unverified |
| Windows | Private R2 gateway7a9c50d2 serves shell720be661 / extensione3ab008b / SDK0.3.299 | Both stored archive hashes, final manifest, local PowerShell extraction/backup/handover and23 online access controls pass. Authenticated HTTP/2 app download timed out at300.02s/28818717 bytes (curl28); no complete-download PASS. HTTP/1.1 also timed out at300.02s/11611200 bytes (curl28). Repeating the same Mac transfer is not the next gate; verify the Windows network and installer. Actual Windows update from682dfd37 toe3ab008b downloaded and verified both archives, prepared SDK and launched the new app on2026-10-16. Workspace/credential restoration and store reuse remain IN_PROGRESS; no20-seat bandwidth guarantee |
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
keep the user-approved USD10 total development/test cap (raised on2026-10-16), including historical spending, held charges and all live allocations.

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
Development/test ceiling is USD10 following the explicit2026-10-16 approval; this does not authorize the proposed live-class budget.

Missing human facts: real learner identities when registering the pilot, actual
class time if a scheduled window is used, accepted class/post-class spending caps,
public offer and privacy/support ownership. Obtain exact mail approval when its
reviewable preview exists. Prepared commercial evidence and billing findings:
[operator packet](email-commercial-operator-packet.md),
[billing continuity](email-commercial-billing-map.md).


## Version lifecycle implementation checkpoint — 2026-10-16

Servicee76d1c2 and the corresponding Studio changes now support owner-only v2
publication, version history, explicit recipient update and explicit rollback.
The publication review names the next version; installation review names the
selected version and replaces only the inert recipe. Parent-bound request IDs
retain retry identity. Download checks separate recipe format from release number
and reject a changed SHA256, unknown format or malformed lineage.

Actual Studio client/helper/controllers plus Service routes and SQLite passed a
three-principal integration: A publishes v1/v2; B updates then restores v1; C keeps
v1 throughout. No Google call or mail is made by installation. Host tests confirm
cancelled rollback preserves the draft and approved rollback preserves existing
private connections. Local D1 tests confirm atomic metadata/recipe insertion,
concurrent revisions and old rows without metadata. Studio automation91,
local-runtime8, typecheck and builds pass. Evidence:
`/tmp/hps-email-mvp/store-version-{service-integration,after,studio-tests,local-runtime-tests}.log`.

This closes a local implementation gap, not SS-08 acceptance: native Mac/Windows
version selection, persisted provenance for recipient forks, canonical Ops DDL,
release coordination and current-revision CI remain open. Keep the running Mac
9b4dd233 and private Windows candidatee3ab008b evidence separate. Do not restart
the current successful Google connection just to claim a newer runtime.

## Windows live checkpoint — 2026-10-16

The user made the existing Windows test PC available. Its682dfd37 app closed normally; the approved private installer downloaded app196648104 bytes and SDK121940997 bytes, enforced both pinned hashes, preserved the older install/shortcut, and launch-stage reached the newe3ab008b welcome screen. This proves delivery on that Windows network, despite the earlier Mac transfer timeouts. Exact installed receipt/profile backup readback, existing workspace/credential restoration, store import and recipient execution are the next live checks; do not infer them from successful installation. No new mail or paid call occurred.

Current source6b73873f passes all18 Studio CI checks. Servicee76d1c2 currently reports no CI checks; focused local/D1 evidence applies, while prior2ce0b2e CI does not count as current-head evidence. Both PR descriptions now distinguish current source, Mac9b4dd233, Windows e3ab008b and pending lifecycle acceptance.

The first live launch exposed a real upgrade defect: the prior682dfd37 install used `data/user-data` portable storage, while the installer only backed up the default roaming profile. Original data remained intact, but activities appeared absent. The installer now follows only a verified prior shortcut (including the retained rollback shortcut on repair), copies the portable tree with per-file SHA256 verification, retains a separate rollback snapshot, atomically activates `data`, and preserves recipient edits on rerun. Unknown targets, incomplete snapshots, linked files and custom routing fail closed. Actual Windows rerun restored the saved activities, work folder and conversation without entering a new Studio participation code. The native graph currently reports2/6 and Google credential reuse is not yet proven.

Private gateway1a566b74-00eb-430b-b0b3-5770b7277bd6 serves only this installer repair; app/SDK hashes, expiry and Service binding are unchanged. Served script matches source;23 online access controls and real PowerShell archive/profile fixtures pass. New source commits still require current-head CI.

## Approved test budget increase — 2026-10-16

The user explicitly chose “총 US$10로 인상”. This supersedes the USD3 development/test ceiling only. Historical spending and unresolved holds count toward the USD10 total; it is not USD10 per account or a new class budget. The prior USD1 three-seat pool remains intact; an additional USD1 Windows-recipient allocation was created and read back. Historical spending/holds plus all active allocations total at most USD3.972794, below the approved USD10 ceiling. No additional model call or mail was used to apply this increase. At the latest check, the recipient had USD0.273198 available. Windows SDK requests returned403 with a model/feature-entitlement refusal; a later private-gateway health check returned503 `Test version unavailable`, while public health remained200. These are separate from a low balance. Preserve the prior store item and do not claim Windows import/execution passed. Installer fix1501537e has all18 CI checks passing.

Readback evidence: `/tmp/hps-email-mvp/raised-budget-20261016-receipt.json`. New funding source: `email-windows-extra-contract-20261016`. The prior test route was removed by a concurrent deployment at2026-10-15T15:51:32Z; restoring the previously approved0% test version retained the current public version d34da3a5 at100%, and private health returned200 with the expected test marker. The SDK refusal is `tool_not_entitled_or_metered`; do not widen execution permissions as a workaround.


Budget readback update (2026-10-16): the non-owner `original` now has a verified
additional USD1 allocation under `email-windows-recipient-contract-20261016`.
The allocator conservatively counted USD5.972794 before this increment and
USD6.972794 after it, below the approved USD10 total. Shared fallback views
are counted more than once in that upper bound; it is not measured spending.
No historical charges, holds or previous allocations were reset, and applying
the increase sent no mail and made no model call. Native funding selection
remains pending. Receipt: `/tmp/hps-email-mvp/raised-recipient-budget-20261016-receipt.json`.


Non-owner Windows checkpoint (2026-10-16,02:12KST): native e3ab008b opened the explicitly selected `original` principal in a new `StoreOriginalRecipient` workspace. The live store returned `mine=false` for peer-owned publication a1370573-7db3-4083-9224-49782bf5a315. The host displayed the inert template review and installed it after confirmation. The activity reused its existing Google connection and one-row Sheet; Apps Script preparation and a reviewed no-send preview reached6/6 with the imported subject/body. No other activity settings were copied and no mail was sent. This establishes non-owner Studio-principal import and useful preview. Distinct underlying Google identities between author and recipient are not yet verified; do not infer them from separate Studio principals. Candidate659de97d upgrade and native revision/update/rollback remain pending. Evidence: `/tmp/hps-email-mvp/windows-original-import-20261016-safe.png` and `/tmp/hps-email-mvp/windows-original-preview-20261016-safe.png`.


Native upgrade checkpoint (2026-10-16,02:19KST): the existing Windows installer fetched both candidate659de97d archives, verified them, reused SDK0.3.299 and migrated the prior portable profile. Read-only installed receipt and process checks show build659de97d, appSHA503517c347224672630822ead80091d616517624c4ab1d57cc2af9d4ee4cfee9, ProfileMigrated=True, RollbackRetained=True and ActiveBuild=True. The original non-owner activity, workspace and conversation were restored. After selecting its existing test grant, Apps Script preparation and a fresh one-recipient no-send preview completed6/6 without login, retaining the imported template and activity-bound Google/Sheet configuration. The model could reuse verified saved configuration; the quest restored prerequisites only after successful fresh execution. No new mail. Native recipe revision publication/update/rollback and distinct underlying Google identity verification remain open. Evidence: `/tmp/hps-email-mvp/windows-upgrade-659de97d-receipt-safe.png` and `/tmp/hps-email-mvp/windows-original-upgrade-preview-659de97d-safe.png`.


Native version lifecycle checkpoint (2026-10-16): Windows659de97d published an
exact reviewed v2 of the Mac-authored store recipe; server readback confirms v1
unchanged and v2 parent/digest/content. Non-owner `original` selected v2 through
version history and host review, previewed its `[v2]` subject with existing private
configuration, then restored v1 through another review and previewed the original
subject. No mail, login or configuration change. Full SS-08 remains open for
third-recipient pinning and fork provenance; distinct Google identities and
different recipient datasets are still unverified. Details and evidence are in
[the store lifecycle checkpoint](skill-store-cross-platform.md#native-immutable-version-lifecycle--2026-10-16).

The live publisher coach exposed unsupported save-completion and cancellation
diagnosis claims. Incorrect review cards were cancelled before publication.
SDK/local/MCP guidance now requires the actual save result and stops after
cancellation without inventing a connection error. Typecheck and automation91
pass; native behavioral acceptance of this guidance change is NOT RUN.
