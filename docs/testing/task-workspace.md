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
