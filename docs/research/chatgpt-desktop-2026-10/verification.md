# Verification of the 8 domain findings against Studio origin/main

Base: `studio@origin/main:` snapshot (docs, chalk/src, extensions/hypeproof-chat src + webview-ui + media). It does NOT contain VSCodium patches, the Electron main process, Service `worker/`, or package.json, so claims about those are UNVERIFIABLE unless a doc settles them. Absence claims are bounded grep searches; the search terms are given per row. Nothing was run or built; no git repo was touched.

## Overall counts

| Domain pair | P0 claims checked | P0: CONFIRMED / PARTIAL / REFUTED / UNVERIFIABLE or no-claim | P0 that duplicate an existing REQ (→ "extend") | ALREADY: IMPLEMENTED / PARTIAL or SPECIFIED-ONLY / NOT-FOUND / UNVERIFIABLE | REJECT conflicts with a Studio REQ or shipped code |
|---|---|---|---|---|---|
| chat-core + design-system | 19 | 8 / 8 (partial+refuted) / — / 3 no-claim | 14 | 27 / 13 / 0 / 2 (42) | 0 conflicts; 1 caveat (CHAT-29 vs REQ-L12) |
| agents + artifacts | 12 | 5 / 4 / 3 / 0 | 9 | 15 / 9 / 1 / 4 (29) | 1 (ART-44 custom domains ship) + 2 rest on stale REQ text |
| learning + voice | 7 | 5 / 2 / 0 / 0 | 4 | 2 / 10 / 0 / 2 (14) | 0 |
| projects + settings | 15 | 5 / 7 / 1 / 1 | 9 | 19 / 11 / 0 / 6 (36) | 3 need correction (KNOW-16, SHELL-72, SHELL-43) |
| **Total** | **53** | **23 / 21+ / 4+ / 5** (chat-design reports refuted+partial jointly) | **36** | **63 / 43 / 1 / 14 (121)** | **1 contradicts shipped code; 6 need caveats** |

## Most important corrections (spot-checked by the merger)

1. **SHELL-29 (remaining-requests meter) REFUTED** — already ships: `webview-ui/src/AccessControl.tsx:12,25` ("… 남음", unknown → "미확인"), `AccountEntry.tsx:21` ("AI 요청 N / M회 남음"). Becomes "extend REQ-L9".
2. **Link chips → system browser without confirmation: CONFIRMED** for chat markdown links / legacy citation chips — `src/chatPanelProvider.ts:4542-4551` calls `vscode.env.openExternal` after only an http(s) scheme check. Task-workspace citations instead open an integrated browser tab. REQ-ART-08 must reconcile with `docs/requirements/classroom-admin.md:773` (instructor links deliberately use openExternal).
3. **".hp-cta-secondary border 1.75:1": CONFIRMED in substance, wrong class name** — source class is `.hp-cta-quiet` (`webview-ui/src/styles.css:1305-1309`, `--hp-line #35483A` on `--hp-bg #151D19`, `tokens.css:20,28`); in lesson mode Send/Run/Retry/Install take the same 1px `--hp-line` border (`styles.css:1290-1296`). Fails DES-11 3:1.
4. **REQ-M17 "writes always reviewed" is stale** — REQ-E1 (corrected 2026-10-14) and `chatPanelProvider.ts:6192-6212`: writeFile has no modal, non-destructive shell auto-runs. Refutes REQ-CGP-AGENT-05's premise; AGENT-46 refuted (tasks never run concurrently, `TaskWorkspace.tsx:310`); "remember similar commands" gap refuted (`chatPanelProvider.ts:6086-6100`).
5. **"Minors have no version restore": PARTIAL** — kids'/world cohorts archive before overwrite (`chatPanelProvider.ts:3202-3256`); what is missing is a restore UI. A "프로젝트 기억" panel ships (gated per class), so "no learner memory" is half wrong.
6. **design-system.md premise REFUTED** — it assumed no Studio CSS; `tokens.css` (10 tokens) + ~2,595 lines of webview CSS ship. Text goes down to 10px (not 11px); IME guard covers Enter only; reduced motion follows only the OS.
7. **Chat-core P0s already shipped**: R53 choice card = `ReplyChoices.tsx` (CC-R1); R48 start/stop announced only in personal mode, no completion announcement (PARTIAL).
8. **"No quit guard" (SHELL-04): UNVERIFIABLE app-wide** — extension src has no quit hook (searched `quit|before-quit|onWillShutdown` in `src/`); the Electron/VSCodium layer is absent from the snapshot.
9. **All 5 voice ALREADY (VO-xx) rows are SPECIFIED-ONLY** — helpers exist but `VoicePanel.tsx` is unmounted ("학생에게 이 패널은 열리지 않는다"). V-04's default copy "음성은 저장하지 않아요" asserts a retention policy VO-25 says still needs approval. LEARN-01 cites `SessionDesign.steps[].materials[]`, which does not exist. AE-15 restore points (relied on by chat-core and agents) exist only in docs.
10. **ART-44 REJECT (custom domains) contradicts shipped code** — `src/publish/customDomain.ts`, `docs/1017-dental.md:81`. AGENT-34 (lesson templates) marked ALREADY: nothing found. REQ-M30 ID is used twice in studio-requirements.md.
11. **"Only exhausted/expired pass messages exist" (SHELL-29 premise) REFUTED** — `AccessControl.tsx:3` has 7 state labels (ready/ended/paused/review_required/exhausted/not_configured/external_unknown); `errorBannerPresentation.ts:7-15` separates pass/auth/connection banners. KNOW-68 → "extend US-12". KNOW-16 "no upsell surface" is false for personal passes (`src/passPurchase.ts:191`).

---


## Part: Verification: chat-core.md + design-system.md vs studio-main (origin/main snapshot)

Paths: `X` = `studio@origin/main:extensions/hypeproof-chat`, `W` = `X/webview-ui/src`, `D` = `studio@origin/main:docs`, `C` = `studio@origin/main:chalk/src/ui`. Line numbers are from the snapshot.

Summary
- P0 rows checked: 19 (chat-core 3, design-system 16). Current-state claims: 8 CONFIRMED (2 of them "already met"), 8 REFUTED/PARTIAL, 3 not a state claim. 14 P0s overlap an existing requirement ID and should be "extend X" (DES-02/06/11, SX-49/50/52, TUX-CHAT-03, CC-R1 in REQ-STUDIO-CHAT-DETAIL).
- ALREADY rows checked: 42 (chat-core 36 incl. CHAT-70 sub-verdict, design-system 6). 27 IMPLEMENTED, 9 PARTIAL, 4 SPECIFIED-ONLY (AE-15 restore, AE-02 IDE context, moderation is Service-side, M1 lockdown is cohort-level), 2 UNVERIFIABLE (window chrome, Service moderation).
- REJECT rows checked: 24 (chat-core 19, design-system 5). 0 contradict an existing Studio REQ; 1 needs a caveat (CHAT-29 vs REQ-L12 in-app pass purchase).
- Biggest correction: design-system.md was written believing no Studio CSS existed. `W/tokens.css` (41 lines, 10 tokens) and 2,595 lines of webview CSS ship. Several "none"/"not specified" claims flip to "partial".
- Key confirmed defect: the quiet/secondary CTA border (`--hp-line #35483A` on `--hp-bg #151D19`) measures 1.75:1, which fails DES-11's 3:1. The class is `.hp-cta-quiet` in source (`W/styles.css:1305-1309`), not `.hp-cta-secondary`, which exists only in the design doc. Send also takes this style in lesson mode (`styles.css:1290-1296`).

