## CGP-KNOW-D-025: overview by task with one correction field at its bottom (2026-11-01, agent-selected)

Builds DES-KNOW-43 on REQ-STUDIO-MEMORY-OVERVIEW (CGP-KNOW-R-025, #3206). Measured on main first:
- Already met: grouping by task, with task names as headings and items as the files' own sentences; the host check that keeps capability, ability and judgment sentences out (memory-overview.smoke).
- Gaps closed here: the correction field was inline per item, which R-025 left for this row to restyle; the rendered DOM's absence of capability names, scores and badges was not asserted; Enter in an IME composition was not tested.
- "A correction field at the bottom": one field after the last task group. It still corrects one item, because with no model nothing could map free text to a file. So 고치기 on an item opens the bottom field, quoting the words it replaces. An always-open free-text box with no target was rejected: it could not say which memory changes.
- IME: the field is a textarea, so neither Enter nor an IME's Enter submits; only 고친 내용 저장 does. The test uses a real CDP composition (keyCode 229 Enter, then commit) and a plain Enter.
- DOM absence: the browser smoke builds an overview with the real `buildMemoryOverview` from planted sentences and asserts that no capability key or label, no score and no badge, chip, meter or icon appears.

