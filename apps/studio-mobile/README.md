# Standalone mobile intent MVP

Issue: hypeproof/hypeproof-studio#3644. This mobile-first PWA is an isolated testing surface, not the desktop companion and not an App Store/TestFlight release. It supports iPhone Safari and Android browsers using the same source. Existing native companion branches are untouched.

Run: `node dev.mjs`. Test: `npm test`. Deploy this directory as an isolated Vercel project. No build dependencies, no provider secrets. `api/service.mjs` is a fixed-origin same-site transport to the existing Service `/v1/free/claim` and `/v1/messages` APIs; it cannot mint privileged access or change budgets. Service owns model selection/policy and metering. Client guidance is a user request, never a system-policy override. It is an Anthropic-compatible text client, not an Agent SDK/tool runtime; existing Service route-level SDK labels must not be interpreted as mobile agent execution evidence.

Flow: write an observation → explicit free AI admission (14+) → real chat → manually confirm/revise intent → close and resume → export/delete. No automatic AI-to-human intent promotion. Drafts and records stay in localStorage, credentials in memory only. Browser storage is not secure account sync. Local deletion does not claim remote data erasure. Install identity persists to avoid resetting allowance on record deletion.

The static opening question is labeled separately, never attributed to an AI run. No simulated AI success, generated app, cloud sync, verified philosophical growth, or Foundry deployment claims. Network cancellation can leave incurred Service usage.

Native boundary: no Xcode installed on the development Mac; existing Studio repository secrets have macOS signing only. iOS distribution provisioning and App Store Connect/TestFlight access need confirmation. Home Screen installation is PWA installation, not native acceptance.

Rollback: remove this isolated test deployment or redeploy its previous version. Existing Studio, Service, and Lab production deployments are not changed.

## Requirements

Owner: `jayleekr`, following the existing mobile product-intent owner and the explicit mobile delivery assignment. Parent: `docs/PRODUCT-INTENT.md` (human judgment stays visible, useful work first, minimum necessary intervention). Related Epic #2803 remains open: this standalone entry point does not satisfy desktop-owned companion requirements by substitution.

- MI-01: Start without a desktop or account. Keep observations local until explicit 14+ AI admission. Explain that admission sends the pending thought; closing/Escape cancels that pending request.
- MI-02: Request actual AI questions through existing Service admission and cost limits. Do not simulate AI answers or claim tool execution. Keep projects isolated in request context.
- MI-03: Only explicit human confirmation creates an intent revision. Preserve prior revisions and drafts on reopening; AI responses cannot replace the user's choice.
- MI-04: Keep local records usable when AI refuses or the network fails. Cancel/late responses cannot mutate another or deleted project. No automatic retry of paid work.
- MI-05: Export the latest in-memory draft even after storage write failure. Preserve unreadable storage for recovery. Only show successful individual deletion after the reduced state is saved.
- MI-06: Provide iPhone/Android responsive layout, accessible labels, Home Screen metadata and a cached reading shell. Distinguish browser verification, installed PWA observation and signed native distribution.
- MI-07: Support observation, perspective taking and small actions as revisable design hypotheses. Do not score human worth/growth or claim philosophical efficacy. Foundry execution, financial telemetry, cohorts and cross-device sync remain subsequent work.

## Verification

`node --test test/*.test.mjs` covers persisted human revisions, bounded context, corrupted storage, request validation, Service refusal and upstream disconnect. `test/browser.mjs` exercises consent, manual revisions, reload, cancellation, quota/export/delete recovery and layout with explicitly mocked AI. Use `PLAYWRIGHT_MODULE` for an installed Playwright `index.mjs`; `BROWSER_ENGINE=webkit` selects WebKit, otherwise Chromium. `MOBILE_TEST_ORIGIN` optionally points to the deployment; `MOBILE_TEST_OUTPUT` owns screenshots and reports. Do not call these device or live-model tests.

`HP_MOBILE_TEST_INSTALL_ID=<persistent UUID> node test/live-smoke.mjs` claims/reuses a real free allowance and asks one real question through the deployed proxy. Run via `hype-resource ... --workload remote_ai`. Never rotate test install IDs to reset allowance. No token is printed. Reclaiming can rotate the credential, so only the latest returned token is current. Static browser tests use `local_heavy`; Ubuntu is preferred, with Mac WebKit checks kept local.

## First test deployment

Public test URL: https://hp-studio-mobile-mvp.vercel.app

Open in Safari → Share → Add to Home Screen. Start with one observation, connect free AI, then open **나의 의도** to confirm a direction. Data is per browser/installation; Safari and a Home Screen app may have separate storage. Export before moving between them. Android uses the same URL and browser install menu.

This is a test PWA, not TestFlight/App Store/Play Store availability. iPhone hardware acceptance remains unobserved until someone actually tests on the device. The free allowance is policy-limited, not unlimited. The MVP does not calculate a fictitious margin or cost figure: real Service metering remains server-owned and a customer-facing cost ledger is subsequent work.
