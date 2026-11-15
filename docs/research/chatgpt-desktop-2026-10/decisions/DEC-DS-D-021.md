## DEC-DS-D-021: shared tooltip hints (2026-10-22; agent implementation choice)

Existing native title hints become explicit `data-hp-tooltip` attributes on DOM
nodes. A single delegated presenter is installed per Studio webview and embedded
in Chalk by a generated transport, avoiding per-button wrappers and layout changes.
The canonical TS/CSS lives in the webview; `scripts/sync-tooltips.mjs --check` locks
Chalk to it. Native iframe titles and component title props are not hints.

A tooltip is supplementary visual text, aria-hidden, with no aria-describedby:
the control's own visible text/aria-label remains its independent accessible name.
Hovering a second control still opens its hint after 500ms; leaving restores the
focused control's hint. No new shortcut is invented. Native modal hints are mounted
inside the dialog. No permissions, data recipients, learner scores or safety flags
change. This is an agent choice, not a new human agreement.

