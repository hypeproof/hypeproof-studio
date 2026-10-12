# Cohort email automation workshop

Status: approved implementation scope, not released. Human sponsor: TJ.
Source: user decisions on 2026-10-13; Epic #1603; execution #1604.
Parent: PRODUCT-INTENT.md, useful work first and human judgment stays visible.

Twenty office workers install Studio during a seven-hour Windows workshop. They
adapt a document-request email recipe, read their own Google Sheet, inspect every
recipient and message, send while their PC runs, then publish a reusable recipe.
Another member of that cohort installs it and runs against their own account and
data. Other corporate mail providers are explicitly deferred. The latest human
instruction sets the follow-up trial to one month, implemented as 30 days.

| ID | Required observable behavior |
| --- | --- |
| EA-01 | A visible Studio entry opens the email automation surface only with a Service-granted automation capability; old profiles remain unchanged. |
| EA-02 | Google desktop PKCE login uses the system browser, checks callback state and stores credentials outside the webview, source files and recipes. |
| EA-03 | A learner selects a Sheet and range, edits the name/document/deadline template and sees the exact rendered recipients, subjects and plain-text bodies. Sheet cells are data, never executable instructions. |
| EA-04 | Sending requires confirmation of the current immutable preview. Editing, importing, expiry, account change or a stale preview cannot reuse approval. No background or scheduled sending. |
| EA-05 | Sending is serialized across windows; durable per-account results prevent automatic resend after a timeout, lost response or crash. Unattempted, failed, unknown and confirmed sent are distinguishable. |
| EA-06 | Store publish previews the exact bounded recipe; credentials, recipient records, Sheet IDs and executable code are excluded. Listing, detail and download enforce the authenticated cohort; unpublish requires ownership. |
| EA-07 | Installed recipes require the recipient's own Google connection and Sheet. Recipe data never adds runtime permissions. Stable learner identity is independent of trial or paid entitlement. |
| EA-08 | The workshop uses a dedicated 30-day bounded grant, preserving the existing one-hour trial default. AI usage and configured spending limits are server-enforced; deterministic rendering and sending make no model requests. Usage observations and monetary estimates are distinguished. |
| EA-09 | A real Windows installation and two distinct learners' publish/import/run flow are required release evidence. Provider fixtures, a webview build and an app launch do not prove Google delivery or Windows acceptance. |

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
