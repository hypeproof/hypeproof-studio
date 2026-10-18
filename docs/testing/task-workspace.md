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

From the repository root after pinned dependency installation:

```bash
npm --prefix extensions/hypeproof-chat run test:task-workspace
npm --prefix extensions/hypeproof-chat/webview-ui run build
node --experimental-strip-types e2e/task-workspace/run.mjs
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
