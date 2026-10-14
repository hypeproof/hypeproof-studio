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

## Integration still required

The installed Studio still uses the previously accepted owner-script path. Before
switching its default, implement an execution-only adapter that accepts only the
operator-pinned runner/deployment, validates the response contract, and binds every
preview and exact user approval to caller, saved recipe and runner version. Keep
per-user durable send state across version upgrades; an unknown earlier send must
not become eligible merely because the runner changed. Do not require source-read
or project-management scopes from learners. Distribution and rollback must pin an
operator-verified configuration; an untrusted recipe cannot select a runner.

Production scope consent, managed-domain policy, Gmail send behavior, source update
review, quotas and twenty actual pre-class logins remain separate gates. The probe
is not a production recipe executor and cannot run learner-supplied code. Personal
Apps Script export is deferred. Real mail needs fresh explicit approval of the
exact recipient and content.
