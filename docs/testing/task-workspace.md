---
title: Task workspace verification
product: studio
doc_type: testing
status: canonical
owner: core
version: 0.1.0
last_reviewed: 2026-10-18
audience: maintainers
source_paths:
  - extensions/hypeproof-chat/test/task-workspace-store.test.mjs
  - extensions/hypeproof-chat/test/task-workspace-host.test.mjs
  - e2e/task-workspace/run.mjs
  - e2e/task-workspace/native.mjs
quality_gates:
  - executable-commands
---

# Task workspace verification (#1756)

| ID | Required behavior | Evidence layer |
| --- | --- | --- |
| TW-01 | Reopen over 200 messages, same draft and selected source. | Real disk; native restart separately |
| TW-02 | Create/switch/name tasks; reject delayed old drafts. | Actual host and built UI |
| TW-03 | A pending run or failed draft flush blocks switching. | Host negative controls and built UI |
| TW-04 | Corruption, symlinks, foreign scopes and stale writers preserve bytes. | Real filesystem controls |
| TW-05 | Recover a killed owner; never evict live/unknown owners. | Spawned processes and recovery races |
| TW-06 | New citations preserve pin/focus; reject foreign/unsafe URLs. | Built UI and actual host API arguments |
| TW-07 | Keyboard, empty/error state and 320–1440 px remain usable. | Built UI and independent design review |
| TW-08 | Native process restart retains task/draft/pin; citation opens in the actual browser panel. | Mac development app with loopback Service |
| CP-01 | Prose/composer align; readable Markdown, citations and controls in dark/light at 320/390/1440px. | Independent rendered review |
| CP-02 | Composer grows with multiline/restored text, caps and shrinks without losing Send/Stop. | Built UI |
| CP-03 | Clipboard success alone produces confirmation; failure is visible. | Built UI controlled clipboard plus native separately |
| CP-04 | Growing output follows at bottom; reading position and draft/caret survive new output; explicit latest resumes. | Built UI with actual scrolling |
| CP-05 | Reduced motion disables nonessential effects; history does not animate per token. | Browser media emulation and code review |
| CP-06 | Enter sends, Shift+Enter adds a line, composition does not send, queue/Stop retains draft. | Built UI synthetic events; physical OS IME separately |

From the repository root after pinned dependency installation:

```bash
npm --prefix extensions/hypeproof-chat run test:task-workspace
npm --prefix extensions/hypeproof-chat/webview-ui run build
node --experimental-strip-types e2e/task-workspace/run.mjs
node --experimental-strip-types e2e/task-workspace/chat-details.mjs
```

The browser test executes the shipped React bundle, actual task host methods and
real disk store. VS Code browser APIs and Service/model are controlled fixtures.
Its PASS is not a signed-app, live-model, Windows or customer result. Independent
review can run `node --experimental-strip-types e2e/task-workspace/server.mjs --serve`.
No fixture needs a paid model or remote runner. Record native OS/profile/artifact
evidence separately. Aesthetic acceptance is independent of functional checks;
these tests do not establish parity with ChatGPT.

For an isolated Mac development app prepared by `scripts/studio-dev.py`, run:

```bash
HPS_APP_PATH='/absolute/path/HypeProof Studio Dev.app' node --experimental-strip-types e2e/task-workspace/native.mjs
```

This launches the real installed shell copy and extension twice with a temporary
user profile and loopback-only synthetic Service. It asserts no model request,
opens an actual native browser tab, and records the extension digest, screenshots
and results under `e2e/test-results/task-workspace-native`. It does not establish
signed distribution, live-account acceptance or Windows behavior. The browser
fixture's `/fixture-controls` page supplies deterministic busy, new-source and
one-shot failed-write controls for independent review; `/?theme=light` supplies a
light theme. Drawer focus, error recovery and personal/classroom separation are
required regression controls, not aesthetic scores inferred from test counts.


## Chat reference acceptance CG-IMPL-R1

