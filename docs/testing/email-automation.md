# Email automation acceptance

Requirement: [EA-01 through EA-11](../requirements/email-automation.md).
Issue #1604. This file defines evidence; it does not claim any test has run.

Automated local checks:

- Google runtime: first consent versus reuse without another connection question,
  valid refresh versus revoked credentials, private Sheet reuse/change,
  PKCE/state/scope, MIME header rejection, limits, account isolation,
  expiry, exact snapshot approval, unknown outcome, duplicates and MCP privacy.
- Controller/client: edit invalidates preview, explicit native confirmation,
  ambiguous network results never enable blind retry, stable publication request ID,
  authorization header, redirect rejection, no secrets in shared payload.
- Conversation: free-text intent, one pending question at a time, choice/free-text
  submission and cancellation, automatic bounded skill save, no manual JSON step,
  private answers absent from model transcript, stale question/account rejection,
  human wait excluded from SDK stall timeout, and saved/previewed/published template
  equality even when the model supplies a different preview recipe.
- React render: inline questions, exact preview, escaped untrusted sheet values, accessible controls,
  disabled duplicate send, clear unattempted and uncertain results. At 360×540,
  selected/unknown access, help, long history, send, stream and idle retain a usable
  message viewport without overlap. Optional rails stay folded across transitions;
  pending questions hide the inactive composer, return-to-question works and clear
  restores input. Required funding selection remains visible.
- Host integration: visible entry, profile opt-in and account binding, permission
  refresh after confirmation, atomic per-learner ledger and cross-window send lock.
- Service: owner/cohort isolation, revoked or wrong-role token denial, schema/size/
  secret validation, concurrent publication cap, retry conflict, unpublish tombstone,
  30-day grant opt-in and preservation of original trial defaults and usage counters.

