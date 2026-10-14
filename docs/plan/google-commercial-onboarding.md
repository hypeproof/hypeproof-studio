# Commercial Google onboarding: twenty learners

TJ request, 2026-10-14: identify remaining commercial onboarding work and proceed
with feasible preparation. Existing MVP acceptance is retained, not relabelled
as commercial launch approval. Parent: Epic1603 / issue1604 / PR1605, EA-02/08/11.

## Confirmed architecture and bounded verification

TJ selected the managed shared Google executor on 2026-10-14 (DEC-023).
Personal Apps Script export is deferred. Learners supply bounded saved recipes;
Studio manages the immutable execution code, and each call must use the learner's
own Google identity. No company Cloud IAM or script editor role is part of learner
onboarding. Real sending still requires exact recipient/content approval.

The first spike is `scripts/google-runner-probe/`: a separate read-only script,
no Gmail scope or send function, a mandatory two-subject allowlist, private A1
value digests and per-user synthetic markers. Root ran its six local behavior
checks successfully. These model Google semantics; live account execution is
still required. The separate probe project was created/uploaded and associated
with the Studio test Cloud project. IAM currently lists only the company owner.
Live OAuth/deployment and two-user isolation are pending, not passing.

## Current observed gaps

Root read the Studio Google Cloud console on 2026-10-14: External/Testing,
two registered test users; publication disabled pending branding; homepage,
privacy, terms and authorized domains empty; declared scope tables empty.
User support/developer contacts exist. No setting was changed. Runtime OAuth
scope requests are present: empty declaration tables do not mean no permissions.

The Windows proof used an operator-assisted standard-project association and
later revoked the temporary IAM roles. That cannot be expanded into unattended
onboarding merely by adding twenty tester addresses. Current owner-only API
execution requires the caller and script to share a standard Cloud project.
See the [official-source design research](google-commercial-onboarding-research.md).

Testing can accommodate a registered pilot of twenty, subject to company policy,
but these scopes' Testing refresh tokens expire after seven days. Studio's 30-day
entitlement does not extend Google authorization. Public production and sensitive
scope verification are separate from a pilot-user list.

## Work packages and completion evidence

| Priority / owner | Work | Required evidence / current state |
| --- | --- | --- |
| P0 Studio + sponsor | Choose managed shared executor versus learner-owned script | Shared executor approved; personal export deferred (DEC-023). Integration remains gated on live two-account isolation. |
| P0 Studio | Local runner/bridge prototype, pin code/version, bind user and approval, preserve unknown-send ledger | Two independent external accounts with zero company IAM; own-Sheet success, cross-Sheet denial and per-user state. Read-only spike and six local checks ready; live proof pending. |
| P0 Product/site owner | Publish product homepage, accurate privacy/deletion policy, support contact; verify company domain | URLs reachable without login and domain ownership verified. Technical disclosure draft below is prepared; publication and legal/retention facts need owner confirmation. |
| P0 Google project owner | Production OAuth project/client, required APIs, branding and least-privilege scope declarations; submit demo and rationale | Separate production and test configuration; submission receipt then Google approval. Never infer approval from a Publish button. |
| P0 Service/Ops | Twenty distinct learner identities, cohort membership, 30-day grants, individual and aggregate budgets, revocation | Dry-run manifest first; no shared instructor token. Sum of exposures fits approved class budget. Actual roster, date and budget not supplied. Existing isolated test cap remains USD3. |
| P0 Studio | Actionable connection recovery | Implemented locally: typed quota/outage, consent, invalid-client/disabled-API/admin-policy errors; private pause/retry/reconnect questions; no destructive reset or auto-send. |
| P1 Studio/site/release | Versioned installer with selected production client, no instructor tokens, update/rollback and support diagnostic | Clean Windows installation plus credential-preserving upgrade. Existing private test installer is not a public production package. |
| P1 Studio + Service | Twenty-participant admission/status concurrency and per-account isolation | Local synthetic failure/load matrix, then two-account external Google transport. Existing instructor20-seat simulation is not twenty real Google connections. |
| P1 Instructor | Pre-class checklist for all twenty actual accounts and managed-domain administrators | Before class: each identity logs in, reads its own synthetic Sheet and completes no-send preview. Track counts/stage only; account list stays protected. |
| P1 Product/operator | Revoke/disconnect/export/delete/support and cancellation ownership | Disconnection behavior documented; deletion/retention rules implemented and checked. Current disconnect is not deletion of Google scripts, messages or store content. |
| Release owner | PR review, approved merge/deploy, production smoke and rollback | Current request authorizes preparation/implementation, not previously excluded general rollout. No extra email without exact approval. |

