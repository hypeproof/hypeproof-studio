## DEC-SHELL-D013: learner settings sheet geometry (CGP-SHELL-D-013, 2026-10-27, agent-selected conservative implementation)

- Surface: the sheet lives where its opener is, the start page "설정" (DEC-SHELL-R014). "Over the chat" is read as over the page under it: a modal right-side sheet on the right edge at full height, 320–400 px wide, the whole window below 320 px. The shared card's 390 px bottom-sheet rule does not apply to it.
- One control per row: 글자 크기 and 움직임 줄이기 change from radio groups to a native select, 알림 stays a checkbox, so each row's name and control fit one 48 px line at 320 px. "고급 설정" is a 48 px row too.
- Notes: the text-size scope note and the notice wording sit under their row as the control's description (`aria-describedby`), not inside the 48 px row; dropping them would make the row less honest. The notice wording becomes a sentence ("…알려 줘요.") because it is no longer the checkbox's label.
- Learner floor: controls stay 44 px and text 14 px (owner rule); the 48 px row is the larger value.

