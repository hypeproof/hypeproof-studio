## CGP-KNOW-R-001: task rail search (2026-10-25, agent choice)

- Found on main: a title filter already existed in the rail but filtered on every keystroke, including an open IME composition, compared raw code points (a decomposed-jamo title never matched), kept a stale query across activities and showed the "not found" line for an empty activity. The row is built by fixing those four, not by a new surface.
- IME: the committed query filters; composing text is shown in the field but does not filter. Chromium sends the commit's last `input` with `isComposing` true and then `compositionend`, so the commit is taken from `compositionend`.
- Matching: one substring of the title in NFC, case folded, query trimmed. No word splitting, no fuzzy or initial-consonant (초성) search; both would need their own acceptance.
- Scope: the search belongs to one activity and resets when the activity changes. The heading count (최근 작업 N) keeps the activity total.
- Default state: on for personal tasks; no new data flow (webview only, nothing posted to the host for the title filter or while composing). A committed query's message-text search is CGP-CHAT-R-026; see the reconciliation below.

