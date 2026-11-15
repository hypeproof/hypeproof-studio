## CGP-ART-D-016: slide suggestion panel (2026-10-27, agent choice under the owner rules)

- Surface: a VS Code webview panel "덱 장 다듬기", opened by the existing command. It replaces the quick picks and the native modal of CGP-ART-R-016; the gate, the one-run rule and the late re-checks before a write are unchanged. Not inside `deck.html`: that page has no host channel (CGP-ART-R-023) and is also the audience-facing deck.
- Thumbnails: drafted slides only, as 16:9 text cards (number, title, headline, visual line), not rendered slide images, so no slide HTML or product iframe runs in the panel. The first drafted slide is selected on open; the selection follows the last slide worked on.
- Evidence label: computed on the host from the slide's refs, which a patch cannot change (CR-55, "never stronger than what it cites"): 확인한 것 (observed) only when every ref is an evidence entry with state `real`; 가정 (assumed) when the slide cites no evidence entry (only the problem, a hypothesis or a decision); 해석 (interpreted) otherwise, including team trials (`self_reported`) and simulations. Korean words reuse the Venture Memory labels (`CONFIDENCE_LABEL`).
- "Changed claim": each face row (title, visual, each support line) that differs; both panes mark it, and 바꾼 안 shows the label.
- Focus starts on 그대로; Esc is 그대로; closing the panel writes nothing. While a request or proposal is open the chips and thumbnails are locked.
- Targets and text: 44 px and 14 px (owner rule), over the register's 32 px.
- Deck preview: after 반영 the deck preview no longer opens by itself (CGP-ART-R-016 opened `deck.html`). The panel stays open for the next chip and its status line says the thumbnail shows the new headline. No requirement text asked for the auto-open (verified by grep of `docs/studio-requirements.md` and `docs/requirements/`), and opening a browser tab on every accepted chip would pull the learner out of the panel.
- Default state: unchanged from CGP-ART-R-016 (wherever `learning_wiki.enabled` is served; nothing new leaves the machine).