### 1. P0 requirements: current-state claims and duplicates

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-CHAT-R48 (src CGP-CHAT-48) | "REQ-C14 uses role=note/aria-live for the disclosure only. No response-lifecycle announcement found" | REFUTED (partial lifecycle exists) | Start: `W/ChatDetails.tsx:42-46` `ResponsePending` `role="status"` "응답을 준비하고 있어요"/"답변 작성 중" (personal mode only, `W/ChatPanel.tsx:2104,2115,2135`); classroom mode renders a plain `<span>` "생각하는 중… ✨" (`ChatPanel.tsx:2104`) with no role. Stop: `ChatPanel.tsx:1258` `hps-stop-notice role=status aria-live=polite`. Completion: none (searched `답변이 끝`, `응답 완료`, `announce`, `aria-live`). 40+ other role=status/alert regions exist. | Reword "today" to: start and stop are announced in personal mode only, completion is never announced, classroom streaming has no live region. Narrow R48 to the completion announcement plus classroom parity. It extends REQ-STUDIO-CHAT-DETAIL rather than adding a new surface. |
| CGP-CHAT-R65 (src CGP-CHAT-65) | No edit-and-resend; "AE-15 is the only restore path" | CONFIRMED (no edit); PARTIAL (AE-15) | No edit of a sent turn (searched `editMessage`, `editLast`, `메시지 수정`, `resend`; docs searched the same). Only retry-on-error resend exists: `W/App.tsx:517` "다시 보내기" reuses the last prompt, `ChatPanel.tsx:2237`. AE-15 is a requirement only: `D/requirements/learning-agent-experience.md:37`. No restore-point code (searched `restorePoint`, `checkpoint`, `AE-15` in `X/src`, 0 hits). | Keep P0 as new. Say AE-15 is specified, not shipped, so "files not reverted implicitly" is true today because nothing reverts. |
| CGP-CHAT-R53 (src CGP-CHAT-53) | "No structured question card" | REFUTED | `W/ReplyChoices.tsx:4-15` renders a `role=group` "답변 선택" button card with numbered options, "직접 입력", "선택하면 입력창에 들어갑니다". `W/replyChoiceParser.ts:4-25` handles detection (2–8 options, explicit choice wording). Spec: `D/studio-requirements.md:153-156` (CC-R1 in REQ-STUDIO-CHAT-DETAIL): pick prepares an editable reply, only Send submits. Already true: no pre-select, no countdown, write-own, never auto-send. | DUPLICATE: make it "extend REQ-STUDIO-CHAT-DETAIL (CC-R1)". The new parts are a "추천" label, an explicit skip marker, and logging the choice to the REQ-Q1 spool. Drop "2–5 options" or reconcile it with the shipped 2–8. |
| REQ-CGP-DS-01 (src CGP-DS-01) | "Planned tokens.css with 10 tokens; none shipped in snapshot" | REFUTED | `W/tokens.css:19-30` ships 10 `--hp-*` tokens, imported first. A second token family, `--tw-*`, sits in `W/taskWorkspace.css:2-5`. Literal counts outside tokens.css: hex 288 (styles 204, start 37, chatDetails 22, taskWorkspace 18, citationPreview 7) and rgb(a) 45. Chalk hex: manage 199, authoring 82, console 71, issuer 64, budgets 52, board 29, sharing 16, learn 8, start 8. | Today: one-tier token file, no light pair (only a Paper override, `tokens.css:35-41`), and two parallel token families. The P0 extends SX-49 (`D/requirements/studio-learning-experience.md:110`), which owns roles. The "0 literals" acceptance is a large migration and should be sized that way. |
| REQ-CGP-DS-01a | Three conflicting palettes: SX `#202C24`, CC-R1 `#18231C`, CP-R1 `#17191d`/`#202226` | PARTIAL | The doc-level conflict is real: CC-R1 panel `#18231C` (`D/design/task-workspace.md:136`) vs SX panel `#202C24` (`tokens.css:21`). In source, though, `#18231C` is `--hp-ink-on-accent` (`tokens.css:27`, `start.css:377`), not a panel. CP-R1 `#17191d`/`#202226` are only dark fallbacks behind `--vscode-sideBar-background`/`--vscode-editor-background` (`taskWorkspace.css:2-3`, doc `task-workspace.md:68-69`). | Restate as: one doc conflict (CC-R1 vs SX panel value), plus two token families (`--hp-*` brand vs `--tw-*` host-theme). Not three competing brand palettes. Extend SX-49. |
| REQ-CGP-DS-02 (src CGP-DS-02) | Host bridge exists only as a doc rule | REFUTED (partially implemented) | `--vscode-*` references: styles.css 199, chatDetails 20, taskWorkspace 17, localReview 17, citationPreview 8. `--tw-*` maps to vscode with fallbacks. `--hp-*` has no vscode source (`tokens.css`). | Today: task workspace, citations and local review follow the host theme; HP lesson surfaces do not. Scope the P0 to the `--hp-*` tokens. |
| REQ-CGP-DS-04 (src CGP-DS-04) | Fixed hex borders `#35483A`/`#3A4A3E`; secondary CTA boundary 1.75:1 | CONFIRMED | `tokens.css:28` `--hp-line #35483A`; `C/manage.html:12,25` `#3A4A3E`. Computed: `#35483A` on `#151D19` = 1.75:1 and on `#202C24` = 1.48:1; `#3A4A3E` on `#151D19` = 1.82:1; tw divider `#34383e` on `#202226` = 1.35:1. Used as the only boundary of `.hp-cta-quiet` (`styles.css:1305-1309`) and of Send/run/retry in lesson mode (`styles.css:1290-1296`). `color-mix` appears only 5× (styles.css). | Use the class name `.hp-cta-quiet`. This is a live DES-11 violation (`D/requirements/classroom-design.md:35`, control boundary 3:1), so the P0 should be "extend DES-11 to Studio". |
| REQ-CGP-DS-05 | Status as named intents with icon + label | Not a state claim; DUPLICATE | SX-50 (`studio-learning-experience.md:111`) and SX-21 (:61) already require icon + wording and a grayscale-readable render. Source note: `styles.css` `.hp-mark` "SX-50 — state is icon + wording". | Extend SX-50/SX-21. Only the intent naming is new. |
| REQ-CGP-DS-09 (src CGP-DS-09) | Metadata 11px today (CC-R1); floor should be 14px | CONFIRMED (worse than stated) | Sub-14px `font-size` declarations in webview CSS: 10px ×12, 11px ×47, 12px ×81, 13px ×48 (styles, start, chatDetails, taskWorkspace, citationPreview, localReview). E.g. `citationPreview.css:16` 11px, `styles.css:1310` 13px. Personal body is 15px (`chatDetails.css:11`), not 16. | Today's floor is 10px, not 11. DUPLICATE of DES-02 (`classroom-design.md:26`: body 16, labels 14), so extend DES-02 to Studio learner surfaces. |
| REQ-CGP-DS-11 (src CGP-DS-11) | "None in Studio docs; Chalk ad hoc" | PARTIAL | 44px targets are already specified: DES-06 (`classroom-design.md:30`) and CC-R1 "retaining 44px targets" (`D/studio-requirements.md:150`). Source: 42 `min-height/height/min-width:44px` declarations, plus 19 heights between 20 and 39px. No 4px spacing token (searched `--hp-space`, `spacing unit`, `4px grid`). | Only the 4px unit is new. The 44px floor duplicates DES-06, so extend it. |
| REQ-CGP-DS-16 (src CGP-DS-16) | Reduced motion is OS media only (CP-05) | CONFIRMED | Only `@media (prefers-reduced-motion…)`: `chatDetails.css:100`, `start.css:361`, `citationPreview.css:27`, `styles.css:326,518,632,1446`, `taskWorkspace.css:103`. No app/VS Code setting (searched `reduceMotion`, `reduced-motion` class, `monaco-reduce-motion`). | Keep as new P0. |
| REQ-CGP-DS-18 (src CGP-DS-18) | Chalk lime ring exists; Studio has no single token | CONFIRMED with gaps | Chalk `focus-visible{outline:2px solid #D5F279;offset 2px}` and 3px variants (`C/manage.html`). `C/board.html` has 0 `focus-visible` rules. Studio uses mixed rings: `--hp-accent` (`styles.css:1325,1334`), `--vscode-focusBorder` (`styles.css:1355`, `localReview.css`, offset 3px); chatDetails.css has 0 focus-visible rules. | Duplicates DES-06/DES-11, so extend them. Name board.html and chatDetails.css as the gaps. |
| REQ-CGP-DS-21 | Placeholder must reach 4.5:1 ("do not use opacity .5") | CONFIRMED already met on the audited surfaces | `.5` opacity is ChatGPT's value, not Studio's. Studio: `chatDetails.css:61` placeholder `--tw-muted` (`#a4aab3` fallback) at opacity 1 = 6.81:1 on `#202226`; `styles.css:1611` `--hp-muted #ACB9A5` = 8.38:1 on `#151D19`. The default classroom composer placeholder takes the VS Code theme, which I did not measure. | Downgrade to a regression test and audit the classroom composer under the active theme. Duplicates DES-11. |
| REQ-CGP-DS-23 | Chalk row actions must not be hover-only | CONFIRMED already met | `C/*.html`: 0 `opacity:0`, 0 `visibility:hidden`, no `:hover{…opacity…}` rules. Webview: no hover-reveal actions found (the opacity:0 hits are keyframes or a reduced-motion rule, `styles.css:328,546,616-627`). | Turn it into a regression guard (P1). |
| REQ-CGP-DS-25 | Dialogs only for destructive/settings; trap and restore focus | PARTIAL already implemented; DUPLICATE | Settings uses native `<dialog>.showModal()` with `autoFocus` close and `onCancel` (`W/ChatPreferences.tsx:8-13`). The sources drawer restores focus to its trigger (`W/TaskWorkspace.tsx:118-121`). The policy is SX-52 (`studio-learning-experience.md:113`). | Extend SX-52. Only explicit focus-return on `<dialog>` close is unproven (it relies on native behaviour). |
| REQ-CGP-DS-26 | Tooltips never the only label | Not a state claim | `title=` appears in ChatPanel.tsx ×30 alongside 120 `aria-label`s in the webview. Copy button has a visible label plus aria-label (`ChatDetails.tsx:35-36`). Not exhaustively audited. | Covered by DES-06 (label association), so extend it. |
| REQ-CGP-DS-30 (src CGP-DS-30) | IME guard covers Enter only | CONFIRMED | `W/ChatPanel.tsx:1436-1444` checks `isComposing \|\| keyCode 229` for Enter only. `isComposing` appears in that one file. Escape handlers do not check composition: `ComposerTools.tsx:29`, `TaskWorkspace.tsx:237,283`, `ChatPanel.tsx:1341,2392`, `VoicePanel.tsx:93`, `InstructorChatPanel.tsx:80`. | DUPLICATE: extend TUX-CHAT-03 / SX-19 (`studio-learning-experience.md:59`) to Escape and shortcuts. |
| REQ-CGP-DS-31 (src CGP-DS-31) | "Not specified (no keep-all in docs)" | PARTIAL | `word-break:keep-all` already ships on the start page: `W/start.css:82,109,137,143,178,227,296,404,412`. The chat/styles.css surfaces use `overflow-wrap:anywhere` only. DES-03 (`classroom-design.md:27`) requires that long Korean text does not break the layout. | Today: keep-all on the start page only. Extend DES-03. |
| REQ-CGP-DS-42 | No readable text token below 4.5:1 | Not a state claim; DUPLICATE | Token muted values pass: `#ACB9A5` 8.38:1, Paper muted `#4B5A4F` 6.71:1 on `#F4F6F0`, `#a4aab3` 6.81:1. The 288 untokenized hex literals were not measured. | Duplicates DES-11. |

### 2. ALREADY verdicts

