## CGP-AGENT-R-015 / CGP-AGENT-D-013: 수업 AI 설정 one page (2026-11-10, agent-selected layout)

Agent implementation choice; not a human policy decision. Confirmed by Jay: no.

- Layout: one `fieldset#ai-settings` in `/authoring` with five collapsible sections in the D-013 order (정체성, 지시문, 모델·처리 수준, 기능·승인, 미리보기) and an in-page section nav, sticky from 1024px. Section names and the Korean helper copy are the agent's wording.
- Every field is an existing one: `assistant.display_name`, `steps[].instructions` (the only instruction text the Service lesson contract has), `model` and `model.effort`, `features`, `approval_preset`. Save, freeze, rehearsal, confirm and version semantics are untouched; the draft is edited, a frozen version is shown as read-only text.
- 지시문 section = the step editor (the Service has no lesson-level instruction field). The curriculum fields (title, audience, objective, starter material, prerequisites, mission) stay in 02.
- Preview = read-only list built from the same `content()` the save sends, plus a separate read-only summary of a loaded frozen version.
- "Accordion below 768px" is met as collapsible sections at every width, not an automatic collapse (a collapsed section would hide controls from the 375px checks and from keyboard users who land on a hash link). Unsaved-changes guard: browser leave confirmation while the draft is dirty.
- NOT built, and not shown: AI role, AI tone, and the 시작 문장 section (up to 4 starter prompts). `hps-session-design/1` has no field for them; DEC-30 (starter field in `hps-authoring-batch/1` plus frozen-version compatibility, Jay + Service owner) is still open, and `starter` is the existing 시작 예제·자료, not conversation starters. Follow-ups once the Service accepts them: a tone/role field, `starters` (max 4, single line) and the 시작 문장 section between 기능·승인 and 미리보기; CGP-KNOW-R-037 and CGP-KNOW-D-037 depend on the same decision.
- Dependency check: CGP-AGENT-R-016 (diff before confirm) is on main (#2120); R-001 and R-019 are on main (#3519, #3677). DEC-30 is the only open dependency, handled by leaving the starter part out.
- Default state: on (reorganises existing controls; no new permission, no new data).

