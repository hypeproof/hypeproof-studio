# Shared Google runner: real two-account isolation

Date: 2026-10-14. Decision: DEC-023 / EA-11. Source: Studio `68c37857`,
`scripts/google-runner-probe/`. Root performed the actual Google calls; these are
not the subagent's simulated results. No mail was sent and no paid AI was called.

## Setup observed

One company-owned Apps Script API executable, immutable version1, was associated
with the Studio standard Cloud project. Both independent Google callers used the
same Studio Desktop OAuth client with only `openid`, `spreadsheets.readonly` and
`script.external_request`. Two distinct subject hashes were configured privately.
Google Cloud IAM showed one company owner only. The script file's sharing dialog
showed restricted access and one owner only. Neither test user was granted company
IAM, script editing or file viewing permission. Their separate synthetic Sheets
were each visibly private to their owner.

The caller identity came from `ScriptApp.getOAuthToken()` and Google userinfo,
not request input. The same token performed the Sheets read. The operator compared
uploaded and version-pinned source/manifest before deployment. The remote result
was compared locally with the independently obtained caller subject and known
synthetic A1 value, without publishing private IDs, tokens or account addresses.

## Actual results

| Invocation | Google result | Assertion |
| --- | --- | --- |
| A reads own Sheet and writes synthetic marker | HTTP200 / done / ok | Caller and cell digests match; previous marker absent |
| B reads own Sheet, same namespace | HTTP200 / done / ok | Different caller/value match; previous marker absent |
| A reads B's private Sheet | HTTP200 / done / sheet_access_denied | No cell digest returned |
| B reads A's private Sheet | HTTP200 / done / sheet_access_denied | No cell digest returned |
| A re-reads own Sheet and state | HTTP200 / done / ok | Only A's marker retained after the denied access |
| B re-reads own Sheet and state | HTTP200 / done / ok | Only B's marker retained after the denied access |
| Company owner outside allowlist | HTTP200 / done / caller_not_allowed | No Sheet value or state returned |
| Post-test disabled allowlist | HTTP200 / done / not_configured | Data operations locked after collection |

Root additionally passed six local tests covering identity spoofing, malformed
configuration, cross-account state, quota/lock/error behavior and absence of mail
capabilities. Local tests do not stand in for the live calls above. CI for source
`68c37857` passed17/17.

Raw receipts and account bindings stay in protected local storage. The redacted
acceptance is recorded under `sharedRunnerIsolation20261014` in the local MVP
acceptance record and in the dated vault result artifact. Probe deployment is
retained but fail-closed; its allowlist was emptied after the test. Registered
OAuth testers and consent remain; no company IAM was added.

## Studio integration acceptance — 2026-10-14

Studio now defaults to the operator-pinned execution-only runner. Missing or
untrusted packaged configuration fails closed; no learner-owned script fallback
or project-management consent is requested. The shared host preserves the legacy
per-account message ledger and requires a separate exact private approval for
sending. Recipe/account/release changes invalidate pending previews.

Root exercised the native local app with the real subscription-backed coach:
business question, tone question, skill save, private Google connection and Sheet
selection, shared prepare, actual Google preview of one synthetic recipient, and
read-only preview acknowledgement. The graph progressed to 6/6 and the composer
returned without an outstanding question card. Changing an earlier answer resets
its dependent graph evidence. No personal script creation, source upload, Cloud
IAM or deployment setup was required. No mail was sent.

Two integration defects found during native testing were fixed: a host-only Sheet
connection field was stripped from the strict runner payload, and a new business
question invalidates the preceding skill's completion state. Deterministic checks
cover identity/recipe/approval binding, cancelled and stale confirmations,
ambiguous delivery, existing ledgers, and cross-account state. These checks do not
prove real mail delivery. The earlier two-account live probe above remains
separate from this native single-account integration acceptance.

Windows acceptance completed on 2026-10-15 KST with source `ab0a13a7` on the
existing `682dfd37` shell. Root updated the installed test app through the
authenticated installer, checked all eight installed file SHA256 values, and used
the native Windows conversation to reuse its existing imported skill, Google
connection and private Sheet. The shared runner returned one real preview with no
OAuth repetition or personal project setup. Read-only acknowledgement completed
the graph at 6/6 and restored the composer. No mail was sent. The single acceptance
conversation added USD0.057188 to the settled token ledger; unresolved reservations
remained unchanged. This is a Service ledger amount, not invoice confirmation.

The source-only Service prompt update is `a50be76`; the isolated backend remains
`ffef7bc`. The installed Studio SDK capability override selects the shared flow.
Only the authenticated download gateway was updated, with no normal-traffic rollout.

Production OAuth review,
managed-domain policy, quotas and twenty actual pre-class logins remain separate
gates. Personal Apps Script export is deferred. Real mail needs fresh explicit
approval of the exact recipient and content.
