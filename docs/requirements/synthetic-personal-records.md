## Synthetic personal records — REA W02 partial (local only)

`ST-REQ-SYNTHETIC-PERSONAL-RECORDS` is the bounded consumer contract for
Studio #2832, under Service #197 and dependent on Studio #2811 / Service #205
(draft Service PR #206). It prepares only SCONT-R02/R03/R04/R05/R07/R08 from
approved REA v0.4, SHA256
`b26c7915e9a60d94f844e2d9a48981f214266c463786ec5fc6f91a0b6afde927`.
The existing personal-account domain owner `jayleekr` remains the owner of the
new REQ/TEST/IMP nodes. Full W02, real ownership/import, mobile editing and all
primary REA acceptance remain open. This is not automatic or bidirectional sync.

- **Admission.** The actual StartPage personal-project panel exposes the prototype
  only in a Development/Test extension host with explicit machine setting
  `hypeproofChat.personalRecordsPreview=true`, signed-in existing AccountSession
  and matching HTTP loopback Service/account-site addresses. Default, production
  extension hosts and non-loopback settings expose no record UI or requests. The
  Service also independently hard-disables record admission in production.
- **Sole source.** A labelled host-owned factory generates fixed synthetic
  messages and one optional synthetic HTML file. The person explicitly selects
  that file. No arbitrary task, path, transcript or file bytes can enter the
  source factory. Existing TaskWorkspaceStore, visible/hidden history, drafts,
  queued requests, class/organization assets and work folders are never read or
  imported. Filesystem access, a participation code, AI provenance and login are
  not treated as proof that an existing source belongs to this account.
- **Preview and storage confirmation.** Before any record write, show the current
  account, exact canonical local receiving Service, selected personal project,
  ordered message text, selected file text/name/size, file SHA256 and canonical
  manifest SHA256. Use dedicated storage disclosure, not the generic AI/memory
  disclosure. The app confirmation binds the captured source/destination/digest
  through one nonce; cancellation, changed selection, account, Service or project
  invalidates that preview. The webview supplies intents, never credentials or a
  replacement transcript. Storage does not run AI, activate a pass or publish.
- **Durable explicit retry.** Before the first HTTP write, atomically persist the
  exact mutation, manifest, consent and selected bytes in a separate mode-0600
  outbox scoped to account + canonical Service + workspace + project. Reuse the
  existing crash-recoverable cross-process lock. No credentials are persisted.
  One pending intent cannot be replaced by another. Restart loads it without
  uploading; only explicit retry sends the same bytes/key/digest. A completed
  stage replay after a lost completion reply verifies the identical receipt and
  acknowledges it without PUTing the immutable object again. Corrupt pending
  originals are preserved and reported; notice mismatch is actionable and never
  automatically reauthorizes old consent.
- **Read-only access.** Explicit list/detail loads only completed records; empty
  lists and unavailable/auth/integrity conditions are visible. Validate scope,
  revision, manifest digest and artifact descriptors. Display all text escaped,
  with no iframe, HTML execution, composer or local task overwrite. Download
  authenticates again and verifies exact byte length/hash plus attachment,
  no-store and nosniff headers before an explicit save destination. Exclusive
  creation never silently replaces an existing file. Recheck identity after the
  picker and preserve unrelated files if cancellation happens while writing.
- **Account lifecycle.** Account/Service/project changes fence late callbacks and
  clear displayed records/preview. Logout clears before remote revocation; an
  HTTP401 clears private cloud views immediately. Owner-scoped pending recovery
  stays on disk and is visible only after that same context is selected again.
  There is no timer, background synchronization or retry after logout.
- **Versioned dependency.** The combined client requires exact literal
  `account-api@3` using the existing capability namespace; the original
  `studio-api` package/surface pins remain mandatory. Service3 retains lines2/1
  and requires additive migration0062 as well as0061. Older Service2 must fail
  consumer dependency resolution; matched3+0062 must pass the canonical projected
  ledger fixture. A capability declaration does not activate this prototype in
  production. Fixture decoder bounds are test-only guards, not customer quotas.

Implementation: new `src/personalRecords.ts`, `personalRecordStore.ts`,
`personalRecordFixture.ts`, `personalRecordTypes.ts`, `personalRecordHost.ts`,
plus narrow StartPage/PersonalSpace wiring. No ChatPanel/provider/tasks rewrite.
Focused checks: `npm run test:personal-records`,
`node scripts/run-tsx-tests.mjs personal-records-render`, and
`FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/personal-records-browser.smoke.mjs`
under `extensions/hypeproof-chat`. The browser test drives the real StartPage
entry with host-state fixtures; it is not a native app or Service integration.
The separate actual-controller localhost Hono/local-D1/recording-R2 proof covers
producer exit, independent reading/download and a lost completion reply followed
by new-process recovery. Any UI-to-Service bridge evidence is recorded separately.
Real native dialogs, installed-app/mobile behavior, live accounts/customer data,
production migration/deployment, retention policy and full sync remain **NOT RUN**.
