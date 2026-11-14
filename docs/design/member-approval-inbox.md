# Member inbox client design

Existing desktop `StartPage` owns a `MemberApprovalController`; React is a text-only projection
and sends typed refresh/decision intents. AccountSession retains bearer custody and verifies
active `/me` identity/session. The host persists each decision under a distinct account-scoped
Memento key, so other windows do not replace a shared array. The webview never receives account
or session identifiers from the decision journal.

Existing iPhone `SharedConversationModel` creates a `MemberApprovalPresentation` and Core
controller with closures into its current service/token methods. `MemberApprovalView` is a sheet
from **연동 설정 → 확인 요청**. It stops voice capture on entry and uses the current native identity.
Concurrent inbox/history requests share the existing credential renewal operation. No second
credential store is added. Pending choices use atomic, protected, backup-excluded files in the
existing app support namespace; a UUID per file prevents unrelated records overwriting each other.

Both clients validate the shared `hps-member-approval-inbox/1` response and an allowlisted review
projection. Three choices send exactly `{id, request_digest, choice}` to the account-bound route.
The default card is compact: repository/PR, up to three lines of verbatim authored summary,
one short assigned-review/status line, then the three choices. Repeated introductions and
empty status rows are omitted. Refresh is in the desktop footer/native toolbar. Full repository,
exact head, authored content and verified evidence remain in the disclosure after the choices;
the shortened visible version has its complete accessible label. Native uses one content cell
for the summary/status/choices so List row padding does not separate the decision from its context.
A busy reservation is set before asynchronous work, persistence precedes POST and account/session
are rechecked before and after transport. A failed save does not send; a lost response keeps the
same intent. Refresh performs only GET, including each original pending card, and never sends a
receipt again. Unknown or submitting states can only reconcile. Expired confirmation directs
the person to refresh for a new Harness-issued card, never re-sign the old card.

Freshness is not inferred from client time alone: a server lease and `can_decide` are both
required; a local timer only removes capability. Service #415 and Harness #584 remain the atomic
membership/lease/decision/relay boundary. These clients implement no independent approval engine.

Operational limitation: a missing/replaced pending card or corrupt journal fails the inbox
closed with refresh guidance. Only an exact server-confirmed declined/questioned/superseded/expired card or validated submitted
review retires its journal entry. Uncertain entries never expire locally. Mutation replay and broad
journal repair are outside this slice. All saved records are non-secret decision identifiers; no credentials,
private chat transcript, raw HMAC receipt or request headers enter the UI or logs.

## Enrollment-only entry visibility

A quiet list read on account/session adoption establishes entry visibility. It never reads the
decision journal, opens a dialog, sends a choice or retries a receipt. Desktop account watch
updates deduplicate the stored host-only session key; native restore/login adopts once. Only a
validated `ready` response for the same full account/session exposes the entry. Explicit default-off,
not-enrolled, logout or account switch clears it. An already confirmed same-session member may
retain the entry through a transient network error so they can explicitly refresh, but receives no
card capability from that cache. Closing the dialog preserves enrollment and clears its cards;
account invalidation clears both. Nonmembers with old pending records keep those records untouched
and do not issue denied detail GETs. Ordinary question/voice onboarding has no internal approval UI.
