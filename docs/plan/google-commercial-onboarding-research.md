# Google onboarding for twenty independent learners

Research date: 2026-10-14. Design proposal, not a deployment or acceptance claim.
Related: [current implementation](apps-script-quests.md), [verified MVP acceptance](automation-local-acceptance.md).

## Decision in plain terms

The completed Windows self-mail test proves the current email vertical works after an operator binds the learner script to Studio's standard Cloud project. It does not establish self-service onboarding for twenty independent Google accounts.

Do not scale the temporary Project Browser / OAuth Config Editor grants used during the test. Production needs an execution model that does not require learners to administer HypeProof's Cloud project. Adding twenty OAuth test users solves only the OAuth audience gate, not that architecture gap.

Recommendation: investigate a versioned, HypeProof-owned Apps Script execution service with per-user authorization and isolated recipe data as the primary commercial path. Retain learner-owned generated code as an explicit advanced/export path. This keeps conversational creation, the quest graph and Google execution, but changes the existing contract of uploading and running each learner's own generated script. That product change needs an explicit decision; it must not be presented as already agreed or implemented. If learner-owned code is mandatory for the first commercial release, prefer a dedicated per-user web-app feasibility spike before building the full onboarding UI.

## What the official platform establishes

| Fact | Consequence | Source |
|---|---|---|
| `scripts.run` requires an API executable, the full script scopes, and the same standard Cloud project as the calling OAuth client. Service accounts are unsupported. | A default project created with a new learner script is insufficient. A single verified Studio OAuth client does not automatically make every new learner script executable. | [Execution API requirements](https://developers.google.com/apps-script/api/how-tos/execute) |
| Changing a script to an existing standard project requires Project Browser and OAuth Config Editor, or equivalent permissions. | OAuth user consent and Cloud administration are separate. Do not give class attendees these company-project roles. The current API adapter has no project-binding operation. | [Cloud project switching](https://developers.google.com/apps-script/guides/cloud-platform-projects#switch_to_a_different_standard_cloud_project) |
| An API executable can allow authenticated users with `executionApi.access=ANYONE`; `DOMAIN` restricts it to the deployer's domain. | A shared executor has a documented authenticated access setting, but our external-account execution, identity and isolation still require a real spike. This access setting is not proof of an implemented tenant authorization check. | [Manifest access settings](https://developers.google.com/apps-script/manifest/web-app-api-executable) |
| Web apps support `USER_ACCESSING` and `USER_DEPLOYING`. | A browser-mediated web app can run as the learner. Never substitute a company-owner execution identity for sending the learner's email. Browser authorization and new-user authorization rate limits still apply. | [Web-app permissions](https://developers.google.com/apps-script/guides/web#permissions) |
| Apps Script API management access is an account-level opt-in; execution-only requests do not require that management toggle. | A fixed shared runner could avoid asking learners to enable project-management API access, if code creation remains optional. | [API authorization and access](https://developers.google.com/apps-script/api/how-tos/enable) |
| External OAuth Testing allows up to 100 listed test users; its refresh tokens normally expire after seven days for these scopes. Unverified production apps have a separate user cap. | A 20-person pilot can fit the numerical test-user ceiling, but Testing is not a durable monthly subscription onboarding policy. | [Audience](https://support.google.com/cloud/answer/15549945), [token expiry](https://developers.google.com/identity/protocols/oauth2#expiration) |

## Architecture choices

| Option | Learner company-project IAM | Ownership / intent fit | Remaining proof or limitation |
|---|---|---|---|
| Current private API executable per learner | Required for the present self-service binding step | Exact current model: learner-owned generated code, private immutable deployment | Reject as the default commercial onboarding process. A trusted operator could bind shared scripts, but that adds operator access to learner code and manual per-user work; it is not zero-setup. |
| Shared versioned API executable | No learner Cloud role is intended; operator binds one service project | Google executes a fixed reviewed engine with a validated personal recipe; the engine is company-owned | Best first spike for low-friction email automation. Prove caller identity, external Gmail and Workspace access, deployment access and per-user state without code-edit permissions or Cloud IAM. Do not claim this spike has passed. |
| Shared `USER_ACCESSING` web app | No learner Cloud IAM | Same shared engine; real browser runs as learner | More clearly documented execution identity. Requires a secure browser-to-Studio result channel and may leave a browser tab in the workflow. Prove denial/reconnection and Workspace policies. |
| Learner-owned web app / browser bridge | No company Cloud IAM | Best match for code created and deployed in the learner's account | Requires new adapter, initial browser authorization, secure response transport, immutable version checks and private access. A separate script OAuth client may show its own unverified warning; Studio's verified client does not automatically verify it. Public commercial onboarding cannot assume those warnings disappear. |
| Direct Gmail + Sheets APIs | No learner Cloud IAM | Existing simpler path supports conversation and approval; no Apps Script execution | Lowest onboarding complexity but fails the explicit Google-hosted-code requirement. Keep only as an honestly labelled fallback, not a silent replacement. |

A learner-created Cloud project and OAuth client also avoids company IAM, but requires every learner to become a Cloud administrator. It is an advanced bring-your-own-project path, not the default seven-hour class experience.

### Shared executor prerequisites

1. A stable operator-owned standard Cloud project, Desktop OAuth client and script deployment, with required APIs enabled. Maintain ownership in one domain; test migration separately.
2. A deterministic workflow interpreter accepting a validated recipe and runtime inputs. Do not use `eval`, arbitrary generated JavaScript or user-selected remote URLs. Preserve the current narrow email capability before adding categories.
3. Bind approval to recipe digest, immutable engine version, account identity, ordered exact messages and expiry. Keep unknown-send outcomes blocked and retain the original executor provenance for reconciliation.
4. User-scoped locks and ledgers; reject replay across accounts or recipe revisions. Current generated code already uses user properties, but a shared engine needs workflow namespacing and concurrent-session conflict tests. Google documents user properties as isolated to the current user, while script properties are shared. [Properties service](https://developers.google.com/apps-script/guides/properties)
5. Pin engine/version metadata using trusted release configuration. Current owner-only content/deployment reads cannot simply be reused if ordinary callers cannot read project source. Determine actual read access in the spike; do not grant edit access to make integrity checks pass.
6. Limit the backend to participant admission, budgets and redacted status. Keep Google access tokens, sheet rows and message previews on the host / Google execution boundary. The model continues receiving only redacted progress and required questions.
7. Execution-only learner consent should omit `script.projects` and `script.deployments` when those actions are not offered. Export/advanced authoring requests these separately and explicitly.

### Per-user web-app spike prerequisites

Use `USER_ACCESSING` with the narrowest deployment access that permits the owner workflow, rather than an anonymous company-authority endpoint. The manifest schema supports access/identity choices, but the exact owner-only deployment flow has not been tested here. Establish the browser authorization and secure callback protocol before replacing `scripts.run` calls. A normal Desktop bearer token plus HTTP POST must not be assumed to satisfy browser-cookie authorization or redirect behavior.

Verify that newly generated versions preserve account identity and approval binding; never put tokens, recipient lists or executable commands in launch URLs. Do not expose an unauthenticated endpoint protected only by a reusable URL secret. Use a short-lived authenticated session, replay protection and a reviewed callback mechanism. Project-specific OAuth verification and Workspace policy restrictions remain launch gates even if code upload and browser preview succeed.

## Commercial OAuth package

Current email code requests `spreadsheets.readonly`, `gmail.send`, `script.external_request`; authoring additionally requests `script.projects` and `script.deployments`. `gmail.send` and `spreadsheets.readonly` are sensitive, not unrestricted sign-in scopes. Gmail send-only does not require mailbox-read scopes. Sheets documents `drive.file` as a narrower per-file alternative, but adopting it requires a working explicit file selection flow and separate behavior tests; a URL textbox alone is not evidence of a file grant. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)

Prepare:

- Verified company domain, public product homepage, privacy/data-deletion policy, support contact and matching branding.
- Explicit data inventory: locally stored Google tokens; host/Google-only sheet and recipient data; Service participant/progress/budget metadata; shared store recipes stripped of personal inputs; retention and deletion behavior.
- Scope-by-scope justification tied to actual screens, current implementation and a narrower-scope analysis. Confirm final classification in Google Verification Center rather than guessing authoring-scope classifications.
- An English demonstration of the complete OAuth grant and each requested sensitive capability, using de-identified evidence and a dedicated test identity. Submit the actual selected architecture, not a video of the different owner-only prototype.
- Separate production branding/data-access verification and publication from the pilot test-user list. The mixed-company class is not covered by the same-Workspace-domain internal-app exception. Track submitted, feedback requested, approved and published separately. No guaranteed review completion date.

Sources: [Apps Script verification](https://developers.google.com/apps-script/guides/client-verification), [sensitive-scope submission requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

## Smallest meaningful live acceptance set

Run locally first. Use existing approved test identities; do not send new mail without exact recipient/content approval.

1. Fresh external Gmail identity with no company Cloud roles: connect, choose own Sheet, preview; assert the sender identity and no operator-owned data access.
2. Independent second identity: reuse the same store recipe, operate its own Sheet, ensure both previews and send ledgers remain isolated. Attempt cross-account replay and deny it.
3. Managed Workspace identity: admin-allowed success and admin-denied explanation. An address using a company domain alone is not evidence it uses Google Workspace.
4. Revoke a required scope, expire/replace token, switch account, restart app, replay approval, lose a send response. Recover with explicit state; never auto-resend an unknown outcome.
5. Twenty synthetic participants for admission/budget/status concurrency; a small real account sample for Google policy and transport. Then perform the actual twenty-account pre-class login check. Synthetic identities cannot prove Google authorization for twenty real people.

Current Apps Script limits include six minutes per execution, thirty simultaneous executions per user and one thousand per script; other per-user and underlying API quotas also apply. These published ceilings are not a throughput test. The current implementation uses Gmail REST through URL Fetch, so do not price or cap it solely using MailApp daily-recipient limits. Observe the actual API errors and stop safely. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)

## Work that can proceed before external approval

Locally implement provider-neutral onboarding state and actionable missing-permission recovery; separate execution scopes from authoring scopes; prepare the verification package and the tenant-isolation fixtures; draft the chosen runner/bridge behind an off-by-default capability. Preparing these does not authorize publishing a new shared endpoint, accepting Google terms, sharing learner code or broadening Cloud IAM. The first blocker to resolve is the execution architecture spike, followed by real external-account acceptance and Google's review. No new cloud state or mail was changed during this research.
