# Email automation acceptance

Requirement: [EA-01 through EA-09](../requirements/email-automation.md).
Issue #1604. This file defines evidence; it does not claim any test has run.

Automated local checks:

- Google runtime: PKCE/state/scope, MIME header rejection, limits, account isolation,
  expiry, exact snapshot approval, unknown outcome, duplicates and MCP privacy.
- Controller/client: edit invalidates preview, explicit native confirmation,
  ambiguous network results never enable blind retry, stable publication request ID,
  authorization header, redirect rejection, no secrets in shared payload.
- React render: exact preview, escaped untrusted sheet values, accessible controls,
  disabled duplicate send, clear unattempted and uncertain results.
- Host integration: visible entry, profile opt-in and account binding, permission
  refresh after confirmation, atomic per-learner ledger and cross-window send lock.
- Service: owner/cohort isolation, revoked or wrong-role token denial, schema/size/
  secret validation, concurrent publication cap, retry conflict, unpublish tombstone,
  30-day grant opt-in and preservation of original trial defaults and usage counters.

Commands live in the extension's `test:automation` and Service `test:automations`.
Run extension/webview type checks and builds after integration. Run affected existing
start/profile, SDK permission, Service budget and native-trial checks as regression.

Release observations, recorded separately:

1. Windows clean learner machine installs without an organization GitHub login.
2. Learner A connects Google and reads a synthetic Sheet. Cancellation sends nothing.
3. A approves the exact displayed emails; a test recipient confirms delivery.
4. A publishes only the recipe. Learner B imports and runs with different credentials.
5. Another cohort cannot list or retrieve it; unpublish removes future access.
6. A bounded real model authoring run reports model ID, token usage, latency and
   price basis. Distinguish vendor-reported cost from an invoice or subscription fee.
7. Repeated preview and deterministic send paths consume zero model calls.

Use synthetic data and explicitly authorized test recipients. Never record tokens,
real email addresses, source sheet contents or personalized message bodies in CI.
Google verification/admin approval, actual Windows access and provider credentials
are external inputs; missing inputs are BLOCKED/NOT RUN, not a synthetic PASS.
