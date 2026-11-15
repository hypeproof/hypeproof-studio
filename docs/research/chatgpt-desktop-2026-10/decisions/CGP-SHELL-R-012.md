## CGP-SHELL-R-012 keyboard panel scope (agent-selected 2026-10-22)

Implement the two existing webview panels (task rail and sources), not native VS Code
sashes. Widths start at the design-token defaults (rail 204px, sources 280px; unchanged
from main), clamp to 200-320 and 240-400, and are remembered per seat in the webview's
saved state (no host messages). The splitter hit target is 44px wide (thin visible line)
and also accepts a mouse drag. Preserve
existing responsive modal breakpoints and remove splitters when panels are overlays.
Plain arrows move 16px, Shift arrows 64px per DES-SHELL-11. Owner decision 2026-10-23
(supersedes the agent's earlier choice to remove autofocus): keep the composer's initial
autofocus as on main, because learners are elementary students who must type at once;
a keyboard user who starts in the composer already has what the link gives. The skip
link stays first in tab order, so the first Tab reaches it whenever focus is not in the
composer, and Shift+Tab reaches it from the composer. The acceptance line "First Tab
focuses a visible skip link" is read that way. Explicit user/host focus requests and the
existing conversation shortcut remain available. No safety
permission or model/runtime behavior changes. This is an implementation choice, not
a newly recorded human agreement.

| DEC-SHELL-R015 | Attribute a singleton model/effort setting to the teacher only with a resolved classroom profile or lesson, excluding local development runtime and instructor mode. Preserve single-option personal/trial/pass/unknown menus without teacher attribution. Do not invent an approval-mode value absent from the pinned Service contract. | Singleton availability alone does not prove teacher ownership. This UI-only change explains existing policy without changing approval, recipient, or runtime grants. | On for confirmed cohort settings; no new permission | no (agent-selected 2026-10-22) |

