# Conversational automation quests on Google Apps Script

Approved direction: TJ, 2026-10-13. Extends Epic #1603 / implementation #1604.
Status: implemented locally behind an explicit new capability; live Google and
Windows acceptance pending. This is the email vertical, not arbitrary code authoring.

The learner describes a task in the existing conversation. The coach proposes a
small dependency graph in the existing editor/game preview area and asks one
missing question at a time. Host-observed results advance the quest. The model
cannot mark a step complete. The graph survives turns in the active activity;
restarting the host requires a fresh plan rather than replaying old success claims.

A validated email recipe generates deterministic Apps Script source. The learner
reviews code and scopes, permits upload to a Studio-created project in their
account, then approves an immutable, owner-only API executable version. Preview
executes on Google and returns actual messages only to the private host. Sending
requires a separate exact-message approval. Unknown outcomes are not retried.
Store publish/install transfers the inert recipe; another learner connects their
own account and creates their own script. Recipient records, credentials, project
identifiers and executable code are excluded from the store.

## Ownership and permissions

Studio owns graph rendering, question cards, OAuth, private project receipts,
generated source, cross-window locks and the shared Gmail/Apps Script send ledger.
Service owns `automations.appsScript` and the metered `apps_script` feature; both
are required. Current ordinary/email profiles remain opted out. One expanded Google
connection is reused for both paths in opted-in activities. Existing narrow consent
is not silently treated as permission to manage scripts.

Private versions use `executionApi.access=MYSELF`, fixed function names,
`devMode=false`, approved content hashes and checked deployment versions. No public
web app, trigger, automatic mail, Cloud IAM grant or normal Studio rollout is made.

## Google onboarding constraint

The [Apps Script execution API](https://developers.google.com/apps-script/api/how-tos/execute)
requires the script and caller OAuth client to share a **standard** Google Cloud
project. An API-created script starts with a default project; code upload alone
does not satisfy execution requirements. The API must also be enabled in Cloud
and the user's Apps Script dashboard must permit API access. The API surface used
here has no project-binding operation. Setup opens Google settings; only a real
execution establishes success. Company administrators can impose further limits.

This prototype is not yet a zero-setup twenty-person rollout. Do not grant learners
editor access to Studio's Cloud project to hide this gap. Before class acceptance,
verify an operator-assisted private-project binding process or separately review
a shared executable architecture. The latter changes code ownership/sharing and
is not silently substituted here.

## Cost and evidence

Deterministic execution makes zero model requests but consumes Google quotas.
Authoring and further coach turns still consume Studio tokens. The existing direct
Gmail path also makes no per-recipient model calls, so moving execution does not
by itself establish additional AI savings. No paid resource or billing plan was
provisioned. Actual new-backend cost and latency remain unmeasured.

Adapter fixtures execute generated source against synthetic Google services.
Host tests cover approvals, changed recipes, revoked grants and the shared ledger.
SDK tests check profile and runtime grants. Chromium renders the conversation and
graph at narrow/wide sizes. None proves live Google execution, mail receipt or
Windows acceptance. This feature requires a host extension update; the earlier
two-file UI hotfix is insufficient.