| ID | Required positive and negative controls | Evidence boundary |
| --- | --- | --- |
| CG-01 | Compact 52–64px at desktop; wrapped/restored content expands on the same textarea; Send/Stop and transcript remain visible in a 400px-high window. | Built React geometry and independent pixels |
| CG-02 | Supported selection changes host request/tool set; unsupported/grant-revoked/invalid mode cannot execute or fall back; stable retry identity and paused mixed-mode draft survive restart. | Host/SDK event seams; real account separately |
| CG-03 | Citation preview, pin, acknowledged open, repeat-open reuse and exact-trigger return; reject forged request/URL/task, unsafe URL, stale open and failed focus. | Actual task handler + mocked browser, native pixels separately |
| CG-04 | Enter/Shift+Enter/composition, queue, Stop, errors and repeated dispatch preserve text and mode without an unintended request. | UI events and actual storage |
| CG-05 | Light/dark at 320/390/1280/1440px, source modal focus loop, 44px targets, quiet real-state feedback, reduced motion, scroll/caret continuity. | Independent rendered and interactive review |
| CG-06 | Existing shell reused, changed layers compile, artifact digests and exact source revision bind native run; remote PR checks and policy gates separate. | Build/dev app/CI, not customer approval |

Additional reproducible checks:

```bash
node --experimental-strip-types e2e/task-workspace/chat-reference.mjs
```

This scenario records screenshots, a browser video and a result ledger. It uses
synthetic tool availability and a controlled model seam to inspect the exact
request sent by the real UI. It does not prove that a model performed a search.
Host tests must independently exercise current grant/runtime checks. SDK citation
extraction accepts matched successful typed tool outputs and rejects model prose,
failed or denied tool results and untrusted URL shapes. Physical OS Korean IME,
Windows, live account search and signed updater remain separately named rows.

The independent reviewer records any material gap as a concrete scenario with
expected/observed behavior. A new code/acceptance revision addresses it and reruns
only affected checks before final review. Test counts or average aesthetic scores
cannot cancel an unresolved defect.

### Review-driven R2 controls

- Paused message Send must restore the next draft's textarea focus and selection after the Send control unmounts, for both keyboard and pointer activation.
- Narrow task navigation and personal header actions have44px targets; header disclosure keeps classroom markup unchanged.
- Native source rendering requires a nonempty document capture and the document composited within its actual browser-pane bounds. A loaded DOM or an empty PNG is not rendering evidence. The fixture's known white page is sampled only inside its measured pane, accounting for optional workbench sidebars.
- A preflight credential failure must settle pending-send state and restore the rejected request with its original tool mode; no paid request is made.

### Recovery and composer continuity follow-up

- A failed draft write stays visibly unsaved across unrelated state refreshes. A
  revision conflict cannot overwrite the other writer. Explicit recovery forks the
  displayed history and current draft into a new task; queue and recovered requests
  remain paused. A failed recovery retains the original input.
- Refused requests retain their own text, images and tool mode independently of the
  next draft. Admission reserves recovery space before dispatch; late or legacy
  over-limit data is never truncated. Removing an item requires explicit confirmation.
- Completion releases a queued request only after host persistence and activity
  ownership settle. Stop and stale terminal events cannot release or mutate a later
  turn. Storage failures retain the visible answer without leaving the UI busy.
- Resizing a short pane or changing line wrapping keeps a previously visible active
  caret visible, including a caret in the middle of a long draft. Deliberately
  scrolling away from the caret must not force a jump back. Text and selection are
  preserved, and resize alone never sends.

Use the existing task host/store and turn-tools tests, `pending-send.smoke.mjs`,
`e2e/queued-photo-send.mjs`, `e2e/stop-stream.mjs` and
`e2e/task-workspace/chat-details.mjs` for these controlled boundaries. A browser
selection-range assertion does not prove selection direction, physical IME or
native focus. Native app tests must be scheduled separately when the user permits
foreground interaction; background checks cannot establish native acceptance.

### Review-driven R3 controls

- Personal menu hover and source errors remain readable in light/dark themes, including fallback colors; Settings has a visible text label.
- Successful pointer/keyboard Send and explicit Stop leave the personal composer ready for immediate next typing. A refused submission does not move focus.
- Failed source Return preserves the already-opened identity and direct retry. Pending Return remains focusable but cannot dispatch twice. Late or unsolicited acknowledgments cannot take focus from a different source or draft. Unknown host errors use operation-specific safe copy.
- Image adjacency must use a profile granting image_paste and assert a visible image; a successful fixture control response alone is not evidence. Combine search selection, image removal, error/Stop and a400px-high window without losing the next draft.


## Compact conversation acceptance (CC-R1, #1762)

