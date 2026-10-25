# Decisions taken by the parity loop

Jay, 2026-10-19: decision-blocked rows proceed with the recommended option. Each choice
is recorded here before the slice that depends on it merges, so it can be reversed.

| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| DEC-14 | Minor cohorts: chat links open only in the integrated safe-session browser; adults: modal naming the host before the system browser. A blocked click does not notify the instructor | README section 3 #1: the system browser bypasses the safe-session allowlist; the confirm adds one click for adults | On (safety tightening, no new data flow) | no |
| DEC-25 (interim) | Until the Service sends the class window end time, the whole active class seat counts as the class window for the update hold | The client has no window end; a restart mid-lesson costs the lesson. A learner can still dismiss the banner and update outside a class seat | On (holds only; no new data flow) | no |
| DEC-08 | Edit-and-resend keeps the original as version 1 and records an edit_resend event; both attempts stay in the observation record | The original prompt, its answer and its turn record are evidence of how the learner iterated (ADAPT); overwriting them would erase the first attempt. The event holds ids and lengths only, no text | On | no |
| DEC-09 | Learner answer verdicts are stored only on this device in the task's verdict file; not in the session log, not uploaded, not collected, not shown to instructors or Chalk (AE-20) | A verdict is the learner judging AI output (JUDGMENT): evidence for the learner, not a grade. The session spool is uploaded and collected for class records, so a verdict written there would reach the Service and instructors; showing raw learner reactions to instructors is what AE-20 rules out. The verdict file keeps the history (time, ids, verdict, reason code, note) and no upload or collection path reads it | On | no |
| DEC-27 | The SX palette in `tokens.css` (`--hp-panel #202C24`) is canonical for HP lesson surfaces; the personal workspace intentionally follows the host VS Code theme through `--tw-*` (named dark fallbacks only); `#18231C` is `--hp-ink-on-accent`, not a panel | Audit (verification.md REQ-CGP-DS-01a): the conflict was doc text, not source. Two token families, not three palettes. Documented in studio-learning-experience.md "팔레트 계열" and task-workspace.md | On (docs only; no visual change, no CSS change) | no |
| DEC-29 | DES-02's 14px floor covers every visible word on the personal chat surface (task rail, heading, chat shell, sources panel, 대화 설정), metadata included: the CC-R1 11px role, tool, citation and chip lines rise to 14px. Exempt: visually hidden text (the keyboard hint), decorative glyphs and glyph-only buttons with an accessible name, and instructor-only text. The classroom chat keeps its sizes in this slice (DES-02 already governs it; follow-up), so REQ-CGP-DS-09 / CGP-DS-R-008 stay open for the classroom. Line measure: 40 syllables (`max-inline-size: 40em`), as shipped in #2067 | REQ-CGP-DS-09's own acceptance asks metadata to rise from 11px to 14px; Hangul syllable blocks lose legibility below 14px; 40em matches REQ-CGP-DS-22 and scales with the text-size setting. Learner testing of 35 vs 40 syllables is still open | On (personal chat only; sizes grow, no layout or data change) | no |
| DEC-35 | CGP-SHELL-R-029 (remaining count next to the composer) never shows a count on a free seat (profile `studio-open-trial`); it applies to pass and class seats only. Sign-in copy at purchase, where CGP-SHELL-R-022 overlaps, is owned by the conversion register (`docs/research/conversion-2026-10/`, CONV-PURCHASE-R-006); CGP-SHELL-R-022 keeps the generic copy-link fallback | Jay 2026-10-19: a free seat shows no allowance or remaining count while in use, only the end card speaks (TUX-SP-14/13, REQ-STUDIO-FREE-START, CONV-DEC-03) | On (free seats unchanged) | yes (2026-10-19) |
| DEC-12 (artifact history conservative implementation) | Reuse local turn-restore storage for 20 versions per file, including minor seats, behind machine-default-off artifactHistoryEnabled. AI means measured AI bytes; 나 means explicit upload/restore or exact-byte learner confirmation of their manual revision. Unknown external saves remain 기록 없음. | Preserve recoverability without guessing authorship; native current-version confirmation records attestation, not automatic detection. Capture neither uploads content nor widens write consent. | Off; no new outbound permission | no |
| DEC-D65 | Keep the latest-prompt edit control always visible, with a pencil and Korean label; extract its version navigator as shared `AttemptPager` for D64/D65 | Persistent visibility preserves touch discoverability and Tab access while satisfying focus/hover availability. D64 answer-generation and selection storage remain separate; extracting navigation does not claim those flows are shipped | On (UI only; no new data flow) | no (agent-selected 2026-10-20) |

