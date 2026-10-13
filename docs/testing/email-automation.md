# Email automation acceptance

Requirement: [EA-01 through EA-09](../requirements/email-automation.md).
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
  disabled duplicate send, clear unattempted and uncertain results.
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
