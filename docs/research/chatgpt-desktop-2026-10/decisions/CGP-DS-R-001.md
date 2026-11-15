## CGP-DS-R-001 implementation decision (2026-10-20; agent choice, not a new human agreement)

Preserve DEC-27 and every existing palette/geometry value. `designTokens.css` owns primitive
values, explicit light/dark semantic bindings and component aliases for Studio and Chalk.
Numbered semantic variants preserve existing contexts without pretending they are a new
approved scale. Existing public `--hp-*`, `--tw-*` and local Chalk aliases remain consumers.
Host variables and CSS-wide inheritance stay at their consuming element. Chalk uses a
checked generated TS transport because its runtime/test HTML loader does not load CSS.
Structural CSS/SVG geometry and learner-authored preview content are outside theme tokens.
No new palette, authorization, Service change or publication is implied.

