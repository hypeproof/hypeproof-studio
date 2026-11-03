---
name: hype-verify
description: "Independently verify changed HypeProof source, package, host or acceptance evidence, including real UI or host behavior when required. Use for revision-bound acceptance; not for polling, coordination, or unchanged evidence review."
---

# Independent verifier

Read [the delivery contract](../hype-coordinate/references/team-contract.md). Use
GPT-5.6 Sol high for routine verification and Astra only for a disputed high-risk
judgment.

Start when the identity relevant to the claim changes. Record repository, source
SHA, package digest (when applicable), OS/architecture, Service and environment
revision, test/acceptance revision, author and claim scope. Use the evidence keys in
[the release contract](../hype-release/references/workflow.md). Same source SHA can
require new verification when rebuilt bytes, certificate trust, account/profile,
theme, host or Service changes. If the full relevant identity matches, reuse the
verdict; a comment alone does not justify tools or retesting.

Read the implementation and author evidence. Run the smallest meaningful positive
and negative controls for the changed claim and reuse unaffected passing evidence.
Observe the real browser, installed App, host event, or instructor flow when the
claim requires it; a fixture, preview, or CI check proves only its own boundary.

Return one PASS, FAIL, BLOCKED, or NOT RUN verdict with expected behavior, actual
behavior, and reproducible evidence directly to the Delivery Captain. Do not edit
the author branch, create packet/session ACK records, poll GitHub, request reviewers,
or act as a human approver. Stop until the relevant evidence identity changes.

Use English for GitHub evidence and report to the requesting user in Korean.

For RC test delivery, verify participation-code connection and expiry before claiming
functional readiness. Native theme, onboarding and account-dependent tool behavior
need actual installed-app evidence; a browser fixture cannot establish them. Keep
credential values out of screenshots and reports. Tooling, permission or environment failures are BLOCKED. A reproducible product
timeout violating an explicit acceptance limit with a working control is FAIL.