Commands live in the extension's `test:automation` and Service `test:automations`.
The actual App browser interaction test is
`node test/automation-conversation-ui.browser.mjs` from `extensions/hypeproof-chat`
(after installing the repository's `e2e` Playwright Chromium dependency). It uses
synthetic host messages and proves webview behavior, not a real OAuth or AI turn.
Run extension/webview type checks and builds after integration. Run affected existing
start/profile, SDK permission, Service budget and native-trial checks as regression.

For local Dev OAuth acceptance, use Command Palette →
**운영자: Google Desktop OAuth 설정** after configuring the public Desktop client ID.
Enter the secret only in the native masked input; it must be held in SecretStorage,
scoped to that client ID, and absent from browser URLs, webview/model messages,
settings/profile JSON and shared recipes. Check cancellation, changing client IDs,
and that the command is unavailable in ordinary Studio. Verify browser consent
can outlast the active model budget after the private question card closes; the
OAuth listener itself expires after ten minutes. Optional learner installation
provisioning uses the [explicit external staging procedure](../dev/studio-dev.md#optional-desktop-oauth-application-packaging).
`test/google-desktop-packaging.smoke.mjs` uses synthetic identity to exercise
absent/default packaging, client-ID binding, Web/user-token rejection, private
source permissions, symlinks, overwrite refusal and redacted failures. Host tests
also require Service opt-in, preserve the Dev override and reject a mismatched
package on repeated attempts. Actual credential injection, signed artifact handling
and clean Windows student OAuth remain separate release acceptance.

Release observations, recorded separately:

1. Windows clean learner machine installs without an organization GitHub login.
2. Learner A describes a document-request workflow in the main coach, answers
   questions, saves the skill and connects Google/Sheet without opening a separate
   setup form or transferring JSON. Cancellation sends nothing.
3. A approves the exact displayed emails; a test recipient confirms delivery.
4. Through conversation A publishes only the recipe. Learner B installs it with
   an inline confirmation and runs with different credentials.
5. Another cohort cannot list or retrieve it; unpublish removes future access.
6. A bounded real model authoring run reports model ID, token usage, latency and
   price basis. Distinguish vendor-reported cost from an invoice or subscription fee.
7. Repeated preview and deterministic send paths consume zero model calls.

Use synthetic data and explicitly authorized test recipients. Never record tokens,
real email addresses, source sheet contents or personalized message bodies in CI.
Google verification/admin approval, actual Windows access and provider credentials
are external inputs; missing inputs are BLOCKED/NOT RUN, not a synthetic PASS.

Windows artifacts built at 97b1a065 predate the conversational interaction correction.
Their integrity and shell launch evidence cannot establish this revised acceptance.

## Private one-command Windows installer

Run `pwsh -NoProfile -File scripts/tests/install-email-test-fixture.ps1`.
The fixture executes the production PowerShell manifest/hash/extraction/reuse
functions and uses a fake HTTP transport to exercise status handling. It covers
fixed build/artifact pins, actual changed file bytes, safe extraction versus
traversal/Windows aliases, redirects and authorization errors, running-app refusal,
and receipt-bound rerun preserving unrelated user data. It parses the actual
ASCII installer with the PowerShell parser. This can run on macOS and is not proof
of Windows PowerShell 5.1 behavior, shortcut creation, SDK launch or installation.

On a real Windows x64 PC, copy the command from the private test installation page,
paste into PowerShell, enter the participation code at the hidden prompt, and
verify the separate shortcut/app opens without changing the ordinary Studio app.
The installed app must show the test funding choice and accept the same code.
No GitHub login or manual archive transfer is required. Test interruption/failure
must preserve an existing install; rerun must preserve its workspace and login.
Any OS security restriction must remain visible and must not trigger an automatic
policy bypass. Windows acceptance remains NOT RUN until these observations exist.

Passing `-SdkZip <protected-offline-addon.zip>` additionally runs the actual pinned
SDK tarball through SHA-512 validation and offline extraction in a temporary
APPDATA directory. The fixture compares the pinned integrity with the canonical
seed script and SDK manifest, verifies the runtime marker contract, confirms
idempotent reuse, and refuses an incomplete existing seed. On macOS only the tar
executable path is adapted; the extracted Windows binary is never executed. The
installer uses a minimal offline adapter so ordinary copy/paste installation does
not require an unsigned child `.ps1` or an execution-policy change. Explicit
organization Restricted/AllSigned policy stops the flow.


## Apps Script quests (EA-10/11)

`npm run test:automation` includes the Apps Script adapter, generated-source VM,
host approvals/shared ledger and graph negative controls. The conversation browser
test includes escaped code review, an initially unchecked approval and host-only
response. `test/automation-quest.browser.mjs` checks actual graph rendering at
1280x800 and 360x540, including failed/blocked states and overflow.

Real acceptance requires the opt-in Service/access grant and updated host, new
Google scopes, owned-script creation/upload, standard Cloud project association,
approved private version, synthetic Sheet execution and separately approved send.
Verify the exact version/content, execution user and inbox receipt. Settings opened,
code uploaded, mocked runs and old Gmail API receipts are not this backend's proof.

Windows follow-up (2026-10-14): root verified extension `8844c233` on shell
`682dfd37`, including all seven installed hashes. A distinct Studio participant
installed the original recipe, used its own bot Google account and one-row Sheet,
and created a separate owner-only script/version. Google recorded `hpsPreview`
API success at 09:00:43 KST (1.267 s) and again after restart and temporary IAM
revocation at 09:11:37 KST (2.827 s). The previously missing OAuth tester and
project-role access were explicitly authorized; temporary project roles were
removed and the IAM list read back. Saved credentials and deployment were reused.
At that earlier checkpoint, no additional mail was sent. The later explicitly
approved one-message send and receipt passed; see the final acceptance below. See the [current acceptance audit](../plan/automation-local-acceptance.md)
for local personas, instructor verification, Windows scope and cost accounting.


## Final real Windows send and receipt (2026-10-14)

Extension `463e8529` on shell `682dfd37`, Service `ffef7bc`: seven installed file
hashes matched. Root verified the private recipient/content approval, Google
version-2 `hpsSendApproved` completion at 13:06:22 KST (1.94 s), Studio sent=1 /
unknown=0, and one matching Inbox message with the exact approved subject/body.
Read-only original-script ledger checks established no send attempt from the
earlier failed execution before a new explicit approval. No further send is
permitted by this test approval. This supersedes the historical NOT RUN send
status, without treating local controls as actual email-delivery evidence.

Root reran 68 automation tests, TypeScript/build, the actual bundled SDK
concurrency probe and updater fixtures. The final live flow had no 429. The
[acceptance audit](../plan/automation-local-acceptance.md#final-windows-send-acceptance--2026-10-14)
records the separate settled/held costs, USD 3 ceiling and commercial-onboarding
boundary. PR review/merge and general rollout remain separate.


## Commercial onboarding recovery preparation (2026-10-14)

Root local automation suite: 73/73; typecheck and host build passed. Fetch-driven
controls cover revoked/expired grants, invalid clients, Workspace policy blocks,
quota/API-disabled/scope errors, spoofed machine-code payloads, callback state and
malformed responses. Private host cards distinguish operator intervention, retry
and consent; pause preserves the existing project and blocks stale sending.
No real account, IAM, OAuth publication, Windows package or mail changed in this
follow-up. Console audit observed External/Testing, two test users, empty branding
URLs/domains and empty declared scope tables. The runtime does request scopes;
an empty console declaration is not absence of granted user permissions.

## Shared runner isolation gate (EA-11, DEC-023)

Root ran `node --test scripts/google-runner-probe/probe.test.mjs`: six passed.
These are local safety/contract checks, not live Google identity evidence.
Use a separate immutable no-mail probe, exactly two allowlisted Google subjects,
no company Cloud IAM/script-editor access, separately owned unshared synthetic
Sheets and the same marker namespace. Both own-Sheet calls must succeed; both
cross-Sheet calls must be denied without a cell digest or state mutation. Re-read
the namespace as each user to prove marker separation. An unlisted caller must
fail before Sheet access. Save only redacted receipts outside protected evidence.
Current live status: PASS on 2026-10-14, seven no-mail live calls plus a post-test
lock check. Both callers had no company IAM or script-file access; own-sheet and
identity digests matched, cross-sheet reads were denied, and same-namespace state
remained per-user. The non-allowlisted owner was blocked. See the
[actual evidence](../plan/google-shared-runner-isolation-evidence.md). Installed
Studio integration and shared-runner mail execution remain NOT RUN.

## Shared-runner default (DEC-023)

The current host uses the packaged `resources/google-shared-runner.json` for
Apps Script activities and fails closed when it is absent. No workspace setting,
recipe or model argument can choose a runner. Provision this operator-verified
configuration only in an external installation staging directory; no OAuth
credential, subject allowlist or private account identifier belongs in Git.

Run `node --experimental-strip-types --test test/sharedRunnerRuntime.test.ts`
from the extension and `node --test scripts/google-shared-runner/runner.test.mjs`
from the repository. `test:automation` includes shared host migration and quest
checks. They cover pinned release/caller/recipe validation, no source or deployment
reads by learners, exact approval, cross-account state, changed connection/recipe,
old sent/sending/unknown ledger retention, duplicate suppression and transport
uncertainty. The runtime retains the existing per-account local ledger key; it
never clears ambiguous earlier attempts during migration.

Native acceptance must show a new requirement question reopens previous design
completion, one inline card at a time, saved skill → own Google → private Sheet →
shared preparation → Google preview. Upload/deploy compatibility calls must not
claim a personal project was created. Preview review is not send approval.
Windows acceptance begins only after local native success and uses the same
pinned eight-file update; rollback must remove a newly introduced configuration
while preserving OAuth, SDK and user data. Actual mail remains separately gated.
