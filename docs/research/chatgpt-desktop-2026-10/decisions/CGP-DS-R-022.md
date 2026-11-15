## CGP-DS-R-022: the task menu joins the shared menu token set (2026-11-14, agent-selected)

Audit of main (7205ff64b): the tools menu and the personal header menu already share the learner-menu tokens (#2575, typeahead #2724) and `test/menu-tokens-computed.smoke.mjs` guards them. The rail's task menu (`TaskMenu.tsx`, CGP-KNOW-R-009, built later) did not: 6px gutter, 10px block padding, 6px item radius, `text-align: left`. Its 44px items, 12px panel radius and 14px text already met the floor. R-022: PARTIAL (one of three Studio menus); D-019 Studio part: PARTIAL for the same menu.
- Change: `taskWorkspace.css` task-menu rules now read `--ds-c-menu-gutter`, `--ds-c-menu-item-height`, `--ds-c-menu-item-pad-block` / `-inline` and `--hp-radius-menu-item`, and align to `start`. No new token, no token value, colour or theme change; no component or copy change.
- Not covered: the `보여주기` attach list in the unmounted VoicePanel is a `role="group"` of buttons, not a menu, and keeps its own rules. Chalk's dense 32px menu (DES-CGP-DS-24) stays separate.

