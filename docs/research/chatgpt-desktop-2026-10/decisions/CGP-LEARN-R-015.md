## CGP-LEARN-R-015: completion checklist helper in Chalk authoring (2026-10-26, agent-selected conservative implementation)

- "Helper" = the existing completion-condition rows in `/authoring` (이번 주 미션 · 완료 조건). No model call: the row asks "무엇을 만들면 끝인가요?", and a per-row button turns "what to make" into "…을/를 만들면 끝" only when pressed. A full clause is refused, never glued.
- Refused words: a number followed by 점, score compounds (점수, 배점, 만점, 감점, 가점, 총점, 득점, 평점, 채점), 등급, 우수, 미흡 and the six SX-35 labels. A bare 점 is allowed: 차이점, 장점, 관점, 점검, 점선 are observable words and blocking them would push teachers away from concrete items.
- Matching runs after NFKC and removal of control, zero-width, bidi and line-separator characters.
- The Service validator refuses score keys but not score words, and no Service change exists. Chalk checks twice: on the page before save or freeze, and in its forwarder on the draft PUT (422, nothing forwarded). Known gap: a draft saved before this change can still be frozen over the API, because the freeze request carries no content.
- Out of scope: per-step 완료 기준 (`steps[].acceptance`).
- Default state: on (instructor surface only; no new data flow).

