# ChatGPT desktop parity: master requirements register

Source: eight domain findings in `findings/*.md` (ChatGPT macOS desktop v26.1013.40934 vs HypeProof Studio/Chalk). Machine-readable register: `findings/master-register.csv` (one row per source row, nothing dropped).

## ID scheme

- Features: `CGP-<DOMAIN>-NNN`, the source number zero-padded (e.g. `CGP-CHAT-48` -> `CGP-CHAT-048`).
- Functional requirements: `CGP-<DOMAIN>-R-NNN`, numbered in source order per domain.
- Design requirements: `CGP-<DOMAIN>-D-NNN`, numbered in source order per domain.
- `orig_id` keeps the source ID verbatim; `source_file` gives `file.md:line`.
- `traces_to`: features list the Studio refs cited in "Studio/Chalk today"; requirements list the parent feature + Product Intent principles (`PI#n`); design rows list the requirement(s) they realise.
- `merged_into` is set on a duplicate; the canonical row has it empty. A canonical requirement takes the highest priority of the rows merged into it.
- `depends_on` lists canonical requirement IDs and `DEC-nn` human decisions (below).
- Requirement/design `verdict` is ADOPT when the parent feature is ADOPT, else ADAPT. Feature `verdict` is the first-listed verdict of a split row.

Rows: 994 in, 994 out (879 canonical, 115 merged).

| kind | rows | canonical | merged |
|---|---|---|---|
| feature | 537 | 455 | 82 |
| req | 238 | 221 | 17 |
| design | 219 | 203 | 16 |

## 1. Totals

### Features by domain x verdict (canonical only; all rows in brackets)

| domain | ADOPT | ADAPT | ALREADY | DEFER | REJECT | total |
|---|---|---|---|---|---|---|
| CHAT | 1 (1) | 25 (27) | 29 (35) | 13 (18) | 14 (19) | 82 (100) |
| KNOW | 0 (0) | 35 (37) | 11 (11) | 9 (13) | 10 (11) | 65 (72) |
| AGENT | 0 (1) | 27 (29) | 10 (13) | 12 (14) | 15 (15) | 64 (72) |
| ART | 1 (1) | 22 (22) | 11 (12) | 13 (13) | 11 (12) | 58 (60) |
| LEARN | 3 (3) | 12 (13) | 2 (5) | 7 (10) | 8 (12) | 32 (43) |
| VOICE | 4 (5) | 20 (23) | 9 (9) | 2 (7) | 3 (6) | 38 (50) |
| SHELL | 4 (5) | 25 (29) | 18 (23) | 16 (24) | 12 (17) | 75 (98) |
| DS | 10 (10) | 21 (21) | 5 (5) | 0 (1) | 5 (5) | 41 (42) |
| Total | 23 (26) | 187 (201) | 95 (113) | 72 (100) | 78 (97) | 455 (537) |

### Requirements and design rows by domain (canonical / all)

| domain | req canonical | req all | design canonical | design all |
|---|---|---|---|---|
| CHAT | 28 | 30 | 28 | 30 |
| KNOW | 35 | 37 | 35 | 37 |
| AGENT | 29 | 32 | 25 | 28 |
| ART | 23 | 23 | 23 | 23 |
| LEARN | 17 | 17 | 17 | 17 |
| VOICE | 25 | 30 | 18 | 22 |
| SHELL | 30 | 35 | 29 | 34 |
| DS | 34 | 34 | 28 | 28 |

### By surface (canonical rows)

Requirement surface is derived from the requirement text (Chalk-only wording -> Chalk) and falls back to the parent feature. `None` = rejected/no product surface.

| kind | Studio | Chalk | Both | Service | None |
|---|---|---|---|---|---|
| feature | 269 | 35 | 67 | 20 | 64 |
| req | 160 | 24 | 36 | 1 | 0 |
| design | 151 | 20 | 31 | 1 | 0 |

Canonical ADOPT/ADAPT features by surface: Studio 140, Chalk 19, Both 50, Service 1, None 0.

### By priority (canonical requirements)

| domain | P0 | P1 | P2 | total |
|---|---|---|---|---|
| CHAT | 3 | 9 | 16 | 28 |
| KNOW | 12 | 12 | 11 | 35 |
| AGENT | 9 | 15 | 5 | 29 |
| ART | 3 | 10 | 10 | 23 |
| LEARN | 4 | 7 | 6 | 17 |
| VOICE | 2 | 15 | 8 | 25 |
| SHELL | 3 | 19 | 8 | 30 |
| DS | 16 | 12 | 6 | 34 |
| Total | 52 | 99 | 70 | 221 |

| surface | P0 | P1 | P2 |
|---|---|---|---|
| Studio | 33 | 74 | 53 |
| Chalk | 3 | 12 | 9 |
| Both | 16 | 12 | 8 |
| Service | 0 | 1 | 0 |

## 2. Cross-domain merges

Each line: canonical row <- rows merged into it. Verdict in brackets when the merged row disagreed with the canonical one (those are listed again in DEC-34).

### Features

