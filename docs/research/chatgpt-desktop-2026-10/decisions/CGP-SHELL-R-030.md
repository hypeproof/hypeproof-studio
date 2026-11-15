## CGP-SHELL-R-030: allowance request reasons, minor seats and the repeat block (2026-11-15, agent-selected)

Supersedes the "blocked on the Service" note in CGP-SHELL-D-029.md (2026-10-25) for the request side. Service half: hypeproof-service#544. The approval side (how a resolution changes a cap) is untouched: resolving still changes no cap, budget or charge.

- **Minor seats send a fixed reason only.** The Service refuses any note from a minor seat (`isMinorCohort`, and a profile it cannot resolve counts as a minor seat) and stores the picked reason's Korean label, so no minor-written text reaches the instructor. Before this, a minor seat could send up to 280 characters of free text to the instructor.
- **The three reasons (agent copy):** 하던 작업을 마무리하고 싶어요 / 문제를 고치는 중이에요 / 결과를 한 번 더 확인하고 싶어요. They are Service data (`BUDGET_REQUEST_REASONS`), so Studio does not hard-code them.
- **Adult seats:** the reason and the note are both optional, as the parent row says. A request with neither is allowed and stored as an empty text.
- **Repeat block:** 10 minutes from the previous request's creation, whatever its state (429 `budget_request_cooldown`). A retry while a request is pending still returns it.
- **Threshold (agent choice):** with a policy, the form shows only at 10% or less of *any* metered allowance with `limit > 0`, or when exhausted. The earlier form looked at `requests:count` only, and a class allowance is usually `currency:USD:micro`.
- **Older Service:** without `request_policy`, Studio keeps the earlier required-note form. A malformed policy offers no form, never the free-text one.
- **Not built:** 승인 / 거절 labels. The resolution is free text without an outcome; adding one needs a Service column on the approval side.
- Confirmed by Jay: no.
