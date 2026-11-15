## CGP-KNOW-D-032: nickname field design (2026-10-27, agent-selected: already met on main)

- The CGP-KNOW-R-032 build (`NicknameSetting.tsx`, REQ-STUDIO-LEARNER-NICKNAME) already draws DES-KNOW-50; no product code changed. The row is closed by proof, not by new UI.
- Field: the legend "뭐라고 불러 줄까요?" in 대화 설정 on personal and trial seats, one text input and nothing else about the learner (seat scope as decided for CGP-KNOW-R-032).
- "20-char counter as text": a visible `n/20자` line tied to the input by `aria-describedby`, not a bar or colour; an over-long value reads `21/20자` and is refused with "20자까지 쓸 수 있어요.".
- "PII rejection message inline": the host's screen runs in the webview first; a refusal shows its reason under the field (`role="alert"`, `aria-invalid`) and posts nothing.
- "IME-safe counter": an open composition does not move the counter; `compositionend` (or a non-composing input event) does.
- Proof: `learner-nickname-browser.smoke.mjs` drives the real App bundle in headless Chromium (dark and light, 1420 and 800 px, adult and minor cohort, forced colours) with CDP `Input.imeSetComposition`/`insertText`. Mutations (IME guard removed, counter text removed, inline reason removed, client screen skipped) each fail it.
- Text stays at 14px (the learner floor), the input and buttons at 44px. Default state: unchanged (empty, nothing sent).