| canonical | title | merged rows |
|---|---|---|
| CGP-VOICE-017 [ADAPT] | In-composer dictation | CGP-CHAT-012 |
| CGP-VOICE-015 [ADAPT] | Appshots / screen context (window image + accessibility text) | CGP-CHAT-015 [ALREADY], CGP-SHELL-041 [ALREADY] |
| CGP-SHELL-069 [REJECT] | Per-chat usage popover | CGP-CHAT-017 [ALREADY] |
| CGP-AGENT-013 [ADAPT] | Thread goal | CGP-CHAT-031 [ALREADY] |
| CGP-KNOW-046 [ADAPT] | Per-chat memory switches (/memories) | CGP-CHAT-033 [ALREADY] |
| CGP-AGENT-001 [ADAPT] | Permission mode selector | CGP-CHAT-034 [ALREADY] |
| CGP-KNOW-047 [ADAPT] | Temporary chat | CGP-CHAT-036 [REJECT] |
| CGP-AGENT-012 [ADAPT] | Subagents (parallel delegation) | CGP-CHAT-055 [DEFER] |
| CGP-LEARN-017 [DEFER] | Flashcards (known/missed/unreviewed, shuffle, edit) | CGP-CHAT-058, CGP-KNOW-031 |
| CGP-KNOW-044 [ADAPT] | Memory citations on answers | CGP-CHAT-074 |
| CGP-AGENT-010 [DEFER] | Hooks approval + hook stats | CGP-CHAT-075 [REJECT] |
| CGP-AGENT-046 [ADAPT] | Attention states in task list | CGP-CHAT-078 [DEFER] |
| CGP-KNOW-008 [DEFER] | Project sharing and roles | CGP-CHAT-089 |
| CGP-KNOW-013 [ADAPT] | Project appearance (icon, colour) | CGP-CHAT-092 [DEFER] |
| CGP-SHELL-039 [REJECT] | Mini & Pets desktop companion | CGP-CHAT-093, CGP-LEARN-033, CGP-VOICE-048 [DEFER] |
| CGP-AGENT-020 [DEFER] | Local vs cloud execution | CGP-CHAT-094 [REJECT] |
| CGP-SHELL-090 [REJECT] | Commerce and finance | CGP-CHAT-096 |
| CGP-AGENT-053 [ADAPT] | Commit / push / PR with generated message | CGP-CHAT-100 [ALREADY] |
| CGP-AGENT-059 [REJECT] | Cloud terminal & remote hosts | CGP-KNOW-019, CGP-SHELL-098 [DEFER] |
| CGP-CHAT-006 [ADAPT] | Attach menu: files, photos, folders, library, browser tabs | CGP-KNOW-026 |
| CGP-CHAT-037 [REJECT] | Locked chats (PIN-hidden) | CGP-KNOW-053 [DEFER], CGP-SHELL-058 |
| CGP-AGENT-018 [REJECT] | Import from other AI apps | CGP-KNOW-066 [DEFER], CGP-SHELL-048 [DEFER] |
| CGP-AGENT-027 [ADAPT] | Workspace agent builder | CGP-KNOW-070 |
| CGP-LEARN-020 [DEFER] | Audio summary "Study guide" format | CGP-KNOW-071 |
| CGP-CHAT-030 [ADAPT] | Plan mode | CGP-AGENT-014 |
| CGP-CHAT-083 [DEFER] | Side chat (temporary) | CGP-AGENT-015 |
| CGP-CHAT-066 [DEFER] | Fork / branch chat from a turn | CGP-AGENT-016 [ALREADY] |
| CGP-KNOW-048 [ADAPT] | Agent memory as files / host-local memory | CGP-AGENT-033 |
| CGP-CHAT-047 [ALREADY] | Tool activity rows | CGP-AGENT-041 |
| CGP-CHAT-080 [ADAPT] | Find in chat (regex) | CGP-AGENT-048 [ADOPT] |
| CGP-CHAT-090 [ALREADY] | Feedback dialog with diagnostics | CGP-AGENT-063 |
| CGP-ART-037 [DEFER] | Pages (Spaces docs, canvas, sheets, slides) | CGP-AGENT-072, CGP-SHELL-092 |
| CGP-CHAT-054 [ALREADY] | Tool approval / connector consent card | CGP-ART-033 |
| CGP-KNOW-062 [REJECT] | Profile share card and visibility | CGP-ART-050 |
| CGP-DS-006 [REJECT] | Accent color picker | CGP-LEARN-022 |
| CGP-SHELL-052 [DEFER] | Parental controls linking | CGP-LEARN-024 |
| CGP-SHELL-056 [DEFER] | Trusted contact | CGP-LEARN-026 |
| CGP-SHELL-054 [ADAPT] | Quiet hours | CGP-LEARN-027 [ALREADY] |
| CGP-SHELL-051 [ALREADY] | Age status and unknown-age safeguards | CGP-LEARN-028 |
| CGP-SHELL-042 [ADAPT] | Teen welcome: interests → idea cards | CGP-LEARN-030 [REJECT] |
| CGP-SHELL-094 [DEFER] | Persistent agent "dot" and characters | CGP-LEARN-034 |
| CGP-AGENT-034 [ALREADY] | Templates gallery | CGP-LEARN-036 |
| CGP-AGENT-045 [ADAPT] | Mission Control | CGP-LEARN-037 |
| CGP-AGENT-056 [REJECT] | Codex Security scanning | CGP-LEARN-043 |
| CGP-ART-008 [ADAPT] | Webpage-suggested prompt transparency | CGP-VOICE-016 [ADOPT] |
| CGP-CHAT-067 [ADAPT] | Read aloud | CGP-VOICE-024 |
| CGP-CHAT-084 [REJECT] | Quick chat / popout hotkey window / floating composer | CGP-VOICE-026, CGP-VOICE-027 [DEFER], CGP-SHELL-007 [DEFER] |
| CGP-CHAT-086 [ADAPT] | Keyboard shortcuts dialog | CGP-VOICE-029 |
| CGP-AGENT-051 [DEFER] | Computer Use & Chrome tabs | CGP-VOICE-034 |
| CGP-AGENT-004 [ADAPT] | Command approval card | CGP-VOICE-035 |
| CGP-KNOW-052 [REJECT] | Computer history (Chronicle) | CGP-VOICE-036, CGP-SHELL-097 |
| CGP-AGENT-069 [REJECT] | Codex Micro hardware | CGP-VOICE-037, CGP-SHELL-096 |
| CGP-CHAT-013 [DEFER] | Audio attachment recording | CGP-VOICE-045 |
| CGP-KNOW-049 [ADAPT] | Memory onboarding and consent | CGP-VOICE-050 [DEFER] |
| CGP-AGENT-049 [ALREADY] | Workspace tabs/panes & command palette | CGP-SHELL-011 |
| CGP-AGENT-047 [ADAPT] | Notifications | CGP-SHELL-013 |
| CGP-DS-010 [ADAPT] | User text-size settings | CGP-SHELL-030 |
| CGP-DS-016 [ADAPT] | Reduced-motion tri-state | CGP-SHELL-031 [ADOPT] |
| CGP-DS-020 [REJECT] | Pointer-cursor preference | CGP-SHELL-032 [DEFER] |
| CGP-DS-030 [ADAPT] | IME composition guards | CGP-SHELL-033 [ALREADY] |
| CGP-CHAT-019 [ADAPT] | Composer tips (rotating TIP) | CGP-SHELL-035 |
| CGP-VOICE-023 [ADOPT] | Microphone device picker | CGP-SHELL-038 [ALREADY] |
| CGP-ART-009 [ADAPT] | External-link confirmation | CGP-SHELL-057 |
| CGP-LEARN-042 [REJECT] | Ads ("bazaar") and seller reporting | CGP-SHELL-076 |
| CGP-KNOW-068 [ADAPT] | Workspace recovery gate | CGP-SHELL-083 [ALREADY] |
| CGP-LEARN-035 [ALREADY] | Team Spaces with shared agent instructions + icon picker | CGP-SHELL-084 [DEFER] |
| CGP-KNOW-069 [REJECT] | WhatsApp account link | CGP-SHELL-091 |
| CGP-KNOW-057 [REJECT] | Writing style | CGP-SHELL-093 [DEFER] |
| CGP-AGENT-058 [DEFER] | Cloud environment setup | CGP-SHELL-095 |
| CGP-CHAT-040 [ADAPT] | Math (LaTeX) rendering + graphs | CGP-DS-040 [DEFER] |