| Finding row/REQ ID | Claim (cited coverage) | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-CHAT-01 | Growing composer, Enter/Shift+Enter, IME | IMPLEMENTED | `W/ChatDetails.tsx:104` `useGrowingComposer`; `ChatPanel.tsx:1433-1444` composition guard | — |
| CGP-CHAT-02 | Stop (REQ-C6) | IMPLEMENTED | `D/studio-requirements.md:309`; `X/src/chatPanelProvider.ts:2477` abort; stop notice `ChatPanel.tsx:1258` | — |
| CGP-CHAT-03 | Queue while responding (REQ-C16) | IMPLEMENTED (different model) | `W/sendQueue.ts:43` `decideEnter`; REQ-C16 `studio-requirements.md:319` allows exactly one queued item (appended); recovered-message list `ChatPanel.tsx:1336-1351` | Note: one queued item, not a list with per-item edit |
| CGP-CHAT-15 | Page/element capture | IMPLEMENTED | `X/src/extension.ts:695` pageAttached; "코치에게 보낼 내용 보기" `ChatPanel.tsx:1242` | — |
| CGP-CHAT-17 | Usage in settings dialog | IMPLEMENTED | `ChatPanel.tsx:1532-1538` `ChatPreferences` contains `AccessControl`; `W/AccessControl.tsx:13,31,35` | Personal mode only |
| CGP-CHAT-18 | Submit-blocked reasons | IMPLEMENTED | `ChatPanel.tsx:601,608` (photos not ready, queue at capacity) | — |
| CGP-CHAT-20 | Draft persistence (UX22) | IMPLEMENTED | `X/src/studioNavigation.ts:54` `hps.activity.draft.*`; `TaskWorkspace.tsx:301` unsaved-draft note | — |
| CGP-CHAT-21 | Model picker (REQ-M36) | IMPLEMENTED | `W/ModelControl.tsx`; `chatPanelProvider.ts:4382` `selectedModel` | — |
| CGP-CHAT-22 | Effort (REQ-M40) | IMPLEMENTED | `W/EffortControl.tsx:48` | — |
| CGP-CHAT-23 | Think via effort | IMPLEMENTED | same as CHAT-22 | — |
| CGP-CHAT-25 | Model change/reroute notice (M41/M42) | IMPLEMENTED | `X/src/modelEchoHelpers.ts:61,141`; `proxyClient.ts:185,301`; `chatPanelProvider.ts:4660` | — |
| CGP-CHAT-28 | Usage limit reached | IMPLEMENTED | `X/src/passPurchase.ts:190-200` `PASS_SPENT_FRIENDLY`; `AccessControl.tsx:31` "추가 사용 요청 · 강사 검토 대기" | — |
| CGP-CHAT-31 | Goal shown (REQ-STUDIO-LESSON-GOAL) | IMPLEMENTED | `W/StudentGoal.tsx`; `studio-requirements.md:771` | — |
| CGP-CHAT-32 | Instructor-owned coach name/tone (REQ-F*) | PARTIAL | Name: `X/src/coachIdentity.ts:25` `naming_mode`; REQ-F1 `studio-requirements.md:347`. Tone tracks tier (REQ-M33 `:509`), not an instructor tone setting | Say name is instructor/profile-owned; tone is tier-derived, not chosen |
| CGP-CHAT-33 | Memory (memorySession/memoryView) | IMPLEMENTED | `X/src/memorySession.ts`, `memoryView.ts`, `W/MemoryPanel.tsx` | — |
| CGP-CHAT-34 | Profile-owned tool policy (M1, M16–18) | IMPLEMENTED | `X/src/shellPolicy.ts`; `sdkCoachHelpers.ts:162,2304` `permittedToolsFor`/`resolveActionApproval`; `artifactApproval.ts` | — |
| CGP-CHAT-35 | Lockdown via fail-closed profile (M1, M2) | IMPLEMENTED (cohort-level) | `X/src/turnTools.ts:22` web_search opt-in; M1 `studio-requirements.md:493` | — |
| CGP-CHAT-38 | Markdown (TUX-CHAT-15) | IMPLEMENTED | `W/MarkdownText.tsx` | — |
| CGP-CHAT-44 | Run code / preview (D1, N1) | IMPLEMENTED | `X/src/extension.ts:418` `runLastCode`; `liveServerHelpers.ts` | — |
| CGP-CHAT-45 | Citation preview (REQ-STUDIO-CHAT-REFERENCE) | IMPLEMENTED | `W/CitationPreview.tsx`, `citationPreview.css`; `TaskWorkspace.tsx:318-325` | — |
| CGP-CHAT-46 | Thinking state, no fabricated progress (M26, M27) | IMPLEMENTED | `ChatDetails.tsx:42`; dots 1.2s×3 ≈3.8s (`chatDetails.css:81-84`); `sdkCoachHelpers.ts:1516` watchdog, `:1876` `extractSdkActivity` | Elapsed time not shown (ADAPT stands) |
| CGP-CHAT-47 | Tool activity rows | IMPLEMENTED | `X/src/toolActivity.ts:15`; `ChatPanel.tsx:1891` | — |
| CGP-CHAT-49 | Error guidance, request_id (M39, C8) | IMPLEMENTED | `W/errorBannerPresentation.ts`; `ChatPanel.tsx:2216`; `sdkCoachHelpers.ts:1996` | — |
| CGP-CHAT-51 | Safety-wait state via watchdog | IMPLEMENTED | `sdkCoachHelpers.ts:1516-1527` | — |
| CGP-CHAT-52 | Moderation notices (REQ-O1..O7) | SPECIFIED in Studio docs; implemented in Service (UNVERIFIABLE here) | `studio-requirements.md:636-642` cite `worker/test/moderation.test.mjs` (not in snapshot). Extension has 0 hits for `moderat`; the block shows through the generic error banner | Label Service-side; no client-specific moderation UI |
| CGP-CHAT-54 | Tool approvals (REQ-E1..E3) | IMPLEMENTED | `X/src/artifactApproval.ts:18`; REQ-E1 `studio-requirements.md:339` | — |
| CGP-CHAT-61 | Copy response | IMPLEMENTED | `W/ChatDetails.tsx:17-39` | — |
| CGP-CHAT-69 | Favorites via team brain | PARTIAL | REQ-STUDIO-TEAM-BRAIN-CALL `studio-requirements.md:1059`; `chatPanelProvider.ts:274,1444-1450`; `X/src/learningWiki.ts`. It ingests a whole session; there is no per-response save | Change to ADAPT/DEFER for per-answer save |
| CGP-CHAT-70 (sub-verdict) | Share with instructor (CLASSROOM-PANELS) | IMPLEMENTED | `W/HelpRequest.tsx:61,89,113`; `X/src/classroomHelpHost.ts:203` | — |
| CGP-CHAT-71 | Follow-ups prefill, never send | IMPLEMENTED | `ChatPanel.tsx:1849` chips "탭하면 입력창에 들어가요"; `ReplyChoices.tsx` | — |
| CGP-CHAT-76 | Task create/rename/switch | IMPLEMENTED | `chatPanelProvider.ts:519` `taskRename`; `TaskWorkspace.tsx:307` | — |
| CGP-CHAT-82 | Scroll anchor (UX13) | IMPLEMENTED | `ChatDetails.tsx:50-60` `useChatViewport` | — |
| CGP-CHAT-87 | Starter examples insert, never send | IMPLEMENTED | `ChatPanel.tsx:1849` example chips; `X/src/startPage.ts` | — |
| CGP-CHAT-90 | Feedback with diagnostics (REQ-H*) | IMPLEMENTED | `X/src/extension.ts:470` `reportProblem`; `reportProblemHelpers.ts` | — |
| CGP-CHAT-99 | IDE context indicator (AE-02, AE-41) | PARTIAL | Page/element context preview and removal: `ChatPanel.tsx:1242`, `curriculumRuntime.ts:111` `removeElementContext`. No editor-selection/open-files context exists | Say "page context only" |
| CGP-CHAT-100 | Restore (AE-15) / publish (P3/P4) | SPECIFIED-ONLY (restore); IMPLEMENTED (publish) | AE-15 exists only in `requirements/learning-agent-experience.md:37` (0 code hits for `restorePoint`/`checkpoint`/`AE-15`); `adultArchive.ts` is adult-only page archiving (`:14-15,39`); publish is in `X/src/publish/` (13 files) | Split the verdict; restore is a gap |
| CGP-DS-18 | Chalk focus ring | PARTIAL | See P0 table: `board.html` has none | — |
| CGP-DS-21 | Composer surface (CP-R1) | IMPLEMENTED | `useGrowingComposer` `ChatDetails.tsx:104-125` | — |
| CGP-DS-22 / table row 156 | Message bubble per CP-R1 | IMPLEMENTED | `styles.css:1302` user bubble on `--hp-panel`; `chatDetails.css:11` | — |
| CGP-DS-28 | Pending dots ≤3.8s, REQ-M35 shimmer | IMPLEMENTED | `chatDetails.css:81-84`; REQ-M35 `studio-requirements.md:511`; reduced-motion `styles.css:326` | — |
| CGP-DS-37 | Hover gating / no hover-only / 44px | PARTIAL | No hover-only actions found (see DS-23). But 0 `@media (hover…)` and 0 `pointer: coarse` rules across 47 `:hover` lines | Say "no hover-only actions; hover is not media-gated" |
| CGP-DS-39 | VS Code owns window chrome | UNVERIFIABLE | No VSCodium/Electron sources in the snapshot; `X/media/hypeproof-theme.json` only | — |

### 3. REJECT vs existing requirements

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-CHAT-10, 11, 27, 37, 41, 68, 75, 84, 88, 93, 94, 95, 96, 97 | REJECT | CONFIRMED (no conflicting REQ) | Searched the `studio-requirements.md` REQ table (268 IDs) and `requirements/*.md` for rich-text, autocomplete, PIN/lock, LaTeX, reactions, quick chat, templates, pet, worktree, commerce: no requirement for them | — |
| CGP-CHAT-26 | Auto model upgrade conflicts with AE-33/MU-02 | CONFIRMED consistent | REQ-M41 `:535`, M42 (`modelEchoHelpers.ts`) forbid silent substitution | — |
| CGP-CHAT-29 | Upsell REJECT | CONFIRMED, with caveat | INT-ACCESS-05 (no upgrade pressure) per REQ-L12 `:449`. But REQ-L12 ships in-app pass purchase, and the exhaustion message points to it (`passPurchase.ts:190-191`) | Say the REJECT covers the in-chat upsell only; the existing start-screen pass purchase stays |
| CGP-CHAT-36 | Temporary chat REJECT in class | CONFIRMED consistent | Class evidence REQ-Q*, M37 `:536` | — |
| CGP-CHAT-91 | Streak REJECT | CONFIRMED consistent | SX-51 no stat cards (`design/studio-learning-experience.md:290`) | — |
| CGP-CHAT-15/23/31/32/34/51/70/100 (REJECT sub-parts) | Partial REJECTs | CONFIRMED (no conflicting REQ) | REQ-P3/P4 publish/GitHub do not require staging UI; REQ-STUDIO-CHAT-PHOTO-FILES does not cover OS capture | — |
| CGP-DS-06, 07, 20, 32, 33 | REJECT | CONFIRMED consistent | SX-04/SX-49 single-lime rule (`studio-learning-experience.md:110`) supports DS-06; nothing requires a cursor setting, density modes or theme import | — |

Out of scope, noted only: the doc names `.hp-cta-secondary` (`D/design/studio-learning-experience.md:289`) while the code ships `.hp-cta-quiet`. That doc/code drift is worth fixing alongside DS-04.

---

## Part: Verification: agents-codex-automation + artifacts-canvas-media

Checked against `studio@origin/main` (docs, chalk/src, extensions/hypeproof-chat). Paths below are relative to `studio@origin/main:`; `ext/` = `extensions/hypeproof-chat/`.

