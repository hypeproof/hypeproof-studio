## CGP-ART-D-006: style tweak popover (2026-10-27, agent-selected implementation)

- Anchor: under the element chip's `스타일 바꿔 보기` toggle in the chat panel, not over the picked element in the preview tab. The native BrowserTab contract has no trusted in-tab surface (as for CGP-ART-R-006, D-002 and D-008); a page-injected popover would put the send under page control. The in-page anchor is the one part of DES-ART-06 not built; it needs a shell-owned overlay with tab identity.
- Form: a compact card (≤ 280 px, the column width below that) that stays in the message flow, so the scroller never clips it; a floating overlay would cover messages and could be cut at the scroller edge.
- Sizes: 44 px targets and 14 px text keep winning over the 32 px stepper (owner rule). Swatches stay 24 px inside a 44 px button; the selected ring is a 2 px border so it survives forced colours, where the system selection fill marks the state.
- Order: label and reset share the first line, so the reset comes before the controls on screen and in focus order.
- Escape closes the popover and returns focus to the toggle; it stops there so it never closes the sources panel or another handler above, and is ignored during IME composition.
- Default state: unchanged (on wherever element pick is on); no new data flow.

