# Shared Google runner isolation spike

This is a bounded read-only probe, not a mail runner or a commercial deployment.
It reads only cell `A1` of a caller-selected Sheet, returns a SHA-256 digest of
the cell value, and retains synthetic markers in Apps Script UserProperties.
It cannot send mail, write Sheets, run supplied code, or fetch supplied URLs.
Local tests model Google caller semantics; only live two-account execution can
establish the platform's actual identity and data isolation.

## Operator setup

1. Create one dedicated Apps Script project under the Studio test Cloud project.
   Upload `probe.gs` and `appsscript.json`. Do not reuse a mail-capable deployment.
2. Privately obtain the two consenting test users' `sub` values from Google
   OpenID userinfo. Compute SHA-256 over each exact UTF-8 subject string. Store
   the JSON array of exactly two distinct lowercase hexadecimal digests as
   ScriptProperty `HPS_PROBE_SUB_SHA256`. Never put identities, IDs, or tokens in
   source, command output, or Git. Missing or malformed configuration blocks all
   probes. No callable setup or allowlist mutation function is exposed.
3. Deploy an immutable API executable. The manifest uses authenticated Google
   access `ANYONE`; the application allowlist still limits actual probe work to
   the two subjects. Testers must not be project editors or Cloud IAM members.
   Use the same standard Cloud project for deployment and caller OAuth client.
4. Each tester independently grants only the manifest's three scopes. Use their
   own OAuth token to call `scripts.run` with `function: "hpsProbe"`,
   `parameters: [{namespace: "isolation-test", sheetId: "<private ID>",
   range: "A1", marker: "probe-alpha"}]`, and `devMode: false`.
   Actual IDs and tokens stay in protected files; store only redacted receipts.

The probe derives caller identity from `ScriptApp.getOAuthToken()` and Google's
userinfo endpoint, never from request input. The same token reads Sheets REST.
User locks serialize per-user marker changes. Sheet denial, failed identity,
quota errors and malformed responses do not modify markers. Only ten probe
namespaces per user can be created; marker strings must be synthetic `probe-…`
values. This is not a general-purpose data store.

## Required live evidence

Use two separately owned, unshared test Sheets with different synthetic `A1`
values. Neither account receives company/Cloud IAM permissions.

| Call | Expected evidence |
|---|---|
| Account A, own Sheet, marker `probe-alpha` | `ok`, caller A digest, null previous marker, expected cell digest |
| Account B, own Sheet, same namespace, marker `probe-beta` | `ok`, different caller digest, null previous marker, different expected cell digest |
| A and B read same namespace without marker | Each retains only its own marker |
| A reads B's private Sheet; B reads A's | `sheet_access_denied`; markers unchanged; no cell digest returned |
| An account outside allowlist | `caller_not_allowed`; no Sheet access or state write |

The operator should compare expected value digests locally. Hashes are
pseudonymous evidence, not anonymization for low-entropy real business data;
use synthetic data only. Record deployment version, source hash, scopes, and
absence of IAM grants alongside receipts. An API authentication/deployment
failure is NOT a passing isolation result. A consumer-account success does not
prove every company Workspace administrator allows the app.

Run the deterministic safety/contract checks with no Google access or API spend:

```sh
node --test scripts/google-runner-probe/probe.test.mjs
```

Disable the probe after evidence collection by removing its valid allowlist;
retain deployment and evidence rather than deleting records. Real mail
requires a separately reviewed implementation, scope consent, and explicit
recipient/content approval; this probe adds none of those capabilities.

## Observed spike result

Root completed the real two-account no-IAM/no-script-file-access test on 2026-10-14:
seven live calls passed and a subsequent disabled-allowlist call failed closed.
See [evidence](../../docs/plan/google-shared-runner-isolation-evidence.md). This does
not claim the shared runner has been integrated into the learner runtime.