| ID | Expected behavior | Focused evidence |
| --- | --- | --- |
| CC-01 | Full personal profile shows no permanent model/effort/usage/observation block; settings retain values, Escape focus and draft. Access recovery stays visible. | `e2e/task-workspace/chat-compact.mjs` |
| CC-02 | Actual HypeProof green tokens, light theme, short/narrow panes; 18px branding, 16px answer glyphs and 44px targets; composer visible. | Matched screenshots plus independent visual review |
| CC-03 | Latest explicit numbered question yields keyboard/click choices; preserve draft, no automatic send; code/instruction/partial/old lists remain prose. | `test/reply-choices.smoke.mjs`, compact browser flow |
| CC-04 | First useful turns name default tasks locally; numeric replies use question context; rename and restart are durable; legacy provenance is protected. | `test/task-title.smoke.mjs`, `test/task-workspace-store.test.mjs` |
| CC-05 | General browser intent opens blank native browser without local preview; other URLs and capability/approval restrictions stay enforced. | Browser intent, MCP, URL and SDK controls; native observation separately |

Fixtures emulate Service/model seams without a provider request. Record source SHA,
UI package hashes, theme, viewport and environment with results. Green fixture pixels
are not an installed-app check; live account/tool routing and physical-device behavior
must be observed separately or marked NOT RUN/BLOCKED.

CC-05 negative controls also feed complete HTML fences, a successful HTML write notification and proxy-loop HTML into the actual provider. Existing index.html and agent.md must survive browser-only turns; an explicit authoring request is the positive control. SDK Write/Bash/delegation and invented destinations are denied before actions, while blank browser opening still needs its existing grant and approval.

- Attachment failure guidance: the visible note must meet 4.5:1 text contrast
  on both fixture themes, including applied opacity. `image-preparation.mjs`
  checks the actual failed-read note alongside preserved draft/images, repaste
  recovery and one explicit send. Synthetic themes do not prove native theme
  or operating-system clipboard acceptance. The persistent attachment live region
  starts empty, receives async failure text while composer focus stays put, and
  clears on retry; the textarea description follows the same failure lifecycle.
  A failed sibling read stays visible and announced when another image succeeds,
  in either completion order; a fresh retry clears the old guidance.
  DOM semantics are not a claim of native screen-reader speech.

- Wide-table reading: scroll horizontally, edit the next draft and append another answer;
  preserve the table offset and draft, with no unintended send. Existing
  `e2e/task-workspace/readable-tables.mjs` covers desktop and narrow panes.

- File-staged photos: a host refusal must remain visible and announced when a
  sibling staging acknowledgement arrives in either order. A new attachment
  attempt clears stale guidance, preserves successful photos and the draft, and
  does not send. `e2e/photo-only-send.mjs` covers the controlled host boundary;
  actual storage failure and native file drops require separate evidence.

- Stop then immediate task navigation: while an aborted transport still settles,
  explain that the stopped response is being finalized rather than asking the
  learner to press a Stop control that is no longer present. Keep the busy gate;
  running streams still require stopping. After settlement, navigation preserves
  the old partial answer and draft and excludes late callbacks from the new task.

### Proxy rate-limit recovery (#1893)

Replay HTTP 429 through the real proxy adapter: delta-seconds and IMF-fixdate
Retry-After headers appear as a readable wait, while missing/malformed/past or
more-than-seven-day delays use generic wait guidance without raw header text.
Keep 413 and non-rate-limit controls. In the UI/host/store fixture, verify no
automatic retry, one explicit retry on the same endpoint/model, and draft/history
preservation through reload. Native and real-provider acceptance are separate.

### Expired-code reconnection (#1897)

After a typed401 expiration disconnects the activity and unmounts the composer,
StartPage code preview and admission must not request a draft acknowledgement
from that unmounted view. Still await queued writes and retain interrupted-history
recovery. Re-enter the same activity/workspace and verify saved draft/history and
reload. Connected activity transitions must still acknowledge the current draft;
persistence failure must still block them. Synthetic admission evidence does not
establish native or live authentication acceptance.

### Automatic naming after introductory turns

CC-04 starts its two-turn naming window at the first useful request. Greetings, bare acknowledgements and unresolved numeric replies before a topic do not leave the task permanently named “새 작업”. The immediately following user turn can still refine the name from an offered option; later topics cannot rename it. Manual names remain protected. Existing title and workspace-store tests cover delayed naming, persistence, draft preservation and settled-title controls. Native verification remains separate.

### Rename save failure recovery

