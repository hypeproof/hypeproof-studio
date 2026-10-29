# Studio feedback and Owner usage acceptance

This is the test contract and ownership map for FB-01–05, OC-01–03 and DL-01/02.
It does not award execution results. Source plan:
`docs/plan/studio-feedback-owner-console-implementation-2026-10-16.md` (delivery
plan; preserved as `plan.md` in the external evidence bundle). Frozen acceptance
revision: `ff25b53b1352e89ce243d780cfe5474af671a9da1229d432f1403b083380339d`;
source plan SHA-256: `97ed022d93dc5260204c136fa8b9aef47df603c995cb9a39fe28122bbc5f241b`.
The delivery bundle's `acceptance.json` is the immutable T01–T30 criterion set.
A criteria change requires a new revision; a fix must not weaken the frozen set.

Explorer follow-up ([#1742](https://github.com/hypeproof/hypeproof-studio/issues/1742))
supersedes the earlier FB-01 layout behavior for subsequent builds: launch, folder
activation, reload and restart start with Explorer closed; the explicit file-view
action opens it. The revised contract and checks are US-03 / US-T03. The frozen
T01/T02 descriptions below and their historical receipts remain unchanged; they
do not establish acceptance of this new behavior or revise the immutable bundle.

[Product Intent](../PRODUCT-INTENT.md) →
[Studio behavior contracts](../studio-requirements.md#feedback-delivery-contracts-2026-10-16) →
[developer index](../dev/04-requirements.md#feedback-delivery-contracts-2026-10-16) →
implementation/tests → revision-bound evidence. The
[traceability registry](../../config/traceability.json) retains existing domain
owners. Reusing an owner's domain is not a new assignment or merge/release authority.

## Requirement and ownership map

| Working ID | Canonical requirement/domain | Boundary and implementation |
|---|---|---|
| FB-01 | ST-REQ-UNIFIED; US-03/10/12 | App: `studioNavigation.ts` closes Explorer on every launch/folder activation before activity restoration. Existing native Explorer and explicit file-view actions remain the file surface. See the #1742 follow-up above; frozen T01/T02 retain their historical scope. |
| FB-02 | ST-REQ-UNIFIED; US-07–10/12/18; ADR 0008 | App activity binding, `studioNavigation.ts`, `workspaceRouting.ts`, StartPage and activation reuse SecretStorage and activity history/draft. Controlled transitions prepare/validate before open; expired, mismatched, cancelled and failed transitions preserve source work. Native menu/restart behavior requires real-app observation. |
| FB-03 | REQ-STUDIO-EXTERNAL-INSTRUCTIONS; ST-REQ-COACH-RUNTIME; ST-REQ-STUDIO-SAFETY | App public immutable Markdown snapshots and workspace-local selection. Both runtimes receive selected user-turn context. Service system/profile/lesson/tool authority stays in force; importing instructions is not installing executable skills or curriculum. |
| FB-04 | REQ-STUDIO-REFERENCE-IMAGES; REQ-C11/18; ST-TEST-INBOUND-IMAGES | App SDK/proxy pixels and explicit active-workspace re-reads; browser capture provenance. Service reference-design instruction owns the design workflow. A brief validator or deterministic keyboard fixture alone cannot prove a live model's reference fidelity. |
| FB-05 | REQ-STUDIO-IMAGE-EDIT; ST-REQ-COACH-RUNTIME; existing usage-cost domain | App chooses/verifies assets, records stable jobs, saves a new PNG and exposes explicit comparison/selection. Service owns authenticated edits, the fixed configured provider, durable dispatch/cancel state, retention and existing cost evidence. |
| OC-01 | ST-REQ-MODEL-USAGE; MU-02–06; REQ-L5 | Service observes actual upstream dispatches and person/session/purpose dimensions. Owner reads existing records; server-unobserved personal-provider traffic is not inferred. |
| OC-02 | ST-IMP/TEST-USAGE-COSTS; AB-05–09/15; MU-05/06 | Service existing attempt/evidence/price registry. Observation is separate from paid admission; unknown/partial/unpriced, approved revision, modality meters and currency units remain explicit. Historical backfill and invoice reconciliation need evidence. |
| OC-03 | ST-DES/TEST-USAGE-OBSERVATION; existing Lab membership/Owner read authorization | Lab's fresh active-member check and dedicated Service Owner-read transport. This does not change MU-07's existing operator-only model-usage admin route or grant other admin reads/writes. |
| DL-01/02 | REQ-STUDIO-FEEDBACK-EVIDENCE; existing unified-delivery verification domain | Portable report validates frozen criteria/revisions/hashes; Korean manuals describe real controls and recovery. Human acceptance is a separately observed task. |

## Service and Lab ownership

The Studio checkout contains App adapters and retained integration tests, not a
second Service runtime. OC implementation and independent tests stay in
[hypeproof/hypeproof-service](https://github.com/hypeproof/hypeproof-service):
`worker/src/lib/usage-dispatch.ts`, `usage-costs.ts`, `owner-usage.ts`,
`worker/src/routes/admin.ts`, `worker/src/routes/image-edits.ts` and migrations
`0045-usage-observation.sql`, `0046-image-edit-jobs.sql`. Relevant independent
checks are `worker/test/usage-dispatch.test.mjs`, `usage-dispatch-d1.test.mjs`,
`owner-usage.test.mjs`, existing `usage-costs*.test.mjs`, and
`image-edit.test.mjs`, `image-edit-route.test.mjs`, `image-edit-runtime.test.mjs`,
`image-edit-fixes.test.mjs`.

Member identity and the read surface stay in
[hypeproof/hypeprooflab](https://github.com/hypeproof/hypeprooflab):
`web/src/lib/ownerConsole.ts`, `membersDb.ts` and
`web/src/lib/__tests__/ownerMembershipDb.test.ts`. Active membership must be
checked freshly; nonmembers/revoked members are denied and membership DB errors
fail closed. A successful local authenticated read does not establish production
membership, invoice completeness or other admin authority.

These are candidate repository/path links, not immutable runtime evidence. Each
execution receipt must record the exact Service/Lab revision, endpoint, profile
and permission state it used. Do not pin a provisional integration SHA into the
canonical requirement. Keep the existing MU and access-budget requirements as
sources rather than restating a separate Studio accounting policy.

## Frozen acceptance matrix

The descriptions below identify coverage; the full frozen criterion remains in
`acceptance.json`. All candidate/installed/live/human rows start NOT_RUN unless
an exact-scope receipt says otherwise. A helper PASS covers only the indicated
local boundary, never an entire numbered scenario.

| Test | Requirement | Required observation and available executable boundary |
|---|---|---|
| T01 | FB-01 / US-03/10 | New profile → work/file → restart; Explorer accessible, saved file and input focus/layout preserved. `activity-resume.test.mjs` covers host rules; actual App/restart remains required. |
| T02 | FB-01 / US-10/12 | User hides Explorer, reopens chat/window; explicit choice is not reset. Initial-layout positive/established-profile negative controls plus real shell observation. |
| T03 | FB-02 / US-07/10 | Bound A→B→restart through controlled paths; valid credential/history/draft retained. `studio-folder-navigation.smoke.mjs` runs production routing with VS Code seams; the hosted native suite executes actual SDK turns with owned scripted upstream, checks exact history occurrence and draft retention after folder reload, and keeps released-installation evidence separate. |
| T04 | FB-02 / US-07/09/18 | Other activity/Service, unbound folder, cancel and denial; no silent binding/secret transfer. Folder-navigation, activity-connections and workspace-routing controls. |
| T05 | FB-02 / US-07/10 | Slow activation, multiple windows, stale marker, symlink/Korean paths; one-shot destination-bound marker. `activity-resume.test.mjs` and `initial-surface.smoke.mjs` exercise actual checkpoint decisions and startup notification callbacks; callback proof is separate from native notification pixels. Actual multi-window check required. |
| T06 | FB-02 / US-08/12 | Active stream/approval, close/recover and revoked credential; draft retained, no duplicate execution. Hosted native scenarios cover active-stream navigation refusal, actual Stop, normal quit/restart, direct File Open Folder, and revoked B rejection. Cancellation requires the same request to close at the client, Service body, and upstream socket before cleanup; the original interrupted user and any actually received partial answer remain in persisted history once, without completion or automatic replay. |
| T07 | FB-03 | Public pinned import→preview→select→SDK/proxy work. `external-instruction-skills.smoke.mjs`, `external-skill-commands.smoke.mjs`; live model use/result still required. |
| T08 | FB-03 | Traversal/symlink, oversize, executable/malicious instructions and denied tool controls. Importer/host tests plus `e2e/feedback-native/external-policy-probe.mjs`: selected hostile context through actual SDK/Service, allowed workspace Read, denied private/other/symlink Read and new outside Write, refused destructive shell approval, ungranted Agent refusal and unchanged owned canaries. Scripted upstream; real SecretStorage is never accessed, and this makes no claim of universal natural-language attack detection. |
| T09 | FB-03 | Moving branch, duplicate/interrupted import, update/revert/remove; immutable snapshots and user files retained. External instruction/command tests. |
| T10 | FB-04 / REQ-C11/18 | Pasted image, file attachment and URL each carry actual pixels and correct source. `reference-images.smoke.mjs`, `reference-transport.test.mjs`, browser/MCP tests; live upstream receipt separately observed. |
| T11 | FB-04 | Synthetic keyboard URL→provenance brief→candidate→follow-up; keyboard/key rows, placement, depth and motion retained. Brief/capture helper and `e2e/reference-design/run.mjs` provide structural controls; live semantic comparison required. |
| T12 | FB-04 | Wrong tab/redirect, capture failure, missing image and tool denial; no invented observation. Reference/browser tests with planted failures plus actual allowed browser route. |
| T13 | FB-04 | 390/1280, hover/scroll/time states and reduced motion. Same-state captures and actual interactions; the deterministic 960×720 keyboard fixture does not satisfy the complete responsive/motion criterion. |
| T14 | FB-04 | Replace core keyboard with generic illustration. Structural negative fixture must fail, and independent semantic evaluation must reject the replacement; a DOM oracle alone is insufficient. |
| T15 | FB-05 | Known-alpha original→real provider background removal; subject/key rows, transparency and edges. PNG/opaque/deleted-subject controls are local; provider fidelity/halo judgment remains live/human. |
| T16 | FB-05 | Directed edit, failure, cancel, late completion and duplicate click. App asset/client/command checks and Service durable-job/evidence tests; real edit and installed command path separately required. |
| T17 | OC-01/02 | Classroom/trial/pass/test × SDK/proxy × stream/nonstream dispatch matrix; actual attempt/identity/usage match. Service usage-dispatch unit/D1 checks plus bounded live paths. |
| T18 | OC-02 / MU-02/05 | Title/helper/retry and repeated evidence; distinct attempts, idempotent evidence, no double sum. Existing Service dispatch/cost tests; live provider coverage separate. |
| T19 | OC-02 | Pre-dispatch refusal, sent failure, partial stream and persistence loss; not_sent/unknown/partial preserved, no fabricated zero. Service cost/dispatch/image recovery tests. |
| T20 | OC-02 / AB | Price revision, modality/cache TTL, tier/region/currency/time boundaries and integer micro units. Existing price/cost controls, including mismatched/missing dimensions and ambiguous/unapproved image-price rejection. |
| T21 | OC-02 | Historical dry-run/replay/revision correction preserves originals and attribution. Exact backfill input/reconciliation evidence required; current-path tests do not pass historical completeness. |
| T22 | OC-01/02 | Fixture→DB→API→Owner UI→CSV, person/model/purpose totals, KST boundaries and CSV safety. `e2e/owner-console/run.mjs` uses local Service + explicitly synthetic records; production totals remain separate. |
| T23 | OC-03 | Google/GitHub session, active/nonmember/revoked identity and DB errors. Lab membership/Owner read tests plus real authenticated Surface observation; local fixture is not recipient acceptance. |
| T24 | OC-03 | Forged headers, redirected upstream, other admin GET/POST; read credential cannot expand authority. Existing Service Owner-auth and Lab transport tests. |
| T25 | FB/OC | Old App/new Service and new App/old or unsupported Service; existing class remains usable, unsupported capability explicit. Artifact-bound compatibility runs required. |
| T26 | DL-01 | Missing evidence, wrong SHA, broken link and HTML injection cannot manufacture PASS. `scripts/test-feedback-report.py`, `e2e/feedback-report/run.mjs` cover report controls/offline rendering. |
| T27 | DL-02 | Novice/Owner completes task using only manual; record person, artifact, assistance and unfinished steps. HUMAN_PENDING until a person's observation, never delegated model acceptance. |
| T28 | All / US-14–16 | Mac/Windows candidate and released installation; App/extension/Service/fixture digests bind real behavior. Local Chromium/host seams and native app preparation are insufficient. |
| T29 | FB-04 | Original user URL/screenshot/video reproduction. BLOCKED while those assets are missing; synthetic keyboard success does not resolve this row. |
| T30 | OC-02 | Same-period actual provider usage/invoice reconciliation with provenance and explained differences. BLOCKED without records; an approved price and computed cost are not an invoice match. |

## Executable checks

Run only existing entrypoints from the corresponding checkout. Record stdout,
exit status, revision and scope. The commands are test instructions, not results
from publishing this document.

```bash
# Studio extension directory
npm run typecheck
npm run build
npm run test:activity-resume
node --experimental-strip-types test/studio-folder-navigation.smoke.mjs
node --experimental-strip-types test/activity-connections.smoke.mjs
node --experimental-strip-types test/workspace-routing.smoke.mjs
node --experimental-strip-types test/external-instruction-skills.smoke.mjs
node --experimental-strip-types test/external-skill-commands.smoke.mjs
node --experimental-strip-types test/reference-images.smoke.mjs
node --experimental-strip-types test/reference-design.smoke.mjs
node --experimental-strip-types --test test/reference-transport.test.mjs
node --experimental-strip-types test/image-edit.smoke.mjs
node --experimental-strip-types test/image-edit-commands.smoke.mjs

# Studio repository root; headless synthetic/local-file browser checks
node --experimental-strip-types e2e/reference-design/run.mjs <evidence-dir>
node --experimental-strip-types e2e/image-edit/compare.mjs <evidence-dir>
python3 scripts/test-feedback-report.py
python3 scripts/feedback-report.py <bundle-dir>
node e2e/feedback-report/run.mjs <bundle-dir>
HPS_SERVICE_SOURCE=<candidate-service-checkout> node e2e/owner-console/run.mjs
python3 scripts/docs-harness/check.py --min-score 95

# Service checkout only; no production deployment
npm run typecheck --prefix worker
node --experimental-strip-types --experimental-sqlite worker/test/usage-dispatch.test.mjs
node --experimental-strip-types --experimental-sqlite worker/test/usage-dispatch-d1.test.mjs
node --experimental-strip-types --experimental-sqlite worker/test/image-edit-fixes.test.mjs
```

The candidate image command, report generator/browser check and Owner browser
check are integration sources in this delivery. Their final registration and
exact implementation revisions must be present before running those commands;
missing files/configuration are NOT_RUN/BLOCKED, not a successful skip. No
command above builds a complete native App or establishes Windows acceptance.

## Evidence and remaining gates

One receipt identifies test/requirement IDs, frozen acceptance revision, source
SHAs, App/extension hashes, Service endpoint/revision, OS/profile/model, fixture
revision, timestamps, commands, observations, artifact paths/hashes, evaluator
kind and limitations. Unrun times and observations stay empty/null. A source,
brief or asset change makes affected evidence stale. Re-run the changed target;
do not reinterpret an old screenshot as a new execution.

The report separates implementation, technical verification, operational release
and human acceptance. Unit/synthetic/provider-seam checks may be PASS within
their boundary while the enclosing live or human test remains NOT_RUN/BLOCKED.
All missing original-reference, provider/account availability, invoice, platform
and human requirements remain named. Keep the frozen limit of 12 live attempts
per synthetic activity, initial candidate plus at most two corrections, and the
recorded per-call output bound; do not extend them to force a passing result.

The [Korean manual](../manual/studio-feedback-20261016/index.html) and its
[manifest](../manual/studio-feedback-20261016/manual.json) are reviewable product
artifacts. Publication alone does not prove a novice, Owner or operator completed
the task. No learning-outcome score is inferred from operational tokens/costs.
