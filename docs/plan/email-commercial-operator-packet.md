# Email automation commercial operator packet

Prepared 2026-10-15. This is a preparation artifact for EA-02/07/08/09/11,
not a deployment, OAuth submission, payment or release receipt. Follow the
[ordered delivery plan](email-automation-next-steps.md); record subsequent
execution against exact revisions. No operator script or external write was
performed for this packet.

## OAuth submission package

The managed runtime is the commercial path. The source contract is
`extensions/hypeproof-chat/src/appsScriptRuntime.ts`,
`appsScriptEmailProject.ts`, and `scripts/google-shared-runner/appsscript.json`.
The runtime adds `openid` to the three execution scopes below; its shared branch
does not request project-authoring scopes. A historical owner-script token may
still contain more permissions: `include_granted_scopes=true` is not evidence
that an existing grant has been narrowed.

| Requested scope | Submission rationale tied to actual behavior | Demonstration |
| --- | --- | --- |
| `openid` | Obtain the authenticated subject and compare its hash with the runner caller; separate private state without collecting profile or email-address permissions. | Two synthetic learners have separate connections and private state. |
| `https://www.googleapis.com/auth/spreadsheets.readonly` | Read the Sheet/range the learner chooses to construct exact recipient/message previews. No sheet writing. This is broad read permission; the UI choice is a product restriction, not a Google-enforced single-file grant. | Select a synthetic private Sheet; show the preview and denial of another learner's private Sheet. |
| `https://www.googleapis.com/auth/gmail.send` | Send only the explicitly confirmed preview from that Google identity. Studio does not read Inbox or mail history through this permission. | One separately approved synthetic self-mail and the corresponding sent result. |
| `https://www.googleapis.com/auth/script.external_request` | The fixed runner calls only OpenID userinfo, Sheets and Gmail HTTPS endpoints in its manifest allowlist. Recipes cannot supply endpoints or executable source. | Show the packaged manifest, pinned runner release and actual preview/send path. |

