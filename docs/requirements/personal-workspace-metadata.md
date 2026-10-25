## Personal workspace metadata — REA W01 partial

`ST-REQ-PERSONAL-WORKSPACE-METADATA` is the bounded metadata contract below.
Its parent `ST-REQ-PERSONAL-ACCOUNT` already assigns the account domain to
`jayleekr`; the new requirement, test and implementation nodes retain that owner.
This registration does not assign the whole REA W01 to a new owner or accept its
remaining identity, organization, child-policy or admission scope.

Approved REA W01 adds a signed-in personal-space entry to the existing start page
(REQ-L13 account boundary; Product Intent PI#1 and PI#5). It exposes learner naming
and ownership without showing capability labels. This slice stores and reopens
**project metadata only**; it is not the full REA workspace requirement or evidence
of conversation/file synchronization.

- Only an enabled existing account runtime and a signed-in identity expose the
  entry. Viewing uses `GET /v1/me/workspaces`; an empty result creates nothing.
  `개인 공간 만들기` explicitly calls the idempotent `POST` with `{}`. The client
  accepts only the current account's personal workspace.
- The learner names a project (trimmed 1–160 JS characters; NUL is rejected). Creation sends a
  host-generated mutation ID; retry after a lost reply keeps the exact ID/title
  while the host session remains open. A different title cannot overwrite the
  pending request. The host never sends account credentials to the webview.
- The list comes from the Service. `다시 열기` refreshes that account's list and
  opens the matching saved title record; a missing record is recoverable. The UI
  states that no conversation/file is synchronized or automatically imported.
- Account changes clear the list, selection and retry request. Logout clears and
  fences them before remote revocation finishes. Late responses and intents
  tagged with the previous account cannot paint or mutate the next account.
- Network/auth refusal offers a retry or existing account refresh/sign-in path.
  On an authentication refusal, previously shown cloud metadata and the selected
  record are cleared; an uncertain retry remains host-private until the same
  account recovers. A matching creation acknowledgement clears the submitted
  name form. Metadata actions never activate a pass, send an AI request, open a local folder,
  import local activities, or change runtime authority. Existing free/local entry
  remains independent.

Release dependency: `release.json` requires the literal `account-api@2` line
from Service in addition to the existing `studio-api` package surface. Service
line 2 must cover the earlier account contract plus these workspace endpoints and
continue serving line 1 for existing consumers such as Lab. A Service
that only provides the earlier account/chat API is not a compatible provider for
this metadata UI. The line-2 provider must include the workspace contract and additive
migration `0061-personal-workspaces.sql`; declaring a line does not prove that the
production migration or deployment has happened. Existing account/model contracts
remain unchanged.

Implementation: `src/personalSpace.ts`, the start-page bridge, and
`webview-ui/src/PersonalSpace.tsx` under `extensions/hypeproof-chat/`.
Focused evidence: `test/personal-space.test.mjs` (persistence across a new client,
exact mutation retry, validation, auth failures and account-response fences),
`test/personal-space-host.test.mjs` (scoped bridge and immediate logout), and
`test/personal-space-render.test.tsx` (explicit actions, retry UI, escaped titles,
metadata reopening and busy controls). These use synthetic accounts/Service
responses. Production deployment, installed-app acceptance and real account data
are **NOT RUN**. Retry intent is host-memory only: after a host restart, refresh
and inspect the saved list before creating the same title again.
