# Curriculum Runtime run record — preview baseline (F1) and the recon map after decision 9 (#1506)

Status: run record, 2026-10-05. Issue [#1506](https://github.com/jayleekr/hypeproof-studio/issues/1506), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388). Row definitions: [curriculum-runtime.md](curriculum-runtime.md). #1506 is a repair issue, not a ledger work item; no row here is a completion. The record sweep (#1507) re-runs CR-T01 for `cr-recon` and CR-T02's switch-off baseline for every item, and cites this file for what changed.

## What was run

- Code: branch `chore/cr-unblock` off `origin/main` `00590823`. No product code changed. Changed: `e2e/tests/09-preview.spec.ts` and `e2e/fixtures/app.ts` (the instrument), the recon page, the CR-T01 frozen control inputs, the plan, this file and its trace node.
- Machine: Apple M3 Pro, macOS 15.7.4, Node 22.22.1. Screen unlocked. Every app run waited for 5 minutes without keyboard or mouse input (`GATE=idle`), ran in quiet mode (off-screen, not focusable, in-memory secret storage, temporary user data) and held the machine-wide app lock (`app-lock.sh`).
- App: a scratch copy of HypeProof Studio 0.1.51 (`d4db9049`) with the extension and webview built from `00590823` injected (`e2e/classroom/mac-devhost.mjs prepare`: 4 bundle hashes equal to the build), marked `LSUIElement` (`scripts/prep-test-app.sh`). The branch changes nothing the app runs, so the same build serves the branch. Each planted regression below was its own build of `00590823` plus the plant, injected the same way.
- Service: `scripts/dev-stack.sh` (local `wrangler dev`, dev-only signing secret, no provider key), cohort `sk-biopharm-2026-a`, profile `sk-biopharm-kids-2026-grade-3-4-s1`, served with `preview.type: "live_server"` and `curriculum_runtime.enabled: false` (the CR switch off).
- Evidence class (MC-38): live-host App. The "webview" variant's `preview.type` is synthetic: a forwarder in the test serves the dev Service's profile with that one field changed.

## Part 1 — F1, `09-preview.spec.ts`

### Diagnosis

The issue repeats the recon's 2026-09-29 result (recon §8: "1 passed, 2 failed"). That was measured before `cr-browser` (#1433) changed the spec on 2026-10-01. Re-measured first, unchanged:

| Run | Build | Result |
|---|---|---|
| `baseline-main`, 13:06–13:08, `--repeat-each=3` | `origin/main` spec and extension | 9 of 9 passed. Every check took the live path. |

The later items' run records (`cr-verify` to `cr-skills`) say "BLOCKED by pre-existing F1" without a re-run; the spec was already green on the live path in the cr-browser finish.

What the spec did not measure: every profile in `worker/src/profiles` serves `preview.type: "live_server"` (checked with `npm run dump-profiles`: all nine). On the dev stack every check took the live branch, so the REQ-D3 (sandbox) and REQ-D6 (previewReady handshake) assertions never ran. The webview path is still shipped: it serves a webview cohort and every live server that fails to start.

The first run with a webview variant (`variants-try1`, 13:12–13:14) passed REQ-D1/D3/D6 and REQ-D5 on the webview path. REQ-D4 [webview] failed before its first check: in `openChatContainer`, the palette input became visible, then the unified "AI와 작업" editor took focus and closed the palette. `fill` waited 30 s on a hidden input. The page snapshot shows the "AI와 작업" tab in front, with the chat already visible in it. This is the recon's REQ-D4 failure ("the command-palette input stayed hidden", F1). #1433's retry reopens a palette that never showed; it did not cover one that closes after it showed.

Verdict (verification.md rule 6): the instrument was wrong, not the product. The product opens the path the served profile names, sandboxes the srcdoc frame as REQ-D3 says, flushes the queued HTML on `previewReady` (REQ-D6), keeps one preview, and saves `index.html`. The planted regressions below show the spec now fails when any of that breaks.

### Changes (test code only)

- `e2e/tests/09-preview.spec.ts`: each test runs twice. `served` uses the dev Service's profile as served. `webview` puts a forwarder in front of the same Service that answers `GET <base>/profile` with `preview.type: "iframe"` and passes every other request and response through. Before launching, the webview variant checks that the forwarder serves a webview cohort (instrument control). The REQ-D6 check now also requires the canned game's own marker inside the sandboxed frame, so a flushed `renderPreview` is told apart from a shown but empty frame. The preview webview is found by its own name, not by its position among the editor's webviews.
- `e2e/fixtures/app.ts`: `launchApp({ proxyUrl })` sets `hypeproofChat.proxyUrl` for one launch (default unchanged). `runCommand` fills the palette and checks that it is still open after the filter settles, inside each of its three attempts; a palette that closes after it showed is opened again. `openChatContainer` returns at once when a chat surface is already visible (the unified layout has no activity bar, and its editor already shows the chat).

### Positive control

| Run | Result |
|---|---|
| `positive-r1`, 13:16–13:19, `--repeat-each=3` | 18 of 18 passed. Each `served` test took the live path; each `webview` test took the webview path, with the sandbox attributes, `referrerpolicy`, the visible frame and the marker inside it. |

### Planted regressions

One plant per build, product code only (`extensions/hypeproof-chat/src`), restored after each build; scratch runner `mutate.py`. Each run is the full spec (six tests). A plant must turn exactly its predicted tests red and leave the others green.

| Plant | Predicted red | Result |
|---|---|---|
| M1 `isLiveServerPreview()` always false: a `live_server` cohort takes the webview path | REQ-D1/D3/D6 [served], REQ-D4 [served] | RED, at "the preview path the served profile's preview.type picks" (expected `live`, opened `iframe`); 4 others green |
| M2 the preview iframe sandbox gains `allow-same-origin` | REQ-D1/D3/D6 [webview] | RED, at `not.toContain("allow-same-origin")`; 5 others green |
| M3 `previewReady` no longer flushes the queued HTML | REQ-D1/D3/D6 [webview] | RED, at `toHaveCSS("display", "block")` (stayed `none`); 5 others green |
| M4 every show creates a new preview `WebviewPanel` | REQ-D4 [webview] | RED (more webviews after the second Run); 5 others green |
| M5 a second Run opens a second browser tab beside the first | REQ-D4 [served] | RED, at the tab count after the second Run (expected 1, received 2); 5 others green |
| M6 the game is never saved to `index.html` | REQ-D5 [served], REQ-D5 [webview], REQ-D1/D3/D6 [served], REQ-D4 [served] | RED: both REQ-D5 at "index.html should exist", the live-path REQ-D1 and REQ-D4 at "no preview opened" (the live server has no page to serve); the two webview tests stay green (the srcdoc frame does not need the file) |

Runs 13:20–13:30, one gated run per plant; the clean build was injected again afterwards (4 bundle hashes equal to the `00590823` build).

Instrument control (test code, no rebuild): M7, the forwarder stops changing the profile. Run 13:31 with `--grep webview`: each webview test failed at its own first check, "the forwarder serves a webview cohort" (expected `iframe`, received `live`), in under 30 ms and without launching the app. The served REQ-D4 test, which the grep also matched, passed.

### The shared fixture in the other CR in-app specs

`runCommand` is shared by the CR in-app specs (`e2e/curriculum-runtime/*-app.spec.ts`, `app-layer.spec.ts`). `app-layer.spec.ts` with this branch's fixture, same app copy, gated (13:31–13:32): 2 passed, 1 failed. The failure is the last assertion of "CR-T02 exception in-app": "hidden again once nothing is stored". The stored bytes were already gone (the spec polls the files first), but the delete command was still listed. The spec reads the palette once, right after the files are gone, and the App sets the context key without waiting (`refreshCrBytesContext`: `void executeCommand("setContext", …)`), so the read can come first. `runCommand` only ran the delete command, which did its job.

The same test with `origin/main`'s fixture, three gated runs (13:33–13:34): run 1 failed at `locator.fill: Timeout 30000ms exceeded`, the palette race this branch fixes; runs 2 and 3 passed. With this branch's fixture: the first run was aborted when input resumed (exit 75); the rest are listed under "Not run, limits".

## Part 2 — CR-T01 after decision 9

Decision 9 (2026-10-01) moved CR-59 and CR-60 (CR-T55, CR-T56) from `cr-browser` to `cr-e2e`. #1433 moved them in the ledger and the plan, not in the recon page.

| Step | Command | Result |
|---|---|---|
| Before, `origin/main` | `cd worker && node --experimental-strip-types test/cr-recon.test.mjs` | exit 0, verdict read at commit `5e82f590` (the recorded map), then `INFO this tree differs from the recorded map in 6 place(s)`: matrix CR-59 and CR-60 (`cr-browser` does not cite them), strategy `cr-browser` (CR-T55 and CR-T56 target none of its requirements), strategy `cr-e2e` (CR-59 and CR-60 not targeted) |
| Page edited (§4 rows CR-59 and CR-60 name `cr-e2e`, §5 `cr-browser` and `cr-e2e` rows, §7 `cr-e2e` note), fixture unchanged | same | exit 1: `frozen-inputs.json is not the projection of the verdict's inputs … The verdict passes on this tree, so regenerate the fixture`. The edited page no longer matches `cr-recon`'s pin, so the verdict reads this tree |
| Fixture regenerated | `HPS_CR_RECON_FREEZE=1` the same | `wrote worker/test/fixtures/cr-recon/frozen-inputs.json`. The diff is exactly `cr-browser` minus CR-59 and CR-60, `cr-e2e` plus CR-59 and CR-60 |
| After | the same, without the variable | exit 0, `verdict read at this tree … · 10 areas · 73 map entries · 84 matrix rows · 11 decisions · 34 negative controls each caught`; no problem |

Planted defects on this branch, one at a time (scratch runner `mutate_recon.py`, the file restored after each; the clean tree passed before and after):

| Plant | Result |
|---|---|
| CR-59 row back on `cr-browser` | RED: `matrix CR-59: cr-browser does not cite CR-59 in the ledger` |
| CR-60 row back on `cr-browser` | RED: `matrix CR-60: cr-browser does not cite CR-60 in the ledger` |
| CR-T55 back in the `cr-browser` strategy row | RED: `strategy cr-browser: CR-T55 targets none of the item's requirements` |
| CR-T56 dropped from the `cr-e2e` strategy row | RED: `strategy cr-e2e: CR-60 is not targeted by any CR-T in its row` |
| Fixture left at the pre-decision-9 projection | RED: `frozen-inputs.json is not the projection of the verdict's inputs` |

## Gates

PENDING

## Not run, limits

- The webview path ran with a synthetic `preview.type`. No shipped profile is a webview cohort, and this run did not force a live server to fail.
- REQ-D4 on the live path counts tabs. A product that closed and reopened its tab instead of reloading it would pass; only a second tab is caught (M5).
- CR-T02's HTML generation specs and the rest of the switch-off inventory: `cr-e2e`.
- No completion is written here. `cr-recon` stays reopened until the record sweep re-records it: its pin on the requirements document had already changed, and this branch changes the page and the fixture it pins.
- The shell is the installed 0.1.51 copy; only the extension and webview are current.
- `app-layer.spec.ts`, "CR-T02 exception in-app": its last assertion reads the palette once right after the stored files are gone, while the App updates the context key without waiting (above). That race is in the spec and the App, not in this branch's fixture; it is left to the record sweep, which re-runs `cr-browser`'s in-app rows. This branch's fixture side of the comparison is listed here when it ran.
