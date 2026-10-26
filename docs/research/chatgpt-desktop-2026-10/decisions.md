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
| CGP-CHAT-D-014 (label size) | The source kind label before the title takes the title line's own size and leading and is set apart by muted ink and the strong weight, not by a smaller font. It moves off the domain line on the personal rack, the classroom chips and the workspace source list; the preview keeps its kind line above the heading | DEC-29 puts a 14px floor on every visible word of the personal chat, and the personal title line is already 14px, so a smaller label would break the floor; at the title's size the row keeps the height it has today, which D45 asks for. The classroom chip uses the same rule so one label style serves both seats | On; display only, no data change | no (agent-selected 2026-10-26) |

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
| DEC-LEARN-14 (CGP-LEARN-R-014) | Chalk `/authoring` asks once per browser for grade band and subjects and stores only those in `localStorage`; only a lesson made with 새 강의 만들기 is pre-filled (대상 text and `audience_tier`). Grade → tier: 초 1–6 → lv1, 중/고 → lv2, 성인 → adult, 유아 → none. A per-lesson 대상 단계 select edits the tier; an unknown stored tier is kept. | The Service has no instructor-preference store and Chalk writes no KV (ARC-01), so a cross-device default needs a new contract. The tier is mapped only from the instructor's own explicit answer and stays visible and editable, which keeps the `chalk_*` tool rule (ask, never guess from age); 유아 has no Service tier, so none is invented. Skipping writes nothing into a lesson | On; Chalk page only, no Service writes or new data flow | needed for a Service-side instructor default (agent-selected 2026-10-26) |

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

## DEC-DS-R-011: one radius scale, nested radii computed (CGP-DS-R-011, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Scale steps | 4 / 6 / 8 / 12 / 16 / 18 / 20 / 24px and full (999px), primitives in `designTokens.css` | DES-CGP-DS-12's 4/8/12/16/24 plus the three values shipped designs already fix: the 20px composer (DES-CGP-DS-21, D-016), the 18px bubble and its 6px tail (owner decision D-017). Dropping them would overrule a design row and an owner decision | On | no |
| Global multiplier | `--ds-p-radius-scale` (1), applied with `calc()` in `radiusScale.css`; full is not multiplied | The token tiers only alias (design-tokens smoke), so the first consumer multiplies. One file serves Studio (via `tokens.css`) and Chalk (in the token transport), so there is one scale, not two copies | On | no |
| Nested radii | Outer radius minus the inset between the two edges: menu items 12 − 4 = 8px (were 6px, REQ-STUDIO-MENU-TOKENS), task menu and "내 질문" items 12 − 6 = 6px (were 5px; their panels 9 → 12px, the menu radius), controls and the field in the composer card 20 − 12 = 8px (every composer button without its own radius, classroom Send/Stop and 다시 굴리기, and the classroom field were 4px) | That is the acceptance's rule; a step that happens to match would drift when either value moves | On | no |
| Round controls | The personal Send/Stop and tools buttons keep their circle, on `--hp-radius-full` instead of 50% | A circle is a shape, not a concentric corner; turning the Send circle into an 8px square is a visual change the row does not ask for | On | no |
| Off-scale values on the named surfaces | Classroom bubble 14 → 16px (tail 4px kept; the classroom assistant bubble keeps its 14px, it is not a named surface), personal suggestion chip 10 → 8px, citation chip 9 → 8px, access chip 5 → 4px; pills already at 999px move onto the full step. Overridden rules (composer 22/28px, personal bubble 20px, personal citation 9px, settings card 16px) name the radius that already won | Nearest step inside the design range (DES-CGP-DS-12: bubble 16–20px); a 1–2px change on each | On | no |
| Scope | Composer, bubble, menus, dialogs and chips in Studio and Chalk. Every other radius keeps its shipped value | As DEC-DS-R-010 kept off-ladder spacing: moving all ~250 radii redraws every surface and needs a design review | On | needed for a full migration |
| `corner-shape: superellipse` | Not adopted | Chromium-only today and not in the acceptance | n/a | no |

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

## CGP-CHAT-D-023: step divider design (2026-10-26, agent-selected)

- D56 is met on main by the CGP-CHAT-R-023 build (full-width hairline, centred "n단계: {name}", `role="separator"` with no focus stop, a 44px "지금 단계로"); the layout smoke measures each clause in headless Chromium.
- Gap fixed: each hairline segment keeps at least 24px (`flex: 1 0 space-4`), so a long title wraps instead of erasing the line in a narrow (360px) chat column. Measured at 360, 800 and 1420 px, dark and light.
- "In the header" = region A's lesson header (`header.hp-mission`) footer, next to 남은 단계, not the task top bar: the button belongs to the lesson and the top bar is shared with personal seats that have no lesson.
- Default state: on (display only).

## DEC-32 interim: math rendering (CGP-CHAT-R-022)

| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| DEC-32 (interim) | Build R40 instead of moving it to DEFER: `$…$` / `$$…$$` in coach answers render with bundled KaTeX (trust off, bounded input) in every seat, personal and classroom, adult and minor alike. Invalid TeX and money-like dollars stay raw text; copy returns TeX. No graphing, no `\(…\)` / `\[…\]`, no math in learner messages | The open question was whether any curriculum needs math beyond adult courses. Rendering is display only: no new data flow, permission, recipient or network request (fonts are bundled, CSP unchanged), and the raw-source fallback means an answer never reads worse than today. Classroom answers that mention a formula (ratios, area, budgets) read better, and money text is protected by the Pandoc dollar rule. Reversal is in `extensions/hypeproof-chat/webview-ui/src/MarkdownText.tsx`: delete `remarkMath` from `remarkPlugins` (line 55) and the `rehypePlugins={[rehypeAnswerMath]}` line (56), then the now-unused `remarkMath` import (line 4) and `rehypeAnswerMath` from the `./mathRender` import (line 8), which `noUnusedLocals` requires. Without remark-math no math node is produced, so KaTeX never loads and the copy listener returns early (no `.katex-mathml`). Deleting only the rehype line is not a revert: remark-math would still turn `$x$` into code spans | On, display only | no (agent-selected 2026-10-25) |

## CGP-CHAT-D-022: math layout (2026-10-26, agent choice)

- Found met on main: REQ-STUDIO-ANSWER-MATH (CGP-CHAT-R-022) already centres display math in its own scroller, loads only bundled KaTeX fonts and lets math inherit the prose colour. No product code changes.
- "Baseline-aligned" is measured, not assumed: a zero-size inline-block before each inline formula marks the sentence baseline and one at the end of each KaTeX base marks the formula's; they must agree within 0.5px for a plain term, a fraction and a sub/superscript, in both seats, both themes, both widths and forced colours.
- "Text token colour" is `--vscode-foreground` with the `--hp-text-primary-default` fallback, the token answer controls use. Math must equal it, not only the surrounding prose, so a later prose override that drifts off the token is caught.
- Default state: unchanged (display only).

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
- Presentation (CGP-CHAT-D-024 / D62, 2026-10-26, agent choice): the result moved from its own bordered line under the header to the answer-copy toast (the shared `CopyFeedback` outlet above the composer, same icon, chrome and 160 ms entry). The failure is announced through the outlet's assertive live region, as answer copy is, instead of a role=alert node; the lifetimes above are unchanged.

## CGP-CHAT-R-021: lesson tip source and action (2026-10-25, owner decision)

- Source: the served step schema `hps-session-design/1` has no tip key, and the Service rejects unknown step keys, so a new `tip` field cannot be served without a Service change. The step's Chalk-authored `hint` is the tip. A blank hint shows no tip; Studio never fills in a generic or product tip.
- Action: `입력창에 넣기` prefills the hint text into the composer (appended on a new line after an existing draft, once). The schema has no separate prefill text, and an action phrased by Studio would no longer be lesson-authored.
- Dismiss: per course, version, sha256 and step id, kept in the panel's webview state (newest 200). It is not per task: closing it on a step hides it for that step in every task of that lesson in this panel. A new lesson version shows its tip again. Two windows each keep their own dismissals.
- Duplication: the rail's 힌트 보기 disclosure keeps the same hint. The tip surfaces it once above the composer; authors who want a hint kept behind a disclosure leave `hint` blank and put it in `instructions`.
- Presentation (CGP-CHAT-D-021): one row above the composer, `도움말` text badge, two-line clamp, 44px targets including the close button, hidden while a turn runs or a send is pending.

## CGP-CHAT-D-021: lesson tip presentation (2026-10-26, agent choice)

