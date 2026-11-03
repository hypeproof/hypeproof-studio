# Shared Google email runner

Owner-maintained Apps Script API executable for the Studio pilot. Learners need
OAuth consent, not project IAM or script edit rights. This source is not deployed
by its tests. The executable must use the same standard Google Cloud project as
Studio's Desktop OAuth client and immutable version deployments (`devMode:false`).

The pilot allowlist is the ScriptProperty `HPS_SHARED_ALLOWED_SUB_SHA256`, a JSON
array of 1–20 unique lowercase SHA256 hashes of OAuth `sub` values. Missing,
empty, malformed, or oversized configuration fails closed. Only the owner edits
this property; account values and script/deployment IDs stay in protected local
configuration. `executionApi.access=ANYONE` permits signed-in OAuth API callers;
the explicit allowlist still controls product eligibility. It is not an anonymous
web app and has no `doGet` / `doPost` endpoint.

## Runtime contract

Only these public entrypoints exist:

- `hpsSharedPreview`: payload `{spreadsheetId, range}`.
- `hpsSharedSendApproved`: payload `{approved:true, previewId, messages}`.
- `hpsSharedGetSendStatus`: payload `{ids}`.

Each request is exactly `{protocol,releaseId,accountId,recipe,recipeDigest,payload}`.
`protocol` is `hps-email-v1`; `releaseId` is `hps-email-20261014-v1`.
`accountId` is SHA256 of the actual caller's OAuth subject. The script retrieves
that subject itself using `ScriptApp.getOAuthToken()` and OpenID userinfo, compares
it with the request, and checks the allowlist before accessing Sheets or state.
The same caller token accesses Sheets and Gmail; owner credentials are never used.

Recipe data has exactly the existing `EmailRecipe` schema. Its digest is SHA256
of UTF-8 `JSON.stringify()` of this fixed-order object, retaining the validated
strings without trimming:

```text
{schema,title,description,category,subjectTemplate,bodyTemplate,
 columns:{email,name,document,dueDate}}
```

Successful responses are exactly
`{protocol,releaseId,accountId,recipeDigest,result}`. Apps Script execution errors
contain only controlled error codes. The client must validate the response
binding and pinned deployment before treating a preview as accepted.

## Delivery boundary

Templates are validated data; the runner accepts no source code, arbitrary URL,
account impersonation, or owner-project management request. Preview is limited
to 20 recipients. The current per-user preview binds its exact message tuple
sequence, recipe digest, caller, and release; it expires after 30 minutes.
Studio must separately obtain explicit private UI approval for the exact preview.
`approved:true` is a protocol assertion from that authenticated client, not a
substitute for the approval UI or proof of a human action by itself.

Message IDs retain SHA256 of `[to.toLowerCase(),subject,body]`. UserProperties
`hps.sent.<id>` entries are independent of recipe and release, so changing a recipe
or deploying a new version does not permit repeat delivery. A user lock serializes
approval checks and mail sends. The runner persists `unknown` before sending,
never retries uncertain attempts, and never deletes old ledger entries to make
room. Use a new immutable version in the **same script project** for upgrades;
replacing the project resets Google UserProperties and requires explicit migration.
Studio must preserve local legacy ledgers as an additional duplicate guard.

Run local deterministic contract checks:

```sh
node --test scripts/google-shared-runner/runner.test.mjs
```

These tests model caller-owned Google resources and provider failures. They are
not evidence of real Google authorization, delivery, or native Studio UI behavior.
The local tests use synthetic addresses only and make no network requests.
