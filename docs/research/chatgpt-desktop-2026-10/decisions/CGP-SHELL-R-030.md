## CGP-SHELL-R-030: allowance request reasons, minor seats and the repeat block (2026-11-15, agent-selected)

Supersedes the "blocked on the Service" note in CGP-SHELL-D-029.md (2026-10-25) for the request side. Service half: hypeproof-service#544. The approval side (how a resolution changes a cap) is untouched: resolving still changes no cap, budget or charge.

- **Minor seats: no free text reaches the instructor (agent choice, privacy for minors; it narrows REQ-SHELL-30 / DES-SHELL-29's "optional reason ≤200" for minor seats).** Studio shows minor seats the fixed reasons only, with no text field. The Service drops any note a minor seat sends (`isMinorCohort`, and a profile it cannot resolve counts as a minor seat): never stored, returned or logged. It never refuses the request for it, because released apps (v2026.1016.0 to v2026.1115.0, rc.1) send `{source_id, note}` (verify-3956, option a). The request keeps the picked reason's Korean label, or the default label 추가 사용을 요청했어요 when none came. Before this, a minor seat could send up to 280 characters of free text to the instructor.
- **The three reasons (agent copy):** 하던 작업을 마무리하고 싶어요 / 문제를 고치는 중이에요 / 결과를 한 번 더 확인하고 싶어요. They are Service data (`BUDGET_REQUEST_REASONS`), so Studio does not hard-code them.
- **Adult seats:** the reason and the note (at most 200 characters, REQ-SHELL-30) are both optional, as the parent row says. A request without a reason carries the default label, followed by the note on a second line.
- **Repeat block:** 10 minutes from the previous request's creation, whatever its state (429 `budget_request_cooldown`, a distinct code the new form explains). A retry while a request is pending still returns it. Released apps show their generic failure line for the 429 (known limitation).
- **Threshold (agent choice):** with a policy, the form shows only at 10% or less of *any* metered allowance with `limit > 0`, or when exhausted. The earlier form looked at `requests:count` only, and a class allowance is usually `currency:USD:micro`.
- **Older Service:** without `request_policy`, Studio keeps the earlier required-note form. A malformed policy offers no form, never the free-text one.
- **Not built:** 승인 / 거절 labels. The resolution is free text without an outcome; adding one needs a Service column on the approval side.
- Confirmed by Jay: no.
