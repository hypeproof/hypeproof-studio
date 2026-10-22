---
name: hype-release
description: Prepare, build, resume or hand off a HypeProof Studio RC; collect exact package evidence, generate the test report, and check signed promotion readiness. Use for rotating release managers and interrupted release operations. Ordinary feature implementation uses hype-deliver; independent acceptance uses hype-verify.
---

# HypeProof release manager

Own one pinned RC through test delivery and handoff. Read the repository's release
policy and [the operating contract](references/workflow.md). Use existing Studio
build-contract and signed release-engine interfaces; do not implement another
approval engine or call a draft a stable customer update.

1. Inspect active work, candidate source SHA, explicit source PRs, final version,
   immutable RC tag, test revision and current release owner. Preserve other work.
2. Resolve the shared helper: `scripts/hype-release/release.py` in the Harness or
   synced repository; global Codex installs also include `runtime/release.py` beside
   this skill. Python 3.11+, Git and authenticated `gh` are required. Studio build
   contract/approval checks additionally require the product's supported Node runtime.
3. Initialize or resume the candidate using the current policy and a shared
   HypeProof state repository. Remote identity comes from `gh`; never substitute a
   teammate's token. `status` first, then reconcile UNKNOWN operations before acting.
4. Prepare explicit PR membership. Plan the exact operation and bind its current
   cost quote to the returned request digest. Include both platforms, retries and
   storage where applicable. An unknown allowance is not USD 0. Total committed or
   observed incremental cost must stay below USD 1. The helper calls no models.
5. Build once via the existing managed annotated tag. Do not also dispatch workflows.
   A lost response is UNKNOWN: observe the exact tag/run before any retry. A failed
   run may use bounded `retry-build`, followed by `reconcile` when its attempt advances.
6. Collect successful Mac/Windows receipts and the exact bytes. Compare digest + size
   uniquely when GitHub normalizes filenames. CI success is not an installed-app,
   certificate trust, functional login, UX or human-acceptance verdict.
7. Prepare actual test access before asking someone to test. Confirm the Service URL,
   supported profile, individual participation code, expiry and allowance. Do not put
   codes, issuer/admin credentials, signing keys or customer logs in shared state,
   screenshots, reports or Git. Use existing issuance and authorization; don't bypass
   a blocked API or copy another person's credential. A fresh RC profile needs its own
   explicit connection. Record unavailable access as BLOCKED, not test-ready.
8. Run independent `hype-verify` for the claim's full evidence identity. Native app
   rendering inherits the installed theme: a white browser fixture does not prove a
   matching native default. Test actual color, button geometry, history, composition,
   streaming/stop/retry, source-panel return and persistence when these claims change.
9. Record checks and failures; `ticket` deduplicates a sanitized failure record. Treat
   FAIL as product investigation, BLOCKED as access/environment investigation. Changing
   a rubric requires an explicit requirement revision, not relaxing a failing test.
10. Update draft notes first, refresh release metadata by numeric release ID, generate
    the report, then upload only generated support documents. Never replace package
    bytes or silently clobber existing reports. The fresh returned draft URL is canonical.
11. Before `promote-check`, run the release dependency check from the canonical
    Harness checkout: `scripts/release-deps/release_deps.py check --candidate
    studio=<candidate sha> --fact hypeproof-studio-db=<live D1 head> --json`
    (add `--client-versions` when an authorized telemetry export exists). Only exit 0
    (PASS) may proceed. FAIL names the unmet contract; BLOCKED names what could not be
    read. Keep the JSON as release evidence and record it with `check`. Details:
    [release dependency check](references/workflow.md#release-dependency-check).
12. Hand off with owner, state revision, open gates, evidence and next action. The next
    manager reads the same shared state and supplies their own authenticated account.
    Ownership does not transfer human approval; expired/superseded approval must be
    checked by the product engine. Use `promote-check` and the existing authorized
    publisher; it must revalidate immediately before publication. This helper does not
    publish stable releases or grant approval.

Use the user's authorized scope without repetitive permission questions. A technical
or policy block needs its exact source and the concrete prepared action. Never invent
PASS, approval, credentials, $0 final billing, or completion of an unobserved test.
Keep engineering records in English and the user-facing report in Korean.
