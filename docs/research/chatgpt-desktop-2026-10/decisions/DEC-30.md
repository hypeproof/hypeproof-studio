## DEC-30 step 2: 시작 문장, AI 역할, AI 말투 in Chalk (CGP-AGENT-R-015 remainder, CGP-AGENT-D-013, CGP-KNOW-R-037, CGP-KNOW-D-037; 2026-11-10)

DEC-30 (starter prompts plus AI role and tone in the lesson contract) is decided by Jay; the Service contract is live (hypeproof-service#348, deployed service-v2026.11.10-1). This records the Chalk part. Confirmed by Jay: yes (2026-11-10).

- Decided by Jay: tone is a closed choice of four (`friendly`, `calm`, `playful`, `formal`), never free text; starters are also shown in rehearsal and in the frozen-version read-only summary.
- Chalk renders what the Service serves: tone ids, Korean labels and `minor_safe` come from `assistant_tones` on the authoring features read. Chalk keeps only fallback names for a saved or frozen tone before that read; `chalk/test/fixtures/assistant-tone-catalog.json` plus `chalk/test/assistant-tone-drift.test.mjs` pin them (the Service-side test that vendors the same fixture is a follow-up in hypeproof-service).
- Unset sends no key: 코호트 기본 tone, empty role and no starters leave `assistant.role`, `assistant.tone` and `starters` out, so an old lesson keeps its bytes and digest. Empty starter rows are dropped, duplicates (NFKC, case-insensitive) are warned live and block the save.
- Role and tone live inside `assistant`, which the Service requires to carry `display_name`; Chalk sends the block only with a name and points at the name field otherwise.
- Minors: the Service clamps. Chalk only warns (per-row note, and a warning when the lesson's 대상 단계 is lv1 or lv2).
- Older Service (no `assistant_tones`): the three inputs and the nav link hide after the features read and are not sent; before that read they show, and the Service's 400 gets a Korean hint.
- Section and copy wording (시작 문장, 역할, 말투, the CGP-KNOW-R-037 disclosure next to the material field) is the agent's wording.
- Not in this change: Studio chips (step 3) and the coach style block (step 4).

## DEC-30 step 3: starter chips in Studio (CGP-KNOW-R-037 learner side, CGP-KNOW-D-037; 2026-11-10)

Agent implementation choice for the Studio part of DEC-30, which Jay decided; the Service serves the data (hypeproof-service#348, service-v2026.11.10-1) and Chalk authors it (#3685). Confirmed by Jay: no.

- Read path: `starters` is a top-level `/v1/profile` key (not inside `lesson.content`), read with `servedLessonStarters()`, which keeps at most four safe, distinct single lines and skips anything else. Absent means no UI.
- Behaviour: wrapping compact chips above the composer; a click inserts into the draft and never sends; a manual draft is kept (the personal-starter rule); hidden after the learner's first message in the task; not drawn in the instructor console; a minor seat behaves the same.
- Layout: 44px targets (`--hp-control-min`), 14px floor (`--hp-font-caption`), tokens only, no icon. Hint line and group label ("이 수업의 시작 문장", "누르면 입력창에 들어가요. 고쳐서 보내세요.") are the agent's wording.
- Not in this change: the AI role line under the name (optional; the header has no second row today, and `assistant_style` is typed only) and any role/tone in a coach prompt (step 4, after a safety review).