- Found on main: the presentation shipped with CGP-CHAT-R-021 (#2767). This row adds no product code; it proves the D19 clauses on the real App in headless Chromium and fills the test gaps (a pending send, a long hint, forced colours, one line at column widths).
- "Single row": one row element in the composer column's flow. At 800px and wider the badge, text and both buttons share one line. At 320px the two buttons wrap under the text inside the same row; 44px targets and the 14px text minimum win over a single visual line.
- "Never overlaps the composer": the row is in flow (never absolutely positioned) and the text is clamped to two lines, so a long hint cannot push the composer off screen at base or xlarge text.
- "Hidden while a turn is running": also hidden while a send is pending (posted, before the host starts the turn), and back if the host rejects the send.
- Default state: unchanged (on wherever a served lesson step has a hint); no new data flow.

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
- Default state: on for personal tasks; no new data flow (webview only, nothing posted to the host for the title filter or while composing). A committed query's message-text search is CGP-CHAT-R-026; see the reconciliation below.

## CGP-KNOW-D-001: rail search field placement and folding (2026-10-26, agent choice)

- Found on main: the field already sat at the top of the task list (after 새 작업, before 최근 작업) with a 44px input, theme input colours and commit-only IME filtering (CGP-KNOW-R-001). The row adds the fold below 360px and the measured checks.
- What "below 360px" measures: the window (webview) width. The rail is resizable only between 200 and 320px, so a rail-width rule would fold it always. Below 700px the rail is already the narrow task-list dialog, so the fold applies inside that dialog.
- Fold rule: only an empty field that the learner has not opened folds. A typed or composing query never folds, so an active filter is never hidden. Opened state belongs to the activity, like the query, and ends on blur of an empty field or when the narrow list closes.
- Escape: not given a second meaning. On the narrow list it still closes the list (the dialog's existing rule); reopening shows the folded icon.
- Empty-result copy: the register's "찾는 작업이 없어요" is not adopted. The owner reconciliation of CHAT-R-026 × KNOW-R-001 (2026-10-25) kept "찾는 이름이 없습니다. 다른 이름으로 찾아보세요." for the title filter and uses "찾는 대화가 없어요" for the message group; a third wording would make the two lines disagree.
- Seats: personal and trial task workspaces (the only seats with a task rail). Default state: on; display only, no host message, nothing stored.

## CGP-CHAT-R-029: low-stakes removal undo (2026-10-25, agent-selected conservative implementation)

- Scope of "attachment chip": every chip the composer draws with a remove control that sends nothing yet: pasted/dropped/sketched images, staged photos, folded long pastes, the work-folder file chip and the page chip. Out of scope: the element chip (curriculum runtime only, its message inventory is fixed by CR-T02), annotation marks (removal also clears the numbered marker in the preview, which is not a composer state), and the quote chip (a reference to visible text the learner can quote again).
- "Queued item" is the #416 parked message. Its × already returns the text to the draft; the toast says so and 되돌리기 queues it again. A tool-mode mismatch only pauses the item (nothing removed), so it has no toast. Stop and the end of a turn are not learner removals and show none.
- Exact prior state or nothing: an offer ends as soon as its subject changes (one keystroke in the draft ends a paste or queue offer), on a send, and on a task or activity switch. No merge of a removed item into a changed list.
- Host-held chips: the host keeps its own snapshot under the webview's undo id and restores that object; the webview never sends content back. The attach gate and folder consent are re-checked at undo. No optimistic success: the toast waits for the host's answer (15 s, then failure).
- Staged photos: the host file is deleted when the offer ends without undo, not at the press. A photo still being prepared or refused is deleted at once without an offer.
- Rename: undo restores the title and its origin; it is refused if the title changed since. The task list order is not rewound (the draft flush around a rename and its undo is activity, and rewinding `updatedAt` would misreport it).
- Lifetime 6 s per CGP-CHAT-D85 (longer than the 4 s floor of CGP-DS-R-025), held while hovered or focused; "되돌렸어요" uses the same lifetime; a refused undo persists with 닫기 (DS-R-025: errors persist).
- Seats: every seat whose composer draws the chip or queue (personal, trial, pass, classroom/lesson); rename only where the task header exists (personal, trial). Instructor mode draws no file or sketch controls. Default state: on (no new data flow; a removed host chip is held in memory only and never sent).

## CGP-CHAT-D-029: undo toast shape (2026-10-26, agent-selected: already met on main)

- The CGP-CHAT-R-029 toast (`UndoToast.tsx`, REQ-STUDIO-REMOVAL-UNDO) already draws the D85 shape; no product code changed. The row is closed by proof, not by new UI.
- "Bottom-center inside the chat panel, above the composer" = rendered by the chat panel itself, centred in the chat column, directly above the composer card (gap ≤24px), inside the panel's own box; content width ≤360px.
- "Paused on hover/focus": while the pointer is over the toast or focus is inside it, no timer runs; when both end, a full 6 s starts again. Resuming the remainder could leave a learner who just moved away a fraction of a second, so the hold never shortens the offer.
- Proof: `removal-undo-browser.smoke.mjs` measures, on personal and classroom seats, dark and light, 320/800/1420px and forced colours: centring, the gap to the composer, containment in the panel, a 44px 되돌리기, ≥14px text on the personal seat, `role="status"`; and in time: still offered at 5.5 s, gone after 6 s, held by a real pointer hover and by focus, gone a full 6 s after focus leaves. Mutations (no focus hold, focus never released, 3 s lifetime, no 44px floor, no centring, no role) each fail it.
- Default state: unchanged (on, every seat that draws the composer; no new data flow).

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

## DEC-KNOW-D-002: activity title above the 작업/자료 tabs (CGP-KNOW-D-002, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What the title says | The activity's name from the host; the activity kind ("개인 작업", "AI 체험", "이용권", "무료 사용") when the name is blank after cleaning | The chat header already says kind · name; the rail heading names the "project" like ChatGPT's project home | On | no |
| Where | An `<h2>` directly above the tablist, only on seats that draw the tabs | Seats without the tabs keep today's rail (DEC-KNOW-R-002 scope) | On | no |
| Untrusted name | Whitespace collapsed; controls, bidi marks/overrides/isolates, U+2028/2029, zero-width and filler characters dropped (ZWJ/ZWNJ kept); NFC; 80 grapheme clusters with "…"; `dir="auto"` and `unicode-bidi: isolate` | The name is host data; a bidi override must not reorder the rail, an invisible name must not draw an empty heading | On | no |
| Size | One line at body size (16px, weight 600), ellipsized; full name as text (accessible name) and tooltip | Above the 14px learner floor; a long Korean name must not push the tabs down | On | no |
| "320px: full-width segments" | The two segments fill the tablist and the tablist fills the rail's row at every width; at 320px the rail is the full-width drawer | The control lives in the rail, so its full width is the rail's | On | no |

## CGP-CHAT-R-025: task archive (2026-10-25, agent-selected conservative implementation)

- Archive = hide, never delete. An archive sidecar beside the task file records task id and time; the task document, versions and verdicts are not touched, so older builds still read the task file and a downgrade only lists archived tasks again.
- Only the open task is archived (the task menu acts on what is on screen), against the current revision; the host flushes its draft first, as on a task switch. Next open task = the most recently updated listed one, else a new empty task.
- "A running task must be stopped first": the host refusal is the task-switch refusal (stream, settling stop, approval, verification run); the menu item is disabled while streaming.
- 보관함 lives in the task rail as a separate view (DES-CHAT-77), entered from a "보관함 N" button shown only when something is archived. 다시 열기 is the quiet neutral 44px button at the 14px floor (DEC-29), no red.
- Seats: personal task workspaces only (no lesson, not instructor). Class seats have no task list; nothing on any seat deletes a task permanently.
- Default state: on (local display state only; no data leaves the device, no permission change).

## CGP-CHAT-D-025: archive design (2026-10-26, agent-selected, already met on main)

- D77 was built with CGP-CHAT-R-025 (REQ-STUDIO-TASK-ARCHIVE); this row adds no product change, only proof.
- "No destructive red" is measured as: the menu's 보관하기 has the same computed colour, background and border as the neutral 설정 item (the unfocused sibling; 활동 변경 takes focus when the menu opens) and never the theme's error colour. 다시 열기 keeps the existing check against the 보관함 back button.
- 44px and the 14px floor apply to the menu item as well as to 다시 열기 (owner rule: learner 44px targets and 14px text win over register specs).
- Default state: unchanged (on for personal task workspaces; class seats have no 보관하기).

## CGP-CHAT-R-028: "내 질문" jump list (2026-10-25, agent-selected conservative implementation)

- Count: the user turns of the transcript as drawn, one version per prompt group. An edited prompt counts once, and its row jumps to the version on screen. Tool, system and assistant lines never count. Below 4 there is no button.
- Row text: the first non-empty line of the learner's own words. A leading `> ` quote block (CGP-CHAT-R-007 quote reply) is skipped when the learner wrote anything after it, because the quote is the coach's text, not their question. Controls, bidi format characters, the zero-width space and the BOM are removed; ZWJ/ZWNJ stay so emoji and scripts are not broken; a line that draws nothing is skipped. The line is cut at 60 grapheme clusters or 240 code units with "…" (the 320px popover also ellipsizes).
- Focus target: the prompt's bubble (`.hps-msg-body`), not the full-width row, so the ring hugs the bubble (D81 "focus moves to the selected user bubble"). It is focusable only for the jump (`tabindex="-1"`, removed on blur). An in-place edit focuses its editor; a row that failed to render jumps to its turn fallback box.
- Placement: a quiet 44px header button at the 14px floor (DEC-29), next to the header controls; in the personal workspace it is drawn into the task heading with the rest of the chat header. Popover: `role="dialog"` labelled "내 질문", REQ-STUDIO-FOCUS-RESTORE popover contract.
- Seats: every seat whose chat panel draws the task header, including instructor mode (the label still names that user's own prompts). The classroom transcript keeps its scroll-to-latest on a new message, so a reply arriving after a jump scrolls back down there; pinning a jump in the classroom seat would change that seat's scroll rule and is left out.
- Default state: on (display only; no host message, no stored state, nothing leaves the device).

## CGP-CHAT-D-028: my-questions popover (2026-10-26, agent-selected: met on main, one gap fixed)

- The CGP-CHAT-R-028 build already draws D81: a header button, a numbered list of 44px rows, 10 rows visible before the list scrolls, focus moving to the chosen bubble. No new UI.
- Gap fixed: the list's 440px cap was fixed, so in a short window (800x480) the popover ran 30px past the bottom edge. "Max 10 rows visible" is read as a ceiling: when fewer fit below the header, the list shows the whole rows that fit (at least one, never a half row) and the rest scroll. It is re-measured on window resize while open.
- Pointer: choosing a row with the pointer also moves focus to the bubble (same as the keyboard); no focus ring shows, because the browser shows rings only for keyboard focus.
- Proof: `my-questions-browser.smoke.mjs` measures the popover hanging from the button (aligned to its end edge, under it), a real CDP pointer choice, and 1280x720 and 800x480 windows in both seats.
- Default state: unchanged (on, display only, no new data flow).

## CGP-ART-R-015: deck present mode (2026-10-25, agent-selected conservative implementation)

- Where: inside `deck.html` itself (a constant inline script), so it works in the Studio preview and any browser without a new host message, permission or iframe attribute. The preview iframe sandbox is unchanged (no `allowfullscreen`, no popups).
- Fullscreen: requested; when refused, DES-ART-15's fallback (a status line, then the slide fills the window). No toast component exists in a standalone deck page, so the status line is the toast.
- Presenter window: not built. REQ-ART-15 (3) applies only if one is opened, and the preview has no popup permission. Notes are therefore hidden everywhere while presenting. Follow-up if Jay wants a presenter view.
- Scaling: slide sizes read `--vw` (1vw on the scrolling deck); present mode pins it to a 1280 px design width and scales the 1280x720 frame, so text stays proportional on any window.
- Idle: 2 s (DES-ART-15); a keyboard-focused control is never hidden. Ends clamp; no wrap.
- Default state: on wherever the deck skill already writes a deck (learningWikiEnabled); display only, no new data flow.

## CGP-CHAT-R-030: shortcut sheet scope (2026-10-25, agent choice)

- What is listed: only keys the chat webview binds today (Enter send/queue, Shift+Enter newline, Esc close, Alt+Shift+J conversation while the personal task layout is mounted, `?` this sheet), each with the platform's modifier name. The acceptance names Esc stop, Cmd/Ctrl+F and focus composer as examples, but none of them is bound on main; the row's own rule ("lists only bound keys") wins, so they are not listed and not built here. Binding Esc to stop would overload the key that closes panels and cancels IME syllables, and find belongs to a search row. Each later binding adds its row in `chatShortcuts.ts` in the same change.
- Where: the personal 대화 설정 dialog and the classroom detail dialog (opened from the access chip) get a 키보드 단축키 button; `?` opens it in every ChatPanel seat (instructor mode included) when focus is outside text fields, dialogs, menus and lists; a seat without the settings dialog has only `?`.
- Rebinding: the sheet does not read VS Code keybindings (REQ-CGPV-29's "reflects user rebinding" is not claimed).
- Side fix: the classroom settings dialog had no surface colour outside `.tw-workspace`; it now falls back to the theme sidebar/editor colour so the page no longer shows through.
- Default state: on; display only, no host message, file or network request.

## CGP-CHAT-D-030: shortcut sheet table and Cmd/Ctrl glyph (2026-10-26, agent choice)

- Gap on main: the CGP-CHAT-R-030 sheet was a definition list in flex rows (key and action wrapped onto separate lines in narrow windows) and listed no Cmd/Ctrl key, because none was bound when it shipped. The find bar (CGP-CHAT-R-027) has since bound Cmd+F on macOS and Ctrl+F elsewhere in every ChatPanel seat, and the sheet did not list it; the requirement text still said "no find in the chat webview".
- Built: the sheet is a `<table>` with column headers 키 and 하는 일, keys as the row header. A 대화에서 찾기 row shows `⌘ Cmd + F` on macOS and `Ctrl + F` elsewhere, with a note for Enter / Shift+Enter inside the find field (bound by the same bar). The R-030 rule stands: a row is listed only while its key is bound.
- Not listed: the sketch dialog's Cmd/Ctrl+Z (CGP-CHAT-D-020). It works only inside that dialog, which shows its own hint, and only in seats where the sketch tool is offered.
- Narrow windows: key caps stay on one line; at 480px and below they wrap between caps (never inside one), so the table keeps two columns at 320px. 44px close target and >=14px text are unchanged.
- Focus trap and Esc: unchanged code (the settings dialog's modal focus contract); now measured with real Tab / Shift+Tab input.
- Default state: on; display only, no host message, file or network request.

## CGP-CHAT-R-026: task search (2026-10-25, agent-selected conservative implementation)

- Where it runs: the host searches the task file it already holds in memory (`TaskWorkspaceStore.search`). The webview holds only the open task's messages, so a webview-only search could not find other tasks. Nothing is written, no task is switched, and no model, Service or network request is made.
- What is searched: task names and the text of user and assistant messages. Tool lines, system notices and superseded answer versions (the edit-and-resend sidecar) are not searched. They are not the conversation the learner reads, and a result has to be something the transcript can scroll to.
- Results: one per task, at the task's latest matching message (newest first, at most 50). The date is the matched message's time. The rail shows only tasks whose title did not match (see the reconciliation below); title matches stay in the KNOW-R-001 list.
- Opening: a result in another task goes through the normal `taskSelect` path and its gates (a running turn still blocks it). The jump waits until that task's messages are on screen, then scrolls the transcript and stops "follow latest". Focus stays where it was (the rail on wide windows; the narrow rail dialog returns focus to its toggle). A refused or failed switch (a task error, or another task shown) drops the jump.
- An unreadable task file answers "cannot search" (`작업 기록을 읽지 못해 지금은 찾을 수 없어요`), never "no match". The webview asks once typing pauses (150 ms), because the host scans every task on the thread that also runs the live turn.
- Adds to the title filter in the same field instead of replacing it (owner reconciliation below). The empty state follows CGP-CHAT-D79: `찾는 대화가 없어요`.
- The answer goes only to the view that asked, outside the broadcast `post()` path, because that path invalidates open approval prompts.
- Seats: personal and trial task workspaces. Classroom seats have no task list, so no search.
- Default state: on (local read only; no new data leaves the device, no permission change).

## CGP-CHAT-R-026 × KNOW-R-001 reconciliation (2026-10-25, owner)

- Context: KNOW-R-001 (#2800, merged) made the 작업 찾기 field a webview-only title filter with no host message. CHAT-R-026 (#2782) replaced that filter with a host search over titles and message text. Both rows touched the same field and the same requirement text.
- Decision (conservative merge of both rows): the KNOW-R-001 title filter stays exactly as is: instant, local, NFC and case folded, IME-safe, scoped per activity.
- CHAT-R-026's message-text search is an addition on top of it. Only a committed, non-blank query (never while an IME composition is open), after a 150 ms pause, posts one `taskSearch` to the host.
- Tasks that match only in message text appear as a separate group, `찾은 대화`, under the filtered title list, with snippets. A task that already matched by title is not listed twice; a host answer that matched only the name is not shown again.
- No-match lines: the title filter's `찾는 이름이 없습니다. 다른 이름으로 찾아보세요.` keeps its place under the list heading; the message group adds `찾는 대화가 없어요` only when nothing matched at all, and the unreadable-file line when the host cannot search.
- Requirement text: KNOW-R-001's no-host-message rule now covers the title filter and composition, and points to CHAT-R-026 for the committed full-text query. `task-rail-search.smoke.mjs` asserts zero posts while composing and for a blank query, and exactly one `taskSearch` per committed query; `task-search-browser.smoke.mjs` asserts no task is listed twice.

## CGP-CHAT-D-026: task search design (2026-10-26, agent choice)

- Found on main: the field (44px, >=14px, top of the task list), bold snippet matches and the `찾는 대화가 없어요` empty state were built by CGP-CHAT-R-026; `task-search-browser.smoke.mjs` already measures them. The title-filtered list (KNOW-R-001) listed matching tasks without marking the match, so "results list with highlighted match" held for only one of the two groups.
- Built: the matched part of each filtered title is a `<strong>` (weight 600 against the 400 title, not colour only), every occurrence, computed with the filter's own key (NFC, case folded) per grapheme cluster, so a decomposed title marks its stored characters and an emoji is never split. The parts always join back to the exact title; the accessible name is unchanged.
- No query, no marking: the row renders the plain title exactly as before (no extra spans), so other rail styles and tests are untouched. The archive view shares the field, so its filtered titles are marked too.
- Default state: on (display only; no host message, no stored state).

## CGP-KNOW-R-008: task emoji and colour (2026-10-25, agent choice)

- Where: the personal task menu (대화 메뉴) of the open task. The task list has no per-row
  context menu; adding one would be a new navigation pattern. Classroom and lesson seats have no
  task workspace, so they get nothing.
- What: fixed lists only (12 emoji, eight colours with Korean names, or none), stored as ids.
  Free emoji input was not built: it would need bidi/control/length hygiene and could carry text
  into the list. The host re-validates every request.
- Storage: a sidecar next to the task file, so the strict task-file schema of earlier builds
  keeps reading the workspace after a downgrade; only the marks are lost. A mark does not change
  `updatedAt`, so a cosmetic choice does not reorder the list.
- Accessibility: the mark is `aria-hidden`; the title stays the accessible name; the title is
  always drawn, so colour is never the only cue. Colours were picked for at least 3:1 against
  the task list in each theme (measured in the browser test).
- Default state: available to personal and trial learner tasks; no new data flow (local file
  only, no Service call).

## CGP-KNOW-D-008: emoji/colour picker design met on main (2026-10-26, agent choice)

- DES-KNOW-13 was built with CGP-KNOW-R-008: the picker opens from the open task's menu, every
  colour shows its Korean name, the selected one has a ring and a check. No product change.
- "3:1 against panel" is read as both surfaces a swatch is drawn on: the task list (already
  measured) and the picker dialog (not measured before). Both now pass in dark and light.
- "2px focus ring" on the selected swatch is measured as the drawn ring width (border plus inset
  spread in one colour), not only its presence; forced colours keep a 2px Highlight border.
- Only the test and the contract text change; four CSS mutations that main's test let through
  (3px ring, low-contrast picker swatch, hidden check, forced-colours ring dropped) now fail.

## DEC-KNOW-35: low disk space bar (CGP-KNOW-R-019)

Agent implementation choice, 2026-10-25; not a human policy decision.
The bar informs and never blocks: a send, the composer and every file stay usable,
because holding a turn on a measured number would take work away (AB). It shows in every
seat, the instructor surface included, since any seat's turn can write files. Classroom and
lesson learners are told to tell the teacher rather than to delete files on a class PC.
The threshold is a machine-scope setting (default 500 MB, 0 = off) so a workspace folder
cannot silence it. An unreadable volume shows nothing when nothing is shown yet and keeps a bar already up (unknown is neither "low" nor "fine"). The
"공간 확보 방법" link is an in-panel disclosure, not an external page: no help page exists
to link to, and an external link would add a confirm step for some seats.
Default state: on (local measurement only; no data leaves the device, no permission change).

## CGP-KNOW-R-021: Studio-browser downloads (2026-10-25, agent-selected conservative implementation)

- Mechanism: the fork core has no download hook (verification.md CGP-ART-32: specified only), and core patches cannot be built or checked in this loop. The extension's per-tab CDP session uses `Page.setDownloadBehavior` and `Page.downloadWillBegin`/`downloadProgress`, which the integrated browser's CDP proxy routes to the page (`Browser.setDownloadBehavior` is a no-op stub there). Verified against headless Chromium; the Electron integrated browser itself is NOT RUN here (owner check listed in the report).
- Safe session (minor cohorts): downloads are denied with a blocked line, also from the extension side. With no profile loaded, downloads are denied (the cohort may be a minor one). The persisted `hypeproof.browser.safeSession` is not used as the fallback here: `applyBrowserSafety(null)` writes `false` to it when a profile fetch fails, so it is not fail-closed (this also affects CGP-ART-R-008's `linkSafety` fallback; reported, not changed in this row).
- All other seats (personal, trial, pass, classroom, lesson, instructor) save into `<workspace>/downloads/`. No workspace or an unusable `downloads` entry (symlink, file) denies; Studio never follows a symlink out of the workspace and never renames the learner's entry for them.
- Overwrite: Chromium overwrites a same-name file in `downloads/`. The "replaced an older copy" hint was dropped because Chromium reserves the target before `downloadWillBegin` arrives, so it cannot be told apart; the line makes no claim either way.
- Presentation: the existing tool row (file icon, done/failed mark), persisted like a denial notice in the task where the download began. CGP-KNOW-D-021's 13px size and 열기/폴더에서 보기 actions are left to that design row; 14px learner text keeps winning over the register's 13px.
- No progress line, no automatic open, no quarantine or execution change.

## CGP-KNOW-R-032: learner nickname (2026-10-25, agent-selected conservative implementation)

- Seats: personal and trial seats outside a lesson, in 대화 설정. Classroom, lesson and unknown seats have no learner settings dialog (their gear opens app settings and the classroom header layout is fixed), so the field is not offered there and a stored value is not sent; classroom nicknames are a follow-up with their own layout check. Instructors never get it.
- Delivery: the Service has no nickname contract (only `x-hps-coach-name` / `x-hps-coach-personality` on the proxy path; the agent-sdk path sends neither). Studio therefore sends it as a model-only `[Studio 안내: …]` line in front of the learner's text on every request, the same channel as page context and lesson work. A Service header can replace it later without a learner-visible change.
- Screen: stricter than REQ-O2's inbound screen because the value repeats on every request. Verify rounds 1 and 2 (2026-10-25) each found new bypasses in a deny-list design (digit words, Hanja, `at` addresses, bare domains, filler-only names, then glued or misspelled markers such as 앳/엣/골벵이, homoglyphs, addresses in numeral words and school abbreviations). The first version also claimed the value "cannot carry a URL", which overclaimed because a bare `naver.com` passed. All of these are refused now.
- Structural rule (owner decision, 2026-10-25): stop the deny-list whack-a-mole. NFKC first, then an allowlist of scripts: Hangul syllables and jamo, Latin A-Z/a-z, space, `-` and `_`. Every other script and every digit form is refused (Cyrillic, Greek, Latin alpha, Hanja, digits of any script, circled, superscript and Roman-numeral forms, `.`, `@`, `·`, emoji). A small lexicon covers what letters can still spell: contact markers (앳/엣/at, 골뱅이/골벵이, 닷/쩜/점/dot + TLD, www, http, mail host + TLD), spaced or glued; six or more numeral words (Sino-Korean incl. 십, native Korean, English); address suffixes (로, 길, 동, 읍, 면, 리, 호, 번지) next to a numeral word; school and grade (below).
- Best-effort, accepted residual risk (owner decision, 2026-10-25): a determined learner can still encode data in letters (look-alike letters for digits, XII, a mail host without a TLD). The model-side line keeps the nickname quoted and labelled as a nickname, and quotes, brackets, `:` and line breaks cannot occur in it. These false positives are accepted as the cost of a conservative screen: any digit (별이2), six numeral-word syllables, 일반 and 이반, "look at me" and "dot com".
- Messenger and social handles (verify round 3, 2026-10-26): the most common way a Korean child shares contact details is an ID next to its platform word (카톡 kimjay, 인스타 kimjay, kimjay 네이버 메일). Any platform word is refused as `contact`, glued or spaced: 카톡, 카카오, kakao, 인스타, instagram, 디코, 디스코드, discord, 유튜브, youtube, 틱톡, tiktok, 페북, 페이스북, facebook, 트위터, twitter, 텔레, telegram, 스냅챗, 위챗, 라인, 메일, gmail, 아이디 (not 아이디어), 번호 and 폰. The short Latin words id, fb, yt, line, mail, email, insta and dm count only as separate words. Accepted false positives: Hangul words that contain one (온라인, 텔레토비, 스마트폰, 메일함). No common Korean given name contains 라인 or 메일, so no such control is added.
- Full residual list (best-effort, accepted 2026-10-25/26): look-alike letters and XII; a mail host with no TLD and no 메일; five or fewer numeral words; one numeral word after an address suffix (역삼동 삼); grade shorthands without 학년 (고삼, 중일), which stay allowed by owner decision; a neighbourhood on its own; "at" spelled in Hangul (에이티); plain instruction text, which stays quoted. Accepted false positives besides those above: 우리 학교, Kim 앳된.
- School and grade (owner decisions, 2026-10-25): minors use this field, so a school or grade identifier is treated as personal information even though REQ-O2 does not list it. Refused: a word ending in 학교 (초등학교, 중학교, 고등학교, 학교); 학년 or 반 with a numeral word (삼학년, 이반); a word ending in 초/중/고 followed by a grade or class pair (별빛중 이-삼); and, from verify round 3, a school demonym (초등학생, 중학생, 고등학생, 초딩, 중딩, 고딩, a word ending in 초등, a 초/중/고 word + 학생). These get their own reason ("학교 이름이나 학년·반은 넣을 수 없어요."). A bare abbreviation such as 하늘초 passes.
- Storage: VS Code global state on this device, per activity like the coach name; nothing leaves the device except the line in the learner's own requests. Default state: empty (no nickname, nothing sent).
- Minors: allowed on a personal or trial minor seat because the row requires minors to see the nickname only; no other learner field exists for any seat.

## DEC-KNOW-R009: task move between personal activities (CGP-KNOW-R-009, 2026-10-25, agent choice)

- Personal activity: kind `personal`, or a bought pass, with no served lesson. Class activity: kind `classroom`, any seat with a served lesson (live profile, or `lesson` now recorded on the saved activity), or an unknown kind. A trial that is not a pass is neither: its tasks do not move and nothing moves into it, because REQ-L12 owns trial-to-pass carryover. Activities saved before this build carry no lesson flag: as a destination, such a record is judged by its kind (a personal-kind lesson activity saved earlier would be listed) until it is connected again, which writes a new record with the flag. As the current activity the live profile decides, so a class task never leaves.
- Placement: a 44px "작업 메뉴" toggle on every rail row; the menu opens in flow under its row because the task list scrolls and would clip a popover. Classroom seats have no task rail, so they get no task menu; the reason surfaces where a class task has a row (a lesson on a task-workspace seat). The disabled item stays focusable (`aria-disabled`) with the reason as its visible description (DES-KNOW-14).
- Move: copy (sidecars first, the task file last), read back and compare byte for byte, then release; an unconfirmed copy or a failed release withdraws the copy. The seat fails closed until its profile is loaded. The destination must already have a task store (opened once), so its first-open legacy import is never skipped. A same-id task in the destination is accepted only when identical (retry); otherwise refused. The destination's open task is unchanged. No confirmation dialog: a move is reversible by moving back, and nothing leaves the device.
- Default state: on for personal seats (local only, no new data destination, no permission change).

## CGP-AGENT-R-030: performance trace recording (2026-10-25, agent-selected conservative implementation)

- Default state: off. Machine setting `hypeproofChat.performanceTraceEnabled=false`; the start command is disabled until it is on. Turning it on for any seat is the owner's decision. Even when on, only an instructor or a resolved non-minor seat can start (an unknown workshop tier counts as a minor, so it fails closed).
- What is recorded: numbers only. Per turn (bound to its stream id): start offset, time to first chunk, total time, chunk count, outcome; once a second: extension-host RSS and heap, event-loop lag. No prompt, answer, error text, file name, path or stream id. Ten-minute auto-stop, 200-turn cap.
- Send path: no Service change. 보내기 reuses the existing problem-report route (`POST /report`) with the summary in its schemaless `attachments` (`kind: "perf_trace"`, at most 6,000 characters, under the route's 8,192-character cap) and the note as the description; the shared outbound confirmation (REQ-KNOW-09) lists items and sizes first. A dedicated trace upload (the full file) would need a Service route and is not built.
- Surfaces: native, like 문제 신고하기. Start is a VS Code modal with the consent text (one 기록 시작 button); the pill is a red status bar item; the review is a modal with 내 컴퓨터에만 두기 first. The in-panel pill and dialog of DES-CGP-AGENT-64 (CGP-AGENT-D-026) stay with that design row; the status bar item does not meet its 44px target.
- Consent text: added as §8 of `docs/session-log-consent.ko.md`; the start dialog uses the same lines and a test compares them. The text promises no retention period, because the report route's retention was not verified.
- Kept files are not deleted automatically and there is no viewer; both are follow-ups.

## CGP-ART-R-016: slide suggestion chips (2026-10-25, agent-selected conservative implementation)

- Deck: the learner's deck in Studio is the wiki-folder deck (`deckGenerator.ts`, `deck.html`). The Service Deck Builder's proposals (CR-56) have no `cr-deck` store yet, so the chips patch the wiki-folder deck and a proposal lives only for its one run; nothing is stored on the Service. Recording accept/reject as a CR-56 learning event waits for `cr-deck`.
- "Never adds a number or claim absent from cited entries": a patch may change only the slide face; the slide's citations (refs), notes and gaps are fixed, so no new source can enter. Numbers follow the deckGenerator rule over the slide's own cited entries, after NFKC (full-width digits count). A quote must be the slide's own quote or verbatim in those entries. An answer that names any other slide is refused whole (no partial apply).
- Numbers, sources and speakers (fix 1, after the first verify): one shared detector (`numerals.ts`) serves the slide gate and deck generation. It reads every script (Unicode digits, Roman and circled numerals before NFKC, Hanja numerals, Korean number words with a counter or %) and compares exact values; spelled-out numbers in the evidence count as values. Uncertain parsing counts as a number (fail closed); only "한 번에", "한번" and "한 …씩" are treated as idioms. A quote's speaker label must be the slide's own label for its own quote or appear in the cited entries; a source word (조사, 통계, 장관, …) and the word before it must appear in the cited entries; a wiki id on the face is refused.
- No new quantity words (owner decision, fix 2): value equality cannot see quantities it cannot parse (절반, 열에 아홉, 첫째, 서너 명, five users). A second, lexical rule refuses any quantity word (Korean and English number words, fractions and parts, N 중 M, ordinals, approximations, percent and %) absent from the slide's current face and its cited entries; deck generation applies it against the cited entries. Both sides are tokenized by the same lexicon, so the check is token against token. Residual risk: the lexicon is best-effort; words outside it (처음, 대부분, 몇, 여러) still pass, and so do source words outside SOURCE_TERMS. Source-word stems no longer cut a source word (보도 is not 보 + 도).
- Accept is bound to the exact slide: 반영 applies only while the slide on disk is still the proposal's "before"; a slide changed meanwhile is kept and the learner is told to pick again. The switch and folder gate are checked again before the write. One run at a time.
- Surface: the existing deck command surface (command palette quick picks, like 덱 만들기) and VS Code's native modal for 지금 / 바꾼 안 with 반영 / 그대로 (Esc or close = 그대로). The webview chips under a slide thumbnail and the side-by-side view are the design row CGP-ART-D-016, not built here.
- Chips: all three for any drafted slide, none for an undrafted one. Seats: wherever `learning_wiki.enabled` is served (lesson cohorts); default off with that switch.

## CGP-ART-R-023: deck PDF export (2026-10-26, agent-selected conservative implementation)

- Where: a command, "HypeProof: 덱 PDF로 저장", next to the deck skill's "팀 브레인으로 덱 만들기" in the command palette (the deck skill's only menu today). No button inside `deck.html`: the deck page has no host channel, and CGP-ART-R-015 (present mode, open PR) owns its toolbar.
- How: the served deck in a background integrated-browser tab over CDP, one 1280x720 JPEG per drafted slide, assembled into an image-only PDF by `src/deckPdf.ts`. No core patch and no new permission; the notes layer is removed from the export document and the PDF has no text layer.
- All or nothing: a failed slide, a reload or a changed `deck.html` writes no file. Output is always `deck.pdf` beside `deck.html` (overwritten on the next export); no save dialog.
- 폴더에서 보기 (REQ-ART-23 (2)) stays the page card's action from CGP-ART-R-010; for a page in the served root it reveals that root. Nested pages keep revealing their own folder (more useful than the root; owner may ask for the root instead).
- Default state: on wherever the deck skill is on (`learning_wiki.enabled`); no new data flow off the machine.
- Owner verification: the export inside the installed Studio (integrated browser CDP `Emulation.setDeviceMetricsOverride` and capture on a background tab) was not run; the fallback without emulation is covered in headless Chromium.

## CGP-AGENT-R-027: checkpoints with a reviewed message (2026-10-25, agent choice)

- Seat: adults on a website track (`game.template_tier === "website"`, not a minor or unknown tier, not the instructor). Other adult tiers (`search-webapp`) do not get it; the row names website tracks only.
- Store: a restore point of kind `checkpoint` in the extension's global storage beside the turn store, not a git commit in the work folder. "Nothing is pushed" then holds structurally: nothing in the folder changes, so neither a push nor the GitHub Pages publish can carry it. Keep 20; refused saves never prune.
- Suggestion: the first prose line of the AI's own answer for the turn, no new model request (no new data flow or cost). Without a usable line the field is filled from the changed file names and says so.
- Message: cleaned on the host, refused when empty or over 200 code points (never shortened silently). Evidence carries counts and an edited flag, never the text.
- History: listed in the 바뀐 것 review bar of the last request. Restoring to a checkpoint is not built (acceptance does not ask for it).
- Default state: on for the seats above (local only; no permission change, no upload).

## CGP-ART-R-020: task activity summary (2026-10-26, agent choice)

- Source of truth: one entry per coach tool call of the task that reached a successful tool_result. Refused, failed, unanswered and post-stop calls make no entry, and prose or tool-line labels are never parsed. A count with no event cannot exist.
- Verbs: Read = 읽음. Write to a path absent at tool_use time = 만듦, otherwise 바꿈. Edit, MultiEdit and NotebookEdit = 바꿈. WebFetch, browser_open and browser_navigate to an http(s) page off this machine = 웹 페이지. The learner's own loopback preview and about:blank are not web pages. WebSearch = 검색. Grep, Glob, Bash and others are not counted.
- Chips count distinct targets per verb. A file created and then edited appears under both, because both events happened.
- Storage: entries ride on the turn's last persisted history line in the task store (local, same file as the conversation). They are never sent to the model and nothing new leaves the device.
- Not counted: provider-hosted search on the proxy route (no client tool event) and calls of an older edited version that is no longer shown (the summary follows the visible conversation).
- Review link: only created or changed files that the open turn review (REQ-ART-02) lists get 바뀐 곳 보기. Older turns have no restore-point comparison, so they get a note instead of a link.
- Seats: every seat that draws the transcript (personal, trial, pass, classroom and lesson, and instructor). Default state: on (local display only; no permission change). Target and text floors follow the owner rule (44px, 14px).

## CGP-LEARN-R-017: help-queue keyboard triage in Chalk (2026-10-26, agent choice under the owner rules)

- "Resolve-and-advance" = save the open request as 답변 완료 · 학생 확인 대기 (`status: answered`) and open the next one. The instructor cannot mark a request resolved: the share contract lets only the learner move it to `resolved` (classroom-admin ADM-05), and the key never claims more. The visible button says "답변 완료로 저장하고 다음 요청".
- Documented key: `E` (also ㄷ on the Hangul 2-set layout, same physical key). J/↓ next, K/↑ previous, Enter opens (the row's native button), `?` toggles an inline sheet, Esc closes the sheet. The ends do not wrap.
- Selection is keyboard focus on the row's "요청 열기" button, not a separate state, so Tab, Enter, mouse and screen readers keep the same control; the selected row is drawn with the shared focus ring colour, 2px, inside the row edge.
- Scope of the listener: the help region and the open record only, never page-wide. No key fires in input, textarea, select or contenteditable, while composing (`isComposing` or keyCode 229) or with Ctrl/Alt/Cmd. Next/previous only in the list, so arrows in the open record keep their meaning.
- E needs a written next action (the existing form already requires it); without one nothing is sent and the cursor moves to the field. Next = the next row below, else the nearest above; with nothing left the saved record stays open with "이 화면에 남은 응답할 요청이 없어요." because the empty queue region folds away.
- Races: bound to the open request's id and revision; one save per press burst; a save that lands after the instructor opened another record moves nothing; a 10 s re-render keeps focus on the same request id.
- Sizes: 44px targets; Chalk text stays on its 12px floor (instructor surface, not learner chat).
- Default state: on (local keyboard handling only; no new data flow, endpoint or permission).

## CGP-ART-R-017: preview follow (2026-10-26, agent choice)

- Placement: the learner's preview is a top-level integrated-browser tab whose toolbar is VS Code chrome (no patch is allowed for this row). DES-ART-17's "toggle in the preview toolbar" is built as a small fixed control on the served page itself, in a closed shadow root on a host after `<body>`, shown only while a coach turn runs. It never reaches published test origins. Correction (fix round 1): the closed root protects only what is inside it, not the host element; the first version let a page hide, remove or show the toggle, read the root through an overridden `attachShadow`, and change the choice through synthetic events or `sessionStorage`.
- "Most recently changed element": a reload carries no element. The page signs every `<body>` element (tag, attributes, own text) before the reload and scrolls to the first new signature in document order after it. A CSS-only change or a removal finds nothing and does not scroll.
- "While the coach is editing" = a coach turn is running in this window (`activeStreams`). The learner's own saves outside a turn and Studio's recovery reload are never followed.
- CR-68: while the automation indicator is on (coach browser step or AI Verify run) the toggle hides, follow is skipped and wheel or key input is not counted as the learner's. Known gap: the hide reaches the page over SSE, so an observation taken in the first milliseconds of a step may still include the toggle in its tree.
- Off persists for the live server's lifetime (every tab of the preview) and is not reset by a new turn: the learner's choice wins (PI#2). It is kept by the host, posted with a per-server token, not in page-writable storage.
- Page script (owner scope 2026-10-26: no silent override, not a sandbox): the snippet is injected first, captures the DOM primitives before page script runs and removes its own `<script>`; only `isTrusted` input counts; showing is decided inside the closed root from Studio's coach-turn state; the host carries `:host{… !important}` plus inline `!important` styles and a MutationObserver re-attaches it (200 repairs per document). Accepted residuals: a page can draw over the toggle, can fetch its own HTML to read the token, and can outlast the repair cap; all deliberate, display-only.
- Host and Origin (fix round 2, owner decision): every path of the live server refuses a Host other than `127.0.0.1:<port>` / `localhost:<port>` for its own port with 403, not only `/__hp_follow`. This also closes the older DNS-rebinding read of the served folder. Before the change I checked that the server binds 127.0.0.1 only and that every caller in the repo reaches it through `127.0.0.1:<port>` (`currentUrl()`/`ensure()`), and that the e2e servers use their own `serveStatic` instances. No phone or LAN preview uses it: QR codes point at published test origins. `/__hp_follow` also refuses a present `Origin` that is not the server's own; a missing `Origin` is allowed because the token still gates it. Learner targets 44 px and 14 px text win over DES-ART-17. Timing: 250 ms smooth scroll, 1 s outline.
- Default state: on (local display only; no new data flow, nothing leaves the device).

## CGP-ART-R-021: overwrite change summary in the write approval (2026-10-26, agent-selected conservative implementation)

- Scope: only the optional write approval dialog (`writeFile` in `requireApprovalFor`; not in the default list). The default stays off; no new approval, data flow or permission. Every seat that reaches the dialog (personal, trial, pass, classroom/lesson, instructor local runtime) gets the same summary.
- Numbers: `diffGuard` on the current file and the call's resulting text, computed in the host before the dialog opens. Every rewrite in diffGuard's sense (`changed_ratio > 0.5`, `REWRITE_RATIO`) is warned. The register's label "거의 전부 바뀌어요" is shown from 80% (`ALMOST_ALL_RATIO`); between 50% and 80% the warning reads "절반 넘게 바뀌어요", because "거의 전부" next to "51%" would overstate it (copy honesty wins over the literal label).
- Whitespace-only changes read "글자는 그대로, 띄어쓰기·줄바꿈만 달라져요", not "그대로" (diffGuard ignores whitespace inside a unit).
- Unknown is a warning, not silence: when the change cannot be computed for an existing file, the dialog says so with the reason. The call's text is taken only from host-built requests (`sdkToolToActionRequest`); a webview-origin request never supplies it, so it cannot forge "내용은 그대로예요".
- Race: the file's sha256 (or absence) at prompt time must still hold after the answer, else the write is refused. A file that appears during the dialog is refused too: that would be an overwrite with no summary.
- Not built: DES-ART-21 bar and diff link (CGP-ART-D-021).

## CGP-ART-R-006: style tweak for a picked element (2026-10-25, agent-selected conservative implementation)

- Where: inside the single-pick element chip in the chat panel. DES-ART-06 asks for a popover anchored to the element in the page; the native BrowserTab contract has no trusted in-tab surface (the same gap blocked CGP-ART-D-002 and D-008), and a page-injected popover could be styled or clicked by the page itself. The annotation batch path (default off) is not covered.
- Live preview: an inline `!important` declaration on the picked node through CDP, resolved in an isolated world, after restoring the node's original `style` attribute exactly; the whole state is re-applied on each press, in order, and the offer's read waits behind any pending restore. Bound to the pick (a sequence number), its node and document generation. A reload ends the preview; the next press clears every choice and says so (no navigation listener: the request still names the values the learner chose for that pick). Restored on removal, re-pick, send, switch off and tab switch. Nothing is written to disk.
- Which send carries the request: only the panel's own button, whose message is exactly the summary of the current choices. A composer message sends the element alone (as the chip shows), so the coach never edits from choices the learner did not send, and every request has the values on the learner's own turn.
- Offered set: page colours computed from at most 1,500 elements, top 8 after normalizing to `rgb()`/`rgba()` (other syntaxes and transparent dropped); fixed px steps for font size, padding and radius. Old values the browser did not report as px or rgb are `알 수 없음`, never echoed.
- Evidence: the send button sends the learner's own message listing the chosen values, so the `user` observation of that turn records them. No new learning-event kind is written: `change_requested` requires a criterion and an artifact reference this flow does not have.
- Sizes: 44px targets and 14px text win over the design row's 32px stepper (owner rule); swatches draw 24px inside a 44px button.
- Default state: on wherever element pick is on (CR switch); no new recipient or data flow beyond the element text the pick already sends.

## CGP-LEARN-R-015: completion checklist helper in Chalk authoring (2026-10-26, agent-selected conservative implementation)

- "Helper" = the existing completion-condition rows in `/authoring` (이번 주 미션 · 완료 조건). No model call: the row asks "무엇을 만들면 끝인가요?", and a per-row button turns "what to make" into "…을/를 만들면 끝" only when pressed. A full clause is refused, never glued.
- Refused words: a number followed by 점, score compounds (점수, 배점, 만점, 감점, 가점, 총점, 득점, 평점, 채점), 등급, 우수, 미흡 and the six SX-35 labels. A bare 점 is allowed: 차이점, 장점, 관점, 점검, 점선 are observable words and blocking them would push teachers away from concrete items.
- Matching runs after NFKC and removal of control, zero-width, bidi and line-separator characters.
- The Service validator refuses score keys but not score words, and no Service change exists. Chalk checks twice: on the page before save or freeze, and in its forwarder on the draft PUT (422, nothing forwarded). Known gap: a draft saved before this change can still be frozen over the API, because the freeze request carries no content.
- Out of scope: per-step 완료 기준 (`steps[].acceptance`).
- Default state: on (instructor surface only; no new data flow).

## CGP-VOICE-R-008: compact voice control corners (2026-10-26, agent-selected implementation)

- Not blocked: VoicePanel's compact presentation already exists (unmounted, voice is planned per REQ-R1), so the row is built on that component and needs no Service contract. It is not mounted on any learner screen by this row; seats inherit it when voice ships.
- Home corner: top right. The composer and its send button live at the bottom of the chat webview; a bottom home corner would cover them (VO-47: the work surface stays reachable). The learner may still move it to a bottom corner.
- Keys: ArrowUp/Down pick the vertical side, ArrowLeft/Right the horizontal side, Home resets; taken with focus anywhere in the control. Arrow keys or Home with Shift/Alt/Ctrl/Meta, or during an IME composition, are left alone (shortcuts and Korean input).
- Pointer: no drag (REQ-CGPV-12 "no drag-to-hide"). A `옮기기` button steps clockwise so mouse users can move it without a drag.
- Per window: this webview's sessionStorage (`hps.voice.compactCorner`), read through an exact-match parse; anything else, or blocked storage, gives the home corner without an error.
- Motion: DES-CGPV-12 asks 150 ms ease-out. The design scale has no 150 ms step and literal durations are not allowed, so the move uses `--hp-dur-press` (140 ms) with `--hp-ease`. Under reduced motion the global reduce rule makes it instant.
- Sizes: 44px targets and 14px text (`--hp-font-caption`) win over DES-CGPV-02's 32px and the old 13px compact text.
- Default state: n/a (voice itself is not shipped; no data flow, nothing leaves the device).

## CGP-LEARN-R-016: coach run state in the chat header (2026-10-26, agent-selected conservative implementation)

- Source of truth: the webview's own state only (send pending, open stream, approval prompts, error banner, last turn outcome, timeline). No new host message, so both runtimes and the local runtime behave the same.
- Precedence: approval > streaming turn or product test run (activity) > send pending (생각 중) > error banner, failed turn, offline or unavailable activity (문제가 생겼어요) > stopped turn (멈춤) > 준비됨. 준비됨 is never shown when the coach cannot take a request. The failed and stopped states last until the next turn (also after the banner is dismissed or the conversation cleared), like the task rail's run chip (taskRunState.ts).
- Approval: the host's `approvalWait` plus every in-webview approval dialog (write, outbound/publish, command, browser, folder consent). The annotation-leave prompt is not an approval of coach work and does not count. One shared flag (App `anyApprovalPending`, now including the command dialog) feeds the header, the idle hint and the task rail chip, so they agree.
- Activity: the newest running tool line of the current turn, classified by the icon the host draws for it (a closed list). Unknown icons, thinking, delegation, preview open, command runs and installs (they may only read) and TodoWrite read 생각 중, never 찾는 중 or 만드는 중 (copy is honest). Text the coach writes after a line, or a learner line (a steer), ends that line's claim until the next tool line.
- One visible state: in the personal task workspace the heading's existing run note (CGP-DS-R-006) leaves the row and keeps only its screen-reader sentence; the rail's per-task chip stays as is because it describes a task in a list, not the coach.
- Size: 20px icon, label at the 14px floor (DEC-29) for every seat; no 44px target because the state is not a control. At ≤480px the state wraps to its own row under the header controls instead of shrinking or ellipsizing its words.
- Seats: every seat whose chat panel draws the header, including instructor mode. Default state: on (display only, no data flow).

## DEC-VOICE-R009: voice "보여주기" (2026-10-26; agent implementation choice)

- Targets: the closed list `editor_file` / `preview_tab`. The host refuses any other string before reading or capturing anything; the panel draws Studio's own labels for exactly those two, whatever the host payload holds. No whole-screen, window or desktop item; a grep test with a planted control keeps `desktopCapturer`, display-media and OS screen capture out of product source.
- "열린 파일" = the active editor's document, through the existing work-folder file checks and gate (`sdk_tools.read`, folder consent, never instructors). Revision = editor version + first 12 hex of sha256 of the text, written into the model text (`revision="..."`) and the panel's reference line. Conservative choice: an unsaved or untitled buffer is refused with "저장한 뒤 보여 주세요" instead of sending unsaved text, because the existing file path reads the disk and the attached bytes must equal what the learner sees; the disk text is compared with the editor text, and a version, task or gate change during the read attaches nothing.
- "미리보기 화면" = the active integrated browser tab, and only while it is the own local preview (exact origin of this window's preview server, confirmed again by the capture's own-preview text check). An external site in the active tab is refused, screenshot included: a learner asked to "show the preview" must not send a mail or other page by accident. Captured through the existing page-context primitive (DEC-VOICE-R010 text rule unchanged). REQ-N3 `input.page_context` gates it for every seat (stricter than "minors only"); the screenshot also needs `input.image_paste`. Default off stays off. A preview has no revision Studio can name, so the reference line says "버전 확인 안 됨" rather than inventing one.
- One click = one attach: request ids are single-use; a second click while one runs is refused, not queued; the menu closes after each attach, so another attach needs another open and click. The menu state is re-read from the host on every open.
- Where it lands: the conversation's existing pending file / page slots, so the chips show exactly what is sent and the existing remove/undo apply. A refusal is reported in the voice panel only (no composer error banner, no lesson denial notice).
- Not mounted: VoicePanel has no learner mount until voice ships (REQ-R1); this adds the host contract, messages and component. Targets 44px and text 14px (owner rule); the reference line moved from 12px to 14px.
- Default state: unchanged gates; no new data flow, recipient or permission.

## DEC-SHELL-R014: start page learner settings sheet (CGP-SHELL-R-014, 2026-10-26, agent-selected conservative implementation)

- Rows: only rows whose behaviour exists are drawn: 글자 크기 (CGP-DS-R-009 text size), 움직임 줄이기 (`workbench.reduceMotion`) and 알림 (`hypeproofChat.osTaskNotices`, default off). 화면 밝기(테마), 팁 보기 and 내 작업 내보내기 wait for REQ-SHELL-16 / 19 / 28: drawing them now would be switches that do nothing. The cap stays six and the order follows REQ-SHELL-14.
- 고급 설정: hidden and host-refused for a minor cohort (`isMinorProfile`, which fails closed on an unknown tier, on the connected or previewed profile) and for a free start answered under14. With no seat and no under-14 answer it stays, because the start page "설정" reached the editor for adult/staff setup before this row. This is a navigation guard, not a security boundary: the editor's own menu entry and shortcut are out of scope.
- Surface: the existing chat settings dialog (`ChatPreferences`) is reused instead of the DES-SHELL-13 right-side sheet; the sheet geometry is CGP-SHELL-D-013's row.
- Text size row: the stored size is the personal-chat size (classroom chat keeps the base size), so the row says "혼자 하는 활동의 대화 글자 크기예요." for every seat.
- Default state: on for every seat; no new data flow, no new permission; notices stay off until the learner turns them on.

## CGP-SHELL-R-020: example project ideas after a no-idea answer (2026-10-26, agent-selected conservative implementation)

- Trigger: client-side and narrow. The learner's latest message must be short (at most 30 characters) and end in a no-idea phrase, and the coach message before it (or the greeting, for the first message) must end in a question about what to make or do. Anything uncertain shows nothing, so NAT-03's one-question flow is unchanged. The answer is still sent to the coach as typed.
- Seats: personal task workspaces only (personal, trial, free, pass). Lesson and classroom seats already have a task, and the instructor console is not a learner seat.
- Ideas: six Studio-owned, generic sentences (no customer, cohort or capability wording). No Service profile key was added; a profile-supplied list would need a Service contract that does not exist.
- One picker at a time: when the coach's reply already parses as reply choices, the idea list is not shown.
- Placement: below the coach's reply after the turn ends. `내가 정할래요` sits right after the list, at the newest end of the conversation that the pane follows, so it stays in view in a 320x500 pane where a heading-row button would scroll away. Profile follow-up chips give way while the list is shown. Columns follow the chat pane (studio-chat container), not the window: one column below 640px, two at 640px and wider.
- Pick: same ownership rule as reply choices (keeps typed text, a second pick replaces the first, never sends). Inert during Korean IME composition and while a missing folder holds the draft read-only. The chosen mark is derived from the composer text, not stored.
- Classifier: `없어요` counts only alone or after an ideas/plans subject (`아이디어가`, `하고 싶은 게`, `딱히`…), never `시간이 없어요`; a goal question needs a what-word plus make/do (or `목표가 뭐`), so `저장하고 싶으세요?` is not one. Dismissal is remembered per task and answer in webview state (bounded to 200 keys).
- Sizes: 44px targets and 14px text (owner rule).
- Default state: on for personal seats (local display only; no new data flow, nothing leaves the device).
- Fix 1 (owner decision, after a failed verification): ideas are for STARTING a project, never mid-work, and the trigger is structural, not only wording.
  - Start of the task: no work made yet. Any tool row other than a look-only one (thinking, the pending line, read, search, web) counts as work, so a written or edited file, a preview, a command or an unknown row hides the list. An assistant message with a fenced block (the chat fence opens a preview) counts too, and so does a known artifact in the task (a picked surface, an open world, a publish).
  - Early conversation: the no-idea answer must be among the learner's first 3 messages (`IDEA_OFFER_MAX_LEARNER_TURNS = 3`). Three is small on purpose: a goal question is asked at the start, and a late one is almost always a detail question.
  - Detail and choice questions are never goal questions: `...으로/로 만들까요`, `더`, `부터`, `다음에`, `어느 쪽`, `어떻게`; a what-word followed by a noun other than the whole thing (`어떤 색`, `어떤 파일 이름`, `어떤 모양`); and any question that points at an existing thing (`이/그/저/이번/방금/위/아래/여기`, `...의`, `...에서`, `안에`, `부분`). If either of the closing two questions is such a question, nothing is offered.
  - When in doubt, show nothing (unchanged).

## CGP-SHELL-R-035: "새로운 기능" after an update (2026-10-26, agent choice)

- Source of the lines: no learner-facing release notes existed (the GitHub release body is staff-facing). The build carries its own learner lines in `extensions/hypeproof-chat/src/learnerReleaseNotes.ts` (≤3 lines, ≤40 characters, DES-SHELL-34), and `docs/RELEASE-NOTES-template.md` tells the release manager to edit them before the cut. No Service field: the lines are bundled, so offline learners get them and no new data flow exists.
- "After an update" vs a fresh install: one globalState record written first on activation. An empty globalState is a fresh install and marks the bundled notes as seen; an existing profile without the record (updated from an older build) has seen nothing. Keyed by the notes `id`, not the version string, so a version with no new lines shows nothing.
- "Once": the record is written when the panel is actually drawn, not when it is offered. A launch where a turn ran the whole time leaves it due. In the same window it stays through panel remounts until closed. Two windows launched together on the first launch may each draw it once (accepted; globalState has no cross-window lock).
- "Reachable later from Help": Studio has no Help menu of its own (the native Help menu is upstream workbench chrome and extensions cannot add to it without a patch). The help entries live in the settings dialog next to `키보드 단축키` (CGP-CHAT-R-030), so `새로운 기능` goes there in both seats.
- Initial lines name three features on main in every learner seat: find in chat (CGP-CHAT-R-027), the `?` shortcut sheet (CGP-CHAT-R-030) and math rendering (CGP-CHAT-R-022).
- Seats: every learner seat (personal, trial, pass, classroom, lesson, unknown); the instructor console gets no panel (unknown instructor state counts as learner, as for CGP-SHELL-R-023). Default state: on (local display only, no event, nothing leaves the device).

## CGP-DS-R-012: three named elevation levels (2026-10-26, agent decision within DES-CGP-DS-13)

- Levels: `flat` (none), `raised` (`0 1px 2px`: the composer, the catch-up button, the start card) and `overlay` (`0 4px 8px -2px`: menus, popovers, the preferences dialog, the sources drawer, Chalk's side menu, seat detail drawer and pick-by menu). DES-CGP-DS-13 names no dialog level; dialogs and drawers share `overlay` so the count stays at three.
- Alpha: both levels are .10 on light themes and .30 on dark ones (DES-CGP-DS-13's menu value; REQ-CGP-DS-13 needs dark >= .2).
- Tokens: the static token expander refuses a semantic token with different light and dark values, so each level is a `-dark` and a `-light` token (the `modal-dim` pattern). `tokens.css` picks one per host theme through `--hp-elevation-raised` / `--hp-elevation-overlay`: dark on `:root`, light on `body.vscode-light`, dark on the forest-only start and disconnected screens in every theme, flat under `body.vscode-high-contrast` (the HC Light body carries that class too) and under forced colors.
- High contrast: menus, popovers, the dialog and the drawer draw their 1px border in `--vscode-contrastBorder`. The composer and the catch-up button are controls and keep the fixed control boundary (CGP-DS-R-005); it measures >= 3:1 there. The start card stays forest in HC Light, where the contrastBorder would be 1.75:1, so it uses its own text colour.
- Chalk is dark only and reads the `-dark` tokens directly; forced colors drops the shadow and the existing 1px edge borders stay.
- Not elevation, left as they are: inset selection and status bars (`box-shadow: inset ...`), the `hps-breathe` pending glow (a looping status animation, CGP-DS-D-011), the learner deck document (`deckGenerator.ts`, an exported artifact) and the live-follow control injected into preview pages (`liveFollow.ts`, outside the token source).
- Visible change: the composer shadow in dark themes goes from alpha .05 to .30; menus and the dialog lose their large soft shadows (12-50px blur) for the 8px overlay.

## DEC-DS-R-026: logical CSS ratchet (CGP-DS-R-026, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What "new" means | A ratchet: the 102 physical declarations on main are grandfathered in `config/logical-css-baseline.json`, counted per file by property and normalised value | The acceptance asks for 0 new ones. Converting the shipped ones would move nothing in LTR but touches 15 files of geometry that DEC-27 keeps; a per-value count still catches a copied or swapped declaration while a selector rename does not fail | On | no |
| Stale baseline entries | Fail until the baseline is shrunk with `--update`; `--update` refuses to grow it | Slack left by a removed declaration could otherwise be reused by a new one in the same file | On | no |
| Carriers | Webview `.css` and TSX `style={{}}`; Chalk `.css`, HTML `<style>` and `style=""`, exported `…Css` template literals | These are every place component CSS is authored today; JS positioning from measured rects and the generated token transport are not authored CSS | On | no |
| Properties | Exactly the acceptance list: margin-left/right, padding-left/right, left, right | text-align, float, borders and shorthands belong to the design row CGP-DS-D-023 and would grow the baseline | On | no |
| Escape hatch | `logical-css: physical <reason>` on the same line | Some placements are physical on purpose (e.g. centring with translateX, which does not flip in RTL) | On | no |
| Tooling | A repo script plus a static smoke, not Stylelint | The repo has no Stylelint; Chalk's CSS lives in HTML and TS strings that Stylelint would not read without custom syntaxes | On | no |

## CGP-DS-R-030: tabular figures in Chalk (2026-10-26, agent choice under the owner rules)

- Scope is the row's three nouns read literally on the pages that have them: seat tables (/manage, /board), usage (/budgets) and timers (/console countdown, /manage help-queue ages and "N분 전"). Counters next to them (roster summary, state filters, help badge) are included because they change while the instructor watches.
- Scoped by container, not set on `body`: prose and identifiers elsewhere keep proportional figures, which read better in Korean running text.
- Controls inside the scope are named with `*` because Chromium's UA `font` reset on buttons and inputs drops an inherited numeric variant (the computed test caught this).
- /board and /console were already met; the computed test now guards them.
- Default state: on (styling only).

## CGP-DS-R-032: startup and empty states use only HP marks (2026-10-26, agent-selected: already met, guard added)

- Finding: on `main` every Studio startup and empty surface already draws only HP marks (boot `DisconnectedChat` and start page: `hypeproof-mark.svg`; empty editor: HP watermark; empty chat: text only). The six packaged images are the five HP brand SVGs and a generic chat bubble; no contributed codicon is a vendor glyph.
- Motion: Studio has no startup animation. 0ms with nothing running meets "≤200ms fade with no loop under reduced motion". No fade is added: it would delay the first readable frame for no learner benefit and push every start-page screenshot test into a timing race. The global reduced-motion override in `tokens.css` is the guard that keeps any future animation on these surfaces to one iteration.
- Scope rule: a provider named in copy (a GitHub sign-in button, a model name) is text, not a mark. Rasters cannot be read for a mark, so a new packaged raster fails the audit until a person lists it.
- Not covered: installed-app platform icons (`.icns`/`.ico`, committed in the VSCodium fork) and the native Electron splash; both need an installed-build check.
- Default state: n/a (no behaviour change).

## DEC-DS-R-033: colour emoji font stack (CGP-DS-R-033, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What "timeline and status lines" means after CGP-DS-R-018 | Icons in those lines stay stroke icons; emoji that remain text (labels, task marks, world faces, messages, answers) use the colour emoji stack | CGP-DS-R-018 already replaced status glyphs with the stroke set and is merged; redrawing them as emoji would undo it | On | no |
| Where the faces go | Appended at the consumer after the host or role font (`var(--vscode-font-family, var(--ds-c-typography-ui)), var(--ds-c-typography-emoji)`), not folded into the role primitives | In the app `--vscode-font-family` is always set and would bypass a role-only change; the token tier rule keeps semantic tokens one primitive each | On | no |
| Order | Emoji faces last | Apple Color Emoji maps 0-9, `#` and `*`; first in the stack it would draw numbers as emoji (the test checks the platform face of digits) | On | no |
| Faces | Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji; no Segoe UI Symbol | The row asks for colour glyphs; Segoe UI Symbol is monochrome | On | no |
| Code and technical text | Unchanged | Code follows the editor font (CGP-DS-R-007); URLs and ids are fixed-width on purpose | n/a | no |

## DEC-SHELL-R028: work export zip (CGP-SHELL-R-028, 2026-10-26; agent choice, not a new human agreement)

- On in every seat, no setting: it copies the learner's own folder to the learner's own disk, sends nothing, and the requirement asks for it to stay available after a pass ends. Instructor and unknown seats get it too; there is no recipient to protect.
- Whole folder, unlike the R-035 takeaway: the row asks for the workspace minus `.git` and `node_modules`. `.hypeproof` is also left out (Studio's own history/memory records; the transcript already carries the conversation).
- Conservative on secrets: a file that contains a token Studio holds or a credential pattern is left out whole and named in `내보내기-안내.txt`; in the transcript only the matching text is replaced by `[가림]`. A false positive costs one listed file, a miss would ship a token.
- Fix 1 after the FAIL verify: "a token Studio holds" means every value in the extension's SecretStorage (listed with `keys()`, JSON records reduced to credential-like fields), matched in UTF-8, UTF-16LE/BE and base64; the generic shapes cover the common provider key prefixes, JWTs, Studio token shapes and key/value pairs named token/secret/password/api_key/authorization/private_key/credential. Names with `\` or `:` and hard links with a name outside the folder are left out and listed, and the zip writer re-checks every entry name. Unquoted values need a digit, or 8+ characters without a dot, and are not calls, so ordinary learner code (`password = input.value`) stays in.
- Fix 2 after the second FAIL verify, owner decision (2026-10-26): scan broadly and fail closed. Every file is searched (binaries through a latin1 view and UTF-16), key names match by contains (secret, token, pass, api_key, `_key`, credential, cookie, session, auth, private), URL credentials, `Authorization:` with any scheme and cookie headers are shapes, file and folder names are scanned, and held values are also matched split by whitespace, percent-encoded and as hex. More false positives are accepted; they are listed in `내보내기-안내.txt`, never dropped silently. The plain-code positive controls stay (`max_tokens`, `type="password"`).
- Refuse, never truncate: over 300 MB / 20,000 files nothing is written. A partial zip presented as "my work" would be dishonest.
- Native folder dialog, progress notification and result message instead of an in-panel panel: the action starts from a modal settings dialog that closes first; the notification is the only surface that exists while the dialog is gone.

## CGP-CHAT-D-015: elapsed time placement (2026-10-26, agent-selected conservative implementation)

- "The turn's status line" = the personal answer action row (복사 · 미리보기 · 다시 받기 · verdict). Studio has no other per-turn status line, and the action row is where a finished answer's state lives. The receipt is the row's last item, after every control, so it never sits between controls.
- Where a turn has no action row (classroom seat, a turn ending on a tool row, a no-answer stop), the receipt stays its own one-line status under the turn (unchanged from CGP-CHAT-R-015).
- Secondary text = the muted text token at the 14px caption size, normal weight, not a control (no button, no 44px target needed). It wraps under the controls in a narrow pane; it is not pushed to the far edge, so it reads with its row.
- No live counter: nothing time-shaped is shown during the run; the pending dots rule (end within 3.8s) is unchanged and now measured in the same test.
- Default state: on, both seats; no new data flow.

## CGP-CHAT-D-016: turn render fallback shape (2026-10-26, agent-selected: already met on main)

- The CGP-CHAT-R-016 TurnBoundary already draws the D50 shape; no product code changed. The row is closed by proof, not by new UI.
- "Inside the turn" = in the failing row's own slot, between its neighbouring rows and within the transcript column. The box does not repeat the coach label: the row's message could not be rendered, so its speaker header is not claimed.
- Proof: `turn-boundary.smoke.mjs` measures solid borders on all four sides (CanvasText under forced colours), exactly two 44px buttons, raw text >= 14px (learner minimum), and walks real keyboard Tab/Shift+Tab across the box to the following answer (personal: Enter on its copy button works) or the composer (classroom).
- Default state: unchanged (on, both seats; no new data flow).

## CGP-CHAT-D-017: paste chip in the D06 chip family (2026-10-26, agent choice under the owner rules)

- Label: D07's `붙여넣은 글 · N줄` replaces R07's `붙여넣은 글 (N줄)`; the design row owns the visual wording and the requirement text is updated to match. The line count uses grouping (`1,234줄`).
- Family: the chip carries the D06 chip class and reuses its name-button and × styling (font, border, colours, 44px icon-only ×). The test compares computed styles against a real D06 file chip rendered beside it, so the two cannot drift apart silently.
- Placement: the paste list stays directly above the composer card, not inside it. D06 counts chips toward the card's 192px growth cap, and an expanded 240px editor cannot fit inside that cap. The list itself scrolls at 40vh.
- Narrow columns: the line count is the point of the label, so the row wraps (`입력창에 펼치기` and × move to the next line) instead of ellipsizing the label at 320px.
- Kept from R-017: `입력창에 펼치기` stays a text button (R07 requires converting back to inline). The × now has the accessible name `붙여넣은 글 빼기` instead of the visible word `삭제`; removal undo (CGP-CHAT-R-029) is unchanged.
- Editor: plain textarea, `field-sizing: content` with a 240px max (`--ds-c-studio-paste-editor-max`), then its own vertical scroll. 14px text minimum and 44px targets hold in both seats.
- Default state: on (display only; no new data flow).

## CGP-CHAT-D-020: sketch canvas design (2026-10-26, agent choice under the owner rules)

- Width: the sketch keeps the shared `hp-modal` geometry (CGP-DS-D-020): at least 320px wide whenever the viewport has room (≥352px), and at ≤390px the shared bottom sheet spans the viewport. "Fits 320px with 16px gutters" is read as the sheet's content (title, tools, hint, canvas, buttons) staying ≥16px from both viewport edges with no horizontal overflow; the sheet's 20px padding gives that. No sketch-only override of the shared sheet.
- Undo shortcut: Cmd+Z on macOS, Ctrl+Z elsewhere (same platform rule as the find bar), matched on the physical key too so a Korean input source works. Shift (redo) and Alt are not undo; there is no redo. It is handled anywhere in the dialog and stopped there, so it never reaches the host editor's undo. It does nothing while a stroke is down, while the PNG is being saved, during IME composition, or while the discard question is open.
- Canvas name: exactly `그림판`; the drawing and undo instructions moved to `aria-describedby` on the visible hint.
- Already met on main and now measured: tools ≥44px with ≥14px text, discard confirm focusing "계속 그리기".
- Default state: on (local drawing only; no new data flow).

## CGP-CHAT-D-018: `@` file list popover (2026-10-26, agent-selected conservative implementation)

- "Above the caret": the popover's bottom edge sits above the composer card, and its inline start is the drawn position of the `@` that opened it (clamped into the card). It never sits between caret lines, so it never covers the draft being written; at narrow widths it spans the card.
- "Max 6 rows visible": the list viewport is 6 × the shared 44px menu item height; rows are exactly 44px and single-line, so long names ellipsize (file name first in strong weight, folder muted). The full path is the row's accessible name and hover tooltip.
- Text is the caption size (14px base), the learner floor, per the menu token contract (REQ-CGP-DS-24); the 14px minimum wins over any smaller register spec.
- Closing: Escape (unchanged) and focus leaving the composer, except while a pick is in flight so its acknowledgement still lands. A refused pick refocuses the composer so the keys work again. No new keys, host messages, seats or file capability; the R-018 gate is unchanged.
- Forced colours: the chosen row keeps Canvas/CanvasText with a 2px Highlight border (the home-tab pattern). The Highlight fill showed the words as black boxes under Chromium's Canvas text backplate, and `forced-color-adjust: none` is reserved for QR codes (CGP-DS-R-016).
- Default state: on wherever R-018 already offers the list (personal or adult profile with the read grant); no new data flow.

## CGP-CHAT-D-027: find bar shape (2026-10-26, agent-selected: already met on main)

- The CGP-CHAT-R-027 find bar already draws D80; no product code changed. The row is closed by proof plus one missing guard.
- "Sticky at the top of the transcript" keeps the R-027 reading: a row in the chat column directly above the scroller (not an overlay, not a sticky row inside it), so it is always at the transcript's top edge and never covers a match. Measured: its bottom edge within 12px of the scroller's top, inside the column, at 320/800/1420px.
- 44px controls and `n/m`: the input and the three buttons measure >= 44px with >= 14px text (learner minimum); the count reads `n/m` and `0/0`.
- Esc: the existing test only returned focus to the composer, which is also the fallback, so "always focus the composer" passed it. `chat-find-browser.smoke.mjs` now opens the bar from a focused transcript button and requires Esc to return there, and falls back to the composer when that element is removed while the bar is open.
- Default state: unchanged (on in every seat that draws the transcript; no new data flow).

## CGP-KNOW-D-009: task menu move item (DES-KNOW-14, 2026-10-27, agent choice)

- Already met on main by CGP-KNOW-R-009 (`TaskMenu.tsx`); no product code changed. The row is closed by proof: `test/task-menu-keyboard-browser.smoke.mjs` sends key events through the DevTools protocol into headless Chromium (never the OS) and reads the browser's own accessibility tree.
- "Reason announced" is read as the accessible description the browser computes for the focused item (`aria-describedby`), plus the reason being drawn while the item has focus. A hidden reason would still be in the description, so both are checked.
- "Keyboard navigable" is the menu-button pattern already built: ArrowDown/ArrowUp or Enter opens on the first item; arrows wrap; Home/End; Escape returns focus to the toggle; Tab closes. Tab-closes is also kept by the menu's focus-out close, so removing only the Tab branch is an equivalent change, not a gap.
- 44px rows stay guarded by `task-menu-computed.smoke.mjs` (unchanged).
- Default state: unchanged (personal task-workspace seats; classroom seats have no task rail).
