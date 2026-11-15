## CGP-LEARN-R-004 / CGP-LEARN-D-004: block references pin type, version and params (2026-11-14)

The Service contract is hypeproof-service#461; this entry covers the Chalk chip. Confirmed by Jay: no. All choices below are the agent's, made under DEC-19, which Jay ruled on 2026-10-28; none is waiting on Jay.

- **Reference shape (agent choice; a technical compatibility choice, not a Jay decision, per the coordinator on 2026-11-14).** `ui` stays the type string, and two optional step keys carry the pin: `ui_version` and `ui_params`. The alternative was an object-valued `ui: {type, version, params}`. It would follow DEC-19's "reuse `ui`" more literally, but Studio apps already installed read `ui` as a string (`surfaceOf`, `stepMaterial`), so every block would turn off for them. There is no hps-session-design bump.
- **Pin at confirm (agent choice).** The draft may omit the pin. At confirm the Service writes `ui_version` (the draft's value, or else the latest). It writes `ui_params` only when that version declares params: draft values over defaults. This is the same pattern as the model and feature bindings written at freeze.
- **First catalog (agent choice).** The seven existing kinds, at v1, with no params and one preset, 기본. No type was given invented params to meet acceptance (a). That case (`prefix_length 31 > 30`) is proved with a test-only catalog injected through the Service's seam. The first real params come with the first parametric mechanic (R-005 onward).
- **Append-only catalog (agent choice).** A published (type, version) is never removed or changed, and a snapshot fixture locks this. The Service re-validates a confirmed lesson every time it serves it, so removing a version would close running classes. Adding a version never does.
- **Rehearsal (agent reading).** Readiness is keyed by version and sha256, and a different pin is different bytes, so (c) holds without a new rule. `impact` reports the change as `step_changes[].block`.
- **Chalk chip (agent choice).**
  - Shown under the step's 학생 작업 화면 select, read-only, 14px.
  - A pinned step shows its pin. An unpinned step shows the latest version with "(확정할 때 고정)".
  - A preset is named when the params equal it, otherwise "직접 설정".
  - Changing the type drops the old type's pin from the saved content.
  - The catalog comes from the existing features read (`step_ui_catalog`), so Chalk needs no new contracts release.
- **Not covered:** a real instructor browser on macOS or Windows (only headless Chromium on Ubuntu); the Studio learner side (a separate change).

## CGP-LEARN-R-004 / CGP-LEARN-D-004: Studio draws only the pinned versions it renders (2026-11-14)

This is the Studio half of the block reference contract. The Service contract is hypeproof-service#461 and the Chalk chip is CH-12. Confirmed by Jay: no.

- **Version set (agent choice).** `RENDERED_UI_VERSIONS` lists the catalog versions each kind is drawn at, which is v1 for all seven today. A step with no `ui_version` (frozen before pinning) means v1. A version outside the list, or a pin that is not an integer, is drawn as the existing unsupported notice: no block and no guessing. The rehearsal report then says `unsupported:<kind>`, so an App that cannot draw a pinned version cannot pass a rehearsal for it.
- **Learner copy (agent choice).** The unsupported notice no longer shows the type id between brackets, to meet "the learner UI never shows type ids or versions". It reads "이 단계의 작업 화면은 이 Studio에서 아직 열 수 없습니다. 대화로 진행하고 강사에게 알려 주세요." The id stays in the `data-surface` attribute for tests and rehearsal, and is not shown.
- **Not covered:** a real installed App (only the component on the minimal DOM and the pure helpers ran); a real v2 block (none exists yet).

