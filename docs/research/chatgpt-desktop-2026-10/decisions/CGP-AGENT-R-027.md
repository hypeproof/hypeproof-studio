## CGP-AGENT-R-027: checkpoints with a reviewed message (2026-10-25, agent choice)

- Seat: adults on a website track (`game.template_tier === "website"`, not a minor or unknown tier, not the instructor). Other adult tiers (`search-webapp`) do not get it; the row names website tracks only.
- Store: a restore point of kind `checkpoint` in the extension's global storage beside the turn store, not a git commit in the work folder. "Nothing is pushed" then holds structurally: nothing in the folder changes, so neither a push nor the GitHub Pages publish can carry it. Keep 20; refused saves never prune.
- Suggestion: the first prose line of the AI's own answer for the turn, no new model request (no new data flow or cost). Without a usable line the field is filled from the changed file names and says so.
- Message: cleaned on the host, refused when empty or over 200 code points (never shortened silently). Evidence carries counts and an edited flag, never the text.
- History: listed in the 바뀐 것 review bar of the last request. Restoring to a checkpoint is not built (acceptance does not ask for it).
- Default state: on for the seats above (local only; no permission change, no upload).