- P0 claims (12 REQs): CONFIRMED 5, PARTIAL 4, REFUTED 3 (AGENT-05 premise: by default no write modal exists; AGENT-46 premise: no concurrent tasks; AGENT-04/01 "gap" overstated). 9 of 12 P0s overlap an existing REQ and should be "extend" rows.
- ALREADY rows (26 + 3 "ALREADY-in-substance" claims): IMPLEMENTED 15, PARTIAL/SPECIFIED-ONLY 9, NOT-FOUND 1 (AGENT-34), UNVERIFIABLE in snapshot (platform/VSCodium) 4.
- REJECT rows (27): one contradicts shipped code (ART-44 custom domains: `ext/src/publish/customDomain.ts`, docs/1017-dental.md:81). Two rest on stale REQ text (AGENT-02, AGENT-07).
- Biggest correction: REQ-M17's "writes always reviewed" is stale. REQ-E1 (corrected 2026-10-14) and `ext/src/chatPanelProvider.ts:6192-6212` show that writeFile runs **without** a modal and non-destructive shell auto-runs (`ext/src/sdkCoachHelpers.ts:2789`). Any finding that cites REQ-M17 for write review is out of date.
- Link-chip claim (ART-09) is CONFIRMED for chat markdown links, the legacy citation rack, gallery notice and inbox links. The task-workspace citation path instead opens an **integrated** browser tab after an in-panel preview.

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| **P0 — agents** | | | | |
| REQ-CGP-AGENT-01a / CGP-AGENT-01 | Today: `requireApprovalFor` default `[executeShell, openBrowser, delegateAgent, browserType]`; lesson can only narrow (REQ-M38); no learner-visible mode label; no preset | PARTIAL | Default list in docs/studio-requirements.md:339 (REQ-E1) and ext/src/chatPanelProvider.ts:6224-6235. **REQ-E1 says the list does not mean every listed kind gets a modal:** shell and browser have their own tiers; non-destructive SDK shell auto-runs; writeFile has no modal (#464). No preset: searched `approval_preset\|approvalPreset\|approval_scope` across src/chalk/docs. Only `approvalScope()` exists, and it is a seat key (ext/src/classroomOpsHost.ts:133). | The requirement must start from today's real tiers (destructive-shell confirm, browser per-origin, delegate/browserType modal, writes free), not "always ask". It extends REQ-E1/AE-10 and overlaps AE-13 (approval bundles, P1). |
| REQ-CGP-AGENT-01b | No read-only preset label near the composer | CONFIRMED | No preset concept exists (same search). | Extend REQ-E1. |
| REQ-CGP-AGENT-03 / CGP-AGENT-03 | No learner "AI가 할 수 있는 일" card; REQ-M38 six keys | CONFIRMED | REQ-M38 keys `read·write·shell·subagents·browser·web_search` at docs/studio-requirements.md:538. Searched `ext/webview-ui/src/*.tsx` for "할 수 있는 일", "안 해요": no card. | Extend AE-07 (the role intro must not over-promise) and REQ-M38. |
| REQ-CGP-AGENT-05 / CGP-AGENT-05 | "Writes always reviewed (REQ-M17); modal copy does not list the file set" | REFUTED | No write modal is shown by default: chatPanelProvider.ts:6192-6212 ("writeFile is **out** of this list", 원장 decision 2026-07-27) and REQ-E1 (docs/studio-requirements.md:339). If re-enabled, the modal text is `${toolName} ${path}`, one file per call (sdkCoachHelpers.ts:2547-2553). Out-of-workspace writes are denied without a modal. | Either drop the requirement, or recast it as "when an instructor/profile re-enables write approval, show a workspace-relative name instead of the raw `Write /abs/path`". Mark REQ-M17 ③ as stale against REQ-E1. |
| REQ-CGP-AGENT-08 / CGP-AGENT-08 | Today: REQ-M17 deny + Korean guidance; AE-12; no source category | PARTIAL | AE-12 already requires distinguishing missing setting, policy refusal and missing runtime (docs/requirements/learning-agent-experience.md:34). Per-feature lesson copy exists: "이 수업에서는 … 쓸 수 없어요" (chatPanelProvider.ts:1313,1363,1426,1515,1682,1765). No three-way category with a next step. | **Duplicates AE-12**, so make it "extend AE-12" with the copy and next-step table. |
| REQ-CGP-AGENT-09 / CGP-AGENT-09 | "5.5 refusals arrive as `stop_reason:"refusal"`; proxy adds Korean notice; `/v1/messages` display unobserved (learning-agent-experience.md)" | PARTIAL | Client handles no refusal: `sdkResultNotice` maps `max_tokens` and error subtypes only (sdkCoachHelpers.ts:1710-1720). Searched `refusal` and `stop_reason` in ext/src: only max_tokens hits. The cited doc text about `stop_reason:"refusal"` and a proxy Korean notice was **not found** in docs (searched `refusal`, `거절`, `5.5` in docs/**). | The gap itself is real. The doc citation is unsupported. This is closest to REQ-M39 (every terminal error gets a notice), so make it "extend REQ-M39". |
| REQ-CGP-AGENT-45 / CGP-AGENT-45 | Chalk board has stage, last activity, help and no-signal; vocabulary differs | CONFIRMED (and stronger than stated) | chalk/src/ui/manage.html:386 already has states 활동 중 / 긴 대기·확인 필요 / 활동 간격 증가 / 최근 활동 없음 / 활동 기록 없음 / 오류 발생 / 확인 불가, plus footer :382 "정보가 없거나 … ‘확인 불가’". ADM-02/ADM-09 at docs/requirements/classroom-admin.md:51,58. | Extend ADM-09/AE-20 as a relabel of the existing implemented states. P0 is too high: ADM-09 itself is P1. |
| REQ-CGP-AGENT-46 / CGP-AGENT-46 | Task list could show per-task AE-03 state and jump to the next waiting task | REFUTED (premise) | Tasks never run concurrently: `TaskSummary` has no state (ext/src/taskWorkspaceContract.ts:5-11). The header says "작업 중… 멈춘 뒤 다른 작업으로 이동할 수 있습니다" (ext/webview-ui/src/TaskWorkspace.tsx:310-311). | "Next waiting task" has no object today. Recast it as "extend AE-03: show the active task's AE-03 state in the list", or DEFER until parallel tasks exist. |
| REQ-CGP-AGENT-52 / CGP-AGENT-52 | `diffGuard.ts` reports one save and never blocks; `adultArchive.ts`; no learner panel with restore | CONFIRMED | diffGuard.ts:1-7 (feeds the **coach** via PostToolUse `additionalContext`; its only caller is orchestratorHooks.ts:258). adultArchive.ts:1,36-39 is adult-only. Searched `restore\|되돌리기\|revertTurn\|undoTurn` in ext/src and webview: no file-restore UI. | **Duplicates AE-05 + AE-15 (both P0)**, so make it "extend AE-05/AE-15". |
| **P0 — artifacts** | | | | |
| REQ-ART-02 / CGP-ART-03 | diffGuard gives "changed files and units"; adultArchive adult-only; no learner Undo | PARTIAL | No undo exists (same search). diffGuard is per save, not per turn, and its output goes to the coach, not the learner (diffGuard.ts:3-7; orchestratorHooks.ts:258). | The per-turn count needs new aggregation, so do not cite diffGuard as the source. **Duplicates AE-15**, so make it "extend AE-15". Also overlaps REQ-CGP-AGENT-52 (merge them). |
| REQ-ART-07 / CGP-ART-08 | `page_context` prepends page DOM text; gated per cohort, off for minors; no UI shows the exact text | CONFIRMED | attachPageContext slices 3000 chars and prepends `[현재 브라우저 페이지] … 위 페이지를 참고해서 답해줘.` (chatPanelProvider.ts:1983-1998, 4837-4844). The learner sees only a label: `pageAttachedNotice` "내용을 …에게 붙였어요 — {title}" (coachIdentity.ts:125). The notice is a non-removable `role=status` (ChatPanel.tsx:1220-1224). Element capture (CR-09) **is** removable (ChatPanel.tsx:1226). Gate: chatPanelProvider.ts:1938; REQ-N3 says minors must be off (docs/studio-requirements.md:618). | The page text is framed as an instruction, not delimited data, so criterion (3) is a real gap. **Duplicates AE-02** (confirm and remove sent files/pages/elements, P0), so make it "extend AE-02 + REQ-N3". |
| REQ-ART-08 / CGP-ART-09 | `openExternal` (#173) http(s)-only, opens the system browser with no confirmation, bypassing `persist:hp-safe` | CONFIRMED with exceptions | chatPanelProvider.ts:4542-4551 opens with no confirm and no safe-session check. Callers: MarkdownText.tsx:14 (any chat link), ChatPanel.tsx:2024 (legacy citation rack), ChatPanel.tsx:1312 (gallery link), NativeObservationPanel.tsx:76, inbox links chatPanelProvider.ts:2467. **Exception:** inside the task workspace a citation first opens an in-panel preview (CitationPreview.tsx:52). "브라우저에서 열기" then opens an **integrated** browser tab via `vscode.window.openBrowserTab` (chatPanelProvider.ts:469-481), not the system browser. | Scope the requirement to the paths that remain. It **conflicts** with classroom-admin.md:773 and studio-requirements.md:933, which deliberately route instructor inbox links through `openExternal` behind a Service host allowlist (`HPS_CLASSROOM_LINK_HOSTS`). Amend those specs together. |
| **ALREADY claims — agents** | | | | |
| CGP-AGENT-04 ("ALREADY in substance"; gap = prefix scope) | Destructive flag refuses "항상 허용" | IMPLEMENTED, and the gap is REFUTED | protocol.ts:741-747 `destructive`. A session-scoped "항상 허용 (signature)" already exists for non-destructive commands: `approvedCommandSignatures` / `commandSignature` (chatPanelProvider.ts:6086-6100). REQ-E1 says it is remembered per session. Most non-destructive SDK shell runs with no modal at all (sdkCoachHelpers.ts:2789). | The proposed "같은 종류 명령 이번 작업 동안 허용" already ships. Only the purpose-first copy (AE-04) remains. |
| CGP-AGENT-11 | REQ-M30 capability loss visible | IMPLEMENTED | Spec at docs/studio-requirements.md:529. Code: `coachDegradedNotice` (coachIdentity.ts:120-122). Note: the ID **REQ-M30 is used twice** (:526 tab targeting, :529 capability loss). | Cite :529. Flag the duplicate ID to the doc owner. |
| CGP-AGENT-16 | UX22 forks history into a new task | PARTIAL | Spec at docs/studio-requirements.md:16-22 covers **recovery only** (a failed draft write). UI: "새 작업에 보관" (TaskWorkspace.tsx:314-315). No general "fork this chat" command. | Change to ADAPT, or keep ALREADY only for recovery. |
| CGP-AGENT-17 | agentHandoff writes workspace/agent.md | IMPLEMENTED | ext/src/agentHandoff.ts:1-5 | — |
| CGP-AGENT-18 (evidence-import half) | REQ-STUDIO-LOCAL-REVIEW / REQ-SS1 | IMPLEMENTED | docs/studio-requirements.md:868,880. LocalReview.tsx imports Claude Code/Codex JSONL (visible messages only). | — |
| CGP-AGENT-28 ("ALREADY in principle") | Confirmed lesson versions | SPECIFIED (AE-33/ADM-11); compare view NOT-FOUND | Verdict ADAPT stands. | — |
| CGP-AGENT-29 | Rehearsal with student permissions | IMPLEMENTED (Chalk) | chalk/src/ui/authoring.html:312 `REHEARSAL_WORDS` (not_run/running/expired/passed). Spec in docs/design/chalk-rehearsal.md and AE-11 (learning-agent-experience.md:32). | — |
| CGP-AGENT-34 | Chalk authoring templates (chalk-authoring.md) | NOT-FOUND | The only template row in chalk-authoring.md is WEB-09 (:38), which is about student web-app dependency templates. authoring.html has 0 hits for `template\|템플릿`. | Change to DEFER or ADAPT (lesson starting-point templates). |
| CGP-AGENT-41 | toolActivity summary/detailed, REQ-M27 | IMPLEMENTED | ext/src/toolActivity.ts:7-16; spec at studio-requirements.md:528 | — |
| CGP-AGENT-43 | REQ-M15 `SdkGatewayAuthError` | IMPLEMENTED | ext/src/sdkCoach.ts:121; spec at studio-requirements.md:513 | — |
| CGP-AGENT-45 ("ALREADY in Chalk") | Board stage/activity/help/no-signal | IMPLEMENTED | chalk/src/ui/manage.html:382,386 | See the P0 row above. |
| CGP-AGENT-49 | VSCodium editor groups and command palette; REQ-N3 | UNVERIFIABLE (platform not in snapshot); REQ-N3 SPECIFIED | studio-requirements.md:618 | — |
| CGP-AGENT-50 | elementPick CR-09 shows the exact block, removable | IMPLEMENTED | ext/src/elementPick.ts:15; ChatPanel.tsx:1226-1230 | — |
| CGP-AGENT-54 | VSCodium file viewer | UNVERIFIABLE (platform) | — | — |
| CGP-AGENT-62 | AE-22 share choice; publishSite confirmed once per repo | IMPLEMENTED (publishSite tier) / SPECIFIED (AE-22) | protocol.ts:735-738; learning-agent-experience.md:41 | — |
| CGP-AGENT-63 | reportProblem.ts (#64) | IMPLEMENTED | ext/src/reportProblem.ts:1-4 | — |
| CGP-AGENT-70 | Release-acceptance synthetic cohort (#1404) | SPECIFIED-ONLY in snapshot | studio-requirements.md:1031. The CI workflow is not in the snapshot. It is an internal CI check, not a user "clean profile". | Fine as "ALREADY in intent". |
| **ALREADY claims — artifacts** | | | | |
| CGP-ART-01 | previewProvider sandboxed iframe + liveServer + native tab | IMPLEMENTED | ext/src/previewProvider.ts:11,167; liveServer.ts; REQ-N10 at studio-requirements.md:616 | — |
| CGP-ART-25 | VS Code dirty/save; liveServer; htmlStructure blocks broken reveals | IMPLEMENTED (htmlStructure, liveServer); platform UNVERIFIABLE | ext/src/htmlStructure.ts:1-4 | — |
| CGP-ART-26 | VS Code editor | UNVERIFIABLE (platform) | — | — |
| CGP-ART-27 | artifactVersion/browserResult CR-10; CR-81 "verified only for exact version" | PARTIAL | artifactVersion.ts:1-6 is IMPLEMENTED. **CR-81 is not met at the in-app layer**: docs/evidence/cr-verify.md "Not recorded" table (CR-12/14/16/81: `verify-app.spec.ts` fails at `bed32b89`). | Say "CR-81 implemented, not yet verified in-app". |
| CGP-ART-28 | liveServer + native tab (REQ-M35) | IMPLEMENTED | liveServer.ts; REQ-M35 at studio-requirements.md:511 | — |
| CGP-ART-29 | CR-17..22 link, QR, expiry, revoke | IMPLEMENTED (link/QR/expiry/revoke) | publishSession.ts:9,63,260; testQr.ts. No Viewer/Editor/Owner roles. | Fine. Roles are absent by design. |
| CGP-ART-30 | Profile-owned browser control (REQ-M19) | IMPLEMENTED | accessClient.ts:30 (`browser_control.enabled && allowed.has('browser')`); chatPanelProvider.ts:5321; spec at studio-requirements.md:517 | — |
| CGP-ART-31 | Safe session denies all permissions (spec §5.1/5.2); REQ-N10 | SPECIFIED-ONLY in snapshot | The handlers live in the fork core patch, which is not in the snapshot. The extension only mirrors settings (chatPanelProvider.ts:2781-2783; browserSafetyHelpers.ts:3-48). docs/native-browser-spec.md:220. | Mark "implemented in core patch, not verifiable here". |
| CGP-ART-32 | Safe session cancels `will-download` | SPECIFIED-ONLY in snapshot | docs/native-browser-spec.md:220 | Same as ART-31. |
| CGP-ART-33 | Approval modals with one AI name (REQ-F8), REQ-K1 | IMPLEMENTED | resolveActionApproval (chatPanelProvider.ts:6086+); REQ-F8 at studio-requirements.md:354 | Note: writeFile and browserClick have no modal by default (REQ-E1). |
| CGP-ART-58 | Studio accounts REQ-L12/L13 | IMPLEMENTED (L12 purchase/account entry) | studio-requirements.md:449-450; webview-ui/src/AccountEntry.tsx | — |
| CGP-ART-60 | VS Code image viewer + image-edit compare | SPECIFIED (REQ-STUDIO-IMAGE-EDIT, studio-requirements.md:1150); viewer UNVERIFIABLE | — | — |
| **REJECT vs existing REQs** | | | | |
| CGP-ART-44 (REJECT custom domains) | "Test links on HypeProof origin; no domain account" | REFUTED, contradicts shipped code | ext/src/publish/customDomain.ts:1-12 implements a GitHub Pages custom-domain flow (DNS records shown, HTTPS toggle). It is gated by profile `publishing.custom_domain` (docs/1017-dental.md:81-82,221). | Change to ALREADY (profile-gated, adult clinic track). REJECT only for minors and for hosted-domain purchase. |
| CGP-AGENT-02 (REJECT full access) | Conflicts with REQ-M17 "writes always reviewed" and REQ-M18 minor-write invariant | CONFIRMED verdict, but the rationale is stale | REQ-E1 (:339) and chatPanelProvider.ts:6192: writes are not reviewed by default. REQ-M18 ③ client minor strip was removed 2026-08-11 (sdkCoachHelpers.ts ~217-218). | Rebase the rationale on AE-09 (client cannot widen deny), REQ-M38 (narrow-only) and destructive-shell confirm. |
| CGP-AGENT-07 (REJECT auto-review) | "Opposite stance: REQ-M28 approval gate as 교육 장치" | CONFIRMED, rationale overstated | Studio already removed approvals by reversibility (writes free; non-destructive shell auto-runs, sdkCoachHelpers.ts:2789-2800). This is close in spirit to auto-review, but it is rule-based, not AI-judged. | Keep REJECT for AI-judged approval. Reword "opposite stance". |
| Other REJECTs: AGENT-18(config), 22, 24, 32, 38, 39, 40, 44, 56, 59, 68, 69, 71; ART-34, 43, 45, 48, 49, 50, 51, 53, 54, 55 | — | No contradiction found | Spot checks: heartbeat.ts:1-5 (liveness only); orchestratorHooks.ts:4 (hooks never decide); externalSkillCommands.ts:1. Searched studio-requirements.md and requirements/*.md for site secrets, scheduling, password, extension: none required. | ART-41's row is malformed (its verdict column holds Studio text), so fix the table. |

Out of scope, noted only: `ext/webview-ui/src/AccessControl.tsx` already shows remaining resources and "확인 시각", with unknown shown as "미확인", never 0. This bears on settings-account-shell REQ-SHELL-29.

---

## Part: Verification: learning-education + voice-multimodal

Summary (rows verified: 7 P0, 14 ALREADY, 18 REJECT checked for REQ conflicts):
- P0 "today" claims: 5 CONFIRMED, 2 PARTIAL (LEARN-01 cites a schema field that does not exist; V-33 ignores an existing voice entitlement gate). 0 REFUTED outright.
- P0 duplicates: 4 should become "extend": LEARN-13 → extend REQ-O2/O5; V-04 → extend VO-25; V-33 → extend REQ-M38 + VO-36 `voiceStartGate`; LEARN-01 → extend SessionDesign SCH fields + U2 materials inbox (#751).
- ALREADY: 2 IMPLEMENTED (VOICE-44, VOICE-49), 1 PARTIAL-IMPLEMENTED (LEARN-35), 9 SPECIFIED-ONLY (incl. all 5 voice VO rows: pure helpers + an unmounted VoicePanel, "학생에게 이 패널은 열리지 않는다"), 2 UNVERIFIABLE (Service/VSCodium side). LEARN-35 and VOICE-31 also mis-map.
- REJECT: 0 contradict an existing Studio REQ (LEARN-16/22/30/31/33 are backed by SX-29, PRODUCT-INTENT:54, TUX-CHAT-01; VOICE-26 by VO-40).
- Snapshot limits: Service `worker/` (moderation, chat-gate, session-design), Electron main, VSCodium patches absent → those parts UNVERIFIABLE.

Paths below are relative to `studio@origin/main:` (`ext/` = `extensions/hypeproof-chat/`).

### P0 requirements

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| REQ-CGP-LEARN-01 (CGP-LEARN-01) | No interactive-block coverage; block attaches via `SessionDesign.steps[].materials[]` | PARTIAL | No-coverage CONFIRMED (rg `visuali[sz]|interactive|simulation|시각화` in docs/requirements, docs/design: no block concept). But `steps[]` today has only `id,title,instructions,hint,acceptance,duration_min,requires,forbids,prohibited_moves,help,ui,evidence,gate` (docs/design/chalk-plan-to-lesson.md:49-61; docs/requirements/classroom-admin.md:895). `materials` exists only as a lesson-plan section (docs/design/chalk-knowledge-and-plan-spec.md:141), not a step field. An instructor "materials" channel to the coach rail already exists: U2 inbox (docs/studio-requirements.md:916-933; ext/webview-ui/src/InstructorInbox.tsx:5; ChatPanel.tsx:1120), off by default (`ops_distribute`) | State `materials[]` as a NEW optional SessionDesign field (same pattern as SCH-01~03, chalk-knowledge-and-plan-spec.md §4), and reuse the U2 coach-rail `<details>` card instead of a new rail slot |
| REQ-CGP-LEARN-02 | Blocks must not show capability names/scores (SX-01/59, SX-43, SX-35) | CONFIRMED (cited rules exist) | SX-59 docs/requirements/studio-learning-experience.md:128; SX-35 docs/design/ux-principles-breakdown-2026-09-18.md:96; SX-43 via SX-T40 docs/testing/studio-learning-experience.md:105. `data-hps-material` does not exist anywhere (rg) | Note these SX rows are "구현 전 계약 제안" (studio-learning-experience.md:3), so the P0 extends a spec, not shipped behavior |
| REQ-CGP-LEARN-03 (CGP-LEARN-10) | A11y rules exist for chat/Chalk (DES-06/11, TUX-A11Y-01) but not for visual materials | CONFIRMED | DES-06 docs/requirements/classroom-design.md:30; DES-11 :35; TUX-A11Y-01 docs/requirements/studio-native-trial-ux.md:102. No material-specific rule (searched `material|자료` in those docs) | Write as "extend DES-11 / TUX-A11Y-01 to block materials" |
| REQ-CGP-LEARN-13 (CGP-LEARN-25) | REQ-O2 blocks self-harm input for minors with kid-friendly message; no help lines; no adult escalation | CONFIRMED | REQ-O2 docs/studio-requirements.md:637 (categories incl. 자해 지시, 400 `moderation_block`, kid-friendly Korean copy); REQ-O5 :639 (log = category+rule id+hash only). Help lines absent: rg `1388|\b109\b|helpline|상담전화|자살|자해|self.?harm|crisis|위기` over docs/, chalk/src, ext/ → only issue/PR numbers. No moderation/safety signal in Chalk: rg `moderation` chalk/src → 0. Block copy itself lives in Service `worker/src/lib/moderation.ts` (not in snapshot) → copy text UNVERIFIABLE | Duplicates REQ-O2's block path → rewrite as "extend REQ-O2 (copy adds 109/1388) + new Chalk safety item honoring REQ-O5 hygiene". Help-line numbers need Jay/legal sign-off (not in any doc) |
| REQ-CGPV-04 (CGP-VOICE-04) | VO-25 pilot default = no raw-audio retention; no learner-facing disclosure copy | CONFIRMED, with a correctness issue in the P0 | VO-25 docs/requirements/voice-conversation.md:94-95 ("기본 파일럿 제안은 원음 비보존… 실제 참여자 정책 활성화는 별도 승인 대상"). No disclosure copy: rg `고지|동의|disclos|보존` in voice doc and ext/src/voice*.ts → none; ext/src/voiceCapability.ts:42 says minor retention policy is undecided (#901/V4) | Default copy "음성은 저장하지 않아요" asserts a policy VO-25 says is not yet approved. Make it "extend VO-25": disclosure renders only from an approved, versioned policy; no default text ships |
| REQ-CGPV-17b (CGP-VOICE-17) | No dictation exists; composer must respect IME | CONFIRMED | rg `dictat|받아쓰기|transcrib` in ext/ → only a VO-36 naming comment (ext/src/voicePopupHelpers.ts:72). Composer IME guard already exists: ext/webview-ui/src/ChatPanel.tsx:1434-1444 (`compositionend`, `nativeEvent.isComposing`); CP-R1 = docs/studio-requirements.md:30 | Fine as conditional P0; cite ChatPanel.tsx:1434 as the guard to extend |
| REQ-CGPV-33 (CGP-VOICE-33) | REQ-M38 has no voice/dictation/read_aloud keys | PARTIAL | Six keys CONFIRMED: docs/studio-requirements.md:538 (`read·write·shell·subagents·browser·web_search`). But voice already has a start gate with an entitlement input and text fallback: ext/src/voicePopupHelpers.ts:103-124 (`not_entitled`, `entitlement_unknown`, `offersTextFallback`); VO-36 (voice-conversation.md:189-193) already requires "허용된 수업/이용권/실제 음성 모델에서만 시작" | Rewrite as "extend REQ-M38 with `voice`/`dictation`/`read_aloud` and feed `voiceStartGate.entitlement` from it"; duplicates VO-36's allowance clause |

### ALREADY rows

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-LEARN-21 | Guided help = SX-08 ladder, SX-10 | SPECIFIED-ONLY | SX-08 docs/requirements/studio-learning-experience.md:40, SX-10 :42; doc status "구현 전 계약 제안 … P0도 현재 구현 완료를 뜻하지 않는다" (:3,:7). Coach prompt lives in Service (not in snapshot) | Verdict → ADAPT/"specified, not shipped" |
| CGP-LEARN-27 | Class quiet hours = REQ-M9 session window + ADM-10 pause | SPECIFIED-ONLY (Service) / UNVERIFIABLE | REQ-M9 docs/studio-requirements.md:501 (gate incl. session window, cohort pause; Layer R = worker tests, not in snapshot). ADM-10 docs/requirements/classroom-admin.md:59; U4 commands "구현됐고 아직 인수되지 않았다", default OFF (:1216). chalk/src/index.ts:19: Chalk itself has no pause write | Keep ALREADY only as "Service-specified; acceptance pending" |
| CGP-LEARN-28 | Age gating via enrollment; personal preview 14+ | SPECIFIED-ONLY (design note) | docs/age-verification.md:40-43 (14+ public signup); REQ-O1/O6 docs/studio-requirements.md:635,640; enforcement is Service-side | OK as ALREADY-by-design; code UNVERIFIABLE |
| CGP-LEARN-35 | Team shared instructions = `coach_brief` (chalk-plan-to-lesson §3) + TEAM-BRAIN-CALL + SX-24 | PARTIAL; mis-mapped | SessionDesign `coach_brief` is design only ("상태: 설계", docs/design/chalk-plan-to-lesson.md:3, §3 :77-95). The `coach_brief` in source is a different thing: orchestrator roster brief (ext/src/agentRoster.ts:78, consultTool.ts:1299). TEAM-BRAIN-CALL IMPLEMENTED (docs/studio-requirements.md:1059; ext/src/learningWiki.ts, chatPanelProvider.ts:63). SX-24 specified only (studio-learning-experience.md:64) | Split: team wiki = IMPLEMENTED; class-wide coach instructions = SPECIFIED-ONLY |
| CGP-LEARN-36 | Template reuse = CH-07 clone to next cohort | SPECIFIED-ONLY | CH-07 docs/requirements/chalk-authoring.md:29 (P1; doc: "구현 목표 … 구현 완료나 배포 증거가 아니다" :3); T-30 docs/testing/chalk-authoring.md:55. No clone route/UI in chalk/src (rg `clone|복제` → only `structuredClone`) | Verdict → DEFER/ADAPT pending CH-07 |
| CGP-VOICE-07 | Voice effort/model = VO-45 | SPECIFIED-ONLY (+ pure helper) | VO-45 voice-conversation.md:243-248; helpers ext/src/voicePopupHelpers.ts:47-56,564,593. Voice doc status "계획" (:3); VoicePanel not mounted (no import of `VoicePanel` outside its own file; ext/webview-ui/src/VoicePanel.tsx:8-10 "학생에게 이 패널은 열리지 않는다") | Label "decision layer only, not shipped" |
| CGP-VOICE-09 | Single active session = VO-09, REQ-R5 | SPECIFIED-ONLY (+ helper) | VO-09 voice-conversation.md:40-41; REQ-R5 docs/studio-requirements.md:566; ext/src/voiceSessionHelpers.ts:69,136. Cross-window (ChatGPT's actual feature) not covered: one seat's helper state only | Add "across windows" gap |
| CGP-VOICE-10 | Usage-limit states = VO-23/24/46 | SPECIFIED-ONLY (+ helper) | VO-23/24 :88-92 (server, not in snapshot); VO-46 :250-255; ext/src/voicePopupHelpers.ts:115 (`budget_exhausted`), :612 | — |
| CGP-VOICE-11 | Nav guard → VO-40 different policy | SPECIFIED-ONLY | VO-40 voice-conversation.md:213-217 (pause on navigate, no auto-resume); VoicePanel.tsx:108,136 unmounted | — |
| CGP-VOICE-28 | Hotkey editor = inherited VSCodium | UNVERIFIABLE | Only text: docs/studio-requirements.md:738 "menus and shortcuts remain available"; VS Code core not in snapshot | Plausible (upstream keybindings editor), not provable here |
| CGP-VOICE-31 | Transcript view = VO-43 | SPECIFIED-ONLY; mis-mapped | VO-43 :231-235 is about binding partial/final transcript to the turn, not a show/hide/copy transcript view | Verdict → ADAPT (view + copy uncovered) |
| CGP-VOICE-40 | Output-audio visual = VO-38 | SPECIFIED-ONLY (+ helper) | VO-38 :202-206; ext/src/voicePopupHelpers.ts:172-224 (motion only on observed audio); no audio capture/playback in source (VoicePanel.tsx:8-9) | — |
| CGP-VOICE-44 | Device use denied in previews (REQ-N10/D3) | IMPLEMENTED | REQ-N10 docs/studio-requirements.md:616; ext/src/cspBuilder.ts:119 `PREVIEW_IFRAME_ALLOW = "microphone 'none'; camera 'none'"`; ext/src/previewProvider.ts:276; ext/src/liveServerHelpers.ts:93 `Permissions-Policy`. Covers preview/live server only; general integrated-browser sites not checked | Scope the ALREADY to previews |
| CGP-VOICE-49 | Preview isolation = REQ-D3 | IMPLEMENTED | REQ-D3 docs/studio-requirements.md:329; ext/src/cspBuilder.ts:100 `PREVIEW_IFRAME_SANDBOX`; previewProvider.ts:276. Side note: ext/src/deckGenerator.ts:235 iframe uses `sandbox="allow-scripts allow-same-origin"` (REQ-D3 forbids same-origin for preview iframes; deck is a different surface, out of scope here) | — |

### REJECT rows vs existing REQs

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-LEARN-08 | 3-D scene out of audience | CONFIRMED (no conflicting REQ) | rg `3D|multivariable` docs/requirements → none | — |
| CGP-LEARN-16 | Graded quiz conflicts SX-29 | CONFIRMED | SX-29 studio-learning-experience.md:74 (no badges/celebration); SX-35 | — |
| CGP-LEARN-22 | Accent color vs SX-49 tokens | CONFIRMED | SX-49 :110 | — |
| CGP-LEARN-30 | Catalog-first conflicts first-experience intent; keep 3 examples | CONFIRMED | docs/PRODUCT-INTENT.md:54; TUX-CHAT-01 docs/requirements/studio-native-trial-ux.md:38 | — |
| CGP-LEARN-31 | Character selection is SX-29 negative | CONFIRMED | SX-29 :74 ("부정: … 캐릭터 선택") | — |
| CGP-LEARN-33 | Mascot overlay vs SX-29, REQ-E1 | CONFIRMED | SX-29 :74; REQ-E1 docs/studio-requirements.md:339 | — |
| CGP-LEARN-38/39/40/41/42/43 | Out of scope / billing / ads | CONFIRMED (no conflict) | HC-07 docs/requirements/capability-model-contract.md:22; REQ-L12 docs/studio-requirements.md:449 (in-app pass purchase exists — LEARN-41 promo credits do not contradict it) | — |
| CGP-VOICE-20 / 26 | Global dictation / global voice hotkey | CONFIRMED | VO-40 :217 "보이지 않는 청취는 허용하지 않는다" | — |
| CGP-VOICE-36/37/46/47 | Surveillance / hardware / biometrics / upsell | CONFIRMED (no conflict) | VO-46 :250-255 (no separate personal billing) | — |

---

## Part: Verification: projects-library-memory (KNOW) + settings-account-shell (SHELL)

Base: `studio@origin/main:` snapshot (docs, chalk/src, extensions/hypeproof-chat src/webview-ui). Paths below are relative to
`studio@origin/main:`; `E/` = `extensions/hypeproof-chat/`. VSCodium patches, Electron main, Service and `package.json` are not
in the snapshot. Doc status matters: `chalk-authoring.md:3`, `chalk-mvp.md:3`, `curriculum-runtime.md:3`,
`unified-studio-experience.md:4` and `access-budget-settlement.md:3-7` each say they are targets, not implementation
evidence. A row cited only from them is marked SPECIFIED-ONLY.

**Counts.**
1. P0 claims (15): CONFIRMED 5, PARTIAL 7, REFUTED 1 (SHELL-29), UNVERIFIABLE 1 (SHELL-04 at app level), duplicate-REQ flag on 9.
2. ALREADY rows (36: KNOW 11, SHELL 25): IMPLEMENTED 19, PARTIAL/SPECIFIED-ONLY 11, UNVERIFIABLE (VSCodium base, inferred) 6.
3. REJECT rows (28: KNOW 11, SHELL 17): no contradiction 25, needs a correction 3 (KNOW-16 "no upsell surface", SHELL-72 credits vs AB-11, SHELL-43 wording).
4. Most important: the remaining-usage meter already ships (SHELL-29 refuted). Studio already has a "프로젝트 기억" (Venture Memory) panel, so "no learner memory" is half wrong. Minor world cohorts do archive before overwrite. The help request already shows what is sent, to whom and until when, with consent left unticked.
5. Absence searches are stated per row. They are bounded searches of the snapshot, not proof of absence.

### 1. P0 requirements

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| REQ-KNOW-07 (CGP-KNOW-07) | No learner-visible memory scope rule. Shared project memory is Service-owned. cr-memory #1450 is open. | PARTIAL | A Service-backed "프로젝트 기억" (Venture Memory) panel ships. It reads `GET /v1/curriculum/projects/:id/memory` per Project and never chat history (`E/src/memorySession.ts:1-8`, `E/webview-ui/src/MemoryPanel.tsx:1-7,71-74`, CR-35/CR-36 `docs/requirements/curriculum-runtime.md:99-100`). #1450 is open for the decision-to-server path only (`docs/studio-requirements.md:1052`). No personal AI memory exists: searched `memory` in `E/src`; the SDK `Projects` memory tool is listed as never granted (`E/src/sdkCoachHelpers.ts:2355-2356`). | Name the collision: "AI 기억" (proposed) vs "프로젝트 기억" (shipped, team scope). Phrase it as "extend CR-35/CR-36 scope rules", so personal memory never feeds Venture Memory. |
| REQ-KNOW-09 (CGP-KNOW-09) | Only partial: Chalk DES-09 and CLS-02. | PARTIAL (understated) | The help request already previews exactly what is stored, for whom, until when and how to withdraw. Consent is not pre-ticked and Cancel sends nothing (`E/webview-ui/src/HelpRequest.tsx:4-12,61,92-102`). Chalk `sharing.html:3,8` does the same with withdraw and audit. Gallery publish has no such preview (`E/src/galleryPublish.ts:1-14`). | Extend DES-09 (`classroom-design.md:33`) and CLS-02 (`chalk-authoring.md:52`). Make the P0 cover the gallery, site publish and collect, plus the new "포함하지 않는 것" line. |
| REQ-KNOW-24 (CGP-KNOW-24) | No learner-visible trash. | CONFIRMED | Searched `trash\|휴지통\|deleteFile\|fs.delete` in `extensions/`, `chalk/src`. The only hit is the codicon in `E/src/crHostWiring.ts:353`. | Duplicates the intent of AE-15 (`learning-agent-experience.md:37`, P0, spec only; the doc says "NOT IMPLEMENTED AS A SET", line 3) and WEB-05. Make it "extend AE-15". |
| REQ-KNOW-30 (CGP-KNOW-30) | adultArchive is adult-only and not learner-visible for minors. The P0 says it "applies to minor seats, not only adult seats". | PARTIAL / REFUTED in part | Kids' world cohorts already archive before overwrite into an `이전 세상` folder. They get a visible timeline line ("고치던 세상을 … 넣어 뒀어요") (`E/src/chatPanelProvider.ts:3202-3256`; `E/src/adultArchive.ts:14-15` "Kids' world cohorts archive their worlds their own way"). Missing for every seat: a version list and a restore UI. Teen and other non-world minor tiers get no archive (`adultArchive.ts:36-42`). | Restate today as: world cohorts archive with no restore UI, teen minors have none, adults keep 20 copies with no UI. Extend AE-15, FO-10 and CR-78. |
| REQ-KNOW-37 (CGP-KNOW-37) | No full per-cause list in learner copy. | PARTIAL | Per-cause Korean messages with a next step exist for count, type, >25 MB, zero-byte and save failure (`E/src/attachedImages.ts:89-99`), plus outside-folder, size and MIME (`E/src/referenceImages.ts:53-72`). Attachments are photo-only, so the encrypted, empty-text and too-much-text causes have no input path. | Extend REQ-STUDIO-CHAT-PHOTO-FILES and REQ-C11/REQ-C18. Keep only the image fixtures until document attachments exist. |
| REQ-KNOW-40 (CGP-KNOW-40) | No learner memory. Curated memory deferred. cr-memory open. | PARTIAL | Project memory is gated off unless curriculum runtime is on. The off copy is "이 수업에서는 프로젝트 기억을 쓸 수 없어요" (`E/src/memorySession.ts:30,58,71,86`; `E/src/chatPanelProvider.ts:1407-1408`). Personal memory is absent (see KNOW-07). | Today = "team project memory exists and is gated per class; personal AI memory absent". Reuse the existing gate instead of a new profile field. |
| REQ-KNOW-41 (CGP-KNOW-41) | No coverage (memory absent). | PARTIAL | `MemoryPanel.tsx` lists items with revisions and sources (lines 16-40). The learner can only add decisions; there is no delete. | Keep the P0 for AI memory. Note that Venture Memory items are Service records, not learner-deletable. |
| REQ-KNOW-44 (CGP-KNOW-44) | Only web citations come from tool events. | CONFIRMED | No memory is injected into requests. Searched `memory` in `E/src/proxyClient.ts`, `sdkCoachHelpers.ts`: only the denied tool description at `sdkCoachHelpers.ts:2356`. | None. |
| REQ-KNOW-45 (CGP-KNOW-45) | No coverage. | CONFIRMED | No AI memory writes exist. Venture Memory writes are explicit learner decisions (`memorySession.ts:7-8`). | None. |
| REQ-KNOW-49 (CGP-KNOW-49) | Partial: session-log consent, REQ-O. | CONFIRMED | Opt-in `analytics.upload_session_logs` (`E/src/chatPanelProvider.ts:3355`, `E/src/extension.ts:176`). No memory consent exists. | None. |
| REQ-KNOW-51 (CGP-KNOW-51) | Gallery publish sends one HTML file only. | CONFIRMED | `E/src/galleryPublish.ts:1-30`. | Moot until memory files exist. Merge it into KNOW-09 (extend DES-09). |
| REQ-KNOW-68 (CGP-KNOW-68) | Partial: US-12 distinguishes 401/403/exhausted/outage and keeps files. No single gate screen. | PARTIAL | US-12 is a spec (`unified-studio-experience.md:4,26`). The source distinguishes pass, auth and connection banners (`E/webview-ui/src/errorBannerPresentation.ts:7-15`), session_window copy (`E/src/proxyClient.ts:113-114`) and pass-spent copy that keeps files (`E/src/passPurchase.ts:191`). | Duplicates US-12 and AB-13. Make it "extend US-12" (single status screen). |
| REQ-SHELL-01 (CGP-SHELL-01) | No idle install and no "not during class" rule. | CONFIRMED | Banner gating is version dismissal only (`E/src/updateCheckerHelpers.ts:393-403`). The scheduler pushes the banner unconditionally (`E/src/extension.ts:803-818`). Searched `수업\|class\|session_window\|idle` in `updateChecker*.ts`: no gate. Install already needs explicit user approval (`updateChecker.ts:173-181`, REQ-I4 `studio-requirements.md:399`). | Extend REQ-I4 / ADM-11 (`classroom-admin.md:60`). Drop "does not start an install" from the acceptance; that is already true. |
| REQ-SHELL-04 (CGP-SHELL-04) | No quit or close confirmation. | CONFIRMED in extension; UNVERIFIABLE app-wide | Searched `onWillQuit\|before-quit\|beforeunload\|종료할까요\|끝낼까요\|onWillShutdown` in `E/src`, `E/webview-ui/src`: none. `deactivate()` only (`E/src/extension.ts:1243`). Docs mention quit only for voice release (`voice-conversation.md:41`). VSCodium core patches are not in the snapshot. | A VS Code extension cannot veto quit, so this needs a core patch. Name that surface and add a REQ-I-style entry. |
| REQ-SHELL-29 (CGP-SHELL-67) | Studio src has only exhaustion/expiry messages; no pre-run remaining display. | REFUTED | The chat panel renders `AccessControl` (`E/webview-ui/src/ChatPanel.tsx:1300,1538`). The summary reads "… N 남음" (`AccessControl.tsx:12,25`) and shows "확인 시각 {as_of}" (line 34). Unknown reads "미확인 … 이전 잔액으로 실행 가능 여부를 판단하지 않습니다" (line 13). It has 7 state labels: ready/ended/paused/review_required/exhausted/not_configured/external_unknown (line 3). The start page shows "AI 요청 {remaining} / {limit}회 남음" plus the end date (`AccountEntry.tsx:20-22`). | Duplicates REQ-L9 (`studio-requirements.md:446`), AB-11 and AB-15. Make it "extend REQ-L9" (copy and placement: requests unit in the header). Check it against design `access-budget-settlement.md:152` ("정확한 남은 질문 수 … 없다"); show the ledger `requests:count` meter only. Lower to P1. |

### 2. ALREADY rows

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-KNOW-03 | Learner goal (AE-01), lesson AI guidance (BASE-04/EDU-02, REQ-STUDIO-LESSON-STEP), external instructions | IMPLEMENTED | `E/src/studentGoal.ts`, `E/webview-ui/src/StudentGoal.tsx`; `LessonStepPanel.tsx:2-9` (#751 G2); `E/src/externalInstructionSkills.ts`. BASE-04/EDU-02 are specs (`chalk-authoring.md:3`). | Cite the source files, not the Chalk spec IDs. |
| CGP-KNOW-11 | Class code or invite enters the lesson (RUN-03) | PARTIAL | The join code ships (`StartPage.tsx:119-126`, REQ-A4). RUN-03 is a spec. There is no accept/decline-invite UI. | Say "join code only". |
| CGP-KNOW-17 | Class folder, project switch REQ-P5 | IMPLEMENTED | `E/src/workspaceRouting.ts`, `E/src/publish/projectSwitch.ts`; REQ-P5 `studio-requirements.md:656`. | None. |
| CGP-KNOW-32 | Chalk /sharing voluntary, recipient-scoped, revocable | IMPLEMENTED | `chalk/src/ui/sharing.html:3,8-13` (withdraw, expiry, "누가 열람했는지 확인"). CLS-05 itself is a P1 spec. | None. |
| CGP-KNOW-34 | Instructor-only material distribution (U2) | IMPLEMENTED | "implemented 2026-09-21, off by default" `studio-requirements.md:916`; `E/src/classroomInbox.ts:1-13`. | None. |
| CGP-KNOW-36 | Requests counted with a visible source (AB/US-11/12) | PARTIAL | AB and US are specs. The meter display ships in `AccessControl.tsx:3-34`. There is no attachment quota. | Cite AccessControl. "In principle" is accurate. |
| CGP-KNOW-39 | VSCodium search/SCM; CR-77 diff | UNVERIFIABLE / PARTIAL | VSCodium is not in the snapshot. Explorer is closed by default and the HP shell hides chrome (#725). CR-77 diff exists as a Venture Memory `onDiff` (`memorySession.ts:7-8`, `MemoryPanel.tsx:48`), but that is a Project version diff, not a file diff vs HEAD. | Mark as inferred. Learners may not reach SCM. |
| CGP-KNOW-58 | REQ-E1, REQ-STUDIO-CHAT-DETAIL, tool menu | IMPLEMENTED | REQ-E1 `studio-requirements.md:339` (default lives in package.json, absent from the snapshot). `ModelControl.tsx`, `EffortControl.tsx`, `ChatDetails.tsx`, `ComposerTools.tsx`. REQ-STUDIO-CHAT-DETAIL is prose at `studio-requirements.md:32,148` (no table row). | None. |
| CGP-KNOW-59 | CR-29, ENV-04, SecretStorage | PARTIAL | SecretStorage is used (`E/src/accountSession.ts:79-106`). CR-29 is a spec (`curriculum-runtime.md:3,86`) and ENV-04 is a spec. | Only SecretStorage is shipped. |
| CGP-KNOW-65 | External instructions, immutable commit, preview | IMPLEMENTED | `E/src/externalInstructionSkills.ts`, `externalSkillCommands.ts`; `studio-requirements.md:1105`. | None. |
| CGP-KNOW-72 | Chalk knowledge versioned and insert-only | PARTIAL (client implemented) | The client calls versioned endpoints (`E/src/chalk/tools.ts:167-170`, #1288). The store is in Service (not in the snapshot). The spec is a "설계" (`chalk-knowledge-and-plan-spec.md:3`). | Insert-only and vocabulary checks are not verifiable here. |
| CGP-SHELL-03 | REQ-A5, REQ-B5, REQ-I11 | IMPLEMENTED | `studio-requirements.md:279,295,403` (U/E/R verification). `E/src/proxyClient.ts:113-114`; `E/src/extension.ts:633`. | None. |
| CGP-SHELL-08 | Detached windows and editor groups (inferred) | UNVERIFIABLE | VSCodium base is not in the snapshot. | Keep "inferred". |
| CGP-SHELL-11 | Command palette and keybindings | UNVERIFIABLE | VS Code base. Commands are registered (`E/src/extension.ts:615-660`). | Keep "inferred". |
| CGP-SHELL-15 | Single instance (inferred) | UNVERIFIABLE | VS Code base. | None. |
| CGP-SHELL-16 | Wrong-arch warning via PRA-05 | PARTIAL | PRA-05 covers bootstrap scripts (`private-release-access.md:16`; scripts not in the snapshot). The updater picks an asset per arch (`E/src/updateChecker.ts:74`). There is no launch-time wrong-arch warning. | It is install-time only, not a launch warning. |
| CGP-SHELL-20 | REQ-H1..H9 report problem | IMPLEMENTED | `studio-requirements.md:382-390`; `E/src/reportProblem.ts`, `reportProblemHelpers.ts`. | Trace upload DEFER is fine. |
| CGP-SHELL-21 | About and licenses via REQ-J4 | PARTIAL | REQ-J4 is a branding grep that excludes license text (`studio-requirements.md:417`). It does not require a licenses view. | About is VS Code base (unverifiable). |
| CGP-SHELL-33 | Send key and IME (REQ-C16) | IMPLEMENTED | `ChatPanel.tsx:1436-1439` (`isComposing`, 229); REQ-C16 `studio-requirements.md:319`. | None. |
| CGP-SHELL-37 | Storage: Q6, Q12, adultArchive | IMPLEMENTED | `E/src/sessionSpool.ts:38` (200 MB); `studio-requirements.md:678,684`; `adultArchive.ts:25-27`. | None. |
| CGP-SHELL-38 | Mic, dictation, voice | SPECIFIED-ONLY | `voice-conversation.md:3` "상태: 계획". Only a capability diagnostic command ships (`E/src/voiceCapability.ts:1-8`). | Not ALREADY. Make it DEFER/ADAPT (voice domain). |
| CGP-SHELL-41 | Appshots: visionInput, page attach | IMPLEMENTED | `E/src/visionInput.ts`, `elementPick.ts:31`, `extension.ts:694`. | None. |
| CGP-SHELL-43 | Chalk start "첫 강의 준비하기" | IMPLEMENTED | `chalk/src/ui/start.html:10` (numbered sections). | None. |
| CGP-SHELL-47 | Conversational native trial | IMPLEMENTED | `studio-native-trial.md:3` (#745 and #757 implemented). | None. |
| CGP-SHELL-50 | Class setup via Chalk / issuer (ADM-01) | IMPLEMENTED | `chalk/src/ui/issuer.html` ("학생 초대" nav, `budgets.html:34`); ADM-01 `classroom-admin.md:50`. | None. |
| CGP-SHELL-51 | REQ-O1 fail-safe minor, age-verification | IMPLEMENTED | REQ-O1 `studio-requirements.md:636` (Service). The client fails closed (`E/src/sdkCoachHelpers.ts:137,325`); `docs/age-verification.md`. | None. |
| CGP-SHELL-55 | Help level by lesson stage | IMPLEMENTED | `LessonStepPanel.tsx:2-9` (`helpChoices`, `HELP_MODE_LABELS`). | None. |
| CGP-SHELL-63 | Session-log upload opt-in | IMPLEMENTED | `E/src/chatPanelProvider.ts:3355,6031`; REQ-Q9/Q10 `studio-requirements.md:681-682`. | None. |
| CGP-SHELL-64 | Chalk "내 공유 기록", ADM-14 | IMPLEMENTED | `chalk/src/ui/sharing.html:9,13` (withdraw, expiry). | None. |
| CGP-SHELL-66 | Coach naming, external instructions | IMPLEMENTED | `E/src/coachIdentity.ts:25,41`; REQ-A6 `studio-requirements.md:280`. | None. |
| CGP-SHELL-69 | Operator usage view (REQ-L5) | SPECIFIED in REQ with Service tests | `studio-requirements.md:442`. Service code is not in the snapshot. | Operator side unverifiable here. |
| CGP-SHELL-71 | Chalk "학생 사용 상한" | IMPLEMENTED | `chalk/src/ui/budgets.html:37,58-60`. | None. |
| CGP-SHELL-73 | In-app pass purchase (REQ-L12) | IMPLEMENTED | `E/src/passPurchase.ts:59-70`; `studio-requirements.md:449`. | None. |
| CGP-SHELL-83 | Files kept after expiry/refund | IMPLEMENTED | `E/src/passPurchase.ts:191` ("만든 파일과 대화는 그대로 있어요"). | None. |
| CGP-SHELL-85 | ADM-07 view audit | IMPLEMENTED | `chalk/src/ui/sharing.html:13` ("누가 열람했는지 확인", `/audit`). | None. |
| CGP-SHELL-87 | Common trial/class entry (#915) | IMPLEMENTED | `E/webview-ui/src/StartPage.tsx:119-120`. | US-* rows are a spec; cite StartPage. |

### 3. REJECT rows vs existing Studio requirements

| Finding row/REQ ID | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| CGP-KNOW-16 | Today: "no consumer upsell surface" | REFUTED (today column); REJECT itself OK | After exhaustion, the pass-spent copy sends personal pass holders to buy a new pass (`E/src/passPurchase.ts:191`; REQ-L12). | Today = "personal passes link to purchase (REQ-L12). Class seats have none (INT-ACCESS-05)". Keep REJECT for class seats. |
| CGP-KNOW-19 | Remote-device projects | No contradiction | Searched `remote` in requirements: none for learners. | None. |
| CGP-KNOW-52 | Chronicle | No contradiction | PRODUCT-INTENT "continuous screen surveillance" (cited). | None. |
| CGP-KNOW-54 | Health/finance memories | No contradiction | REQ-O2 PII categories (`studio-requirements.md:637`). | None. |
| CGP-KNOW-55 | Legacy memory switch | No contradiction | None found. | None. |
| CGP-KNOW-56 | Memory to connected apps | No contradiction | SDK `Projects` memory tool never granted (`sdkCoachHelpers.ts:2355-2356`). | None. |
| CGP-KNOW-57 | Writing style | No contradiction | None found. | None. |
| CGP-KNOW-60 | Public profile | No contradiction | REQ-O2. | None. |
| CGP-KNOW-61 | Token stats as achievement | No contradiction | AB-17 (`access-budget-settlement.md:42`). The learner usage meter (REQ-L9) is separate, not achievement. | None. |
| CGP-KNOW-62 | Social share card | No contradiction | Gallery publish (opt-in) remains separate. | None. |
| CGP-KNOW-69 | WhatsApp link | No contradiction | None found. | None. |
| CGP-SHELL-06 | Launch at login | No contradiction | None found. | None. |
| CGP-SHELL-18 | AppleScript | No contradiction | None found. | None. |
| CGP-SHELL-23 | Dock icon variants | No contradiction | REQ-J1..J4. | None. |
| CGP-SHELL-28 | Beta/debug settings | No contradiction | None found. | None. |
| CGP-SHELL-39 | Mini & Pets | No contradiction | None found. | None. |
| CGP-SHELL-43 (Studio) | Role-based welcome REJECT | Minor | Studio already asks trial vs class at start (`StartPage.tsx:119-120`). That is a mode choice, not a role survey. | Clarify that a mode choice is kept and a role survey is rejected. |
| CGP-SHELL-46 | Mini-game during sign-in | No contradiction | None found. | None. |
| CGP-SHELL-58 | Locked chats PIN | No contradiction | Classroom share contract. | None. |
| CGP-SHELL-63 (marketing part) | Marketing cookies | No contradiction | None found. | None. |
| CGP-SHELL-69 (learner part) | Per-chat usage popover | Tension | REQ-L9 and AB-11 require learners to see source, as-of time and their own use (`studio-requirements.md:446`, `access-budget-settlement.md:36`). AccessControl already shows per-task funding (`AccessControl.tsx:17-20`). | Reject only the cost/token detail. Per-task funding is already shown. |
| CGP-SHELL-72 | Credits, auto-reload, instant reset | PARTIAL contradiction | AB-11 allows credits "환산/만료/revision 정의가 있을 때만" (`access-budget-settlement.md:36`). Auto-reload is rightly rejected (AB-05, line 30). | Reject auto-reload and instant reset. Say credits are conditional under AB-11. |
| CGP-SHELL-74 | Cancellation retention | No contradiction | INT-ACCESS-05. | None. |
| CGP-SHELL-76 | Ads | No contradiction | None found. | None. |
| CGP-SHELL-80 | Workspace discovery / join requests | No contradiction for classes | US-04 (P1) allows code-less public *trial* issuance under server policy (`unified-studio-experience.md:8,18`). | Scope the REJECT to classes. Trial self-issuance is planned. |
| CGP-SHELL-90 | Commerce | No contradiction | None found. | None. |
| CGP-SHELL-91 | WhatsApp | No contradiction | None found. | None. |
| CGP-SHELL-96 | Codex Micro hardware | No contradiction | None found. | None. |
| CGP-SHELL-97 | Chronicle | No contradiction | None found. | None. |

Out of scope, noted only: the CGP-SHELL-57 today claim ("openExternal … no minor-cohort confirmation rule") overlaps the artifacts domain's REQ-ART-08 and was not verified here.

---
