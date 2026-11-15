## CGP-CHAT-R-021: lesson tip source and action (2026-10-25, owner decision)

- Source: the served step schema `hps-session-design/1` has no tip key, and the Service rejects unknown step keys, so a new `tip` field cannot be served without a Service change. The step's Chalk-authored `hint` is the tip. A blank hint shows no tip; Studio never fills in a generic or product tip.
- Action: `입력창에 넣기` prefills the hint text into the composer (appended on a new line after an existing draft, once). The schema has no separate prefill text, and an action phrased by Studio would no longer be lesson-authored.
- Dismiss: per course, version, sha256 and step id, kept in the panel's webview state (newest 200). It is not per task: closing it on a step hides it for that step in every task of that lesson in this panel. A new lesson version shows its tip again. Two windows each keep their own dismissals.
- Duplication: the rail's 힌트 보기 disclosure keeps the same hint. The tip surfaces it once above the composer; authors who want a hint kept behind a disclosure leave `hint` blank and put it in `instructions`.
- Presentation (CGP-CHAT-D-021): one row above the composer, `도움말` text badge, two-line clamp, 44px targets including the close button, hidden while a turn runs or a send is pending.