Keep the typed task name until a matching host save result arrives. A failed or unconfirmed save must leave the editor and value available for explicit retry; pending saves do not dispatch duplicates. Cancel and task/activity changes invalidate the pending UI request so late results cannot close another editor. Validate actual host persistence failure and recovery, draft/search preservation, and exact request matching separately from native window acceptance.

A delayed rename success or failure must preserve focus when the user has moved to the composer, search, or another control. Continue typing across the acknowledgment and verify every character remains in the draft, with no send. When focus still belongs to the rename form, success returns it to the title button and failure returns it to the retained name. Recheck ownership again on the animation frame so a newer focus or task change wins.

Personal conversation starters use the same draft ownership as editable reply choices: preserve manually typed text, replace only an untouched generated selection on reselection, and relinquish replacement ownership after manual editing. Verify an empty-draft control, saved manual draft, repeated selection, manual edit, reload and zero sends. Classroom starters retain their separate behavior.

Personal conversation deletion keeps its original task identity across confirmation. An in-progress task transition must not open deletion confirmation. A rejected store write must preserve history, show safe retry guidance, release the deletion guard, and permit a later explicit successful retry. Cancellation and active-stream guards remain required; synthetic modal tests do not establish native event timing.

Complete targetless browser requests include polite Korean ability questions (for example “브라우저 열어줄 수 있어?”). They must retain the same no-authoring protection as imperative browser-open requests, including against synthetic unexpected HTML output. Explicit destinations, search, authoring, negation and mixed requests must not be classified as targetless browsing.

## Question card (CGP-CHAT-D-003 / CGP-CHAT-D53)

`test/question-card.test.tsx` mounts the shipped card and ChatPanel, drives keyboard
and pointer events, and checks selection, explicit send, preserved draft, duplicate
confirmation, IME guards, typing focus/notice, retry, new-turn ownership and the
classroom gate. It also rejects hostile control/bidi option text and distinguishes
explicit recommendation suffixes from prose. Existing parser/quote/text-size tests
remain regression coverage.

Browser verification must measure the card against the reading column, 44px
options with 8px gaps, badge contrast in dark/light, and no narrow-pane overflow.
Capture personal/classroom at 1420px and 800px (320px is an additional stress case).
Check arrow focus, Space selection, Enter confirmation, draft-preserving arrival
and idle arrival. Physical IME, native screen-reader speech and forced-colors
acceptance must be reported separately from synthetic DOM/browser tests.

## Plan card (CGP-CHAT-D-004 / CGP-CHAT-D30)

`test/plan-first-layout.smoke.mjs` drives the real App in headless Chromium on both
seats, dark and light, at 320, 480 and 800px: the classroom chip's `aria-pressed`, the
personal tools-menu item and pill, the card's numbered steps and four actions, the send
button reading `계획 승인 기다리는 중` and disabled, and geometry (44px targets, no overlap,
no horizontal scroll, text at least 14px). D-004 adds: every action has the primary's
height and font size, and `이대로 진행` has its own fill and a heavier weight than each
secondary action.
Colours come from tokens only (`test/design-tokens.smoke.mjs` lints every webview sheet).
Packaged-app and forced-colors acceptance are reported separately.

## Selection action popover and quote chip (CGP-CHAT-D-007 / CGP-CHAT-D72)