### Functional requirements

| canonical | title | merged rows |
|---|---|---|
| CGP-KNOW-R-026 (P0) | An answer that used memory shows "기억 사용 N" listing the exact items; the learner can exclud | CGP-CHAT-R-013 |
| CGP-VOICE-R-012 (P1) | Dictation inserts transcript into the composer draft at the caret; it never auto-sends by  | CGP-CHAT-R-019 |
| CGP-CHAT-R-011 (P1) | The learner can attach a workspace file as context. | CGP-KNOW-R-014 |
| CGP-AGENT-R-015 (P1) | Chalk has one "수업 AI 설정" screen composing AI name/role/tone, instructions, model, effort,  | CGP-KNOW-R-037 |
| CGP-CHAT-R-004 (P1) | "먼저 계획 보기" mode shows a plan and waits for learner approval before any tool runs. | CGP-AGENT-R-011 |
| CGP-KNOW-R-030 (P1) | Memory is stored as readable files inside the activity (`.hypeproof/memory/` or the team-b | CGP-AGENT-R-018 |
| CGP-CHAT-R-027 (P2) | Find-in-chat searches the open transcript. | CGP-AGENT-R-025 |
| CGP-ART-R-007 (P0) | When page context (`page_context`) or an element capture is attached to a turn, the learne | CGP-VOICE-R-011 |
| CGP-DS-R-027 (P0) | IME composition never triggers Enter-send, Escape-close or any single-key shortcut | CGP-VOICE-R-013 |
| CGP-CHAT-R-009 (P1) | Each completed answer can be read aloud. | CGP-VOICE-R-020 |
| CGP-CHAT-R-030 (P2) | A shortcuts help sheet lists the chat keys that exist. | CGP-VOICE-R-022 |
| CGP-AGENT-R-004 (P1) | A command approval offers "이번 작업 동안 같은 종류 명령 허용" for a non-destructive command prefix. | CGP-VOICE-R-025 |
| CGP-AGENT-R-023 (P1) | Studio notifies when the coach finishes a turn or waits for approval while the chat panel  | CGP-SHELL-R-008 |
| CGP-DS-R-009 (P1) | Learner can choose a chat text size (기본 / 크게 / 아주 크게) | CGP-SHELL-R-017 |
| CGP-DS-R-015 (P0) | Reduced motion honors an explicit app/VS Code preference, falling back to the OS | CGP-SHELL-R-018 |
| CGP-CHAT-R-021 (P2) | At most one lesson-authored tip appears above the composer. | CGP-SHELL-R-019 |
| CGP-ART-R-008 (P0) | For minor cohorts (`browser_session.mode = "safe"`), every link the learner opens from cha | CGP-SHELL-R-026 |

### Design requirements

| canonical | title | merged rows |
|---|---|---|
| CGP-KNOW-D-026 (P0) | "기억 사용 N" chip in the answer metadata row; opens the source shelf on a 기억 tab. | CGP-CHAT-D-013 |
| CGP-VOICE-D-010 (P1) | Dictation button and states | CGP-CHAT-D-019 |
| CGP-CHAT-D-011 (P1) | File context chip | CGP-KNOW-D-014 |
| CGP-AGENT-D-013 (P1) | Single settings page with sections in order: 정체성 → 지시문 → 모델·처리 수준 → 기능·승인 → 시작 문장 → 미리보기. | CGP-KNOW-D-037 |
| CGP-CHAT-D-004 (P1) | Plan mode indicator and plan card | CGP-AGENT-D-010 |
| CGP-KNOW-D-030 (P1) | Memory files view reuses the "내 작품" drawer with a 기억 filter. | CGP-AGENT-D-016 |
| CGP-CHAT-D-027 (P2) | Find bar | CGP-AGENT-D-021 |
| CGP-ART-D-007 (P0) | An attachment chip "페이지 내용 · {host}" in the composer. Clicking it expands a read-only pane | CGP-VOICE-D-009 |
| CGP-DS-D-024 (P0) | IME guard covers Enter, Escape, Tab, Arrow-up history and Cmd/Ctrl+Enter | CGP-VOICE-D-011 |
| CGP-CHAT-D-009 (P1) | Read-aloud control | CGP-VOICE-D-016 |
| CGP-AGENT-D-003 (P1) | Command approval modal: purpose line (16px) first, `$ command` in monospace block with hor | CGP-VOICE-D-019 |
| CGP-AGENT-D-020 (P1) | In-app notice: toast bottom-right of chat panel, 5 s, with "열기"; OS notification text "코치가 | CGP-SHELL-D-007 |
| CGP-DS-D-006 (P1) | Text size: 16 / 18 / 20px body; controls scale proportionally; 44px targets unchanged | CGP-SHELL-D-016 |
| CGP-DS-D-012 (P0) | Reduced-motion state is on `<html data-reduced-motion=true\|false>` set by the host; CSS ga | CGP-SHELL-D-017 |
| CGP-CHAT-D-021 (P2) | Lesson tip | CGP-SHELL-D-018 |
| CGP-ART-D-008 (P0) | Adult confirmation: a small dialog "바깥 사이트를 열까요?" with the host in bold, **열기** and **링크 복 | CGP-SHELL-D-025 |

Related but deliberately not merged (different behavior, same epic): task search CGP-CHAT-R-026 vs rail filter CGP-KNOW-R-001; per-turn review bar CGP-ART-R-002 vs per-task changes panel CGP-AGENT-R-026 vs "AI가 한 일" CGP-ART-R-020; Chalk usage CGP-AGENT-R-017 (runs) vs CGP-SHELL-R-031 (budget); denial source CGP-AGENT-R-007 vs locked settings CGP-SHELL-R-015; export CGP-SHELL-R-028 vs class-end take-away CGP-KNOW-R-035; per-turn render fallback CGP-CHAT-R-016 vs panel error CGP-SHELL-R-013; shortcut sheet design CGP-VOICE-D-017 (covers voice commands too).

## 3. P0 requirements (deduplicated)

52 canonical P0 requirements.

| id | orig_id | requirement | surface | depends on |
|---|---|---|---|---|
| CGP-CHAT-R-001 | CGP-CHAT-R48 | The chat announces response lifecycle to assistive tech. | Studio | - |
| CGP-CHAT-R-002 | CGP-CHAT-R65 | The learner can edit their latest sent prompt and resend it. | Studio | DEC-08 |
| CGP-CHAT-R-003 | CGP-CHAT-R53 | A coach question offering choices renders as a card that requires an explicit learner pick. | Studio | - |
| CGP-KNOW-R-005 | REQ-KNOW-07 | Memory is scoped to one activity; a class or team activity never reads or writes the learner's personal memory, and the scope is fixed at activity creation. | Studio | CGP-KNOW-R-022; DEC-01 |
| CGP-KNOW-R-006 | REQ-KNOW-09 | Every action that sends learner content outside the activity (help request, collect, gallery, site publish, share) first lists what is sent, to whom, and what is excluded | Studio | - |
| CGP-KNOW-R-013 | REQ-KNOW-24 | Deleting a learner file through Studio moves it to the activity trash; it can be restored to its original path until the activity is removed. | Studio | DEC-12; DEC-13 |
| CGP-KNOW-R-017 | REQ-KNOW-30 | Each learner artifact has a visible version list (who changed it, when) and restore archives the current copy before replacing it. | Studio | DEC-12 |
| CGP-KNOW-R-020 | REQ-KNOW-37 | Each attachment failure cause has its own learner message and next step; the attachment chip and draft remain. | Studio | - |
| CGP-KNOW-R-022 | REQ-KNOW-40 | Memory is available only when the activity's Service profile enables it; minor cohorts default to off; the current state is visible in the activity. | Both | DEC-01; DEC-02 |
| CGP-KNOW-R-023 | REQ-KNOW-41 | The learner can view and delete each remembered item; a deleted item is absent from all later requests. | Studio | CGP-KNOW-R-022; CGP-KNOW-R-030; DEC-01 |
| CGP-KNOW-R-026 | REQ-KNOW-44 | An answer that used memory shows "기억 사용 N" listing the exact items; the learner can exclude an item from the rest of this task. | Studio | CGP-KNOW-R-022; CGP-KNOW-R-030; DEC-01 |
| CGP-KNOW-R-027 | REQ-KNOW-45 | Every memory write appears as a timeline line in the turn that caused it, with an undo. | Studio | CGP-KNOW-R-022; CGP-KNOW-R-030; DEC-01 |
| CGP-KNOW-R-031 | REQ-KNOW-49 | First enablement of memory shows once what is stored, where, who can read it and how to delete it; for minors the enablement happens in Chalk, not in a learner pop-up. | Both | CGP-KNOW-R-022; DEC-01; DEC-02 |
| CGP-KNOW-R-033 | REQ-KNOW-51 | Help, collect, gallery and publish payloads exclude memory files unless the learner explicitly selects one. | Studio | CGP-KNOW-R-006; DEC-01 |
| CGP-KNOW-R-036 | REQ-KNOW-68 | When an activity can no longer run AI (class ended, token expired, cohort paused, budget exhausted), one status screen states the cause, what still works and who can fix  | Studio | - |
| CGP-AGENT-R-001 | REQ-CGP-AGENT-01a | Chalk lets the instructor choose one approval preset per lesson version from `항상 묻기`, `중요한 것만 묻기`, `바꾸기 전에 묻기`; there is no full-access preset. | Chalk | DEC-11 |
| CGP-AGENT-R-002 | REQ-CGP-AGENT-01b | Studio shows the active approval preset next to the composer as read-only text. | Studio | CGP-AGENT-R-001; DEC-11 |
| CGP-AGENT-R-003 | REQ-CGP-AGENT-03 | Studio shows a "이 수업에서 AI가 할 수 있는 일" card derived from the resolved feature set (`read·write·shell·subagents·browser·web_search`) and the approval preset. | Studio | CGP-AGENT-R-001; CGP-AGENT-R-019; DEC-11 |
| CGP-AGENT-R-005 | REQ-CGP-AGENT-05 | A write approval lists every file the tool call will change, in workspace-relative form. | Studio | - |
| CGP-AGENT-R-007 | REQ-CGP-AGENT-08 | Every denied tool call or disabled feature names its source: lesson setting, platform safety rule, or unsupported app version. | Both | - |
| CGP-AGENT-R-008 | REQ-CGP-AGENT-09 | A model refusal on either runtime shows a composer banner with what the learner can still do. | Studio | - |
| CGP-AGENT-R-021 | REQ-CGP-AGENT-45 | Chalk board uses five student states: 작업 중 / 막힘 / 선생님 확인 필요 / 쉬는 중 / 끝남, plus 확인 불가. | Chalk | - |
| CGP-AGENT-R-022 | REQ-CGP-AGENT-46 | Studio's task list shows each task's AE-03 state, and one command moves focus to the next task waiting on the learner. | Studio | - |
| CGP-AGENT-R-026 | REQ-CGP-AGENT-52 | Each task has a "바뀐 것" panel listing changed files with before/after and restore. | Studio | CGP-KNOW-R-017; DEC-12 |
| CGP-ART-R-002 | REQ-ART-02 | After the coach finishes a turn that changed the learner's page, the preview shows a review bar for that turn: the number of changed files and units (from `diffGuard`), a | Studio | CGP-KNOW-R-017; DEC-12 |
| CGP-ART-R-007 | REQ-ART-07 | When page context (`page_context`) or an element capture is attached to a turn, the learner sees exactly the text that will be sent, labeled with its source page origin,  | Studio | - |
| CGP-ART-R-008 | REQ-ART-08 | For minor cohorts (`browser_session.mode = "safe"`), every link the learner opens from chat or preview opens inside the integrated safe-session browser, never the system  | Studio | DEC-14 |
| CGP-LEARN-R-001 | REQ-CGP-LEARN-01 | An interactive block appears for a learner only when the confirmed lesson version attaches it to the current `SessionDesign` step (`steps[].materials[]`); the coach canno | Studio | DEC-18; DEC-19 |
| CGP-LEARN-R-002 | REQ-CGP-LEARN-02 | A block never sits in the work canvas and never shows capability names, scores, grades or "correct/incorrect" judgments. | Both | CGP-LEARN-R-001 |
| CGP-LEARN-R-003 | REQ-CGP-LEARN-03 | Every block exposes a live text equivalent: a title, a controls help sentence, and a state description that updates on each change. | Studio | CGP-LEARN-R-001; DEC-20 |
| CGP-LEARN-R-013 | REQ-CGP-LEARN-13 | When minor-cohort input is blocked for self-harm, the learner sees Korean help lines and the class instructor gets an immediate safety signal without conversation text. | Both | DEC-22 |
| CGP-VOICE-R-004 | REQ-CGPV-04 | First voice start shows a disclosure stating the actual retention policy for audio and transcript | Studio | DEC-05 |
| CGP-VOICE-R-024 | REQ-CGPV-33 | Class feature allowlist gains `voice`, `dictation`, `read_aloud` keys | Both | DEC-06; DEC-07 |
| CGP-SHELL-R-001 | REQ-SHELL-01 | During an active class session window, Studio does not show an update install prompt or start an install. | Studio | - |
| CGP-SHELL-R-004 | REQ-SHELL-04 | Quitting or closing the last window while a coach turn runs, a preview build is in progress or an unsent queued message exists asks for confirmation and names what will s | Studio | - |
| CGP-SHELL-R-029 | REQ-SHELL-29 | Before sending, a pass holder sees the remaining requests in the pass and when that number was confirmed. | Studio | DEC-26 |
| CGP-DS-R-001 | REQ-CGP-DS-01 | Studio chat webview and Chalk resolve every color, font, size, radius, shadow and duration from one token source with primitive → semantic → component tiers | Both | CGP-DS-R-002; DEC-27 |
| CGP-DS-R-002 | REQ-CGP-DS-01a | The three conflicting palettes (SX `#202C24`, CC-R1 `#18231C`, CP-R1 `#17191d`/`#202226`) are reconciled into one documented set | Both | DEC-27 |
| CGP-DS-R-003 | REQ-CGP-DS-02 | Every semantic token in the Studio webview has a `--vscode-*` source and an HP fallback | Studio | CGP-DS-R-001; DEC-27 |
| CGP-DS-R-005 | REQ-CGP-DS-04 | Hover and pressed fills derive from the foreground via `color-mix`; boundaries that identify a control never do | Both | CGP-DS-R-001 |
| CGP-DS-R-006 | REQ-CGP-DS-05 | Status is expressed as named intents (info/caution/danger/success plus `source_state`), each with text, icon and color | Both | CGP-DS-R-001 |
| CGP-DS-R-008 | REQ-CGP-DS-09 | Learner text uses a semantic scale whose smallest step is 14px | Studio | CGP-DS-R-001; DEC-28; DEC-29 |
| CGP-DS-R-010 | REQ-CGP-DS-11 | Spacing uses a 4px unit; interactive control heights come from a ladder whose learner minimum is 44px | Studio | CGP-DS-R-001 |
| CGP-DS-R-015 | REQ-CGP-DS-16 | Reduced motion honors an explicit app/VS Code preference, falling back to the OS | Studio | CGP-DS-R-014 |
| CGP-DS-R-017 | REQ-CGP-DS-18 | Focus ring is one token (2px solid, 2px offset) that is visible in every theme | Both | CGP-DS-R-001 |
| CGP-DS-R-019 | REQ-CGP-DS-21 | Composer placeholder text meets 4.5:1 | Studio | CGP-DS-R-034 |
| CGP-DS-R-021 | REQ-CGP-DS-23 | Chalk sidebar/list row actions are visible without hover | Chalk | - |
| CGP-DS-R-023 | REQ-CGP-DS-25 | Dialogs are reserved for destructive or settings flows; any dialog traps focus and restores it to its opener | Both | - |
| CGP-DS-R-024 | REQ-CGP-DS-26 | Tooltips never carry the only label of a control | Both | - |
| CGP-DS-R-027 | REQ-CGP-DS-30 | IME composition never triggers Enter-send, Escape-close or any single-key shortcut | Both | - |
| CGP-DS-R-028 | REQ-CGP-DS-31 | Korean prose wraps at word (eojeol) boundaries; long tokens still wrap | Both | - |
| CGP-DS-R-034 | REQ-CGP-DS-42 | No text token below 4.5:1 is used for readable text | Both | CGP-DS-R-002; DEC-27 |

## 4. Epics (requirements that should ship together)

Every canonical requirement sits in exactly one epic. Design rows follow their requirement via `traces_to`. Size: S <= ~1 week, M ~2-4 weeks, L > 1 month for one engineer (rough).

| epic | name | size | reqs | P0 | members | blocking decisions |
|---|---|---|---|---|---|---|
| E01 | Design tokens and theming foundation | L | 21 | 9 | CGP-DS-R-002, CGP-DS-R-001, CGP-DS-R-003, CGP-DS-R-004, CGP-DS-R-005, CGP-DS-R-006, CGP-DS-R-007, CGP-DS-R-008, CGP-DS-R-010, CGP-DS-R-011, CGP-DS-R-012, CGP-DS-R-014, CGP-DS-R-016, CGP-DS-R-017, CGP-DS-R-018, CGP-DS-R-026, CGP-DS-R-030, CGP-DS-R-032, CGP-DS-R-033, CGP-DS-R-034, CGP-SHELL-R-016 | DEC-27, DEC-28, DEC-29 |
| E02 | Korean input and reading comfort | S | 5 | 3 | CGP-DS-R-027, CGP-DS-R-028, CGP-DS-R-020, CGP-DS-R-031, CGP-DS-R-019 | DEC-29 |
| E03 | Learner accessibility, settings sheet and resilience | M | 14 | 5 | CGP-CHAT-R-001, CGP-DS-R-009, CGP-DS-R-015, CGP-DS-R-013, CGP-DS-R-022, CGP-DS-R-023, CGP-DS-R-024, CGP-DS-R-025, CGP-DS-R-021, CGP-DS-R-029, CGP-SHELL-R-012, CGP-SHELL-R-013, CGP-SHELL-R-014, CGP-CHAT-R-016 | - |
| E04 | Approval and capability transparency | L | 14 | 6 | CGP-AGENT-R-001, CGP-AGENT-R-002, CGP-AGENT-R-019, CGP-AGENT-R-003, CGP-AGENT-R-032, CGP-AGENT-R-004, CGP-AGENT-R-005, CGP-AGENT-R-006, CGP-AGENT-R-007, CGP-AGENT-R-008, CGP-ART-R-021, CGP-SHELL-R-015, CGP-SHELL-R-024, CGP-SHELL-R-010 | DEC-11 |
| E05 | Change review, versions and restore | L | 8 | 4 | CGP-ART-R-002, CGP-AGENT-R-026, CGP-KNOW-R-017, CGP-KNOW-R-013, CGP-KNOW-R-012, CGP-KNOW-R-016, CGP-ART-R-020, CGP-AGENT-R-028 | DEC-12, DEC-13 |
| E06 | Visible, file-based memory | L | 13 | 7 | CGP-KNOW-R-005, CGP-KNOW-R-022, CGP-KNOW-R-023, CGP-KNOW-R-024, CGP-KNOW-R-025, CGP-KNOW-R-026, CGP-KNOW-R-027, CGP-KNOW-R-028, CGP-KNOW-R-029, CGP-KNOW-R-030, CGP-KNOW-R-031, CGP-KNOW-R-032, CGP-KNOW-R-033 | DEC-01, DEC-02 |
| E07 | Outbound sharing and publish safety | M | 7 | 1 | CGP-KNOW-R-006, CGP-KNOW-R-007, CGP-KNOW-R-018, CGP-KNOW-R-034, CGP-ART-R-011, CGP-ART-R-012, CGP-ART-R-013 | DEC-15 |
| E08 | Safe browser, links and preview | M | 5 | 1 | CGP-ART-R-008, CGP-ART-R-009, CGP-ART-R-017, CGP-KNOW-R-021, CGP-KNOW-R-010 | DEC-14 |
| E09 | Composer context and attachments | L | 11 | 2 | CGP-CHAT-R-011, CGP-CHAT-R-017, CGP-CHAT-R-018, CGP-CHAT-R-020, CGP-CHAT-R-007, CGP-ART-R-007, CGP-VOICE-R-010, CGP-VOICE-R-009, CGP-KNOW-R-003, CGP-KNOW-R-015, CGP-KNOW-R-020 | - |
| E10 | Answer judgment and iteration | M | 10 | 2 | CGP-CHAT-R-003, CGP-CHAT-R-005, CGP-CHAT-R-006, CGP-CHAT-R-002, CGP-CHAT-R-008, CGP-CHAT-R-024, CGP-CHAT-R-029, CGP-CHAT-R-022, CGP-CHAT-R-014, CGP-KNOW-R-004 | DEC-08, DEC-09, DEC-32 |
| E11 | Plan, goal, steer and delegation | M | 5 | 0 | CGP-CHAT-R-004, CGP-CHAT-R-012, CGP-AGENT-R-010, CGP-AGENT-R-009, CGP-AGENT-R-029 | DEC-10 |
| E12 | Run state, waiting and attention | M | 10 | 1 | CGP-LEARN-R-016, CGP-AGENT-R-022, CGP-AGENT-R-023, CGP-AGENT-R-031, CGP-ART-R-019, CGP-CHAT-R-015, CGP-CHAT-R-010, CGP-SHELL-R-011, CGP-SHELL-R-007, CGP-VOICE-R-030 | - |
| E13 | Read aloud and dictation | M | 9 | 1 | CGP-VOICE-R-024, CGP-CHAT-R-009, CGP-VOICE-R-012, CGP-VOICE-R-014, CGP-VOICE-R-015, CGP-VOICE-R-016, CGP-VOICE-R-017, CGP-VOICE-R-018, CGP-VOICE-R-019 | DEC-03, DEC-04, DEC-05, DEC-06, DEC-07 |
| E14 | Voice session deltas | M | 14 | 1 | CGP-VOICE-R-001, CGP-VOICE-R-002, CGP-VOICE-R-003, CGP-VOICE-R-004, CGP-VOICE-R-005, CGP-VOICE-R-006, CGP-VOICE-R-007, CGP-VOICE-R-008, CGP-VOICE-R-021, CGP-VOICE-R-023, CGP-VOICE-R-026, CGP-VOICE-R-027, CGP-VOICE-R-028, CGP-VOICE-R-029 | DEC-03, DEC-05 |
| E15 | Task navigation and housekeeping | M | 12 | 0 | CGP-CHAT-R-026, CGP-CHAT-R-027, CGP-CHAT-R-028, CGP-CHAT-R-025, CGP-CHAT-R-030, CGP-CHAT-R-023, CGP-CHAT-R-021, CGP-KNOW-R-001, CGP-KNOW-R-002, CGP-KNOW-R-008, CGP-KNOW-R-009, CGP-KNOW-R-011 | - |
| E16 | Interactive learning blocks | L | 12 | 3 | CGP-LEARN-R-001, CGP-LEARN-R-002, CGP-LEARN-R-003, CGP-LEARN-R-004, CGP-LEARN-R-005, CGP-LEARN-R-006, CGP-LEARN-R-007, CGP-LEARN-R-008, CGP-LEARN-R-009, CGP-LEARN-R-010, CGP-LEARN-R-011, CGP-LEARN-R-012 | DEC-18, DEC-19, DEC-20, DEC-21 |
| E17 | Minor safety escalation | S | 1 | 1 | CGP-LEARN-R-013 | DEC-22 |
| E18 | Chalk lesson AI authoring | L | 8 | 0 | CGP-AGENT-R-015, CGP-AGENT-R-014, CGP-AGENT-R-016, CGP-AGENT-R-020, CGP-ART-R-014, CGP-ART-R-004, CGP-LEARN-R-014, CGP-LEARN-R-015 | DEC-16, DEC-30 |
| E19 | Chalk classroom operations and reporting | L | 12 | 1 | CGP-AGENT-R-021, CGP-AGENT-R-013, CGP-AGENT-R-024, CGP-AGENT-R-017, CGP-AGENT-R-012, CGP-LEARN-R-017, CGP-SHELL-R-031, CGP-SHELL-R-034, CGP-SHELL-R-021, CGP-SHELL-R-032, CGP-ART-R-022, CGP-ART-R-005 | DEC-24, DEC-31 |
| E20 | Desktop shell, updates and OS integration | M | 9 | 2 | CGP-SHELL-R-001, CGP-SHELL-R-002, CGP-SHELL-R-003, CGP-SHELL-R-004, CGP-SHELL-R-005, CGP-SHELL-R-006, CGP-SHELL-R-009, CGP-SHELL-R-022, CGP-SHELL-R-035 | DEC-24 |
| E21 | Access, usage and class lifecycle | M | 11 | 2 | CGP-SHELL-R-029, CGP-SHELL-R-030, CGP-SHELL-R-025, CGP-SHELL-R-027, CGP-SHELL-R-028, CGP-SHELL-R-033, CGP-SHELL-R-023, CGP-SHELL-R-020, CGP-KNOW-R-035, CGP-KNOW-R-036, CGP-KNOW-R-019 | DEC-23, DEC-25, DEC-26 |
| E22 | Page and deck editing tools | M | 8 | 0 | CGP-ART-R-001, CGP-ART-R-003, CGP-ART-R-006, CGP-ART-R-010, CGP-ART-R-015, CGP-ART-R-016, CGP-ART-R-018, CGP-ART-R-023 | - |
| E23 | Adult and operator tools | S | 2 | 0 | CGP-AGENT-R-027, CGP-AGENT-R-030 | - |

## 5. Human decisions that block requirements

Owner is Jay unless stated. Blocked IDs are canonical master IDs.

| id | decision | blocked | owner |
|---|---|---|---|
| DEC-01 | Does Studio adopt memory at all; is there any server-side memory and who may read it (cr-memory #1450). Preferred shape: file-based memory inside the activity | CGP-KNOW-R-005, CGP-KNOW-R-022, CGP-KNOW-R-023, CGP-KNOW-R-024, CGP-KNOW-R-025, CGP-KNOW-R-026, CGP-KNOW-R-027, CGP-KNOW-R-028, CGP-KNOW-R-029, CGP-KNOW-R-030, CGP-KNOW-R-031, CGP-KNOW-R-033 | Jay + Service owner |
| DEC-02 | Who switches memory on for a minor cohort: instructor in Chalk, guardian, or nobody | CGP-KNOW-R-022, CGP-KNOW-R-031 | Jay |
| DEC-03 | Microphone capture path (REQ-R1 / ADR-0009): the core patch every mic feature depends on | CGP-VOICE-R-001, CGP-VOICE-R-002, CGP-VOICE-R-003, CGP-VOICE-R-012, CGP-VOICE-R-014, CGP-VOICE-R-015, CGP-VOICE-R-016, CGP-VOICE-R-017, CGP-VOICE-R-018, CGP-VOICE-R-019, CGP-VOICE-R-026, CGP-VOICE-R-027 | Jay |
| DEC-04 | Dictation spec home (VO-48+ in voice-conversation.md or its own file) and whether read-aloud (no mic) ships first | CGP-VOICE-R-012, CGP-CHAT-R-009 | Jay |
| DEC-05 | Audio and transcript retention policy (VO-25); the disclosure copy cannot be written truthfully before it | CGP-VOICE-R-004, CGP-VOICE-R-016 | Jay |
| DEC-06 | Audio metering: are TTS/STT inside the one-request unit or a separate audio entitlement (REQ-R3); default for elementary cohorts | CGP-CHAT-R-009, CGP-VOICE-R-012, CGP-VOICE-R-024 | Jay |
| DEC-07 | New class feature keys voice / dictation / read_aloud need a Service profile schema change | CGP-VOICE-R-024 | Service owner |
| DEC-08 | Does the original prompt/answer of an edit-and-resend count as a separate attempt in the observation record (MC-*) | CGP-CHAT-R-002 | Jay (measurement-core owner) |
| DEC-09 | Learner answer verdict: local spool only, or visible to the instructor in Chalk (AE-20 forbids raw-content surveillance) | CGP-CHAT-R-005 | Jay |
| DEC-10 | Plan mode: learner toggle or a fifth instructor help mode (AE-36); only learner edits/approval count as evidence (AE-35) | CGP-CHAT-R-004 | Jay |
| DEC-11 | Approval preset granularity: per lesson version or per lesson step (AE-10 vs rehearsal cost AE-11) | CGP-AGENT-R-001, CGP-AGENT-R-002, CGP-AGENT-R-019, CGP-AGENT-R-003 | Jay |
| DEC-12 | Per-turn pre-images / version archive for minor seats (adultArchive.ts is adult-only today): storage on school PCs and "raw input retention" reading | CGP-ART-R-002, CGP-KNOW-R-017, CGP-AGENT-R-026, CGP-KNOW-R-013 | Jay |
| DEC-13 | Trash retention: life of the activity vs 30 days, and what happens at activity removal (US-10) | CGP-KNOW-R-013 | Jay |
| DEC-14 | External links for minors: force the in-app safe-session browser (ART) or show full URL + confirm (SHELL); does a blocked click notify the instructor | CGP-ART-R-008 | Jay |
| DEC-15 | Minor-cohort first publish: instructor confirmation step and whether the CR-20 clock starts at confirmation | CGP-ART-R-012 | Jay |
| DEC-16 | Starter style/template source: knowledge base (KB-03, versioned) or cohort profile | CGP-ART-R-014 | Jay |
| DEC-17 | Image generation: cost, minors' likeness in reference photos, provider policy | CGP-ART-040 | Jay |
| DEC-18 | Learning blocks: who authors the first blocks, which curricula first, and whether coach-selected blocks are ever allowed for adults | CGP-LEARN-R-001, CGP-LEARN-R-012 | Jay |
| DEC-19 | Schema home for steps[].materials[] (hps-session-design bump or existing `ui` field) | CGP-LEARN-R-001, CGP-LEARN-R-004, CGP-LEARN-R-009, CGP-LEARN-R-012 | Jay + Service owner |
| DEC-20 | Block rendering runtime: sandboxed iframe per block vs in-webview component (bundle weight, CSP REQ-L2) | CGP-LEARN-R-003, CGP-LEARN-R-005, CGP-LEARN-R-006, CGP-LEARN-R-007, CGP-LEARN-R-009, CGP-LEARN-R-010 | Jay |
| DEC-21 | Does a sampling-block expectation ever become a criterion_set event (risk of a disguised quiz, SX-57) | CGP-LEARN-R-008 | Jay (MC/SX owner) |
| DEC-22 | Self-harm escalation: PIPA/legal review, responsible adult outside class hours for 14+ personal preview, no mid-class account pause | CGP-LEARN-R-013 | Jay |
| DEC-23 | PIPA guardian/consent decisions: guardian linking, trusted contact, account/data deletion by learner or guardian | CGP-SHELL-R-027, CGP-SHELL-052, CGP-SHELL-056 | Jay |
| DEC-24 | Cohort update freeze vs security fixes: who may override, and is there a Service minimum-version gate | CGP-SHELL-R-003, CGP-SHELL-R-034 | Jay |
| DEC-25 | Service must expose the class window end time to the client | CGP-SHELL-R-025 | Service owner |
| DEC-26 | Service must expose a confirmed remaining-request count with an as-of time (AB-15 forbids inventing one) | CGP-SHELL-R-029, CGP-SHELL-R-030 | Service owner |
| DEC-27 | Canonical palette: SX #202C24 vs CC-R1 #18231C vs CP-R1 #17191d/#202226; is the personal-chat palette meant to differ | CGP-DS-R-002, CGP-DS-R-001, CGP-DS-R-003, CGP-DS-R-034, CGP-SHELL-R-016 | Jay |
| DEC-28 | Bundle Pretendard (OFL) or use system fonts only (size, CSP, Windows Malgun Gothic Latin) | CGP-DS-R-007, CGP-DS-R-008 | Jay |
| DEC-29 | Scope of DES-02 (>=14px) for the personal chat metadata (CC-R1 11px) and line measure 35 vs 40 syllables (test with learners) | CGP-DS-R-008, CGP-DS-R-020 | Jay |
| DEC-30 | Chalk conversation-starter field in hps-authoring-batch/1 plus frozen-version compatibility | CGP-AGENT-R-015 | Jay + Service owner |
| DEC-31 | Chalk scheduled lesson operations need a Service scheduler (Worker cron availability/cost) | CGP-AGENT-R-012 | Jay + Service owner |
| DEC-32 | Math rendering: any curriculum need beyond adult courses; otherwise move to DEFER | CGP-CHAT-R-022 | Jay |
| DEC-33 | Shared team memory / team projects across several learners' PCs (no contract yet) | CGP-KNOW-008 | Jay |
| DEC-34 | Cross-domain verdict conflicts exposed by the merge (see conflict table); the canonical verdict stands until Jay rules | CGP-KNOW-047, CGP-SHELL-042, CGP-AGENT-046, CGP-AGENT-012, CGP-CHAT-040, CGP-KNOW-013, CGP-SHELL-039, CGP-CHAT-084, CGP-AGENT-018, CGP-AGENT-059, CGP-AGENT-020, CGP-AGENT-053, CGP-KNOW-057, CGP-CHAT-037, CGP-LEARN-035, CGP-KNOW-068, CGP-VOICE-023, CGP-DS-020, CGP-CHAT-066, CGP-KNOW-062 | Jay |

### DEC-34 detail: verdict conflicts exposed by merging

ALREADY vs ADAPT/ADOPT pairs usually mean partial coverage (the ADAPT side adds the missing part) and need no ruling. The pairs that need a product call are REJECT/DEFER vs ADOPT/ADAPT and REJECT vs DEFER.

| canonical | feature | canonical verdict | conflicting rows |
|---|---|---|---|
| CGP-VOICE-015 | Appshots / screen context (window image + accessibility text | ADAPT | CGP-CHAT-015 ALREADY; CGP-SHELL-041 ALREADY |
| CGP-SHELL-069 | Per-chat usage popover | REJECT | CGP-CHAT-017 ALREADY |
| CGP-AGENT-013 | Thread goal | ADAPT | CGP-CHAT-031 ALREADY |
| CGP-KNOW-046 | Per-chat memory switches (/memories) | ADAPT | CGP-CHAT-033 ALREADY |
| CGP-AGENT-001 | Permission mode selector | ADAPT | CGP-CHAT-034 ALREADY |
| CGP-KNOW-047 | Temporary chat | ADAPT | CGP-CHAT-036 REJECT |
| CGP-AGENT-012 | Subagents (parallel delegation) | ADAPT | CGP-CHAT-055 DEFER |
| CGP-AGENT-010 | Hooks approval + hook stats | DEFER | CGP-CHAT-075 REJECT |
| CGP-AGENT-046 | Attention states in task list | ADAPT | CGP-CHAT-078 DEFER |
| CGP-KNOW-013 | Project appearance (icon, colour) | ADAPT | CGP-CHAT-092 DEFER |
| CGP-SHELL-039 | Mini & Pets desktop companion | REJECT | CGP-VOICE-048 DEFER |
| CGP-AGENT-020 | Local vs cloud execution | DEFER | CGP-CHAT-094 REJECT |
| CGP-AGENT-053 | Commit / push / PR with generated message | ADAPT | CGP-CHAT-100 ALREADY |
| CGP-AGENT-059 | Cloud terminal & remote hosts | REJECT | CGP-SHELL-098 DEFER |
| CGP-CHAT-037 | Locked chats (PIN-hidden) | REJECT | CGP-KNOW-053 DEFER |
| CGP-AGENT-018 | Import from other AI apps | REJECT | CGP-KNOW-066 DEFER; CGP-SHELL-048 DEFER |
| CGP-CHAT-066 | Fork / branch chat from a turn | DEFER | CGP-AGENT-016 ALREADY |
| CGP-CHAT-080 | Find in chat (regex) | ADAPT | CGP-AGENT-048 ADOPT |
| CGP-SHELL-054 | Quiet hours | ADAPT | CGP-LEARN-027 ALREADY |
| CGP-SHELL-042 | Teen welcome: interests → idea cards | ADAPT | CGP-LEARN-030 REJECT |
| CGP-ART-008 | Webpage-suggested prompt transparency | ADAPT | CGP-VOICE-016 ADOPT |
| CGP-CHAT-084 | Quick chat / popout hotkey window / floating composer | REJECT | CGP-VOICE-027 DEFER; CGP-SHELL-007 DEFER |
| CGP-KNOW-049 | Memory onboarding and consent | ADAPT | CGP-VOICE-050 DEFER |
| CGP-DS-016 | Reduced-motion tri-state | ADAPT | CGP-SHELL-031 ADOPT |
| CGP-DS-020 | Pointer-cursor preference | REJECT | CGP-SHELL-032 DEFER |
| CGP-DS-030 | IME composition guards | ADAPT | CGP-SHELL-033 ALREADY |
| CGP-VOICE-023 | Microphone device picker | ADOPT | CGP-SHELL-038 ALREADY |
| CGP-KNOW-068 | Workspace recovery gate | ADAPT | CGP-SHELL-083 ALREADY |
| CGP-LEARN-035 | Team Spaces with shared agent instructions + icon picker | ALREADY | CGP-SHELL-084 DEFER |
| CGP-KNOW-057 | Writing style | REJECT | CGP-SHELL-093 DEFER |
| CGP-CHAT-040 | Math (LaTeX) rendering + graphs | ADAPT | CGP-DS-040 DEFER |

Some of these are fact checks rather than product calls: CGP-CHAT-066 vs CGP-AGENT-016 (is UX22 recovery-fork "fork chat"?), CGP-VOICE-023 vs CGP-SHELL-038 (does a mic picker exist?), CGP-KNOW-068 vs CGP-SHELL-083 (is a learner-facing "AI unavailable" status screen shipped?).

## 6. Technical unknowns (not human decisions, but they can flip a row)

- Steer (CGP-CHAT-R-012): whether the Agent SDK / proxy paths accept mid-turn user input; if not, the row degrades to DEFER.
- Subagent panel (CGP-AGENT-R-009): which Agent SDK 0.3.207 events carry child status and final text.
- Notifications (CGP-AGENT-R-023): whether VSCodium notifications reach macOS Notification Center and Windows reliably from a built-in extension.
- Reduced motion / text size (CGP-DS-R-015, CGP-DS-R-009): whether `workbench.reduceMotion` and zoom reach the webview or must be bridged by the host.
- Korean native menus (CGP-SHELL-R-006): whether VS Code menus localize without a language pack.
- Built-in browser downloads (CGP-KNOW-R-021): whether Electron's default download prompt already appears.
- Studio webview source and CSS were absent from the snapshot: every ALREADY row is doc-based, not runtime-verified.
- ChatGPT feature flags were not resolved: a shipped string proves code, not availability.
