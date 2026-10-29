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

### Normal quit during an admitted model turn (#3134)

Before dispatch, the existing task store durably upserts the admitted user message
under its original identity. Prepared companion execution does this after its
reservation and durable run binding, then rechecks the untouched native composer
before SDK entry; it never imports the phone request into that composer.
Normal extension shutdown synchronously freezes the owned user, received partial
answer and tool timeline, aborts the stream, and awaits that history write together
with spool closure. It does not wait for SDK transport unwind. A stale task/epoch
cannot commit into a replacement owner. Terminal and aborted settlement upsert
identities instead of appending duplicates; late SDK bytes cannot upgrade the
frozen interrupted transcript. Failed persistence remains a failure.

`test/companion-normal-turn.test.mjs` exercises ordinary and prepared requests over
the actual provider and task store, reloads a second store while SDK unwind is held,
and checks zero/partial output, stale ownership, storage refusal and the actual
`deactivate` join. This is local source/disk evidence, not a process-kill, power-loss
or installed operating-system shutdown guarantee. Both native hosted normal-quit
checks remain required for the resulting packaged revision.