`test/quote-reply.test.tsx` checks the pure placement rules (above, the 48px flip,
row and view clamps, a selection scrolled away), the chip's draft parts (typed text
kept, quote first when sent, one quote at a time, × removes only the quote), Escape
from the page and during IME composition, an Escape a menu already handled or pressed
while a modal is open (the popover stays), nothing during a mouse drag, and the popover
leaving an answer that starts streaming, through ChatPanel on the minimal DOM.
`test/elevation-computed.smoke.mjs` measures the popover's overlay level in Dark+ and
Light+ and, in high contrast and forced colors, that it drops the shadow and keeps a 1px
solid edge (the theme's contrastBorder in high contrast).

`test/quote-popover-layout.smoke.mjs` drives the real App in headless Chromium with CDP
mouse and key input, personal and classroom, dark and light, at 320 and 1420px: nothing
mid-drag; in the page within 150ms of the release and of a selection made without the
mouse; no entry animation; above the first line with a 2px gap, below the last line when
the selection is under 48px from the conversation's top; a 44px action that nothing covers;
Escape from the page; none on the streaming answer; the chip inside the composer card on
two lines with an ellipsis and a 44px `인용 빼기`; no horizontal scroll added (the 320px
personal header already scrolls by 11px before any popover in this fixture; the smoke
prints that as a note). Packaged-app, physical IME and screen-reader acceptance are
reported separately.

## Read-aloud control (CGP-CHAT-D-009 / CGP-CHAT-D67)

`test/voice-mount.test.tsx` renders the real ChatPanel with served voice and two answers in
the personal and classroom seats and presses the controls on the minimal DOM: idle
`읽어 주기` with the speaker glyph; pressed `aria-pressed="true"`, `그만 읽기` and the level
glyph; the second answer takes over and releases the first (one pressed at a time); the
pressed control stops its own reading. The same file keeps the unserved markup byte-identical.
`test/voice-ui.test.tsx` reads `aria-pressed` across play and stop on one answer, and across a
reading that ends by itself. The answer is read in at least two utterances (the test asserts the
count): an earlier utterance's end keeps it pressed with `그만 읽기`, and the last utterance's end
event (no press) releases the control to `aria-pressed="false"` and `읽어 주기` without a cancel.

`test/voice-browser.smoke.mjs` drives the real App bundle in headless Chromium at 320px,
both seats, dark and light, with a recording synthesizer: the pressed control has a fill that
the idle one has not, a 44px box and 14px text; the level glyph and its shape compute
`animation-name: none` and run no animation with motion allowed, with OS reduced motion and
with `data-reduced-motion="true"`; in forced colours the pressed and idle controls differ; the
second answer takes over and the first reading is cancelled. These browser-only checks (the
personal pressed fill, the cancel) must not skip: with `FOCUS_REQUIRE_BROWSER=1`, as the CI smoke
shards set it, a missing Chromium fails the smoke instead of printing NOT RUN. Every read is a state, a computed style or a minimum box, not a
text width, so a runner's fonts do not change the verdict. A real Korean voice, screen-reader
speech of the pressed state and the packaged app are reported separately.

## Microphone and speaker mute (CGP-VOICE-R-002 / CGP-VOICE-D-001)

`test/voice-mute.test.tsx` renders the real VoicePanel, owned by the real popup and session
reducers, next to a real read-aloud button under a served-voice profile (disclosure read), with a
scripted synthesizer on the minimal DOM. Both presentations show exactly one `마이크 끄기` and one
`소리 끄기` button, each with `aria-pressed` and its glyph. `소리 끄기` cancels a reading within the
press, holds read-aloud (disabled, `읽어 주기, 소리 꺼짐`), sends no session event and leaves capture
open. `마이크 끄기` sends one `mute`, closes capture and leaves the switch and the reading alone. Both
are kept across collapse and expand; ending the conversation turns sound back on. Each change is
announced in a status region. Red on main: all seven cases fail (no such buttons).

`test/voice-read-aloud.smoke.mjs` checks the hub against the switch without React: muting cancels
synchronously, a muted hub starts nothing, a hub without the switch is unchanged (negative
control), a disposed hub stops listening. Red on main: the first assertion fails.

`test/voice-mute-controls.smoke.mjs` drives the same composition in headless Chromium, dark and
light at 1420 and 320 plus forced colours, with real mouse presses: two named toggles per
presentation, 44px boxes, 20px glyphs, inside the viewport, no sideways scroll, pressed differs by
glyph, fill and edge (and still differs in forced colours), off words at 14px or more, switches
independent and kept across collapse and expand. Negative controls run by hand: main's VoicePanel
fails it (no buttons) and a pressed rule without the edge fails it. Reads are states, computed
styles and minimum boxes, not text widths, so a runner's fonts do not change the verdict. A real
voice, a screen reader and the packaged app are reported separately.

## Voice agent-status line (CGP-VOICE-R-007 / CGP-VOICE-D-006)

`test/voice-agent-status.test.tsx` renders the real VoicePanel, owned by the real popup and session
reducers, under a served-voice profile (read-aloud served, disclosure read) with a scripted
synthesizer and a real answer read-aloud button, on the minimal DOM. Host events arrive as window
`message` events through `onHostMessage`, in the shapes `chatPanelProvider` posts (`streamStart`,
`streamChunk`, `toolLog` with a tool_use id going running to done or error, `approvalWait`,
`streamEnd`, `streamStopped`, `streamError`). Real tool lines carry the host's `kind: "tool"`; the non-tool lines are posted exactly as the host posts them, without it. Thirty cases: a start is shown with the run-state word
and the host's label, announced once and read once; a step update of the same call is not announced
or read again; `끝났어요` appears only after that call's result event; the negative control (prose
`파일을 저장했어요` and `끝났어요!` with no tool event) leaves `생각 중`, then `준비됨`, with nothing
announced or read; negative controls for every non-tool `toolLog` the host posts (the adult thinking block `💭 think-N` with prose claiming a save, `⏳ notice:` busy and orchestrator notices, the compaction note, the pending placeholder and its `생각했어요` / `고쳤어요` close) each leave `생각 중` with nothing announced, read or called finished, also between real calls; a result for a call never seen starting is not called done; a source check that only the tool_use / tool_result / browser-loop posts in `chatPanelProvider.ts` carry `kind: "tool"`; failure paths posted through the host's own denial rewrite (`denialToolLine`): a refused approval in both orders and a timed-out one (D1), an SDK safety denial, a failed browser-loop step (D2) and a failed end each replace the running line with `문제가 생겼어요`; a check that `postToolLog` rewrites denials through `denialToolLine`, which keeps `kind`; a call with no result is never called done; a tool failure and a failed reading
are separate lines, and a failed reading never turns a success into a failure; `소리 끄기` holds every
reading and stops a running one; an answer reading is never cut off; a status reading refused by autoplay (`not-allowed`) shows the failed-reading line (F1); no status is read over an answer whose reading was refused, and that answer's `소리 켜기` still reads exactly its unheard chunks (F2; both red on 1fe3261d6); approval holds its line; another
stream's events are ignored; stop and errors; pacing at the interval; collapse and expand repeat
nothing; with voice not served nothing touches the synthesizer; the reducer leaves its state object
unchanged for prose and malformed messages. Red on main: the file cannot bundle (no reducer). Red on 5be2029c8 (before the `kind` marker): the six
non-tool and no-start cases and the source check fail (7 of 23). Red on 441ee8b83: the file cannot bundle
(no `denialToolLine`); with the rewrite mutated back to 441ee8b83's (dropping `kind`) D1, the SDK denial,
D2 and the rewrite check fail (4 of 28), and without the held result D1 fails. 28 pass at the fix.

