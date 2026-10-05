# Curriculum Runtime run record — preview baseline (F1) and the recon map after decision 9 (#1506)

Status: run record, 2026-10-05. Issue [#1506](https://github.com/jayleekr/hypeproof-studio/issues/1506), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388). Row definitions: [curriculum-runtime.md](curriculum-runtime.md). #1506 is a repair issue, not a ledger work item; no row here is a completion. The record sweep (#1507) re-runs CR-T01 for `cr-recon` and CR-T02's switch-off baseline for every item, and cites this file for what changed.

## Requirement IDs: touched, none met

Records, issue comments, `align.py` inputs and the PR's assessment name these as touched or re-mapped, never as claimed or met.

- CR-01 (`cr-recon`): CR-T01 re-run on the edited recon page, five plants caught (Part 2). `cr-recon`'s completion stays reopened until the record sweep (#1507) re-records it.
- CR-02 (cited by every implementation item, `cr-browser` to `cr-e2e`): `09-preview.spec.ts` with the switch off, on both preview paths (Part 1). That is one spec of CR-T02's switch-off half. Not run here: the HTML generation specs, the switch-off inventory, the switch-on half and the stored-bytes exception. `app-layer.spec.ts` ran only to compare fixtures (Part 1, last section), so it is no CR-T02 result.
- CR-59 and CR-60 (`cr-e2e` since decision 9): the recon map now names `cr-e2e` as their item (Part 2). Nothing was measured. CR-T55 and CR-T56 (30 samples each, in the Studio app on the reference Mac) stay with `cr-e2e`.

## What was run

- Code: branch `chore/cr-unblock` off `origin/main` `00590823`. No product code changed. Changed: `e2e/tests/09-preview.spec.ts` and `e2e/fixtures/app.ts` (the instrument), the recon page, the CR-T01 frozen control inputs, the plan, the status line of [curriculum-runtime.md](curriculum-runtime.md) (a link to this file), this file and its trace node.
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

### What ran against the changed fixture

`e2e/fixtures/app.ts` is shared. 26 spec files call `runCommand` or `openChatContainer` (`grep -rln "openChatContainer\|runCommand(" e2e` lists them and the fixture itself): 20 under `e2e/tests/` and the six CR in-app specs under `e2e/curriculum-runtime/`. Only two were re-run against this branch's fixture: `09-preview.spec.ts` (above) and `app-layer.spec.ts` (below). The other 24 were not. What changed for them: `openChatContainer` returns at once when a chat `.hps-shell` is already visible (only `ChatPanel.tsx` and `ChatErrorBoundary.tsx` render one), and `runCommand` fills the palette and checks that it is still open inside its retry, then presses Enter. Whoever next finds one of the 24 red (the record sweep #1507 re-runs the CR in-app specs) runs it with `origin/main`'s fixture and with this one before blaming the product.

`app-layer.spec.ts` with this branch's fixture, same app copy, gated (13:31–13:32): 2 passed, 1 failed. The failure is the last assertion of "CR-T02 exception in-app": "hidden again once nothing is stored". The stored bytes were already gone (the spec polls the files first), but the delete command was still listed. The spec reads the palette once, right after the files are gone, and the App sets the context key without waiting (`refreshCrBytesContext`: `void executeCommand("setContext", …)`), so the read can come first. `runCommand` only ran the delete command, which did its job.

The same test alone, three gated runs per fixture, the fixture file swapped on the same app copy and Service (scratch runner `ab_fixture.py`):

| Fixture | Runs | Result |
|---|---|---|
| `origin/main`'s | 13:33–13:34 | 2 passed. 1 failed at `locator.fill: Timeout 30000ms exceeded` in `paletteRows` (`e2e/curriculum-runtime/app-helpers.ts:95`, first palette read after launch) |
| this branch's | 13:40–13:42 (one earlier attempt aborted at 13:35 when input resumed, exit 75) | 2 passed. 1 failed the same way, in `paletteRows` |

Both failures are the palette race this branch fixes in `runCommand`, inside the CR specs' own copy of the palette code, which this branch does not touch. The four runs that reached "hidden again" passed it, two per fixture. Neither race comes from `fixtures/app.ts`; both are left as follow-ups (below).

## Part 2 — CR-T01 after decision 9

Decision 9 (2026-10-01) moved CR-59 and CR-60 (CR-T55, CR-T56) from `cr-browser` to `cr-e2e`. #1433 moved them in the ledger and the plan, not in the recon page.

| Step | Command | Result |
|---|---|---|
| Before, `origin/main` | `cd worker && node --experimental-strip-types test/cr-recon.test.mjs` | exit 0, verdict read at commit `5e82f590` (the recorded map), then `INFO this tree differs from the recorded map in 6 place(s)`: matrix CR-59 and CR-60 (`cr-browser` does not cite them), strategy `cr-browser` (CR-T55 and CR-T56 target none of its requirements), strategy `cr-e2e` (CR-59 and CR-60 not targeted) |
| Page edited (§4 rows CR-59 and CR-60 name `cr-e2e`, §5 `cr-browser` and `cr-e2e` rows, §7 `cr-e2e` note), fixture unchanged | same | exit 1: `frozen-inputs.json is not the projection of the verdict's inputs … The verdict passes on this tree, so regenerate the fixture`. The edited page no longer matches `cr-recon`'s pin, so the verdict reads this tree |
| Fixture regenerated | `HPS_CR_RECON_FREEZE=1` the same | `wrote worker/test/fixtures/cr-recon/frozen-inputs.json`. The diff is exactly `cr-browser` minus CR-59 and CR-60, `cr-e2e` plus CR-59 and CR-60 |
| After | the same, without the variable | exit 0, `verdict read at this tree … · 10 areas · 73 map entries · 84 matrix rows · 11 decisions · 34 negative controls each caught`; no problem |
| After the record sweep, simulated | scratch clone of `d73fb630` whose ledger (working tree only) gives `cr-recon` a completion pinning this page and fixture, as `align.py record --replace` would; then CR-T01 | commit = `d73fb630`: exit 0, verdict read at that commit, `INFO this tree still matches the recorded map`. Commit absent from the clone (every CI run checks out at depth 1): exit 0, verdict not re-run, the same INFO line. The control is `origin/main` itself (first row): six differences |

Planted defects on this branch, one at a time (scratch runner `mutate_recon.py`, the file restored after each; the clean tree passed before and after):

| Plant | Result |
|---|---|
| CR-59 row back on `cr-browser` | RED: `matrix CR-59: cr-browser does not cite CR-59 in the ledger` |
| CR-60 row back on `cr-browser` | RED: `matrix CR-60: cr-browser does not cite CR-60 in the ledger` |
| CR-T55 back in the `cr-browser` strategy row | RED: `strategy cr-browser: CR-T55 targets none of the item's requirements` |
| CR-T56 dropped from the `cr-e2e` strategy row | RED: `strategy cr-e2e: CR-60 is not targeted by any CR-T in its row` |
| Fixture left at the pre-decision-9 projection | RED: `frozen-inputs.json is not the projection of the verdict's inputs` |

## Gates

At `d73fb630` (exit codes, run after committing; the commit after it changes only this file):

| Gate | Exit |
|---|---|
| `worker` `npm test` (includes CR-T01 `cr-recon.test.mjs`: "verdict read at this tree", and `cr-traceability.test.mjs`) | 0 |
| `worker` `npm run typecheck` | 0 |
| `worker` `test:authoring:d1` · `test:classroom:d1` · `test:native-trial:d1` · `test:classroom-ops:d1` · `test:cr-publish:d1` · `test:cr-memory:d1` · `test:cr-skills:d1` · `test:cr-evidence:d1` | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 |
| `worker` `npm run validate-profiles` · `bash worker/scripts/cohort-harness/test/run.sh` | 0 · 0 |
| `e2e` `npm run test:cr-publish` · `npm run test:cr-evidence` (real Chromium, the PR CI job) | 0 · 0 |
| `e2e` `tsc --noEmit -p .` (not in CI) | 2, the same 24 errors with `origin/main`'s and this branch's versions of the two changed files, none in them |
| `python3 scripts/next-work.py --check` (`HYPEPROOF_HARNESS=~/.cache/hypeproof/harness`) | 0 |
| `python3 scripts/check-registry.py` | 0 |
| `hype-align` `align.py check --item cr-unblock` | 1: `refused: unknown work item: cr-unblock`. #1506 is not a ledger item |
| `hype-align` `align.py check --doc curriculum-runtime` | 1: `BROKEN cr-recon`, completion no longer holds (changed since recorded: the recon page, the requirements document, the frozen inputs). At `origin/main` the same check exits 1 with the requirements document alone. The record sweep re-records `cr-recon` |

Not run: the extension typecheck and smokes (no file under `extensions/` changed), the measurement, chalk and workflow jobs (untouched).

## Not run, limits

- The webview path ran with a synthetic `preview.type`. No shipped profile is a webview cohort, and this run did not force a live server to fail.
- REQ-D4 on the live path counts tabs. A product that closed and reopened its tab instead of reloading it would pass; only a second tab is caught (M5).
- `runCommand` narrows the palette race but does not close it. It checks that the palette is still open 150 ms after `fill`, then presses Enter; if the "AI와 작업" editor takes focus between that check and Enter, the palette closes, Enter lands in that editor, the command does not run and the caller's next step fails. No run after the change failed inside `runCommand`; the one that did (`variants-try1`) predates it.
- CR-T02's HTML generation specs and the rest of the switch-off inventory: `cr-e2e`.
- No completion is written here. `cr-recon` stays reopened until the record sweep re-records it: its pin on the requirements document had already changed, and this branch changes the page and the fixture it pins.
- The shell is the installed 0.1.51 copy; only the extension and webview are current.
- Follow-ups for the record sweep (#1507), which re-runs the CR in-app specs:
  - From this change: 24 of the 26 specs that use the changed fixture were not re-run against it (Part 1, last section). One found red is run with `origin/main`'s fixture and with this branch's before the product is blamed.
  - Pre-existing, not changed here: `paletteRows` (`e2e/curriculum-runtime/app-helpers.ts`) opens the palette until its input shows and then fills it outside the retry, the race `runCommand` had: it failed 1 of 3 runs with either fixture.
  - Pre-existing, not changed here: `app-layer.spec.ts`, "CR-T02 exception in-app": the last assertion reads the palette once right after the stored files are gone, while the App sets the context key without waiting. It failed once in 5 runs that reached it.
  - Pre-existing, not changed here: `cr-browser` lists `docs/testing/curriculum-runtime.md` in its `verification_inputs`, and `align.py record` pins every verification input as a whole file. Once `cr-browser` is recorded, the next clause added to that file's status line (each item adds one; this change added one before any completion pinned the file) reopens it.