`gmail.send` is classified as sensitive by Google's
[Gmail scope table](https://developers.google.com/workspace/gmail/api/auth/scopes).
Do not request Gmail read/full-mail scopes merely to show a test receipt.
Review the Google Console classification of every scope before submission.
`drive.file` would require a tested file-grant flow; a pasted Sheet URL is not
such a grant. Do not silently substitute scopes in the packaged runner.

Google's current submission guidance calls for accurate public branding,
domain ownership, a public homepage, and a privacy page on the homepage's
domain explaining access, use, storage and sharing. The demonstration must
show the consent flow in English, the app name, the OAuth client ID in the
browser address bar, and the use of each requested sensitive scope. Provide
the unlisted YouTube demonstration URL and per-scope justification; retain
the actual Verification Center submission and approval statuses separately.
[Official submission guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

Use distinct test and production Cloud projects; this is a deployment-tier
requirement in Google's [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).
Within each tier, the API executable and calling Desktop OAuth client use the
same standard Cloud project. This does not require learners to receive Cloud
IAM or script-editor access.
[Apps Script execution setup](https://developers.google.com/apps-script/api/how-tos/execute).

### Recording cue sheet

Use dedicated synthetic data and mask account identifiers before retaining
review copies. Never record tokens, browser callback codes or payment secrets.
The client ID is a public application identifier requested by Google, not a
learner credential. Keep the exact authorized client ID visible only in the
submission version as needed.

| Segment | Visible evidence | Stop condition |
| --- | --- | --- |
| 1. Product identity | Installed version/revision, public homepage and policy; describe manually initiated Gmail automation. | Wrong client, old owner-script path or stale policy. |
| 2. Consent | System-browser English consent initiated from Studio; app name/client ID and requested permissions. | Broader scopes than the declared managed-runner contract. |
| 3. Private input | Conversational recipe, host-private Sheet selection, real read and exact preview. | Private rows appear in coach/model traffic or another account's data succeeds. |
| 4. Controlled sending | One pinned preview, exact human approval, one send result. | Missing approval or ambiguous result; never retry automatically. |
| 5. Reuse | Publish a sanitized recipe, import with learner B, preview using B's private Sheet. | Imported recipe carries account, Sheet, recipient or credential data. |
| 6. Recovery | Disconnect local connection, reconnect, and explain Google grant removal and retained send ledger. | Claiming disconnect deleted all Google data or revoked grants without evidence. |

Prepare segments 1–3 and 5–6 without mail. The exact self-mail test was approved
and completed at624b214f on2026-10-15; its matching Inbox receipt was observed
at15:04KST. That approval is consumed and does not authorize another recording
send. Retained test evidence is not an OAuth-review video. If segment4 needs a
new send, prepare its exact preview for a new approval. A preview-only video is
an incomplete demonstration of `gmail.send`; do not submit it as proof of sending.

### Technical disclosure facts and unresolved implementation

The internal [technical privacy draft](google-commercial-onboarding.md#technical-privacy-disclosure-draft--internal-not-published-policy)
remains the starting text. Its publishable facts must be checked against the
final installer and Service revision:

- Host SecretStorage holds Google credentials. Test production Windows storage
  protection; the development `--use-inmemory-secretstorage` mode cannot prove
  encrypted storage at rest.
- The local host and Google runner process rows and rendered messages. The
  automatic coach result is aggregate data; voluntarily pasted conversation
  content follows the configured model path. Do not advertise a blanket claim
  that all Studio content stays local.
- The runner's UserProperties retain a preview and hashed message delivery
  markers. Local durable ledgers also protect against duplicate delivery.
  Recipe/release changes must preserve these markers. There is no demonstrated
  retention/deletion service-level promise in this packet.
- `createAppsScriptRuntime().disconnect()` now invalidates local approval and
  revokes the grant through Google's endpoint. A failed/uncertain response keeps
  a SecretStorage-only retry token and disables execution/reconnection until
  explicit retry succeeds; the inspector shows the pending state. Its fixture
  tests do not prove real grant removal. Obsolete-scope migration and actual
  Google lifecycle acceptance remain open, without deleting unresolved-send
  protection. Google's
  [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
  require revocation of permissions no longer needed and secure token storage.
- A grant removal, local disconnect, deletion request, recipe unpublication,
  support closure and cancellation/refund are different operations. Describe
  exactly which one the user receives.

## Release and class acceptance record

Use this table as a record, not a pre-filled success claim. `not_run`, `pass`,
`fail`, `blocked`, and `unknown` are distinct. An evidence reference identifies
a redacted artifact plus its revision/time; private rosters remain outside Git.

| Gate | Required observation | Status / artifact reference |
| --- | --- | --- |
| Source | Studio, Service and Ops exact SHA; required checks; immutable runner release/version/content digest | Partial: Studio b48be48a has18 successful CI checks; Service2ce0b2e has13, including the full premerge gate. These source checks do not establish a production package, merge or current native acceptance. |
| Isolation | A and B use shipped adapter, separate private Sheets, bidirectional cross-Sheet denial, separate approval/ledger, no company IAM | not_run |
| Google configuration | Tier, Desktop client binding, script's common project, API configuration, manifest scopes, actual console review state | not_run |
| OAuth lifecycle | Production credential reuse, revoked access, test-token expiry, old-scope migration, managed-domain denial with actionable recovery | not_run |
| Windows installation | Fresh standard-user installation from pinned package; first login/private preview; no instructor credentials | not_run |
| Upgrade/rollback | Existing install updated with its credentials, skills and ledgers preserved; rollback preserves unknown/sent state | not_run |
| Class preflight | 20 actual distinct seats each log in, read their own synthetic Sheet and complete no-send preview; count readiness separately from fixture tests | not_run |
| Class limits | Synthetic 20-seat simultaneous admission, individual/aggregate cap, expiry/revocation, stale/disconnected/failed/completed instructor states | Synthetic Service contracts pass at integrationacfd637, including real local D1 cap enforcement and instructor HTTP states. This does not provision or verify20 real learners. See Service `docs/migration/email-workshop-readiness.md`. |
| Sending | Exact approval reference, one attempt, confirmed result, separately observed matching Inbox receipt | Historical pass: Mac624b214f, shared runner, sent1/unknown0, matching Inbox at2026-10-15 15:04KST. No retry/new send; current package and OAuth-review recording remain separate. See [delivery evidence](google-shared-runner-isolation-evidence.md). |
| Commercial offer | Current product catalogue, payment consent and grant semantics, support/refund owner; [billing audit](email-commercial-billing-map.md) gates resolved | not_run |
| Release | Merge/deploy/package references; production smoke; support and rollback ownership | not_run |

For each actual seat, record only a pseudonymous seat key in shared evidence:
`seat`, `account_type`, `installer_sha`, `grant_ref`, `oauth_at`,
`own_sheet_read_at`, `preview_at`, `instructor_stage`, `block_reason`,
`last_observed_at`. The protected roster links seats to real identities.
Record UTC timestamps with the class's Asia/Seoul date; do not infer attendance
or readiness from a provisioned token.

Testing refresh tokens ordinarily expire after seven days for these scopes;
a 30-day Studio grant does not extend them. Include reconnect in the pilot
instructions. [Google token lifetime](https://developers.google.com/identity/protocols/oauth2).
Workspace admin policies can still prevent access even after Google review.
[Workspace access controls](https://knowledge.workspace.google.com/admin/apps/control-which-third-party-and-internal-apps-access-google-workspace-data).

## Facts needed from the accountable owner

Engineering can finish synthetic tests and review materials before these facts
arrive. Collect them together at the relevant operational gate; general action
authorization is not a source for missing business facts.

| Fact | Why it is needed |
| --- | --- |
| Class date/time, protected roster and managed-domain contacts | Issue actual seats, plan token-expiry handling and preflight. |
| Aggregate class cost cap and per-seat allocation | Convert bounded test execution into actual class spending limits; the explicitly approved USD10 development/test ceiling does not authorize a live-class budget. |
| Seller/legal identity, verified domain, public support/deletion owner | Publish accurate policy/consent information and route real requests. |
| Retention periods, backups, deletion procedure and subprocessors | Complete an operationally true privacy disclosure. |
| Actual offer: trial duration, price, included limits, renewal, cancellation/refund | Connect workshop completion to an explicit purchase; the 30-day grant is not recurring-charge consent. |
| Any new recording-send recipient and preview approval | The earlier one-mail authorization was used successfully. A new recording send, if needed, requires its own exact approval. |

Repository sources were read on 2026-10-15 while integration was in progress.
This packet needs revision-bound execution evidence, not another approval for
already authorized preparation.

Public-page readback at20:46KST on2026-10-15 found a reachable Studio product
homepage plus paid terms/refund pages with support contact. The inspected public
links did not identify a privacy policy, and `/studio/privacy` and `/privacy`
returned404. The policy URL is requested, not assumed absent site-wide. See
[onboarding evidence](google-commercial-onboarding.md#current-observed-gaps).
Reachable public pages do not prove domain verification or OAuth submission.
