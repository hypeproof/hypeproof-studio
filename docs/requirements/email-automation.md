# Cohort email automation workshop

Status: approved implementation scope, not released. Human sponsor: TJ.
Source: user decisions on 2026-10-13; Epic #1603; execution #1604.
Parent: PRODUCT-INTENT.md, useful work first and human judgment stays visible.

Twenty office workers install Studio during a seven-hour Windows workshop. They
describe their work in the main coach conversation. The coach asks one relevant
user question at a time and creates a bounded reusable skill. Learners connect
their own Google account and Sheet through private inline questions, inspect every
recipient and message, send while their PC runs, then publish a reusable recipe.
Another member of that cohort installs it and runs against their own account and
data. Other corporate mail providers are explicitly deferred. The latest human
instruction sets the follow-up trial to one month, implemented as 30 days.

| ID | Required observable behavior |
| --- | --- |
| EA-01 | The main coach conversation is the primary automation entry. Free-text intent leads to relevant one-at-a-time questions and a saved bounded skill without a separate form or manual JSON transfer. Optional classroom help and model/usage controls stay folded during ordinary conversation and never displace the message viewport or composer, including sending/streaming/question transitions in a short sidebar. Required funding selection remains directly reachable. Service-granted capability gates every tool; old profiles remain unchanged. |
| EA-02 | Google desktop PKCE login uses the system browser, checks callback state and stores credentials outside the webview, source files and recipes. A learner grants Google access once; valid credentials and refresh tokens are reused for subsequent MCP operations. Reconnect only when access is missing/revoked or new scopes are needed. Existing private Sheet setup is reused unless the learner requests a change. Default builds include no client identity; an operator may explicitly package a Desktop client from a protected external file into an application-owned resource, bound to the authorized client ID. Students consent without entering keys; Web credentials and personal tokens are rejected. |
| EA-03 | An active inline question replaces the inactive composer with a return-to-question control; clearing the question restores normal input. Inline user questions collect only missing setup, with explicit submit/cancel and no pre-approved choice. Google connection and Sheet/range inputs stay host-private. Public question tools reject explicit requests for account values or Sheet URLs and direct the coach to the dedicated private setup tool; labelling a public question private never changes its privacy. Apps Script activities reject legacy local-preview/direct-send execution and route the coach to the Apps Script run tool. The learner can revise the template conversationally through an explicit skill save and sees exact recipients, subjects and plain-text bodies before sending. Conversation execution and publication use that same saved skill; a model-supplied preview recipe cannot silently replace it. Sheet cells are data, never instructions. |
| EA-04 | Sending requires confirmation of the current immutable preview. Editing, importing, expiry, account change or a stale preview cannot reuse approval. No background or scheduled sending. |
| EA-05 | Sending is serialized across windows; durable per-account results prevent automatic resend after a timeout, lost response or crash. Unattempted, failed, unknown and confirmed sent are distinguishable. |
| EA-06 | Conversation-driven store publish/install uses explicit inline confirmation and previews the exact bounded recipe; credentials, recipient records, Sheet IDs and executable code are excluded. Listing, detail and download enforce the authenticated cohort; unpublish requires ownership. |
| EA-07 | Installed recipes require the recipient's own Google connection and Sheet. Recipe data never adds runtime permissions. Stable learner identity is independent of trial or paid entitlement. |
| EA-08 | The workshop uses a dedicated 30-day bounded grant, preserving the existing one-hour trial default. AI usage and configured spending limits are server-enforced; deterministic rendering and sending make no model requests. Usage observations and monetary estimates are distinguished. |
| EA-10 | The graphics area displays the conversational workflow dependency graph. Only host-observed outcomes advance stages; cancelled, blocked, stale and failed actions cannot appear complete. A successful authenticated private Sheet read restores observed connection evidence when reusing a saved skill. |
| EA-11 | An explicit Apps Script grant permits bounded email source generation, separate code-upload and private immutable-deployment approvals, then Google preview and exact-approved send. Changed accounts/code/deployments and prior Gmail or Apps Script attempts cannot reuse approval or automatically resend. Same-standard-project and API-access setup blockers remain visible. |
| EA-09 | A real Windows installation and two distinct learners' publish/import/run flow are required release evidence. Provider fixtures, a webview build and an app launch do not prove Google delivery or Windows acceptance. |

The sponsor corrected the primary interaction on 2026-10-13: conversation first,
not a standalone automation form or a fixed wizard. The optional inspector must
not be required for skill creation, connection, setup, preview or sharing. Pending
questions are bound to their active request/account and cancelled on stale activity;
human wait time must not trigger an SDK stall timeout.

AI authoring uses the existing coach with only a reusable template and the learner's
stated purpose. Neither sheet rows nor rendered personal emails are automatically
sent to a model. Managed MCP tools return only counts, header names and aggregate
send status, and host confirmation displays the actual preview to the human.

Scope excludes public discovery, ratings, seller payouts, monthly auto-billing,
arbitrary MCP servers, arbitrary script packages, attachments and non-Google mail.
The category structure starts with email; other categories must not pretend to run.

Implementation belongs to Studio host/webview, Service APIs and profile policy,
Ops canonical migration, and the existing release pipeline. No new product repo.
Verification contract: [email automation tests](../testing/email-automation.md).

Private Windows acceptance installation uses the same website-copy / PowerShell
paste interaction as the normal product installation (human correction,
2026-10-13). `scripts/install-email-test.ps1` pins the existing tested application
and offline SDK artifacts; it does not replace the production installer or public
release. The participation code is entered in a masked prompt and sent only to
the exact test origin. Files require authorization, direct HTTP 200, exact size
and SHA-256 before extraction or execution. A separate versioned user directory
and desktop shortcut preserve an ordinary Studio installation. Unknown existing
folders, running test apps and unsafe archive paths stop installation. Matching
receipts permit rerun without replacing user data. No code is placed in command
history, settings, shortcuts or logs. OS security policy remains in effect.

A private UI-only hotfix may update exactly the tested base build's two webview
assets through the same authenticated copy/paste flow. The updater checks the
base installation receipt, packaged commit/version, original file hashes and
pinned download before replacing anything. It refuses running apps and unknown
local modifications, backs up the original files and rolls back caught failures.
User data, Google credentials, SDK and the ordinary Studio installation stay intact.

The Apps Script direction and rollout boundaries are in
[conversational quests](../plan/apps-script-quests.md). Arbitrary executable code
remains excluded; this slice compiles the saved bounded email recipe.
