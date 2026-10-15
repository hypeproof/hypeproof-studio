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

[Completed research](skill-store-distribution-research.md) compares current Service/D1 with private Cloudflare R2, Supabase,
Google and GitHub/open-source distribution patterns. Final audience remains a
product question; current cohort visibility must not be mistaken for cross-class
or public access. Store research/planning is current work; actual Mac→Windows
acceptance follows feature implementation and Windows availability. The new gate
is NOT_RUN. Earlier two-user or Windows preview evidence does not satisfy it. Local follow-up verified19
three-synthetic-principal Service/D1 controls and added common-client rejection of
unsafe/mismatched store recipes, with88 automation checks/types/host build passing.
Those partial controls do not pass the real Mac-to-Windows journey. The single
Mac Dev app remains0b57074d; the private online Windows candidate now includes
the client fix atf90b65e3. Its runtime passed all18 CI checks (one Windows-runner
startup timeout passed on the failed-job rerun). Actual Windows execution is NOT_RUN.
The private gateway now admits three distinct Studio principals; online Service/D1
publication/ownership/withdrawal19 and download/profile/access23 controls pass.
Actual Google identity mapping and native Mac/Windows reuse remain unverified.
The three existing Studio subjects now each have an available test allocation
(~USD0.333), under a USD1 active pool and the unchanged USD3 overall ceiling.
A full117-record ledger audit retained USD1.972794 prior spent/held amounts;
combined prior exposure plus the new limit is USD2.972794. No usage/token reset,
model call, email or payment occurred. Concurrency remains1 for sequential pilot
testing; this does not provision the real20-person class budget.

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
| Studio source | Main `171279dc` integrated at `0b57074d`, retaining the learner-journey design and existing automation diagnostics | Full extension tests, types/build and four actual SDK paid-ending controls pass; all18 remote CI checks pass at0b57074d. Single Mac Dev app is staged at0b57074d; bot reconnect/own-preview recovery passed; final two-identity scope remains revision-bound |
| Main integration | Main browser/subagent age policy and outbox drain retained; email-specific minor gate remains; SDK0.3.299 pinned | Automation88/88, orchestrator6/6 and automation-SDK12/12, SDK/browser helpers, types/build pass. Independent pre-A4 characterization updated only for main's policy delta; no current-output baseline recording |
| Service | Main `012274d6` integrated at `abf79a8`; shared workshop capability retained; final13 CI checks passed | Local server now runs `abf79a8` directly, preserving116 existing tables and the20-seat roster; no production deployment. Additive local migrations0043–0045 applied with an integrity check and rollback backup |
| Ops | PR2 `8b7344cc`; existing schema supports class readiness | No production migration claimed |
| Local product | Earlier native acceptance at720be661 remains revision-bound; the only Peer Check app now runs0b57074d after extension/profile backup | Start page, saved dialogue/recipe and fresh coach request work. Google-dependent stages reset; a non-owner private-Sheet read is denied. After the user completed fresh login, bot own-Sheet read and exact one-recipient preview passed at0b57074d; no new two-account run is claimed |
| Windows | Historical shell `682dfd37`; full shell720be661 build run38694734487 passed packaging/CI smoke. Private candidate now contains shell720be661 / extensionf90b65e3 / SDK0.3.299 | Current installer is served online. Authenticated full app/SDK downloads match pinned hashes; anonymous downloads deny401. PowerShell archive/backup and exact-receipt handover from682dfd37,9d535c87 and0b57074d pass. Actual Windows install/update/credential reuse remain NOT_RUN |
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
