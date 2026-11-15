## DEC-DS-D-012: explicit reduced-motion off (2026-10-22; agent implementation choice)

The supplied DES-CGP-DS-16 three-way contract supersedes R-015's earlier agent choice
that off follows the OS. Host on sets `data-reduced-motion="true"`, off sets `false`,
and auto/unknown removes the attribute. Only an explicit boolean false permits motion
over the OS preference. System remains the default; no preference is persisted by
this change. CSS OS rules run only without the attribute. This is not a new human
agreement and does not change permissions or safety policy.