| CGP-CHAT-D53 (conservative UI scope) | Extend the existing personal-workspace numbered-choice card, preserving its classroom/lesson exclusion and draft-first behavior. Enter after selection and an explicit confirmation button call normal Send; selection alone never sends. Recommendation requires a trailing exact `(추천)` or `[추천]` marker. | No question-specific protocol exists; do not invent model confidence, widen minor-seat admission, or bypass existing send guards. The card uses the reading column while prose retains its 40em measure. Skip/spool behavior belongs to a separate product slice. | On only where existing cards were admitted; no new recipient or transport | no |
| CGP-CHAT-D-008 (copy feedback lifetime) | Code-block copy success stays at least 4s and is announced through role=status; failure is role=alert and never times out. CGP-DS-R-025 wins over the D-008 "2s, status only" wording. | CGP-DS-R-025 is the design-system rule for copy feedback and is already merged on main; keeping one lifetime for answer and code copy avoids two timers. D-008 keeps its chrome (32px strip, 44px targets, 160ms label, monospace, contrast). | On | owner decision 2026-10-24 |
| DEC-12 (trash conservative implementation) | Activity trash stays default-off for every seat, adult seats included: `hypeproofChat.activityTrashEnabled=false`, machine scope, no in-product toggle. When on, it covers explicit learner commands (files and folders) and native Explorer/workspace-edit deletions for known learner seats; instructor/unknown seats are denied. Coach deletions (SDK Bash `rm`, codex shell) emit no VS Code delete event and stay out of scope; Studio does not intercept shell `rm` (they remain under turn restore, one review bar); the owner files the follow-up issue | Conservative: retention on minor and classroom seats is Jay's open question, and turning the trash on for adult seats is his decision too, not the loop's. Native file events cannot cancel a deletion, so a failed or over-cap backup warns instead | Off for every seat | no |
| DEC-13 (trash conservative implementation) | Keep original path, time, mode and verified bytes without timed expiry, until the activity folder is removed. A store is bound to its folder's real path and identity (dev, inode, birth time), so a new folder at the same path never sees the old trash (verify R2: free seats reuse `~/HypeProofTrial`). A store whose folder is gone while its parent still exists, or whose path holds a different folder, is marked missing at activation and removed with its key after 30 days missing; disconnecting keeps it. One gesture (all selected items together) is archived only up to 5,000 files / 200 MB, `node_modules` counted; over the cap the explicit command asks a plain permanent-delete confirm and a native delete copies nothing and warns. A cancelled native participant never discards a copy, including the one in progress (VS Code still deletes); intact-original pending copies are collected after 10 minutes. Damaged entries are skipped and counted; a lock with a dead owner or older than 120 s is free | Conservative local recoverability, no uploads or automatic erasure; the cap bounds disk use on class PCs (the open DEC-13 disk-cost question) and keeps the copy inside VS Code's 60 s participant window | Off, same flag | no |
| DEC-12 (trash storage) | Trash bytes and metadata live in the extension's global storage, one store per activity folder (`activity-trash/<sha256(folder realpath)[:24]>`), never inside the work folder; this follows turn restore (`turnRestore.ts`) | Verify F1: a store at `<activity>/.hypeproof/trash` was readable by the coach's SDK Read/Glob/Grep/Bash and the local runtime. Outside the folder, workspace containment refuses Read/Glob/Grep/Write and work-folder shell commands find nothing. An auto-allowed shell is not a sandbox and can find the store; see the encryption row | Off, same flag | no |
| DEC-12 (trash encryption) | Every trashed file and its metadata is sealed with AES-256-GCM under a random 256-bit key per store, kept in VS Code SecretStorage (`hypeproof.activityTrash.<store>`), never on disk. Opaque file names (`<uuid>.blob`, `<uuid>.meta`); the additional data binds each file to its store, entry and kind. A missing, malformed or wrong key, or a tampered file, is refused and logged; no plaintext fallback, and a store with entries never gets a fresh key. The sweep deletes the key with the store | Verify2 R1: an auto-allowed SDK Bash has no path confinement (#2157, out of scope), and `find ~ -name '*.data'` plus `cat` printed a deleted file. Encryption makes what the shell finds useless without the keychain item. Follow-up for the owner, not changed here: turn restore keeps plaintext content-addressed copies (`blobs/<aa>/<sha256>`) and plaintext manifests with relative paths in the same global storage (`turnRestore.ts`), so the same shell can read them | Off, same flag | no |

| DEC-26 | The header uses only the selected requests:count ledger and Service as_of. No access state, `configured:false` (Service access contracts off) or no chosen source means no line (the host never auto-selects); an unreachable Service or a missing/malformed ledger reads 미확인; no unresolvable 확인 중 is shown. Scope is DEC-35: pass and class seats, never free seats. A selected cohort/organization source is named and shows its own remaining count and no other number; classroom seats show it wherever the class funding data supports it. A selected source that is not available or not in state ready shows the usage panel's state word and no count. Reservations and unresolved counts stay separate. | No conversion from currency or un-timestamped pass limits can establish a confirmed remaining request count. | On, display only; no grant or funding switch | no |

### CGP-AGENT-D-004 implementation choice — 2026-10-20

Keep REQ-E1 write approval opt-in. Replace only the configured write-confirmation
presentation with the shared chat webview's native HTML dialog; do not add a new
write permission. Show five focusable chips and expand the remainder in place.
Focus reveals the complete sanitized workspace-relative name; it does not open or
modify the file. Default focus is refusal. An unavailable UI refuses rather than
falling back to an unreviewable write. Bind the prompt to a fresh presentation id,
current activity/task/folder/profile and lifecycle generation before credential
reads, and recheck after them. This is a conservative implementation choice, not
a new human agreement or a claim that every write needs approval by default.

| DES-KNOW-30 (CGP-KNOW-D-017) | Reuse the native artifact history command as a local side panel on all eligible seats; compare verified text snapshots through Studio's built-in diff editor. Keep existing native attestation and machine-default-off capture. Binary comparison fails visibly rather than guessing an encoding. | Queue source line 210 points at neighboring DES-KNOW-29; the title, register design ID and R017 parent consistently identify DES-KNOW-30 at line 211. No new data destination or permission. | Off with artifactHistoryEnabled | no |

| CGP-AGENT-D-002 (implementation choice) | Use current runtime and effective machine approval policy for the third card state; shell always means some commands ask, and browser means some actions ask only on the agent-sdk runtime; on the proxy runtime and after a fallback the browser auto-runs without a modal and reads 해요, explained in the note. No invented lesson preset. Denied grants win. | Existing tool approval paths are concrete; named lesson presets remain a separate external contract. AE-07 honest role boundaries support ADAPT without score labels. | On, display only; no permission change | no |

| DEC-D018 | Share a conservative metadata state adapter across both Chalk boards. Preserve operational attention details; unknown stays neutral/dashed. Idle means reported AI runtime idle, and done means a current-basis step submission/review only; disclose those limits in chip titles. | R021's prior ALREADY note did not supply the canonical mapping. Do not infer learner rest or class completion from silence, stale signals or previous lesson evidence. | On; presentation only, no Service writes or new data | no (agent-selected 2026-10-21) |

| CGP-AGENT-D-019 (corrected scope) | Follow R022 and verification.md: active task badges only; no invented input-waiting or next-waiting task. Reuse the conversation skip target with a local Alt+Shift+J shortcut and explicit tooltip. | Native approval dialogs already take focus; no cross-task attention navigation exists. Fixed badge placement and focus are display/navigation only (AE-03). | On, no grants or task concurrency changes | no (agent-selected 2026-10-21) |

| CGP-ART-D007 (disclosure) | Use a native button with aria-expanded/controls for the learner composer chip; retain the independent remove action even while folded. A replacement capture folds its preview. The complete expanded panel scrolls at 40vh; page strings remain React text. | Reuses the shipped host-owned queued attachment and admission rules, adds no recipient, capture or send permission. Instructor capture visibility is an existing separate surface gap, not widened by this learner design. | On where existing page attachment is admitted | no (agent-selected 2026-10-21) |

| DEC-D007 | Use only explicit stream-bound model refusal signals; show a passive, nonanimated composer banner with no arrival focus. Keep existing transcript notices. Do not infer refusal from prose when an upstream adapter loses the discriminator. | Preserve drafting and Korean composition; safe alternative guidance must not claim a model refusal from guessed text. Local Codex and Anthropic-to-proxy gaps remain explicit external contract limits. | On for explicit events; no new permission or data flow | no (agent-selected 2026-10-21) |

| CGP-AGENT-D-006 (implementation choice) | Reuse the existing report dialog as the single allowed action. Store only canonical Korean source/copy in the existing tool-line format; unknown remains unknown. | Avoid an invented permission-changing action or a file-schema migration. Show denial evidence in summary mode and save disabled notices to the captured task. AE-12 supports responsible interpretation of limits. | On, display and persistence only; no permission expansion | no (agent-selected 2026-10-21) |

| R036 conservative implementation | Local export means one explicitly selected on-device file copied to a new filename; no directory archive, remote file fetch, overwrite or upload. Unknown failure causes stay unknown; status recovery never sends a prompt. | Preserves own-file access without expanding authorization or inferring token expiry from a bare 401. | On, no new remote or minor data flow | no |

| DEC-D022 (changed-file panel) | Extend the existing last-request restore point with bounded physical-line comparisons and exact selected-file/all restore, one count-bearing native confirmation and stale-context refusal. | Preserve the existing scope and recovery format; task-start checkpoints are not synthesized from a last-turn snapshot. Binary/large comparisons say unavailable. Direct edits during a turn are disclosed, not attributed to AI. | Existing learner restore permission; no new network access | no |

| DEC-KNOW-09 (interim) | Require fresh per-copy confirmation for every content export, including resumed collections and help-request retries; Cancel ends that collection batch. Name existing recipient roles and actual endpoint hosts, never invent personal identities. Exclude app-owned private stores and configured wiki paths; user-selected page/help prose is disclosed content. Gallery publication keeps the 2026-08-21 post-publish session-record upload, listed as its own block in the same confirmation (recipient `수업 기록 운영자 · <proxy host>`, each spool file with its byte size); exactly the listed bytes go up after the page is published, and Cancel sends neither. The problem report (`문제 신고하기`), the budget-request note and the observation assessment are confirmed the same way | Existing broad collection consent and repository registration cannot describe the bytes of a later export. Conservative choice uses existing authorized recipients and no remembered send approval. Keeping the gallery session record preserves the 2026-08-21 operations decision (guardian pre-survey consent; report material survives a missed "기록 보내기") while still disclosing it | On as a restrictive gate; existing feature/profile opt-ins remain unchanged | no |

## Attachment recovery (CGP-KNOW-R-020)

Conservative implementation choice, not a new human policy agreement: a Send
press may save explicitly attached files into their existing activity directories
before the model request starts. Retain failed staging and reuse verified successful
copies for targeted retry. Persist only failed filenames/reasons and photo metadata
in the webview session; lost browser handles require explicit native repicking.
Never infer encryption or add an unsupported document parser. No new recipient,
capability grant, background upload or persistent minor-content store is added.

| DEC-D013 (trash in 내 작품) | The existing task-workspace file list stands in for 내 작품 (DES-KNOW-20 has no drawer yet), so the panel is on task-workspace seats only (personal, trial); other seats keep the commands. Moving needs the host's native confirm naming the file; Undo and 복원 need none, because restore never overwrites. 영구 삭제 needs the webview dialog with 취소 focused and then the native confirm. The toast's hold restarts a full 8 s after hover or focus ends. Refused while a turn runs. The queue's source line pointed at DES-KNOW-21; the title and the R-013 trace identify DES-KNOW-24, which is what this implements | Conservative: no new seat, no new write path, the host keeps every write decision; built on the merged #2195 store only | Off, the same `activityTrashEnabled` setting | no |
| DEC-LEARN-13a (CGP-LEARN-D-013) | The learner's calm safety notice is on for every moderation block. The 109/1388 help lines are added only for a Service-named `self_harm` block on a seat whose `/v1/profile` sends `safety_help_lines: true`; numbers are plain text, never `tel:` links | verification.md: the help-line numbers need Jay/legal sign-off and appear in no doc. Showing the Service's own sentence calmly adds no data flow; the numbers are minor-facing safety copy, so they wait behind a Service flag. A desktop cannot dial and a link would leave the safe session (DEC-14) | Notice on; help lines off until the Service flag | no (agent-selected 2026-10-21) |
| DEC-LEARN-13b (CGP-LEARN-D-013) | Chalk reads a per-seat `safety: {category: "self_harm", at}` from the ops status answer and pins it until the instructor acknowledges it. Only `self_harm` is pinned; no other category, no matched text. The Studio client never sends a safety signal itself | The Service already knows seat and category at the block; a client-sent signal would be a new learner data flow without consent (help shares need the learner's consent). Fewest recipients: the class instructor only, no guardian automation | Chalk render on; nothing shows until the Service sends the field | no (agent-selected 2026-10-21) |

| DEC-KNOW-51 (interim, CGP-KNOW-R-033) | "Memory files" are the existing app-owned stores: the team-brain wiki (`wiki/` and the profile's `learning_wiki.plan.dir`), `notes/`, `memory/`, `memories/`, `개인 메모/`, `AI 기억/` and anything under a dot directory such as `.hypeproof/memory/`. They are left out of every outbound payload by default. The only learner selection is a path typed into the test-version publish panel's "파일 추가" manifest; that exact path (no case or look-alike match) joins the set and the confirmation labels it `AI 기억 파일 · 내가 직접 고름`. A page that links to an unselected memory file refuses the publish and names the file, rather than publishing a broken link. Dot-directory stores stay unselectable (the Service path rule refuses them). Site publish, gallery, help and collect have no file choice, so memory files never go there; site publish names the stores it left out in its confirmation. A new share link for a stored version that contains a memory path stays refused (DEC-KNOW-09); the learner republishes instead. Any confirmation that lists a memory path without the selection flag renders no dialog and sends nothing | DEC-01 (memory adoption) is open, so this covers only stores that exist today and adds no new selection surface beyond the existing typed manifest. Refusing a linked memory file is stricter than dropping it, and keeping link refusal sends to the fewest recipients | On (restrictive gate) | no |

| DEC-SHELL-D001 (CGP-SHELL-D-001) | The in-class update line lives at the top of the chat panel, the only Studio surface that shows update state; the native About dialog (VSCodium, version only, no prompt) and the start page (no update state for a class seat) are left unchanged. The line has no "나중에" dismiss and no release-notes toggle: it is a status, not a prompt, and a control would push the verb past 320px. Outside class the card and its dismiss are unchanged | Fewest changes: no upstream patch and no new surface; dismissing a line that asks for nothing adds a control without a purpose. The version number is the part that gives way at 320px because the verb is the information the learner needs | On (presentation only; no new data flow) | no (agent-selected 2026-10-21) |

| DEC-SHELL-03 (CGP-SHELL-D-003, with CGP-SHELL-R-004) | The quit dialog needs a quit trigger that did not exist (R-004 unbuilt and unclaimed; an extension cannot veto quit, verification.md SHELL-04), so this row builds both. A Studio-owned core patch in `scripts/patches/core/` (staged into the fork's `patches/user/`, not a submodule bump) adds a shutdown veto that asks the extension and shows the native box. Guarded: window close and app quit only (not reload or workspace switch); closing any window with active work asks, since its turn stops with it. Active = `hasActiveStream()` (turns in every runtime, approvals waiting) plus a queued unsent message reported per chat surface. There is no separate "preview build": preview reveals are part of the turn. The core fixes the button order and Enter = Esc = 계속하기; the extension only supplies words, validated and capped. If the extension does not answer in 2 s, errors, or the box cannot be shown, the quit proceeds. 업데이트 설치 is refused while a turn runs, because its quit would meet the guard after the installer had already started | Conservative for the learner and for release risk: no setting, no new data flow, no new recipient; the patch is inert for every upstream dialog (none sets `defaultId`). Failing open on an unreachable extension avoids trapping a child in an app that will not close; a failed veto would otherwise show VS Code's English shutdown error. The new base-key inputs make the next Mac release take the full build path once | On for every seat; inert until a build includes the patch | no (agent-selected 2026-10-21) |

### CGP-KNOW-D-006 implementation choices (2026-10-21, agent decision)

Build on the merged CGP-KNOW-R-006 disclosure (`outboundConsent.ts`): every producer keeps its own immutable manifest and the single `confirmOutbound` chokepoint. Only the presentation changes. While a Studio chat webview is visible, the manifest opens as a native HTML `<dialog>` there: exact recipient (and each `also` recipient as its own block), one checkbox per item with its byte count, the fixed `포함하지 않는 것: AI 기억, 개인 메모` box, primary 보내기 and secondary 취소 with initial focus on 취소. Every checkbox starts unchecked, including the action's own item: REQ-KNOW-09's stricter no-preselection rule takes precedence over the design row's optional exception. All items of one manifest are one atomic payload, so 보내기 stays disabled until every item is checked; a partial selection never sends a subset. Cancel, Escape, closing the panel, a reload, a changed activity/task/folder/profile, a concurrent prompt or a 3-minute timeout send nothing. When no chat webview is visible (for example the report-problem command with the panel closed), the existing R-006 VS Code modal is used unchanged. Consent is never remembered.

Register correction: DES-KNOW-09 is line 200 of projects-library-memory.md; line 199 belongs to the scope header. No adjacent backlog row is changed.

### CGP-KNOW-D-033 implementation choices (2026-10-21, agent decision)

DEC-KNOW-D033: build on main's merged dialog (#2365) and R-033 host rule (#2361). Only the presentation changes. A memory item reaches the dialog only when the learner typed it into "파일 추가", so the group never offers a file the host did not already list. The group stays collapsed and unchecked; because the payload is atomic, a listed memory file must be opened and checked before 보내기 works, and the hint says so. A partial send that drops the memory file is not offered: the learner removes it from "파일 추가" instead, which keeps DES-KNOW-09's one-decision rule. The empty group appears once, on the first recipient, so the learner sees that no memory goes with this transfer. An earlier draft of this row (built on the pre-merge D-006 branch) changed host selection and site publish; those parts are superseded by R-033 and are not carried over.

## Attachment error presentation (CGP-KNOW-D-020)

Agent implementation choice, not human policy approval: “one-line message” means
one concise status entry below the composer, allowed to wrap rather than clip
Korean recovery instructions at narrow widths or larger text sizes. Show the last
failure in the existing producer order; all failures retain full chip text. Map only
existing diagnoses to decorative glyphs and short labels; unknown diagnoses say
`첨부 실패`, without claiming encryption detection. One persistent polite status
replaces assertive chip alerts. Reuse the R-020 recovery implementation and gates.

## CGP-DS-R-001 implementation decision (2026-10-20; agent choice, not a new human agreement)

Preserve DEC-27 and every existing palette/geometry value. `designTokens.css` owns primitive
values, explicit light/dark semantic bindings and component aliases for Studio and Chalk.
Numbered semantic variants preserve existing contexts without pretending they are a new
approved scale. Existing public `--hp-*`, `--tw-*` and local Chalk aliases remain consumers.
Host variables and CSS-wide inheritance stay at their consuming element. Chalk uses a
checked generated TS transport because its runtime/test HTML loader does not load CSS.
Structural CSS/SVG geometry and learner-authored preview content are outside theme tokens.
No new palette, authorization, Service change or publication is implied.

## DEC-DS-D-001: semantic colour role names (CGP-DS-D-001, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Which names follow `--hp-{text\|bg\|border\|ring}-{role}-{state}` | The Studio colour roles in `tokens.css`, the names components read. The numbered `--ds-s-*` tier of CGP-DS-R-001 stays a value transport, not a role API | Renaming the generated tier gives no reader a clearer name and churns every alias | On | no |
| Legacy names | Removed, not kept as aliases. Each use was renamed by the property that paints it, so one old name can map to several roles (`--hp-accent` → bg/border/text accent). `start.css` `--studio-*` aliases removed | Two names for one role would let new CSS keep the old vocabulary. Rendered values are unchanged | On | no |
| States | `default`, `hover`, `selected`, only where a component already had that state | No invented states | On | no |
| Type scale | `--hp-text-{caption,body,lead,step}` renamed to `--hp-font-*` | Otherwise `--hp-text-body` (a size) collides with `--hp-text-{role}-{state}` (a colour) | On | no |
| Light and dark | Dark = forest on `:root`; light = Paper on the reading surfaces (SX-54). Paper binds every role explicitly, including roles whose value is unchanged | The row names exactly these two. Host light themes keep DEC-27 (branded values are equal in both host themes) | On | no |
| Chalk | Pages keep their page-local palettes and alias names. The token file is injected first on every route (CGP-DS-R-001) | Chalk ships three distinct palettes; one role vocabulary would merge them, which is a palette change nobody approved | Unchanged | needed for a Chalk palette merge |
| `--tw-*` | Kept (DEC-27): personal workspace follows the host theme | Already decided | Unchanged | no |

## DEC-DS-D-002: host theme mapping (CGP-DS-D-002, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Which surfaces follow the host theme | The `:root` roles, so the lesson chat (mission header, CTAs, evidence and completion lines, fields) follows any VS Code theme. DEC-27 still holds: the SX palette is what those surfaces draw under the HypeProof Studio theme, which is the configured default | REQ-CGP-DS-02 and verification.md scope the bridge to the `--hp-*` tokens. Under Light+ the forest-only roles left 10 text pairs below 4.5:1 in the classroom chat (white quiet-CTA text on a white body, 1.0:1) | On | no |
| Branded screens | The start and disconnected screens stay forest in every theme: `.studio-start, .studio-disconnected` re-bind every role to the forest value | Their cards, gradient and artwork are forest-only literals; following the host there would mean redrawing the start screen, which is a visual design nobody approved | Unchanged | needed to theme the start screen |
| Source key per role | A built-in key whose HypeProof Studio theme value already equals the palette (`foreground`, `textLink.foreground`, `button.*`, `editor.background`, `quickInput.background`, `panel.border`, `focusBorder`). The theme gains two keys where none existed: `descriptionForeground #ACB9A5` and `list.warningForeground #E6A373` | Keeps shell changes to two keys that the theme already uses for the same purpose (`#ACB9A5` is its secondary text everywhere). `quickInput.background` over `editorWidget.background`, which would change editor widgets. `list.warningForeground` over `editorWarning.foreground`, whose Light+ value is 3.1:1 on white | On | no |
| The row's example `--hp-bg: var(--vscode-sideBar-background, #151D19)` | Not used: the HP theme's sidebar is `#18231C`, so the fallback-free value would not equal the palette. The app role reads `editor.background` (`#151D19` in the HP theme) | The acceptance clause wins over the example | On | no |
| Light-theme muted text | `body.vscode-light` and `body.vscode-high-contrast-light` pull the description colour 20% toward the foreground (Light+ `#6E6E6E`, 4.6:1 on `#F3F3F3`) | VS Code's own `#717171` is 4.4:1 on its Light+ sidebar. Dark kinds, the HP theme included, are untouched | On | no |
| Fixed roles | Control boundary `#748F79` and the Paper chip pair keep no host source | No default theme's control border reaches 3:1 (Light Modern `#CECECE` is 1.6:1); the sage value is ≥3:1 on every default theme's surfaces | On | no |
| HC themes | Not themed beyond the mapping (CGP-DS-R-004 owns HC). Text pairs pass in HC Dark and HC Light; the HC Dark CTA is a black button with white ink and no extra border | Out of this row | Unchanged | no |
| `--hp-code-bg` | Not added: code blocks already read `--vscode-textCodeBlock-background`, and a role nobody reads fails the CGP-DS-D-001 guard | No consumer | n/a | no |

## DEC-DS-D-003: state layers and the control boundary (CGP-DS-D-003, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Pressed share | 14% on dark surfaces, 12% on light ones | Inside both ranges the row allows (12–20% dark, 12–16% light) and clearly apart from hover. It keeps the control boundary ≥3:1 against the pressed fill over `#151D19` (3.3:1; 16% would give 3.1:1, 20% 2.7:1). Over the panel `#202C24` the pressed fill sits at 2.7:1 from the boundary; WCAG compares a boundary with what surrounds the control, and that stays ≥3:1 | On | no |
| Which controls take the layers | Quiet (transparent) controls drawn with the control boundary in Studio; in Chalk every non-primary control (on `/manage` one `!important` layer over each control's own fill; `/sharing` and `/learn` buttons too). Chalk hover fills that were not a layer (bulk actions turning accent, the seat card turning forest) are removed | Those are the controls the row's boundary clause names. Primary CTAs keep their accent hover; ghost icon buttons in the personal chat keep `--vscode-list-hoverBackground` because DEC-DS-D-002 makes the host theme their source, and changing the IDE theme's list hover would restyle the whole workbench | On | needed to restyle the personal chat's host-hover controls |
| Layer as a mix with `transparent` | `color-mix(in srgb, <text> N%, transparent)` | It is the text colour at N% over whatever surface the control sits on, with no per-surface value. In Chalk, where a quiet rule forces `background-color: transparent !important`, the same layer is painted as a `background-image` gradient so it is not erased | On | no |
| Control boundary value | Studio keeps `#748F79` (already the control token on main). Chalk uses `#7D8994`, the field line `/manage` already drew | The row's example `#6E8270` is 4.2:1 on `#151D19` but 2.8:1 against a 14% pressed fill over it and 3.7:1 on Chalk's `#1D2630`, so it needed the verification the row asked for and did not pass it everywhere. No new palette value is introduced | On | no |
| Chalk scope | Control rules only; dividers, panels, fieldsets, tags and the flow bar keep their lines | A decorative line is not a control boundary (DES-11); raising every line would be a palette change | On | no |
| Disabled controls | Not measured | WCAG 1.4.11 exempts inactive components | n/a | no |

## DEC-DS-D-004: the status chip (CGP-DS-D-004, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Where the chip lands in Studio | The evidence drawer's source-state label, the one learner surface that shows real / simulated / self_reported / unverified | It was 12px muted text with no chip; other status marks (`tw-task-state`, verify states) are separate rows | On | no |
| `blocked` in Studio | In the vocabulary (danger, ban icon, 막힘 from Chalk's board) but drawn on no Studio surface | The row names five states; no learner surface shows a blocked state today, and inventing one is out of scope | n/a | no |
| Intent colours | success = `--vscode-charts-green` (fallback `#4ec9b0`), caution = the warn role, info = the body text role, neutral = the muted role, danger = `--vscode-errorForeground` (fallback `#f48771`). Lime is not used | SX-04 keeps lime for the one Primary CTA and the current step. All are colours Studio already draws | On | no |
| Soft fill share | 14% of the intent colour over the surface (neutral 10% plus a dashed edge) | Tinted but clearly not solid; label and icon contrast hold on the app and panel surfaces | On | no |
| Label colour | The body text role, not the intent colour | Keeps ≥4.5:1 on every fill over the app and panel surfaces of the HP palette (measured in `test/status-chip.smoke.mjs`; other host themes are not measured); the icon carries the intent | On | no |
| Label size | `--hp-font-caption` (14px at the default text size) | The learner's text-size choice (CGP-DS-R-009) still grows it; the icon stays 16px | On | no |
| Chalk | Same geometry and soft fill on the board/manage seat chip; Unicode glyphs replaced by 16px stroke SVGs | The row is Both; the seat chip is Chalk's status chip and already carries blocked | On | no |

## DEC-DS-R-005: every hover/pressed fill is a foreground layer; one control boundary (CGP-DS-R-005, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Filled controls | Their own foreground (`currentColor`) at 8% / 14%, drawn as a `background-image` over the resting fill | A layer of the text colour over a filled button would not be its own ink. `currentColor` resolves on the control, so one token serves every fill (checked in Chromium: a red-on-blue button gets `color(srgb 1 0 0 / 0.08)`) | On | no |
| Personal chat ghost buttons | Leave the host's `list.hoverBackground` for the text layer `--hp-bg-control-hover` (supersedes DEC-DS-D-003's carve-out) | DEC-DS-D-003 kept them on the host key to avoid restyling the workbench. This change is in the webview only and the layer still follows the host through its foreground: `#29342C` for `#253526` (HP), `#323233` for `#2A2D2E` (Dark+), `#E7E7E7` for `#E8E8E8` (Light+) | On | no: no workbench colour changes |
| Field and secondary boundaries | `--hp-border-control-default` replaces the host input/panel/widget borders, `--tw-line` and the notice literals | No default theme's input or panel border reaches 3:1 (the HP theme's own `input.border #526448` is 2.5:1 on `#18231C`), and DEC-DS-D-002 already fixed the control boundary for that reason | On | no |
| Light host themes | Bind the control boundary to the Paper control line (`#76837A`) under `body.vscode-light` / `body.vscode-high-contrast-light` | `#748F79` is 2.8:1 on the Light+ error notice tint; the Paper value is 3.1:1 there and 4.0:1 on white. No new palette value | On | no |
| Secondary-filled buttons with no border | Get the control boundary (voice buttons; their `#2C3C2B` fill is 1.4:1 on the forest) | A secondary button must be found by its edge | On | no |
| Exception | The `/manage` seat row's action button takes the Primary style while its row is current or hovered | It is an emphasis tied to the row (also on `aria-current`), not a state layer of the hovered control | On | no |

## DEC-DS-R-006: named status intents (CGP-DS-R-006, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| The intent set | info, caution, danger, success, plus `neutral` | The row names four plus `source_state`; D-004 already gave unverified a neutral intent. Neutral is the "no evidence yet" intent and is reused for idle/stopped states rather than calling them info (which would read as an active signal) | On | no |
| Grayscale cue for the intent itself | One edge per intent: info dotted 1px, success solid 1px, caution solid 2px, danger double 3px, neutral dashed 1px; block padding compensates so every chip has one height | Icon and words already separate states; the edge also separates intents in a grayscale capture and in forced colours, where colour is gone. Heavier edges mean higher severity | On | no |
| Which elements are "status chips" | Studio: source state, task run (rail badge and the heading's live run note), delegation, product-test state, criterion verdict, help request. Chalk: board seat chip, seat attention tag, wrap-up badge, evidence source state | These are the chip-shaped state marks. Status sentences and lines, the citation tier chip (a link), the fixed instructor badge and tool-log marks are not chips | n/a | no |
| Severity mapping | Failures and blocks are danger; anything that waits for the learner or instructor (approval, answered help, needs recheck, partial) is caution; finished is success; activity is info; no signal is neutral. `non_reproducible` verdicts are danger, as they were red before | The most conservative reading: never show a state as calmer than it was | On | no |
| Unknown inputs | Unknown verify state → not_verified; unknown verdict → 확인 안 됨 (no raw token); unknown help status → neutral with the card's words; Chalk unknown intent → neutral, unknown icon → help | Fail toward "not checked", never toward a reassuring state | On | no |
| Chalk colours | Colour now follows the intent. idle (쉬는 중) moves from violet to info blue, the same as working; they differ by icon (pause/play) and words | One colour per intent across both surfaces | On | no |
| Chalk wording | Chalk keeps its instructor words (실제, 가상(시뮬레이션), 학생 자기보고, 미확인; 차단됨 vs the board's 막힘) | The row is about intent, icon and colour; unifying instructor copy with learner copy is a copy decision for a human | n/a | yes, if unified later |

## DEC-DS-R-010: spacing unit and control ladder (CGP-DS-R-010, 2026-10-22; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Existing spacing | Kept at its values (5, 6, 7, 10px and so on). `--hp-space` is 4px; new and changed spacing uses `calc(var(--hp-space) * n)`. The only spacing this row changes is the classroom header's block padding (8px → one unit) | The acceptance asks for the unit to be defined. Moving every off-grid value would redraw every surface, which DEC-27 and CGP-DS-R-001 (preserve shipped geometry) rule out without a design review | On | needed for a grid migration |
| Ladder steps | 32 / 44 / 48px; learner floor = 44 (`--hp-control-min`) | 44 is DES-06's floor. 32 is the dense row Chalk already uses (DES-CGP-DS-24). 48 is what the start page's large choices draw. No step below 44 is allowed on a learner surface, and the smoke fails on any learner rule using sm | On | no |
| How each small control reaches 44px | `min-height`/`min-width` on the control's own rule; padding and font unchanged | Smallest visual change: text stays where it was, the box grows around it. The classroom header row grows from 43 to 53px (its block padding drops from 8px to one unit) | On | no |
| One-line composer textarea (24px) | The card forwards a primary press on its own surface to the textarea, instead of making the textarea 44px | The growing-composer code measures the textarea's scrollHeight to decide when to expand; padding or a min-height there would make every draft look like two lines. The card is already ≥44px and is what the learner sees as the field | On | no |
| Classroom photo remove × on a 64px thumbnail | A transparent 44px round button in the corner with the dot drawn as a radial gradient (the `.hps-edit-image button` pattern) | A solid 44px circle would hide most of a 64px thumbnail; the existing pattern is already on main | On | no |
| Inline links in an answer | Exempt | WCAG 2.5.8 inline exception: the link's size is set by the sentence it sits in | n/a | no |
| Which surfaces count as learner surfaces | Personal task workspace and chat, classroom chat with its lesson rail, start page. Instructor surfaces, local review and host dialogs are out of this row | They are the surfaces a learner touches in the app; the others are named as not covered in REQ-STUDIO-CONTROL-LADDER | n/a | no |

## DEC-DS-D-005: the learner type scale (CGP-DS-D-005, 2026-10-22; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Scope | The personal task workspace, the DEC-29 scope of CGP-DS-R-008. Shared chat classes are moved onto the scale under the personal shell; the classroom chat keeps its weights, tracking and sizes | DEC-29 already left the classroom for a follow-up; changing classroom typography is a separate, larger review | On (personal only) | no |
| Where 22px and 28px go | 22px (`--hp-font-title`) is an answer's h1; h2/h3 take 18px (`--hp-font-lead`), h4-h6 16px. 28px (`--hp-font-display`) is defined and tested but no personal surface uses it yet | Answer headings were 1.15em (18.4px, off the scale) at every level, so markdown hierarchy was flat. No personal screen has a display-size heading today, and inventing one is out of scope | On | no |
| Off-scale weights | 500, 550, 650, 700 and the user agent's bold (h1-h6, strong, b, th) become 600; 400 stays 400 | 600 is the nearest step that keeps the emphasis these labels had; dropping them to 400 would remove hierarchy | On | no |
| Tracking | Exactly 0 on personal learner text (the acceptance says ≥0; the row says 0). Answer headings lose -0.2px; the chips label (0.2px) and the week line (1px) become 0 | The stricter value meets both sentences | On | no |
| Label leading | Every line-height in the personal files is `--hp-leading-label` (1.5) or `--hp-leading-prose` (1.65). Values under 1.6 became label leading, 1.6 and above prose leading | Two tokens instead of nine literals (1.3-1.8); values ≥1.6 were all multi-line explanatory text | On | no |
| Composer | The composer textarea keeps the label leading (1.5), not the prose leading | Its single-line height inside the 48px composer (DES-CGP-DS-21) is built on a 24px line; a learner's draft is input, not read prose | On | no |
| Exemptions | The `HypeProof` wordmark (`.tw-brand`, a Latin logo with -0.4px tracking and 650 weight) and its aria-hidden mark (`.tw-mark`); glyph-only buttons and decorative icons already exempt under DEC-29 | Logo typography is not Hangul learner text | On | no |
| Workspace defaults | `.tw-workspace` sets the label leading, and h1-h6, strong, b and th there are 600, in a rule placed before the component rules | Unstyled text otherwise reads at `normal` (about 1.2) and bare `<strong>`/`<h3>` in a dozen components at the user agent's 700; a default catches the next component too | On | no |
| Approval dialogs | The write approval dialog takes the label leading and the outbound recipient is 600 in both seats | The dialogs mount at the page root with no seat marker; the change is one line-height and one weight, both toward the scale | On | no |
| Shared files | `citationPreview.css` citation chip title/domain move from 1.4 to 1.5 for the classroom too, because those unscoped rules sit in a personal-scope file (the preview's own rules, personal only, move from 1.4 to 1.5 and from 1.6 to 1.65) | A 1.4px-per-line difference on a 12px classroom chip; scoping it would add a third rule for one value | On | no |

## DEC-DS-D-007: spacing ladder and the primary CTA step (CGP-DS-D-007, 2026-10-22; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Ladder names | `--hp-space-n` by multiple of the 4px unit (1, 2, 3, 4, 5, 6, 8); step 1 directly references the unit, others use `calc(var(--hp-space) * n)` | The name says the size without a lookup, a skipped 7 makes the missing 28px step visible, and the ladder follows the unit | On | no |
| Existing off-ladder spacing | Kept (as DEC-DS-R-010). The guard covers declarations that use the unit or a ladder step | Moving 5, 6, 7, 10px values redraws every surface; that needs a design review | On | needed for a grid migration |
| What is a primary CTA | `.studio-primary`, `.hp-cta-primary`, `.hps-trial-end-card-primary`, `.hps-verify-primary` (the test panel's 테스트 시작, the learner's one action there): the classes that carry the one Primary per screen (SX-04). The composer's send button stays 44×44 (DES-CGP-DS-21) | The narrowest set the code already marks as Primary; no new visual hierarchy is invented | On | no |
| How a CTA reaches 48px | `min-height: var(--hp-control-cta)`; padding and font unchanged | The start page's button already drew 49px; the other two grow 4px, and the Google account override grows from 40px to 48px | On | no |
| 32px step | Defined, not applied; no Studio instructor row moves onto it in this row | The row is about learner surfaces; restyling instructor rows is a separate visual change | n/a | no |
| Audit report location | `HPS_AUDIT_REPORT`, default `<tmpdir>/hps-hit-target-audit/report.md` (+ `.json`), never inside the repo | Generated output in a working tree has leaked into main before | On | no |

## DEC-DS-D-012: explicit reduced-motion off (2026-10-22; agent implementation choice)

The supplied DES-CGP-DS-16 three-way contract supersedes R-015's earlier agent choice
that off follows the OS. Host on sets `data-reduced-motion="true"`, off sets `false`,
and auto/unknown removes the attribute. Only an explicit boolean false permits motion
over the OS preference. System remains the default; no preference is persisted by
this change. CSS OS rules run only without the attribute. This is not a new human
agreement and does not change permissions or safety policy.

## DEC-D028: remaining-requests chip beside the model (CGP-SHELL-D-028, 2026-10-22; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| DEC-D028 (CGP-SHELL-D-028) | The design row's 13px chip text is not adopted: the chip uses the learner type scale (`--hp-font-caption`, 14px floor, DEC-29) and the 44px control floor. Model and chip share one row in the heading row and in the narrow header's own row; the header keeps main's height at wide widths. Only the model label yields (ellipsis, down to nothing); the count, confirmation time, reservation/unconfirmed parts and class source name stay whole, and when the chip is narrower than its text the parts wrap whole inside it. Preserve all R-029 seat/provenance guards. Warn (amber border, stroke icon) only for a positive safe-integer Service request limit; no inferred total or progress bar. Open the existing AB-11 usage panel through the existing settings dialog, including classroom seats, where that dialog is mounted only while open | The 14px floor and stroke-icon rules are shared design-system guards, so a one-row exception would fork them. Reusing the selected ledger and dialog avoids a second entitlement or detail implementation; no send, funding change, recipient or minor-safety grant is added. Mounting the classroom dialog only while open keeps every old-profile render unchanged | On where R-029 already shows usage | no (agent-selected 2026-10-21, revised 2026-10-22) |

## DEC-DS-D-014: shared focus geometry (2026-10-22; agent implementation choice)

Reuse the semantic `--hp-ring-focus-default` role established by D-001; do not resurrect the removed
`--hp-ring` alias. `focusGeometry.css` owns an important outline so legacy page-specific 3px rules cannot
win, but with low specificity (exemptions in `:where()`), and the offset is an inherited custom property
that a scroll scope sets once, so the inset needs no selector that out-ranks the base (the first
checkpoint's scope rules lost to the base). It sits after the role tokens in Studio's bundle and is
appended to the Chalk transport. Focus changes the ring only: a keyboard-focused control keeps its own
fill, text and icon colours in every state (hover, pressed, selected), so the primary CTA stays lime.
Because an inset ring would then sit on the control's own fill, the accent-filled controls
(primary CTA, Send, Save, Run, Retry) keep the outside +2px offset even inside a scroll scope; the 2px
gap separates the ring from the fill, so the ring has to contrast with the surface only. Any ring that
is inset (-2px) must also reach 3:1 against the control's fill. This supersedes the round-2 design that
repainted every focused control with the neutral surface pair. Forced colors are the one exception:
the browser already replaces author fills there, so Canvas/CanvasText with a Highlight outline keeps
a Highlight-filled selected control from swallowing the ring, and the -2px scroll inset stays.

The four theme kinds require >=3:1 against the surround. The browser checks (computed style, forced
:focus-visible over CDP) run in the `extension-test` CI job with `FOCUS_REQUIRE_BROWSER=1`, on the
runner's preinstalled Google Chrome, so a missing browser fails the job instead of skipping them;
the parsed stylesheet/token guards run without Chromium; the browser checks remain required owner evidence when the sandbox
cannot start Chromium. No safety, permissions, Service behavior, copy or publication is changed.

## CGP-DS-D-016 implementation interpretation — 2026-10-22

Agent-selected, not a new human agreement. Apply the editing-card geometry to both
classroom and personal seats. Interpret 48px as a minimum, since 44px controls plus
12px padding cannot fit in an exactly 48px card. Keep the textarea's existing line
measurement. The design acceptance names `--hp-text-muted`; the repository forbids
component-level role declarations (semantic-tokens check 4), so the placeholder keeps
the already contrast-corrected `--hp-text-placeholder-default` role directly and no
`--hp-text-muted` alias is added. Generic host `descriptionForeground` fails on some
themes, so it is not substituted.

## DEC-DS-D-018: persistent Chalk list actions (2026-10-22; agent implementation choice)

DES-CGP-DS-23 keeps existing native buttons, links and their Korean names. A decorative
currentColor arrow is drawn with CSS beside action labels, avoiding a second DOM renderer
or changes to handlers and accessible names. Disclosure summaries keep their existing
state chevrons. The row floor is 44px; menu density is a separate row.
Only the existing sidebar, seat/board lists, roster preview and instruction-diff list
scroll containers get the 16px/32px fade.
Matching padding protects end rows. Focus-within and forced-colors remove the fade;
keyboard visibility takes priority over decoration. No theme palette, permissions,
minor-safety policy, Service API or human agreement changes.

DEC-DS-D-018 addendum (2026-10-22, CI round 2): the 44px floor must not cost the ops-g1 requirement
(8 complete seat rows at 1280x720, `e2e/classroom/ops-g1-layout.mjs`). The seat row was 44px of target plus a
1px cell border (45px), and the 16px fade padding moved the first row down, so 7 rows fit. Chosen: keep the 44px
target and the 16px/32px fade as specified, and draw the row divider as a zero-height cell pseudo-element so the
row is exactly 44px. Rejected: shrinking the fade padding (departs from the D-018 text), a negative margin on
`#ops-seats` (overlaps the bulk panel above, only 6px apart), and a forced row height (squeezes the narrow grid card).

## DEC-DS-D-024: the IME guard's key set and the host barrier (CGP-DS-D-024, 2026-10-22; agent choice, not a new human agreement)

| Choice | Decision | Why | Default | Needs Jay |
|---|---|---|---|---|
| Arrow-up history | No Arrow-up prompt recall is added. The composer's composition check runs before every other key branch, so a later recall (CGP-CHAT-R-002 / DEC-08) inherits it; the test already presses Arrow-up during composition | The row guards a key, not a feature; adding recall is out of this row's scope | No new behaviour | no |
| Host forwarding | One document-level bubble listener stops a composing keydown (`isComposing` or 229) before the window, where VS Code's webview host forwards keys to the workbench dispatcher. Plain keys are untouched | Fewest moving parts: one place covers every text field, including ones that do not stop propagation themselves | On (composition keys only) | no |
| Native default | The composer, edit box and dialog hook never call `preventDefault` on a composing key; the IME and the browser keep the commit/cancel and Tab's own focus move. Form fields (task rename, purge dialog) keep their existing hold on a composing Enter, which only stops implicit submission | Taking the key from the IME would eat the syllable | On | no |
| Keyup | The barrier covers keydown only. The host also forwards keyup, but workbench keybindings dispatch on keydown | Smallest change | On | no |
| Chalk | Only `manage.html`'s document Escape handler acted on a key a text field can see; it now ignores a composing Escape. Other Chalk pages have no key handlers; form submission during composition stays with the browser | Smallest change at the only handler found by `grep keydown chalk/src/ui` | On | no |

| CGP-DS-D-020 | Apply card geometry to Studio settings, write/outbound/purge and Chalk outbound consent; keep host-native confirms, navigation drawers and nonmodal voice contracts. Use 20px padding and viewport-clamp the 320px minimum; cancel deferred Studio answers on unmount. | Conservative existing-surface scope, no new learning interruptions or permission grants; CSS animations own dismissal timing. | On; visual/lifecycle only | no (agent-selected 2026-10-22) |

## DEC-DS-D-021: shared tooltip hints (2026-10-22; agent implementation choice)

Existing native title hints become explicit `data-hp-tooltip` attributes on DOM
nodes. A single delegated presenter is installed per Studio webview and embedded
in Chalk by a generated transport, avoiding per-button wrappers and layout changes.
The canonical TS/CSS lives in the webview; `scripts/sync-tooltips.mjs --check` locks
Chalk to it. Native iframe titles and component title props are not hints.

A tooltip is supplementary visual text, aria-hidden, with no aria-describedby:
the control's own visible text/aria-label remains its independent accessible name.
Hovering a second control still opens its hint after 500ms; leaving restores the
focused control's hint. No new shortcut is invented. Native modal hints are mounted
inside the dialog. No permissions, data recipients, learner scores or safety flags
change. This is an agent choice, not a new human agreement.

## DEC-DS-D-028: the contrast table and its fixes (2026-10-22; agent implementation choice)

DES-CGP-DS-42 asks for an automated contrast table "over every token pair actually used". The
choices below are the agent's, taken conservatively (raise contrast, never lower it); none is a
new human agreement or a palette change for the HypeProof Studio theme.

| Question | Choice | Why | Default | Human needed |
|---|---|---|---|---|
| How Studio pairs are found | Every `color:` declaration in the webview CSS, on its own background or on each surface of its scope (chat, personal, branded, Paper), in a committed stylesheet test | A rendered audit sees only the states it drives; the stylesheet covers every rule, so it over-approximates instead of missing pairs | On | no |
| Which themes | The HypeProof Studio theme as VS Code delivers it (its keys plus the registry's dark defaults), no theme at all (CSS fallbacks), and the eight VS Code default themes for muted text | The shipped theme is what learners see; fallbacks must not be a quieter palette; muted text is what this row is about. Non-muted text under other themes stays with `host-theme-mapping.smoke.mjs` | On | no |
| How Chalk pairs are found | Real Chromium over every served page at 1280/390 px, hidden blocks revealed, `<details>` opened, colours read back from the cascade; a CI step in the existing real-Chromium job | Chalk pages layer a dark palette over an older light one, so a static reading of their CSS reports pairs that never render. Script-built rows from Service data are not covered (listed in the requirement) | On | no |
| Muted text that read `--vscode-descriptionForeground` directly | Reads `var(--hp-text-muted-default)`; `--tw-muted` takes the role's light value on light theme kinds | The role already carries CGP-DS-D-002's light fix (Light+ `#717171` is 4.4:1 on `#F3F3F3`). Dark themes get the same host value as before | On | no |
| Error text fallbacks | `#f48771` (the status chip's danger value) instead of `#c62828` / `#e55` | `#c62828` was 2.6–3.1:1 and `#e55` 4.2:1 on forest; only the no-theme fallback changes (`#f48771` is 5.9–7.2:1) | On | no |
| Publish "verified" colour | Primary text instead of `#2e7d32` | The sentence names the state in words (SX-50); green text at 4.5:1 does not exist for both Light+ and forest with one value | On | no |
| Classroom "Stop" label | The app surface colour on the error fill | Error colours are light in dark themes and dark in light ones, the opposite of the app surface, so the pair holds in both; white on the dark-theme `#F48771` was 2.5:1. Light themes are unchanged (their app surface is white) | On | no |
| Text dimmed with `opacity` | Not allowed outside disabled controls, animation frames and icons; of the 24 rules that faded, 21 take the muted role and 3 stop fading | Opacity makes contrast depend on whatever lies underneath, which a token table cannot see; `.hps-hint` at .7 was 2.7:1 on Light+. CGP-DS-R-019 already says this of placeholders | On | no |
| Pressed muted controls | Keep the hover text colour (the body text) | Muted on the pressed layer was 3.6–4.4:1; the hover state of the same controls already switched | On | no |
| Icons | 3:1, not 4.5:1 | WCAG 1.4.11: an icon is a graphic; its label carries the words | On | no |
| Studio ancestor surfaces | A leading part of the selector, plus a listed set of TSX parent/child classes | A name prefix alone mistakes variants (`.hps-naming-btn-ghost`) for children; the list was read from the TSX | On | no |
| Chalk placeholders | Each page's existing secondary ink at full opacity | Chromium's default `#757575` was 3.3–3.7:1 on the dark fields; existing tokens only, so the Chalk transport is unchanged | On | no |
| Chalk authoring eyebrow and toggles, board button | The page's existing dark muted / quiet-control inks; page ink on the blue accent | They were left on the light-page inks (3.0–3.5:1) and white on `#5B8DEF` (3.2:1); existing tokens only | On | no |

### CGP-CHAT-R-006 — local attempt selection (2026-10-22)

Agent-selected, not human-confirmed: record the optional choice only in extension
local globalState, keyed by activity/task scope. Store learner actor, root/attempt
IDs and timestamp; no answer text, score, upload or instructor recipient. Selecting
an answer and choosing it are separate actions: browsing changes next-turn history;
the chosen marker stays until explicitly choosing another attempt. Preserve retry
request IDs for accounting and group them only for display/history projection.
Use the existing version sidecar for full attempt transcripts, with a plain selected
conversation for older builds. Same-session images remain in memory and are not
introduced into durable storage. No grant or minor-seat safety policy is widened.

## DEC-KNOW-R-003: the activity's 자료 list (CGP-KNOW-R-003, 2026-10-22; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Where the list is stored | Per work folder in the extension's storage (`activity-materials/<sha(folder)>.json`), not inside the work folder | Only learner actions write it, so nothing the model writes into the folder can make an item read 나 or 강사 | On | no |
| What a file item may be | A plain text file under the attach caps (100 KB, UTF-8, 20,000 characters, not empty, no link); copied into `<work folder>/자료/` with ` (2)` on a name clash, never overwriting; a `자료` that is a link or not a folder is refused | Whatever is listed can later be sent exactly as stored, through the same checks as REQ-STUDIO-CHAT-FILE-ATTACH. PDFs and images are not added | On | needed to accept non-text files |
| What an address item sends | The normalized address only, inside `<material kind="url">`; Studio does not open, fetch or preview the page, and the framing tells the model so | Fetching a learner-supplied URL from the host is a new outbound request path; the narrowest version sends no request at all | On | needed to fetch page content |
| Address rule | The classroom-link rule of `classroom-admin.md` "링크" (https only, no userinfo, no IP literal, no localhost, no `.local`, no port other than 443, ≤500 characters), checked after WHATWG parsing; plus refusing single-label hosts and whitespace/control/bidi characters. No host allowlist | The allowlist (`HPS_CLASSROOM_LINK_HOSTS`) is the Service's list for instructor links; a learner's own address has no Service list to consult. A single-label host can only name a machine on a local network | On | no |
| Origin AI | Only a file directly in `자료/` whose provenance ledger records an AI write (`ai_created`/`ai_changed`); a file there with any other or no record is not listed | Positive evidence over inference: never guess an origin | On | no |
| Origin 강사 | Readable `material` cards of the classroom inbox (#751 U2); withdrawn, unreadable and other kinds are not listed. The host refuses to remove them | The row's acceptance; the inbox is the only instructor distribution channel on the device | On | no |
| Removing an item | 목록에서 빼기 takes a learner or AI item off the list; a file stays in the folder (deleting files is REQ-KNOW-24's trash, from 내 작품) | Removing from a list must not delete a learner file outside the trash path | On | no |
| Selection | Host-owned, bound to the task scope and folder it was made in, at most 3 items per message, never pre-selected, taken once by a fresh send where the model turn starts; a retry does not resend and says so; another task or folder never shows or sends it | Same lifetime rules as the attached file; three keeps one message near the single-file budget (3 × 20,000 characters) | On | no |
| Gate | The file-attach gate: `sdk_tools.read` after pass narrowing, never the instructor surface; a personal folder whose consent is "AI 안 씀" refuses add and select | Selected items are work-folder content reaching the model, which is what that flag governs | On | no |
| A selected item that disappears or will not read | Named before Send: a watcher on `<work folder>/자료/` (the folder and its files) refreshes the list, and the "함께 보낼 자료" line shows the item as 보낼 수 없음 with why. It stays selected until the learner presses its 빼기. A fresh send with any such item is held in its preflight: nothing goes, the draft comes back, and the alert names it. Taking it out is the learner's consent to send without it | The row says an item is sent "only when the learner selects it for a turn"; sending a turn without an item the learner selected for it, and saying so only afterwards, changes the turn the learner chose. Holding is the conservative reading | On | no |
| A selection from another task or folder | Dropped when the list is drawn on another task or folder (the alert says so). A send that finds it from another folder is held and names it; the selection is cleared, so the next send goes. The folder or task changing between the preflight and the model turn sends nothing from the list and names it | A selection belongs to the folder it was made in: an AI file or instructor card has the same id in every folder | On | no |
| When the selection is taken | Read in the send's preflight (so a vanished item can still hold the send), taken at the same point as the attached file; a later refusal in that send does not restore it | One lifetime rule for both; restoring would need a second release path for every later refusal | On | no |
| What is not claimed | The agent-sdk coach can still open files in the work folder (including `자료/`) with its own Read tool under `sdk_tools.read`; the guarantee is about what Studio puts in the request. The copy says "고른 자료만 다음 질문과 함께 AI에게 보내요", not that the AI cannot see the rest | The coach's own tool reads were already allowed on these seats; blocking `자료/` for the coach would also hide AI-made materials | n/a | needed to fence `자료/` from coach tools |
| Focus ring | The shared focus geometry of CGP-DS-D-014 (`focusGeometry.css`): 2px solid ring token, -2px inside the coach rail's scroll scope, +2px outside one. The card has no ring rule of its own | One ring for every surface; a second rule could only disagree with it | On | no |

## DEC-KNOW-10 — public publication second confirmation

Agent-selected conservative implementation, 2026-10-22; not human approval.
Use the existing host-owned `public` manifest bit as the audience contract. Gallery,
GitHub site/save, and public test-version/link flows are public regardless of seat;
never infer cohort restriction from classroom membership. Nonpublic manifests skip
the additional confirmation. Ask a separate in-panel step after the content checklist,
naming 인터넷의 누구나 (not 우리 반) and the destination host. Keep all existing grants
and default-off publication features unchanged; this restriction grants no new
minor-seat permission. Each action uses a frozen manifest and fresh answers; concurrent
prompts are refused with a reason.
Revised 2026-10-23 after verification: a native modal was rejected because the shipped
build makes its first action the default button, so Enter or a repeated press published.
The public step lives in the panel (focus on 취소, Enter inert, tick before 공개하기) and a
public send with no visible panel is refused, not asked natively.

## DEC-AGENT-R-010: goal status is a learner self-report (2026-10-22)

Agent choice, not a new human agreement: extend the existing local lesson/activity goal
record with an optional status, not a separate goal store. All four statuses are explicitly
labelled 내가 표시한 상태. No automatic completion checker is invented; no status action
starts/stops an AI run or completes a learning task. Existing records default visually to
진행 중 without a write. Edits preserve status. Instructor mode cannot write a new status.
Use only the selected cohort/organization requests ledger with a valid confirmation time,
nonnegative integer remaining count and no unresolved usage; otherwise show 확인 안 됨.
Never infer a lesson budget from a personal balance, trial attempts or tokens. A real zero
is displayed. DEC-35 keeps free-seat budget copy hidden. This adds no permissions or
outbound data, so it is on for existing lesson-goal seats without a new safety flag.

## DEC-AGENT-R032: local lesson disclosure receipt (2026-10-22, agent choice)

Use the existing inline capability card expanded before the lesson content, with
`다음` as the requirement row specifies. The separately queued DES-CGP-AGENT-67
modal-sheet presentation is not introduced here. The first entry remains pending
until Next persists a receipt, so a crash or failed write does not silently skip
it. Header reopening uses the same read-only rows and does not change policy.
Receipts are device-local VS Code global state, keyed by SHA-256 of Service URL,
Service activity_id, course id, version and immutable content hash. Credential
renewal preserves the receipt. Older profiles without a valid activity_id use a
credential-scoped fallback and a replacement credential conservatively asks again.
No raw credential or lesson text is stored;
there is no cross-device seen-state API. Multiple views read the same receipt;
idempotent writes use one key per entry, not a shared read/modify/write array.
This is UI disclosure only, not minor-safety enablement, consent or new autonomy.

## DEC-KNOW-33: receiver policy unavailable (CGP-KNOW-R-018)

Agent implementation choice, 2026-10-22; not a human policy decision.
Use the required unknown disclosure for every destination until the pinned
Service supplies a destination-bound receiver-AI storage policy. Do not equate
"AI 기억, 개인 메모" exclusion, retention/expiry, public audience, or the sender's
profile with a receiver's policy. Do not invent a live endpoint or accept a
caller/model-provided assertion as Service authority. The current work implements
only the unknown branch; affirmative policy branches need Service delivery and
remain outstanding. Existing grants and default-off minor features are unchanged.
Revised 2026-10-23 after verification: instructor sends to learners in Chalk
(distribution confirmation and help feedback) are send-to-others actions and carry the
same unknown line; the help feedback gets a pre-send line in its form, not a new modal.

## DEC-ART-R-011: version sharing summary (2026-10-22, agent choice)

Use the existing publish panel (DES-ART-11's location), without adding permissions or
creating links. Group experiments by immutable version ID, count distinct active links,
and display the latest active expiry; copy the longest-lived link so its expiry matches
that summary. A version with no links is unpublished; one with only revoked/expired links
is disconnected. A Service read that fails or answers malformed shows "공유 상태를 확인하지 못했어요"
in a status region, never "공개하지 못했어요" and never a claim that a page is private;
the last known rows stay, marked with their read time and with copy off. Refresh every 15 seconds and on focus; recheck immediately
before clipboard write. Remote changes are visible after that read, not pushed in real time.
The existing curriculum-runtime grant remains authoritative for every seat/runtime.
This display does not implement the separate minor-publication confirmation row R-012.
No new recipient, default, publication permission or human agreement is introduced.

## CGP-ART-R-001 annotation batch implementation choice (2026-10-22)

Agent-selected conservative implementation, not a new human policy agreement:
`hypeproofChat.annotationBatchEnabled` is machine-scoped and default off. It narrows
existing Curriculum Runtime and image permissions; it grants neither. When off,
the existing single-element CR-09 flow remains. When on, the learner explicitly
picks elements or drags rectangles in the local learner preview and reviews the
numbered crop/text payload in the chat tray before sending one ordinary coach turn.
Comments are limited to 300 normalized characters; page content is quoted data.
Only this activity/task's in-memory draft is eligible. A reload, changed artifact
version, invalid ref table or edited draft during send refuses transmission.
Rectangles include all intersected snapshot refs, or an explicitly unmapped empty
region. More than 200 intersected refs refuses the selection instead of truncating.
No instructor, gallery or public recipient is added. Existing local observation
consent controls recording. Screenshot/installed-shell acceptance remains separate.

CGP-ART-R-001 follow-up: unsupported local development image transport hides the
annotation controls and refuses consumption. Annotation-bearing requests bypass
app-only brain/show/project/guest shortcuts so they reach the ordinary coach path.

## DEC-KNOW-R035: local copy-only takeaway (2026-10-22; agent choice)

Keep the feature machine-default-off for every seat. Use explicit local file
selection and existing provenance, never scan/copy an activity directory wholesale.
Unknown file ownership is exclusion, not permission: require a learner-upload or
AI-created origin and matching bytes. Class resources, class memory, instructor
notes, credentials and configuration stay behind. Team-brain files require the
same origin check and explicit selection. Task history becomes readable text,
without system/tool messages, SDK sessions or authentication bindings. This is a
portable copy, not an import into a destination runtime. A new exclusive folder
per request prevents overwrites and makes retry non-destructive. Retain every
source byte, report each outcome, and keep local copies independent of expired AI
access. These are conservative implementation choices, not a human agreement.

## DEC-SHELL-R-002: prepared update handoff (2026-10-22; agent implementation choice)

Retain only an explicitly requested, verified download; do not add background downloads.
Install after all native shutdown vetoes accept an app exit, never on reload or
workspace switch. An app exit is QUIT (Cmd+Q, File > Exit) or, on Windows, closing
the last window (X, Alt+F4): the pinned VS Code reports that close as CLOSE and quits
from the main process after the window is gone, so the renderer hook treats CLOSE
with one window left on Windows as the exit, as upstream workingCopyBackupTracker
does. Closing a window on macOS, or one of several windows on Windows, never installs. A running turn or class hold still defers installation,
even when the learner accepts the active-turn quit dialog. The updater remains
available until its shutdown joiner finishes; local extension-host teardown becomes
a deferred Last joiner, matching the existing remote-host teardown contract.

Natural quit stays closed (Windows explicitly disables the remembered runcode task
and reboot). The existing explicit restart retains relaunch. Persist per installation,
recheck prepared bytes, reject stale/downgrade targets, consume once across windows,
and clear only the pending record belonging to the explicit-restart modal. A failed
or tampered handoff discards that record and keeps the old app; the learner may request
a fresh download. This adds no minors' permission or background installation flag and
is not a new human agreement.

Shared handoff exclusion uses the existing inter-process `accountLock` in a separate
update directory and a lease naming the detached installer (pid, per-launch nonce,
launch time). A second window or a newer pending download cannot launch another
installer while that process is alive. Because pids are reused, the lease also
expires 10 minutes after launch, so an unrelated process can hold updates back for at
most that long; a lease whose process is gone, or one that is unreadable, is deleted.
The Windows wrapper waits for Setup itself (`WaitForExit`), not `-Wait`, which also
waits for descendants and would hold the lease through the whole session Setup
relaunches after an explicit restart. A refused explicit restart (another installer
running, or a turn or class started) does not quit Studio; it says so in Korean and
keeps the prepared update for the next eligible quit.

## CGP-SHELL-R-009 implementation choice — 2026-10-22

Agent choice, not a new human agreement: use a host-owned, reference-counted
native helper for automatic system idle sleep only. macOS `caffeinate -i -w`
binds to the extension host PID. Windows executes a fixed C# method on one thread,
sets `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`, then waits for stdin EOF and clears it;
closing the host also closes that pipe. Explicit user sleep, lid close and display
sleep remain under OS/user control. No settings or learner safety policy changes.
A missing helper logs a fixed diagnostic and never prevents the learner's work.
The preview lease spans preparation through actual preview readiness, not the
lifetime of the local preview server. Queued unsent input holds no lease.
Windows API reference: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate

## CGP-SHELL-R-012 keyboard panel scope (agent-selected 2026-10-22)

Implement the two existing webview panels (task rail and sources), not native VS Code
sashes. Widths start at the design-token defaults (rail 204px, sources 280px; unchanged
from main), clamp to 200-320 and 240-400, and are remembered per seat in the webview's
saved state (no host messages). The splitter hit target is 44px wide (thin visible line)
and also accepts a mouse drag. Preserve
existing responsive modal breakpoints and remove splitters when panels are overlays.
Plain arrows move 16px, Shift arrows 64px per DES-SHELL-11. Owner decision 2026-10-23
(supersedes the agent's earlier choice to remove autofocus): keep the composer's initial
autofocus as on main, because learners are elementary students who must type at once;
a keyboard user who starts in the composer already has what the link gives. The skip
link stays first in tab order, so the first Tab reaches it whenever focus is not in the
composer, and Shift+Tab reaches it from the composer. The acceptance line "First Tab
focuses a visible skip link" is read that way. Explicit user/host focus requests and the
existing conversation shortcut remain available. No safety
permission or model/runtime behavior changes. This is an implementation choice, not
a newly recorded human agreement.

| DEC-SHELL-R015 | Attribute a singleton model/effort setting to the teacher only with a resolved classroom profile or lesson, excluding local development runtime and instructor mode. Preserve single-option personal/trial/pass/unknown menus without teacher attribution. Do not invent an approval-mode value absent from the pinned Service contract. | Singleton availability alone does not prove teacher ownership. This UI-only change explains existing policy without changing approval, recipient, or runtime grants. | On for confirmed cohort settings; no new permission | no (agent-selected 2026-10-22) |

## CGP-SHELL-R-023: first-result comparison (2026-10-22; agent choice)

The check opens the exact successful answer as inert text and asks the learner
to compare it with their request and original material. It never runs generated
code, opens a URL, sends another model request or records a correctness claim.
The learner can acknowledge comparison and finish, or close without claiming a
check. This informational card applies to all learner seats, including minors,
independently of optional tips; it adds no safety grant or opt-in feature.

First session means the first successful AI answer after this local education
record is introduced. Existing users therefore also receive it once. Dismissal
is local to this Studio installation and stable account/cohort-seat identity;
unknown legacy identities use a token digest (or local conversation scope when
there is no token). There is no cross-device sync. Atomic, immutable records
keep two windows from replacing the first answer or undoing dismissal. Only
scope/answer ID and a dismissal flag are stored, never answer text or a score.
This is an implementation interpretation, not a newly confirmed human decision.

Fix round 1 (2026-10-23): the card carries an amber warning icon and edge
(DES-SHELL-22). The action button takes a lime border, not a lime fill, because
the screen keeps one Primary CTA (SX-04). The answer sits on a panel surface at
learner type size, bounded to six control heights, scrolls, keeps line breaks and
is keyboard focusable. A store that cannot be built or read yields no card and
never interrupts the send-release cleanup.

## DEC-VOICE-R010: own-preview text only (2026-10-22; agent implementation choice)

Context attachments keep integrated-tab viewport screenshots, but collect no DOM or AX
text from external pages. Full body text (including off-screen text) requires the live
HTTP(S) document to match this window's current local preview origin and captured URL.
Unknown ownership fails closed, including screenshot-only callers that do not supply an
owner. The existing page-context grant remains default off; this does not enable voice,
add an OS capture API or expand any cohort grant. Learner copy changes only to stay
true: when no page text goes, the notice says 화면 사진만 or 주소와 제목만 and why, and
the chip reads 페이지 정보 with the reason on it (fix round 1, 2026-10-23).
Generic agent browser tools retain their independent CR-11 scope contract; this slice
changes the page-context attachment primitive and its command caller.

### DEC-KNOW-63 — Restricted visitor snapshot

Use a dedicated in-App preview panel with a snapshot-only loopback origin. Never
reuse the workspace live server: its unselected files must remain inaccessible.
Keep existing publication consent after the preview. Disable external requests,
embedded frames, workers, forms and device access in this local view; explicitly
state that limit rather than claiming remote behavior was reproduced. Site save
without deployment is not a visitor publish action and keeps existing consent.

### DEC-ART-03 — Preserve annotations at the browser close boundary

Use the native modal's first/close-affordance action for keeping annotations and
a separate explicit discard action. Only a matching scope and revision can be
discarded. Native BrowserTab close notification arrives after closure, so preserve
the annotation draft and ask then; do not claim to cancel the browser's close.
Do not automatically navigate or send content when the learner chooses to keep.
Activity switching is blocked before credentials, folder or task mutation until
discard is chosen. A transient unexpected scope switch parks the prior draft in
this window only, without sending it or copying it to another activity.

## DEC-SHELL-R-006: bundled Korean shell (2026-10-22; agent implementation choice)

Ship a Korean NLS bundle with the app and select it on every OS, including when
an existing user profile requests English. Do not modify the user's language-pack
cache or require a first-launch network request. Use the existing Korean quit and
update copy. The native app menu title is `하이프루프 스튜디오`; model names, versions
and user-authored names remain intact. Generate messages in packaging before
signing; refuse missing native menu/dialog/update keys and placeholder drift.
This is presentation only, default on, and introduces no grants or recipients.

The Korean shell uses a new native menu cache key so an upgraded English profile
cannot restore old English labels before its first renderer update. Native
Studio settings use a fixed Korean label map; their setting keys, values and
approval defaults remain unchanged. Local canonical builds generate the same
bundle as CI packaging.

## CGP-KNOW-D-003: drop zone clause split out (2026-10-24)

The DES-KNOW-04 acceptance names a drop zone outline, but the materials panel has no drop input. A drop input is a new file-input path that needs its own validation and review, so the clause moves to hypeproof-studio#2641 and CGP-KNOW-D-003 ships with the row presentation only.

## CGP-AGENT-D-009: collapsed goal strip height (2026-10-24)

DES-CGP-AGENT-13 asked for a collapsed strip of at most 40px, while every learner control must be a 44px target. The strip is itself the expand control, so the 44px target rule wins. The intent of the original clause, a strip that stays one compact row, is kept.

## DEC-AGENT-D028: lesson disclosure modal (2026-10-24, agent choice)

The separately queued DES-CGP-AGENT-67 now replaces R032's interim inline
presentation with a native modal sheet and `알겠어요`. R032's local receipt scope,
failed-write retry, resolved capability rows and seat/runtime gates are unchanged.
Escape acknowledges this informational disclosure, never grants permission, and
is ignored during composition. Backdrop presses do not acknowledge it. Focus
returns to the preserved composer after the host confirms the receipt.

## CGP-DS-D-011: motion names, exit curve and loop exception (2026-10-24, owner decision)

- Confirm: `--hp-dur-confirm: 160ms` is added as an alias of `--hp-dur-content` (one value, two names). Existing uses are not renamed.
- Move: `--hp-dur-move: 240ms` is added for in-place movement. No transition moves an element in place today (the chevron turn is a 140ms press, the runner bar's height change is a 180ms entry), so nothing uses it yet.
- Exit: `--hp-ease-exit: cubic-bezier(.4, 0, 1, 1)` replaces the `ease-in` keyword on the dialog exit (Studio `modalSurface.css` and the Chalk copy in `sharing.html`). It is the only dialog or popover exit in the product.
- Loops: looping pending indicators (runner, shimmer, breathe, response and classroom dots) are the "bounded pending" exception to the 300ms cap. They must stop under `prefers-reduced-motion` and `workbench.reduceMotion`; the global override already sets one iteration and 0.01ms, and `test/motion-computed.smoke.mjs` measures it.
- No spring or bounce: no cubic-bezier with y outside [0, 1], no `linear()` easing, no spring keyframe names. The runner hop and dust keyframes are looping status animations, covered by the loop exception.

## CGP-SHELL-D-029: reason choices and cooldown blocked on the Service (2026-10-25)

The parent REQ-SHELL-30 asks for an optional reason, approval/refusal states and a 10-minute cooldown between requests. The pinned Service requires a non-blank reason and has no cooldown, so Studio ships the part it can keep honestly: a free-text reason up to 200 characters (labelled required), an IME guard, a live counter and a receipt taken from the Service record. Reason choices and the cooldown are recorded as blocked on the Service contract (owner decision 2026-10-25); they are not simulated in the webview.

## CGP-DS-D-017: personal message bubble geometry (2026-10-25, owner decision)

- Identity mark: not rendered in the personal chat. The later personal-chat polish removed boxed assistant icons on purpose; DES-CGP-DS-22's 18px mark is adapted away. The test asserts no `.hps-assistant-mark` node and no 18px square node or pseudo-element in an assistant message.
- Bubble background: keep the host token (`--vscode-list-inactiveSelectionBackground`, as shipped) instead of the text colour at 6-8%. It follows the learner's VS Code theme and the host-theme-mapping contract. The test asserts the computed background equals the mapped host colour in Dark+ and Light+ and that the text keeps at least 4.5:1 on it.
- Radius: keep the shipped `18px 18px 6px 18px` (tail corner at bottom right). The test asserts the four computed radii.
- Kept as shipped: prose 40em, user bubble max-width 85% including padding (border-box).

## CGP-CHAT-R-023: lesson step dividers (2026-10-25, agent-selected conservative implementation)

- Served step = the step the host captured at turn start for the runtime (`turnLesson`, the `x-hps-lesson-step` value). The divider names exactly what the coach was told, never the step the learner looks at later.
- The first served step also gets a divider: it is the boundary the transcript starts under, and the jump needs a target for it. Unmarked lines (history from before this change, app-answered shortcuts, tool lines) neither start nor break a run; there is no backfill. A re-sent id drops its old mark at the start of the send and is stamped again only on the model path, so a re-send answered by an app shortcut (or in instructor mode) shows no boundary rather than a stale one (verify FAIL fix, 2026-10-25).
- The mark (lesson digest, step id, 1-based number, cleaned title capped at 60 characters) is stored beside the transcript in workspace state, at most 400 per workspace, keyed by the user message id. The task file is unchanged, so older builds still read it.
- "지금 단계로" targets the latest divider of the rail's step on screen (the first step when none is picked) in the lesson on screen. When that step has no divider yet, there is no button. It scrolls only (instantly under reduced motion): no focus move, no step change, no host message.
- Seats: learner seats with a served lesson. Personal workspaces have no lesson (`personalWorkspace` requires no lesson), and instructor mode draws no lesson rail, so neither gets dividers.
- The button sits in region A's footer as a quiet 44px button at the 14px floor (DEC-29), next to 남은 단계, never a second Primary (SX-04).
- Default state: on (display only; no new data leaves the device, no permission change).

## DEC-32 interim: math rendering (CGP-CHAT-R-022)

| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| DEC-32 (interim) | Build R40 instead of moving it to DEFER: `$…$` / `$$…$$` in coach answers render with bundled KaTeX (trust off, bounded input) in every seat, personal and classroom, adult and minor alike. Invalid TeX and money-like dollars stay raw text; copy returns TeX. No graphing, no `\(…\)` / `\[…\]`, no math in learner messages | The open question was whether any curriculum needs math beyond adult courses. Rendering is display only: no new data flow, permission, recipient or network request (fonts are bundled, CSP unchanged), and the raw-source fallback means an answer never reads worse than today. Classroom answers that mention a formula (ratios, area, budgets) read better, and money text is protected by the Pandoc dollar rule. Reversal is in `extensions/hypeproof-chat/webview-ui/src/MarkdownText.tsx`: delete `remarkMath` from `remarkPlugins` (line 55) and the `rehypePlugins={[rehypeAnswerMath]}` line (56), then the now-unused `remarkMath` import (line 4) and `rehypeAnswerMath` from the `./mathRender` import (line 8), which `noUnusedLocals` requires. Without remark-math no math node is produced, so KaTeX never loads and the copy listener returns early (no `.katex-mathml`). Deleting only the rehype line is not a revert: remark-math would still turn `$x$` into code spans | On, display only | no (agent-selected 2026-10-25) |

## CGP-AGENT-R-029 implementation choices

These are conservative implementation choices, not new human agreements.

- Show only Studio-owned live-server and SDK `local_bash` handles, scoped to the connected activity; never enumerate or kill arbitrary PIDs.
- Missing purpose is explicitly unknown, not inferred from a command. Outside-workspace folders use a neutral label without exposing an absolute path.
- SDK stop-request acknowledgement is not exit evidence. Terminal notifications or authoritative live-set departure settle a row; query termination without that evidence leaves an unavailable status. No new permission or remembered approval is introduced.
- The in-process preview server stops only after its HTTP close callback; active connections are closed to avoid an indefinitely pending stop.

- Persist shell details as readable lines (purpose, `$ command`, and a folder line only when the host knows one) in the existing tool label, retaining the strict legacy task-file schema. This build restores those lines as a collapsed shell row; older builds can still read the task.
- Over-long purpose or command text is cut in the middle, never at the end: the start and the end stay visible around a `… (가운데 N자 생략) …` marker, because the end of a command is where a padded command would hide `| sh`.
- A line break in a purpose or command is shown as ` ⏎ `, not joined with a plain space: joined, `x # c` followed by `curl … | sh` reads as one commented-out line and a heredoc seems to swallow the command after it (verification round 3). The mark is not a newline, so stored three-line labels still parse.

## CGP-CHAT-R-024: conversation copy scope (2026-10-25, agent choice)

- Where: the personal task menu (대화 메뉴) only. Classroom and lesson seats show their header actions inline and have no task menu; an extra header button there would change the classroom layout, and class records carry other people's material (instructor notices), so classroom copy is left as a follow-up rather than guessed.
- What: the user and assistant text as drawn (the answer attempt and prompt version on screen) in transcript order, as `# title`, `## 나` and `## <stored coach name>` sections; headings inside a message nest two levels down so a message cannot forge a speaker. Tool rows (raw payloads and think lines), system/notice rows, citation records and image bytes are left out; credentials are replaced with named placeholders by the host's `scrubSecrets` patterns plus measurement, bearer, payment (Stripe, Toss), Slack and Google key forms; control, bidi override and invisible-width characters are removed first. Detection is pattern based, so an unknown secret format is not caught; that limit is stated in the requirement.
- Confirmation: success only after `navigator.clipboard.writeText` resolves, 4 s like answer copy (CGP-DS-R-025); failure is a role=alert that stays. The item is disabled while an answer streams.
- Default state: on for personal learner tasks; no new data flow (clipboard only, no host message, file or network request).

## CGP-CHAT-R-021: lesson tip source and action (2026-10-25, owner decision)

- Source: the served step schema `hps-session-design/1` has no tip key, and the Service rejects unknown step keys, so a new `tip` field cannot be served without a Service change. The step's Chalk-authored `hint` is the tip. A blank hint shows no tip; Studio never fills in a generic or product tip.
- Action: `입력창에 넣기` prefills the hint text into the composer (appended on a new line after an existing draft, once). The schema has no separate prefill text, and an action phrased by Studio would no longer be lesson-authored.
- Dismiss: per course, version, sha256 and step id, kept in the panel's webview state (newest 200). It is not per task: closing it on a step hides it for that step in every task of that lesson in this panel. A new lesson version shows its tip again. Two windows each keep their own dismissals.
- Duplication: the rail's 힌트 보기 disclosure keeps the same hint. The tip surfaces it once above the composer; authors who want a hint kept behind a disclosure leave `hint` blank and put it in `instructions`.
- Presentation (CGP-CHAT-D-021): one row above the composer, `도움말` text badge, two-line clamp, 44px targets including the close button, hidden while a turn runs or a send is pending.

## CGP-CHAT-R-027: find in chat (2026-10-25, agent-selected conservative implementation)

- Placement: D80 asks for a bar "sticky at the top of the transcript". An overlay would cover the first lines (the first match could not be scrolled out from under it), and a sticky row inside the scroller would add a flex gap. The bar is a row in the chat column right above the transcript; opening and closing shift `scrollTop` by its height, so the text on screen and the distance to the bottom do not change. Only a reader within the bar's height of the very top sees the text move on close (nothing to compensate with).
- Focus on Esc: D80 (previously focused element) wins over REQ-CGP-AGENT-48 (composer). The composer is the fallback when that element is gone.
- Scope: user and coach message bodies on screen, in reading order. Tool lines, hidden retry versions and interface chrome inside a body (buttons, status lines, screen-reader-only text) are not searched. A collapsed code pill registers its code: its matches count, and arriving at one opens the pill (it stays open, like any learner toggle).
- Matching: plain text, case-insensitive with offset-preserving folding; no regex, no NFKC; controls, bidi characters, U+2028/2029 and BOM are dropped; 200 code-unit cap.
- Painting: CSS Custom Highlight API, so no DOM is changed and streaming re-renders are untouched; the current match is also underlined (not colour-only); forced colours use Mark/Highlight. Without the API the count and navigation still work.
- Shortcut: Cmd+F (macOS) / Ctrl+F (others), handled on the document before the VS Code webview host sees it; not while a modal dialog is open or during IME composition. No other keys are bound (CGP-CHAT-R86 lists Cmd/Ctrl+F only).
- Seats: every seat that draws the transcript, including the instructor's nested panel. Default state: on (local display only; nothing leaves the device, no permission change).

## CGP-KNOW-R-001: task rail search (2026-10-25, agent choice)

- Found on main: a title filter already existed in the rail but filtered on every keystroke, including an open IME composition, compared raw code points (a decomposed-jamo title never matched), kept a stale query across activities and showed the "not found" line for an empty activity. The row is built by fixing those four, not by a new surface.
- IME: the committed query filters; composing text is shown in the field but does not filter. Chromium sends the commit's last `input` with `isComposing` true and then `compositionend`, so the commit is taken from `compositionend`.
- Matching: one substring of the title in NFC, case folded, query trimmed. No word splitting, no fuzzy or initial-consonant (초성) search; both would need their own acceptance.
- Scope: the search belongs to one activity and resets when the activity changes. The heading count (최근 작업 N) keeps the activity total.
- Default state: on for personal tasks; no new data flow (webview only, nothing posted to the host).

## CGP-CHAT-R-029: low-stakes removal undo (2026-10-25, agent-selected conservative implementation)

- Scope of "attachment chip": every chip the composer draws with a remove control that sends nothing yet: pasted/dropped/sketched images, staged photos, folded long pastes, the work-folder file chip and the page chip. Out of scope: the element chip (curriculum runtime only, its message inventory is fixed by CR-T02), annotation marks (removal also clears the numbered marker in the preview, which is not a composer state), and the quote chip (a reference to visible text the learner can quote again).
- "Queued item" is the #416 parked message. Its × already returns the text to the draft; the toast says so and 되돌리기 queues it again. A tool-mode mismatch only pauses the item (nothing removed), so it has no toast. Stop and the end of a turn are not learner removals and show none.
- Exact prior state or nothing: an offer ends as soon as its subject changes (one keystroke in the draft ends a paste or queue offer), on a send, and on a task or activity switch. No merge of a removed item into a changed list.
- Host-held chips: the host keeps its own snapshot under the webview's undo id and restores that object; the webview never sends content back. The attach gate and folder consent are re-checked at undo. No optimistic success: the toast waits for the host's answer (15 s, then failure).
- Staged photos: the host file is deleted when the offer ends without undo, not at the press. A photo still being prepared or refused is deleted at once without an offer.
- Rename: undo restores the title and its origin; it is refused if the title changed since. The task list order is not rewound (the draft flush around a rename and its undo is activity, and rewinding `updatedAt` would misreport it).
- Lifetime 6 s per CGP-CHAT-D85 (longer than the 4 s floor of CGP-DS-R-025), held while hovered or focused; "되돌렸어요" uses the same lifetime; a refused undo persists with 닫기 (DS-R-025: errors persist).
- Seats: every seat whose composer draws the chip or queue (personal, trial, pass, classroom/lesson); rename only where the task header exists (personal, trial). Instructor mode draws no file or sketch controls. Default state: on (no new data flow; a removed host chip is held in memory only and never sent).

## DEC-KNOW-R-002: activity home views (CGP-KNOW-R-002, 2026-10-25; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What the "activity home" is | The task workspace rail of personal and trial seats. 작업 is today's rail (새 작업, search, task list); 자료 is the R-003 자료 list | Studio has no separate project page; the activity is the "project" (CGP-KNOW-01) and its rail is where the learner already moves between tasks | On | no |
| One place for the 자료 list | On those seats the chat column's closed 자료 card is left out; the "함께 보낼 자료" line above the composer stays. Classroom keeps the card in the coach rail | Two copies of one list invite a second, stale press target; classroom layouts must not change (REQ-STUDIO-TASK-WORKSPACE scope) | On | no |
| Seats with no list | No tabs; the rail is unchanged, even if 자료 was remembered | An empty view that can do nothing is noise; R-003's gate decides whether the list exists | On | no |
| Persistence | The webview state (as the panel sizes, CGP-SHELL-R-012), per host scope digest, at most 50 seats | A presentation choice; nothing for the host to store, and it survives hiding the panel and reloading the window | On | no |
| Draft safety | Switching is local state only: no host message, no remount of the conversation | The row's acceptance (20 switches, byte-identical draft); keeping the composer mounted is stronger than restoring it | On | no |
| Selected-state presentation | Weight 600 and a 2px underline in the text colour; forced colours keep Canvas/CanvasText with a 2px Highlight underline instead of the shared selection fill | Not colour only (DES-KNOW-02). The shared `[aria-selected]` Highlight fill sits under Chrome's text backplate and hid the label (measured 1:1) | On | no |
| Activity title | Not added above the tabs | DES-KNOW-02 ("under the activity title") is CGP-KNOW-D-002; this row ships the behaviour | n/a | no |

## CGP-CHAT-R-025: task archive (2026-10-25, agent-selected conservative implementation)

- Archive = hide, never delete. An archive sidecar beside the task file records task id and time; the task document, versions and verdicts are not touched, so older builds still read the task file and a downgrade only lists archived tasks again.
- Only the open task is archived (the task menu acts on what is on screen), against the current revision; the host flushes its draft first, as on a task switch. Next open task = the most recently updated listed one, else a new empty task.
- "A running task must be stopped first": the host refusal is the task-switch refusal (stream, settling stop, approval, verification run); the menu item is disabled while streaming.
- 보관함 lives in the task rail as a separate view (DES-CHAT-77), entered from a "보관함 N" button shown only when something is archived. 다시 열기 is the quiet neutral 44px button at the 14px floor (DEC-29), no red.
- Seats: personal task workspaces only (no lesson, not instructor). Class seats have no task list; nothing on any seat deletes a task permanently.
- Default state: on (local display state only; no data leaves the device, no permission change).

## CGP-KNOW-R-021: Studio-browser downloads (2026-10-25, agent-selected conservative implementation)

- Mechanism: the fork core has no download hook (verification.md CGP-ART-32: specified only), and core patches cannot be built or checked in this loop. The extension's per-tab CDP session uses `Page.setDownloadBehavior` and `Page.downloadWillBegin`/`downloadProgress`, which the integrated browser's CDP proxy routes to the page (`Browser.setDownloadBehavior` is a no-op stub there). Verified against headless Chromium; the Electron integrated browser itself is NOT RUN here (owner check listed in the report).
- Safe session (minor cohorts): downloads are denied with a blocked line, also from the extension side. With no profile loaded, downloads are denied (the cohort may be a minor one). The persisted `hypeproof.browser.safeSession` is not used as the fallback here: `applyBrowserSafety(null)` writes `false` to it when a profile fetch fails, so it is not fail-closed (this also affects CGP-ART-R-008's `linkSafety` fallback; reported, not changed in this row).
- All other seats (personal, trial, pass, classroom, lesson, instructor) save into `<workspace>/downloads/`. No workspace or an unusable `downloads` entry (symlink, file) denies; Studio never follows a symlink out of the workspace and never renames the learner's entry for them.
- Overwrite: Chromium overwrites a same-name file in `downloads/`. The "replaced an older copy" hint was dropped because Chromium reserves the target before `downloadWillBegin` arrives, so it cannot be told apart; the line makes no claim either way.
- Presentation: the existing tool row (file icon, done/failed mark), persisted like a denial notice in the task where the download began. CGP-KNOW-D-021's 13px size and 열기/폴더에서 보기 actions are left to that design row; 14px learner text keeps winning over the register's 13px.
- No progress line, no automatic open, no quarantine or execution change.
