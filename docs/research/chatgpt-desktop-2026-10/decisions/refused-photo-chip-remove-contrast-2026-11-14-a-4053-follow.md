## Refused-photo chip remove × contrast (2026-11-14, a #4053 follow-up, agent-selected)

Confirmed by Jay: no. builder-art-r005 handed it over, from verify-3956's #4053 check.

- **Defect (real, not an instrument limit).** On the refused-photo chip, #2365 made the remove button `position: static`. Its `::before` dot (`position: absolute`) then anchored to the chip, not the button, so the white × sat on the light panel at 1.19:1 (Light+, HP Light). #4053's branch notes this as an instrument limit of text-contrast-computed. The note lives only on that branch and should be corrected when #4053 merges.
- **Fix (agent choice).** The refused chip's button is `position: relative`: it stays in the flex row and anchors its dot again. In the personal seat the × is a transparent 44px square with a foreground ×, by design, so its dot is not drawn (`::before { content: none }`). Left on, that dot anchored to the chip and painted a dark circle across it.
- **Measure.** `attachment-remove-contrast-computed` runs the real ChatPanel with every bundled theme, for the classroom and personal seats. Where a dot is drawn, the button must anchor it, and the × must reach 4.5:1 against what is painted behind it. Pinning the "attachment × ::before" row in text-contrast-computed's default set waits for #4053's all-rows mode.
- **Not covered:** HP Light. That theme exists only on #4053's branch. The smoke iterates THEMES, so it picks the theme up when #4053 lands.

