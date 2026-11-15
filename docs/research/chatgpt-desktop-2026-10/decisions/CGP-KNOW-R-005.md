## CGP-KNOW-R-005: memory scoped to one personal activity (2026-10-29, agent-selected conservative implementation)

Applies DEC-01 (ruled by Jay 2026-10-28). Built as REQ-STUDIO-ACTIVITY-MEMORY-SCOPE on the R-030 store, R-022 line and D-030 view.

- "Activity" is the personal or trial activity whose folder holds `.hypeproof/memory/`. The scope is the activity's saved kind, which the activity record took from the profile when it was first entered and never changes: that is "fixed at creation". No scope is stored in the memory folder and there is no scope setting.
- Class and team activities get no personal memory and no class store in this row: Studio adds no class memory writer, so "a class memory write does not appear in the personal list" holds because a class seat cannot reach any store. A class store (team-brain) is left to a later row and must get its own binding.
- Fails closed: a lesson recorded on the activity, a lesson or an enforced `lesson_binding` served now, a served `activity_kind` other than personal or trial, a missing record and an unloaded profile all count as not personal. A personal activity later served as a lesson is refused rather than re-scoped; its files stay on disk. A profile with no `activity_kind` keeps the saved kind (the record took it from the profile).
- "Request contains no X" is shown with a recorded runtime: no request carries memory yet (R-030 decision), so the test also pins the personal turn; REQ-KNOW-44/49 must read memory through the same binding.
- Two personal activities that open the same folder (a free seat continued by a pass, REQ-L12) share that folder's memory: the folder is the activity's home and the learner is the same. Not separated by activity id, so a pass keeps the learner's earlier memory.
- Label: "기억 범위: 이 작업 공간 안에서만 · 수업 활동에서는 이 기억을 읽거나 쓰지 않아요." under the state line in the 기억 view, muted note style at 14px. The class wording of DES-KNOW-07 and the activity header line are CGP-KNOW-D-005.
- Not covered: an AI file tool in a class activity whose folder contains a personal activity folder could read files there; folder bounds belong to REQ-STUDIO-FOLDER-CONSENT, not this row.