`test/voice-agent-status.smoke.mjs` drives the same panel in headless Chromium, dark and light at
1420 and 320, with and without reduced motion, and forced colours, posting the same host messages
with `window.postMessage`: the line sits below the state label at 14px or more with a 16px icon that
neither animates nor transitions, a label long enough to wrap in any font is held to two computed
line heights while the DOM and the tooltip keep the whole text, the line itself has no live role and
the single status announcer changes only for a start and a finish, and at 320 nothing scrolls
sideways. Reads are computed styles and line heights, not text widths, so fonts do not change the
verdict. Negative control: main's VoicePanel fails it (no line). A real voice, a screen reader and
the packaged app are reported separately (NOT RUN).

## Blocked read-aloud recovery (CGP-VOICE-R-028 / CGP-VOICE-D-021)

`test/voice-autoplay-blocked.test.tsx` renders a real read-aloud button under a served-voice profile
(disclosure read) on the minimal DOM. The scripted synthesizer's utterances are failed by the test with
`not-allowed`. Cases:
- A refused start is not shown as reading: `aria-pressed="false"`, no `읽는 중이에요`. Exactly one inline
  notice `소리가 막혔어요.` appears with one `소리 켜기` button, with no dialog.
- After one chunk ended and the next was refused, one press reads exactly the unheard chunks in order.
  The notice is gone and does not come back after a normal end.
- `소리 끄기` clears the notice.
- Negative controls: another engine error (`synthesis-failed`) shows no notice, and an unserved seat has
  nothing to press.
- The hub refuses `resume` unless this answer is blocked, and `stop` forgets the pending chunks.
- The style case reads the CSS rule: no animation or transition, wrapping, caption step.

Red on main `97c232ddf`: 5 of 6 cases fail. The unserved-seat negative control passes there too, as it
should. Four mutants each fail at least one case: treating `not-allowed` as a plain error, resuming
from the first chunk, showing a blocked reading as pressed, and keeping no pending chunks. A real
browser autoplay refusal, a screen reader and the packaged app are not run here.

## Task memory switches (CGP-KNOW-R-028 / CGP-KNOW-D-028)

`test/task-memory-switches.smoke.mjs` runs the real provider (task harness) on real files, plus the Agent SDK runtime
bundled as it ships. Cases:
- **Ledger rules:** defaults on; malformed values fall back to on; entries equal to the default are pruned; the lock and
  bounds hold.
