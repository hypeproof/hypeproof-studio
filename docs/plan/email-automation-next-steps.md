# Studio email automation: goal and remaining delivery plan

Audit date: 2026-10-15 KST. Sponsor: TJ. This is a planning/status update,
not approval to merge, release generally, send mail, or change Google access.
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
| Studio source | Local/remote `9277348d`, source `ab0a13a7`; clean checkout before this documentation update | PR1605 is OPEN/DRAFT, CONFLICTING with main; current check rollup empty |
| Main integration | Fetched `origin/main` at `53c5e567`; non-mutating merge-tree found four conflicted paths | package.json, package-lock.json, sdkCoachHelpers.ts, webview StartPage.tsx; other automatically merged interaction paths still require behavioral checking |
| Service | `a50be76`, OPEN/DRAFT; twelve current-head CI checks successful | Isolated runtime remains `ffef7bc`; new coach prompt is source-only, supported by the installed Studio SDK override |
| Ops | PR2 `8b7344cc`, OPEN/DRAFT, mergeable; check successful | No merge or production migration claimed |
| Local product | Native questions → skill → private connection/Sheet → actual shared preview → graph6/6; composer restored | Acceptance is revision-bound; no new shared-runner mail delivery |
| Windows | Existing shell `682dfd37`, eight-file source `ab0a13a7` update; all hashes matched; saved skill/Google/Sheet reused, preview and graph6/6 | Accepted authenticated test update, not a fresh commercial installer |
| Account isolation | Earlier read-only probe: two non-IAM identities, own-data success, bidirectional cross-data denial, isolated state | Full shipped recipe runner has native single-account preview evidence; close the full-product two-account gap |
| Store/instructor/UI | Earlier actual publish/import; local real learner plus labelled20-seat instructor fixture; resize300→480 and persona transitions | Recheck changed shared-runner paths after integration; not20 real concurrently connected learners |
| Sending | Prior owner-script Windows self-mail and Inbox receipt passed | New shared-runner transport has deterministic controls but no approved live send/receipt yet |
| Cost | Last minimal Windows conversation added USD0.057188 to settled token ledger; unresolved reservations unchanged | One run, not per-student monthly cost, invoice reconciliation or subscription profitability |

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

Decisions still requiring human facts: class date and protected roster, class-wide
budget, public trial/price/renewal offer, actual privacy retention/support owner,
and release/merge authorization. Obtain the exact mail approval only when its
reviewable preview is ready. No new permissions or mail were requested in this audit.
