# Member approval inbox — Studio #3788

Parent outcome: [member channel #3767](https://github.com/hypeproof/hypeproof-studio/issues/3767).
Implementation owner: jayleekr. This private member workflow is separate from personal reflection,
classroom enrollment, an AI allowance and customer product validation.

## MAI-01 — One existing account, two existing surfaces

The existing VS Code desktop start screen and native iPhone question screen expose **확인 요청**
only after Service confirms `availability=ready` for the current account/session. Being signed in
is not membership. One quiet account-adoption list GET discovers enrollment; default-off, unknown
and not-enrolled customers see no approval entry, prompt or GitHub language in onboarding.
Use the current AccountSession / Keychain custody; no new Mac application, pairing code,
GitHub token, reviewer-name entry or secondary approval authority. Opening the inbox does not
replace a question conversation or discard its draft. iPhone stops capture before opening it.

## MAI-02 — Understand the exact request

Before the choices, both clients show **변경 내용** and at most three visible lines of the
existing authored summary. This is a verbatim preview, not an AI-generated or verified claim;
only the canonical leading `summary: ` label is removed. The full authored text and verified
evidence stay separately labeled in collapsed details. Reading the preview sends no decision.

A short Korean card names why the member was asked, repository/PR and the complete source head.
Collapsed details separate author statements from verified evidence. Render only allowed fields
as text. “선택을 전달했어요 · 처리 대기” is not “GitHub 승인 반영됨”; the latter needs a validated
GitHub APPROVED review for exactly the source head and reviewer. Show no raw receipt or bearer.

## MAI-03 — Explicit, currently authorized choice

Approve, hold and ask-for-explanation map to `approve`, `reject`, `question`. All three require a
fresh server-attested `can_decide`, pending/delivered state, unexpired card and maximum 60-second
lease, no previous decision/review and no local pending choice. UI expiration disables choices;
Service still checks authority atomically at POST. No account/email/allowance-derived membership.

## MAI-04 — Durable intent, uncertain results and concurrent devices

Before POST, durably store the generated decision UUID with account/session, card ID, request
digest and choice. A disk failure must prevent dispatch. Recheck account/session after awaits.
Never send the old decision automatically after restart, timeout, conflict or refresh: GET the
same card. A second explicit tap cannot issue another decision for that card. Only a new card ID
issued by Harness after expiry permits a new explicit choice. Another device's winning decision
is shown from Service; the losing device does not manufacture approval or resend.

## MAI-05 — Failure and identity boundaries

Loading, empty, not-enrolled, unavailable, signed-out and failed reads have Korean recovery copy.
Logout/account change clears visible cards and fences stale responses; saved decision records
stay scoped to their account. Corrupt/unreadable journal fails closed. Only an exact, server-confirmed terminal card can retire its saved decision. Submitting/unknown
remain durable. Journals are bounded to 50 unresolved entries; exceeding the bound requires
investigation, not silent deletion or replay. No automatic background dispatch or polling is introduced.

## MAI-06 — Separate source proof from delivered acceptance

Focused host/controller/UI and Swift Core controls cover failure, expiry and identity races.
Native App/Xcode, installed desktop/iPhone, actual member enrollment, server lease, relay receipt
and observed GitHub review remain separate required evidence before rollout. Source completion
must not close parent #3767 or claim customer validation. Native member Core/App/simulator
evidence must name the integrated client source before rollout.