- **Defaults:** `remember` writes.
- **Keep off:** no tool; `recordTurnMemoryWrite` refuses; the coach's `Write`/`Edit` into `.hypeproof/memory/` (nested
  too) is refused with the sentence; nothing reaches the disk. Negative controls: a page write, a sibling name and a
  `Read` are untouched.
- **Shell (keep off):** commands naming `.hypeproof` are refused, in any case, as an absolute path, and for reads.
  Negative controls: `npm test`, `ls` and `echo memory > notes.md` are untouched. With keep on, the shell is decided as
  before. No request leaves the client while keep is off (a fetch tripwire).
- **Mid-turn:** a host made before keep went off refuses its next call; keep back on offers it again.
- **Path check:** a symlinked folder lands inside; case variants are the same folder on macOS and Windows (another folder
  on Linux); a Write through a symlinked folder is refused.
- **Read side (use off):** Read, Grep, a Glob aimed at `.hypeproof/**` from the work folder, and `cat` on the folder are
  refused with the use sentence. Negative controls: other files and other searches are read as before, and reads are
  allowed with use on.
- **Pinned turn:** a turn begun in the keep-off task stays refused (and has no remember tool) after another task opens,
  while a new turn in the other task may write.
- **Temporary task:** a temporary task gets no group, and `setTaskMemory`'s own guard refuses another task id.
- **Use:** with the first-use notice seen, use on carries the stored item (positive control); use off carries nothing.
- **Lock:** use is locked after a message, and keep still changes.
- **Stale task:** a stale task id changes nothing.
- **No store binding:** class and instructor seats have no view.
- **SDK runtime:** `canUseTool`, with the provider's own check, denies a `Write` into the memory folder and a `Bash`
  command naming it, with the sentence. A page write is left to the usual policy.

Mutants on snts each fail it:
- use gate off;
- keep gate off;
- file-tool guard off;
- shell check off;
- SDK hook off;
- lock ignored;
- no realpath;
- no case fold;
- read side off;
- a temporary task getting the view;
- not pinned to the turn's task;
- `setTaskMemory`'s task-id guard off. The router-level
drop of a stale message is a second layer.

`test/task-memory-switches.test.tsx` renders the group on the minimal DOM:
- two labelled native checkboxes under the legend;
- each change posts one `taskMemorySet` for the open task;
- locked: the use box is disabled, and its `aria-describedby` points at the lock glyph and reason; keep is still free
  and has its hint;
- one mount in the personal dialog, gated on the host view;
- 44px rows, the caption step, and no physical box properties.