Dependencies: architecture spike → stable data/scopes → final policy/demo →
Google review → limited pilot → commercial release. Domain/policy drafts and
local recovery/concurrency work can proceed while the approved architecture is verified.
Engineering estimate, not a commitment: 1–2 days for the narrow two-account
architecture experiment, then 2–4 days for integration/operations/verification
if it succeeds. Google's review and company-admin response time are external;
do not promise that commercial readiness completes in one day.

## OAuth submission preparation

The selected architecture determines the final submitted scopes. Current code:

| Scope | Actual purpose | Narrower-scope decision |
| --- | --- | --- |
| `openid` | Stable subject for account isolation; never display a token to the coach | No profile/email-read scope is needed merely to hash the subject. |
| `spreadsheets.readonly` | Read the user-selected Sheet/range to render exact previews | Broad spreadsheet read permission; consider `drive.file` only with a tested explicit file-grant/picker flow. A pasted URL does not grant file access. |
| `gmail.send` | Send only exact host-approved messages via Gmail REST | Do not add Gmail inbox/read/full-mail scopes for this feature. Receipt inspection during development was an operator test, not an app capability. |
| `script.external_request` | Generated Apps Script calls only Sheets/Gmail HTTPS endpoints | Keep endpoint allowlist; no arbitrary external service or model requests. |
| `script.projects` | Create/read/update learner-owned generated source | Drop from execution-only managed runner consent if authoring is not offered. |
| `script.deployments` | Create/read immutable learner-owned deployment | Same conditional removal; advanced authoring obtains separate consent. |

Demo recording plan: dedicated synthetic identity; English Google consent;
app name/client visible; connect, private Sheet selection, code review/upload
and deployment if applicable, private preview, explicit approved test send,
store transfer without private values, disconnect. Record the chosen commercial
path, not only the older owner-script prototype. No additional send or video
upload has been authorized/performed by this plan.

## Technical privacy disclosure draft — internal, not published policy

- Studio stores Google authorization material in host SecretStorage. The Google
  account subject is hashed for local identity checks. Sheet selection and
  project receipts are host-private. This is not a blanket claim about every
  operating system's protection; production OS storage must be tested.
- Sheet rows and rendered recipient/content previews are handled by the local
  host and Google execution. They are not automatically supplied to the AI.
  A learner may voluntarily paste private data into ordinary conversation;
  onboarding must explain that conversation content follows the model path.
- The Service handles entitlement, metering and allowlisted progress. Store
  recipes exclude tokens, addresses, Sheet/project identifiers and executable
  code. The coach receives aggregate tool results rather than private rows.
- Local send ledgers retain hashed message/account bindings and result status to
  prevent duplicate sends. Google user properties also retain delivery markers.
  Removing a ledger can lose duplicate protection; deletion must stop execution
  and disclose that tradeoff rather than silently resetting unknown sends.
- Disconnect clears local connection credentials; it does not promise revocation
  of all Google grants, deletion of Google scripts, prior messages or recipes.
  Provide separate Google-account access removal and owned-data deletion guidance.
- Before publication, the accountable company must supply actual legal identity,
  public support/deletion contact, retention periods, backup deletion process,
  subprocessors and user-rights procedure. Do not invent those facts or claim a
  complete legal policy from this technical draft.

## Class readiness acceptance

Keep a protected roster keyed by seat (01–20), with separate columns for account
type (Gmail/managed Workspace/non-Google), installer revision, unique grant,
OAuth connected, own-Sheet read, Google preview, policy block, revoked/expired,
last observed time and instructor-visible stage. Do not collect passwords or
share instructor credentials. Never mark an unobserved seat ready.

Run 20-seat Service/host fixtures without paid AI first, including simultaneous
admission, one exhausted learner, cross-cohort recipe denial, expired grant,
stale progress and disconnect. Then two actual external-account smoke paths,
one managed-domain allow/deny case, and the twenty real pre-class logins.
Use synthetic rows and no-send previews; testing twenty accounts does not imply
sending twenty emails. Publishing reusable recipes remains explicit.
