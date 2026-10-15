# Studio email automation: goal and remaining delivery plan

Updated: 2026-10-15 KST. Sponsor: TJ. The sponsor authorized continuing
implementation and delivery with minimal approval interruptions. Exact email
content approval and required external permission/release gates still apply.
Scope: Epic1603 / issue1604, Studio1605 / Service50 / Ops2, EA-01–11 and DEC-023.

## Intended outcome

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

Default execution is the managed immutable Google runner. Learners receive no
company IAM or script editing access. Personal script export, arbitrary generated
code, non-Google mail, unattended schedules and public seller payouts are deferred.
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
| Studio source | Main `fbde0482` integrated at `720be661`; native-discovered clarification/read-error/account-change fixes retained | All18 CI checks passed at `720be661`; PR1605 remains draft and final live acceptance is incomplete |
| Main integration | Main browser/subagent age policy and outbox drain retained; email-specific minor gate remains; SDK0.3.299 pinned | Automation88/88, orchestrator6/6 and automation-SDK12/12, SDK/browser helpers, types/build pass. Independent pre-A4 characterization updated only for main's policy delta; no current-output baseline recording |
| Service | Main `012274d6` integrated at `abf79a8`; shared workshop capability retained; final13 CI checks passed | Local running service remains `21033b32`; no production deployment. New source migration0045 preserves the historical automation schema after main's0044 attribution migration |
| Ops | PR2 `8b7344cc`; existing schema supports class readiness | No production migration claimed |
| Local product | Bot preview/publish at `5838f1bc`; peer import/TJ preview at `9e43a9c8`; account-change recovery/self-mail at `624b214f`; single Peer Check now runs `720be661` | Latest native run: TJ/bot own previews, bidirectional private-Sheet denial, account-change3/6 and recovery6/6 verified; durable sent1 unchanged. Latest test switches Google identities within one Studio participant; earlier distinct-participant store evidence remains separate |
| Windows | Historical shell `682dfd37`, source `ab0a13a7` authenticated test update; full `720be661` build run38694734487 in progress | Current SDK0.3.299 win32-x64 tarball downloaded and SHA512 verified; not executed. Latest install/update/credential reuse remain NOT_RUN. Old extension-only updater retains SDK0.3.207 and cannot establish current package parity |
| Account isolation | Bot and TJ connected with sponsor-approved scopes; separate participant imported an inert recipe earlier; latest `720be661` real Google execution denies cross-Sheet reads in both directions | One durable sent record and Inbox receipt remain at `624b214f`; latest sequential account-switch test is not a new two-participant store-sharing pass. Credentials remain in-memory in Dev |
| Store/instructor | Twenty synthetic signed grants and real local D1 cap tests pass; current actual A02 reports failed read4/6, answer wait4/6 and restored preview6/6 | Only Peer Check runs. Current normal1/unknown19 correctly excludes closed/stale/unconnected seats; not20 actual users. Progress is mail-only; CSV correctness is not automatically observed |
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
| 2 / Studio + Service | Validate the final shared path with two real learner identities: publish/import the same recipe, own private Sheets, cross-account denial, separate preview/ledger; new-answer invalidation and reconnect recovery | Both real accounts execute through the shipped adapter without company IAM, one cannot use the other's data/approval; no mail required for this gate |
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

Local tests carry the broad MECE failure matrix. Windows covers only installation,
credential reuse, a shared preview/graph/composer path and, if approved, one send.
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