`test/memory-folder-guard.smoke.mjs` covers the turn-end folder check (#4014) on real files and through the provider:
- **Put back:** an added file is quarantined; a changed file and a deleted file are put back; the turn's versions are kept.
  A second run finds nothing.
- **Studio's own changes are kept:** `ActivityMemory` append and remove, and the learner's editor save.
- **Bounds (fail closed):** a file over the item size is never read, is reported and is left in place. Past the read
  bound, stray files are tracked by name only, a planted memory file is still moved out, and the turn says some contents
  were not checked.
- **Flood plus rewrite:** 260 new memory files that sort first, 30 junk names and a rewrite of an item tracked at turn
  start: the rewrite is still put back, every new file is gone, and junk names are moved, not copied.
- **No data loss:** a learner's 200 KB photo dropped in mid-turn is moved byte for byte; an item swapped for a folder
  keeps its earlier bytes in the quarantine and is reported. Moves are capped per turn, the rest is left and reported,
  and a moved file is outside the byte cap. A moved photo with a 30-day-old mtime survives the prune right after its move,
  junk with a future mtime does not outrank newer copies, and retention and order follow the stamp in the name.
- **Studio's last state:** a learner's editor save, then a shell overwrite in the same turn, ends with the learner's
  save; the overwrite is quarantined. A BOM and CRLF file saved in the editor is journaled from disk and kept byte for
  byte.
- **Quarantine:** the seven-day retention, the per-activity count cap (oldest first), a task purge, a malformed key
  touching nothing, and modes 0700/0600.
- **Provider:** a keep-off turn's shell write, through a path built at run time, is put back. The line names the count
  only and is kept with the turn. No fetch is made, and nothing of the content is logged. Archiving the task purges its
  quarantine. A keep-on turn takes no snapshot, and its write stays. A turn that changed nothing posts nothing.
- **Wiring:** the guard starts after the turn is bound to its task and ends before the turn restore point. Both runtime
  calls run inside it. Archive and move purge the task's quarantine, and retention is applied at activation.

Mutants each fail it:
- Studio's changes not kept;
- deletions not restored;
- the guard running on keep-on turns;
- the end hook missing;
- the retention ignored;
- the caps ignored;
- the archive purge removed;
- the journal's state ignored (the pre-turn version restored);
- new names past the bound not moved;
- the editor save journaled from the editor's text;
- a content-tracked item not read again at the end (the flood bypass);
- junk deleted instead of moved;
- a folder swap losing the item's bytes;
- no per-turn move cap;
- moved files counted in the byte cap;
- the quarantine aged by mtime instead of the stamp in the name.

A real coach shell command and the packaged app are not run here.

## Shell row and 실행 중인 것 (CGP-AGENT-D-025 / DES-CGP-AGENT-60)

- `test/shell-row-copy.test.tsx`: the real App on the minimal DOM. A host `toolLog` with a shell
  presentation draws the row through ToolLine; the block is open on a detailed seat and has one
  `명령 복사` button (a real `type="button"`, no tabindex or aria-hidden, after the summary and the
  command in document order, inside the `<details>`). A click writes the command exactly as shown
  (no `$ `, the ` ⏎ ` mark kept); `명령을 복사했습니다` only after the write resolves, the refusal
  wording on a rejected write. A summary-seat row and a row restored from its stored label start
  collapsed with the button inside. In 실행 중인 것 a shell task reads `멈추기`, then `멈추는 중` in
  the status and the disabled button until the host reports the exit, then `멈췄어요` and no
  button; the preview server keeps `끄는 중` (negative control).
- `test/shell-process-layout.smoke.mjs`: the shipped cascade in headless Chromium, personal and
  classroom, dark and light, 320/800/1420px, forced colours and both VS Code high-contrast themes.
  Measured: monospace command (ten `i` and ten `W` equally wide), a long command block at most
  240px with `overflow-y: auto` and content to scroll, the copy button 44 × 44 with a visible edge,
  beside the command (no overlap) and inside the row, not drawn at rest, drawn under a forced
  `:hover` on the row and when Tab from the summary reaches it, no opacity transition, the shared 2px focus ring (inset in the transcript scroll scope). Eleven new
  injected overrides (proportional font, no cap, clipping, never/always drawn, hover only, out of
  the tab order, over the command, small target, no edge, a fade) each fail it.
- Physical IME is not involved (the button binds no key), and packaged-app, touch-device and
  screen-reader acceptance are separate observations.

## Activity trash in 내 작품 (CGP-KNOW-D-013)

- `test/activity-trash-panel.smoke.mjs`: the real provider routes the panel's requests into the
  real encrypted store with real temporary files. Default off, instructor and no task workspace
  give no view. Native confirm names the file with one Cancel; Cancel, a running turn, a pending
  send, an unsaved buffer, folder refusal, a stale scope, traversal, folders and malformed request
  ids never mutate. Move, Undo with identical SHA-256, suffixed restore, purge Cancel/confirm,
  the send reservation during the confirm, a refused second press and a profile change during the
  confirm.
- `test/activity-trash.test.tsx`: the real component on the minimal DOM. Exact 7999/8000ms
  expiry, hold on focus and hover with a fresh 8s after, a pending Undo holds, polite live copy
  `휴지통으로 옮겼어요 · 되돌리기`, restore of the moved id, foreign answers ignored, refusal and
  retry, double press, dialog naming the file with 취소 focused, Escape focus return, IME block,
  task and scope changes. Focus: a pending press is `aria-disabled` (never `disabled`, which blurs
  the focused button), and after a file move, 복원, 영구 삭제 or Undo the focus lands on the next
  row's control, the restored file's row, or the 휴지통 entry, never `<body>`; the mini DOM sends
  focus to `<body>` when the focused element is removed, as a browser does. Every rendered trash
  control is matched against the real stylesheet for 44px (되돌리기 also 44px wide).
- `test/activity-trash-css.smoke.mjs`: stylesheet rules with one negative control each: 44px
  targets (되돌리기 44 × 44), caption type step, wrapping names, the 2px focus ring, forced colours.
- Native dialog focus, physical IME, installed-app rendering and screen-reader output are
  separate observations; the synthetic tests do not establish them.
