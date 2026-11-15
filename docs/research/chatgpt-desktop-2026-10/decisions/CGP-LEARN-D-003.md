## CGP-LEARN-D-003: the live text equivalent is a visible caption (2026-10-29, agent-selected under the owner rules)

- "Diagram" in Studio is the block's work surface (the criterion or decision form): no block draws a picture yet (the `ui` field carries no parameters, REQ-CGP-LEARN-04 is open). "Caption line under the diagram" therefore means the state line sits under the form inside the open card.
- The caption is R-003's polite state line, not a second copy. It moved after the card body in the markup, so open it is drawn under the work surface and read after the controls; the card's head became `display: contents` and the card's own grid places the caption. Closed, the grid lifts the same node under the title, so D-001's fix (a step switch or host save on a closed card is drawn and announced) and the 72px closed card both hold.
- Closed, the caption is one line with an ellipsis (the D-001 trade-off). "Readable without horizontal scroll" is measured on the open card, where the caption is the whole sentence and wraps at any width; the closed line is a summary and the full words are one press away.
- 200 % zoom is emulated as Chromium lays out page zoom: device scale 2 with half the CSS width. Measured panes: the 480px rail and the 640 (the WCAG 1.4.10 320 CSS px), 800 and 1420px panes. The 280px rail at 200 % is a 140 CSS px viewport, below the WCAG reflow floor, and is not claimed.
- Contrast is measured against the background actually behind the caption (the card's Panel token), not assumed from tokens.
- Default state: on for every seat that draws the lesson rail (display only, no new data flow).

