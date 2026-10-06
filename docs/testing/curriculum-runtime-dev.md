# Curriculum Runtime — trying it on the dev host

Status: active, 2026-10-01. Owner: jayleekr. One section per `cr-*` item, appended by the item that ships it. Row definitions: [curriculum-runtime.md](curriculum-runtime.md); run records: `curriculum-runtime-<date>-evidence.md`.

Every CR behaviour sits behind the switch `curriculum_runtime.enabled` on the cohort profile (CR-02). The Worker serves it only to an adult, workshop-tier cohort (`curriculumRuntimeAllowed`: not a minor cohort, audience lower age bound 18 or more), and the App mirrors it to the context key `hypeproof-chat.curriculumRuntimeEnabled`. No shipped profile turns it on.

## `cr-browser` — Experiment Browser (#1391)

**Flag:** `curriculum_runtime: { enabled: true }` on the profile, plus `browser_control.enabled` and `observation.format` (the validator refuses the switch without a recorder) and `input.image_paste` for the element crop.

**Fastest check (one command, in the background, scripted agent, no model key).** An app copy with this branch's extension injected (`e2e/README.md`, "Driving a different .app", or `node e2e/classroom/mac-devhost.mjs`), prepared once so it never takes focus:

```bash
bash scripts/prep-test-app.sh "<app copy>"     # once per copy: LSUIElement=1, ad-hoc re-sign
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts
```

`GATE=idle` starts the run only after 5 minutes without keyboard or mouse input with the screen **unlocked**, and stops it (exit 75, "retry later", not a failure) the moment you touch the Mac, so you can keep working and it waits for you to step away. The run itself is quiet: the window sits off-screen, is shown inactive and is never focusable, and the prepared copy never activates (`e2e/README.md`, "Quiet mode"). This config sets `HPS_QUIET_NO_HIDE=1` because a hidden app's integrated browser paints no frames; for the same reason the screen must stay unlocked (recon F7), so the default `GATE=lock` cannot run it. `HPS_QUIET=0` shows the window for debugging and takes focus. Never point `HPS_APP_PATH` at `/Applications/HypeProof Studio.app`.

**What runs while you work, and what waits.** No framework change is needed for either.

| Layer | Command | While you work |
|---|---|---|
| Unit, smoke, headless Chromium (CR-T03..T11 halves, `test:cr-browser`) | `cd extensions/hypeproof-chat && npm test`, `cd worker && npm test`, `cd e2e && npm run test:cr-browser` | Runs in the background. No window, no focus change |
| In-app Electron (this Playwright config) | `GATE=idle ... e2e-quiet.sh` above | Quiet (no focus, no Dock icon), but it **waits** until you have been idle for 5 minutes and **stops** when you come back, so it effectively runs while you are away |

It starts its own local Service (`e2e/curriculum-runtime/app-service.mjs`: the real Service router, the `canary-sdk-contract` profile with the switch set in that process only, a scripted agent as the model) and writes `e2e/test-results/cr-app/result.json`.

**By hand, in the dev app.** The local Service must answer on port 8787, so stop `scripts/dev-stack.sh`'s wrangler first, then:

```bash
STATE="$HOME/Library/Application Support/HypeProof Studio Development/cr-browser"
python3 scripts/studio-dev.py --state-dir "$STATE" --provider service prepare   # claims the state dir first
node --experimental-strip-types --experimental-sqlite e2e/curriculum-runtime/app-service.mjs 8787 "$STATE/local-participant-token.txt" on &
python3 scripts/studio-dev.py --state-dir "$STATE" --provider service run --service local
```

`--provider service` keeps the coach on the Service, where the scripted agent answers; the default `claude` provider would route it to a local CLI instead. This by-hand path was written from the scripts, not executed end to end; the Playwright run above is the executed one.

Copy `e2e/curriculum-runtime/fixtures/kiosk-practice/` into the workspace, open `index.html` and run "HypeProof: HTML 미리보기 (옆 패널)". The scripted agent acts only on messages that start with a scenario tag; anything else gets "[로컬 시험 응답] 받았어요."

| Step | What the student does | Expected (in student terms) |
|---|---|---|
| 1 | Sends `[cr:flow] 주문 시작부터 주문 완료까지 눌러보고 오류가 있으면 몇 번째 단계였는지 알려줘` | The preview gets an orange outline while each step runs and loses it after; the chat shows one tool line per step that goes from running to done; the answer is "다섯 단계를 모두 마쳤어요. 오류: 없음" |
| 2 | Sends `[cr:flow:console-step3] 다시 해봐` | The answer names the planted error once, at flow step 3 ("3단계 planted-step3-error"). The tool result itself says "단계 4": the browser counts the request's actions and the opening navigate is action 1 |
| 2a | Right after step 2, sends `[cr:again] 지금 화면 다시 보고 도움말 보기 눌러봐` (this request does not navigate) | The tool results list the planted error as "이전 요청 planted-step3-error…", never with a step number, and the answer reports "오류: 없음" |
| 3 | Sends `[cr:flow:disabled-step4] 다시 해봐` | "4단계에서 멈췄어요" |
| 4 | Runs "HypeProof: 화면에서 요소 골라 코치에게 묻기" and clicks "주문 시작" in the preview | A chip "함께 보낼 요소 <button> “주문 시작” · 소스 위치: index.html:23" with a crop; ✕ removes it and nothing of it is sent |
| 5 | Runs "HypeProof: 실험 브라우저 결과 기록 보기" | Each result is listed as "현재 버전 · 버전 1" (versions numbered per page in the order they were seen); after `index.html` changes the same results read "이전 버전". Picking one with a screenshot attaches that stored screenshot to the next message |
| 5a | In the same list, picks "저장된 화면·동작 기록 지우기" and confirms | "저장된 화면·동작 기록 N개를 지웠어요." The results stay listed; picking one now says "기록된 화면을 찾지 못했어요." |
| 6 | Restarts `app-service.mjs` with `off` and reloads the window | Neither CR command is in the palette and the coach is offered none of the five CR tools. If screens are still stored (skip 5a to see this), "HypeProof: 저장된 실험 브라우저 화면 지우기" is in the palette: it shows the count, asks ("내가 저장한 실험 브라우저 화면과 동작 기록 N개를 지울까요? 되돌릴 수 없어요."), and deletes them. It disappears once nothing is stored. Signed in as another student on the same computer, it is not there: each student sees and deletes only the screens they stored |

**Where the data is.** Two places. Browser results are `tool_result` events tagged `hps-browser-result/1` in the workspace's native observation batch (VS Code `workspaceState`, the `NativeObservationRecorder` batch), with the CR-10 keys `artifact_version`, `screenshot_digest` and `trace_digest`. The bytes those digests name are `blobs/` entries of the local measurement-core record under the app's `User/globalStorage/<extension>/local-review-v1/`, the directory the local review uses. Bytes are stored only when the turn has a recorder with room for the result's event, and are bounded at 64 MB of their own (oldest removed first, silently, never counted against the local review's 256 MB). Each stored blob also has an owner marker (`blob-owners/<owner>/<digest>`, the owner a digest of the signed-in account or cohort-local user, never the identity), so one student's count and delete never reach another student's screens on a shared PC; whether to show the delete command is read from the app's `globalState` (`hypeproof-chat.crBytesOwners`), not from disk. The student deletes them with the results command (step 5a) or, whatever the CR switch says, with "HypeProof: 저장된 실험 브라우저 화면 지우기" (step 6). Deleting a local-review task does not remove them today: no local-review observation names these digests (the local review imports only user and coach turns), so `deleteTask`'s byte removal is defence in depth for a future import of the native batch, not a path the student can use. The Service's `/__cr/state` shows what reached the scripted agent.

## `cr-verify` — AI Verify (#1392)

**Flag:** the same `curriculum_runtime: { enabled: true }` (with `browser_control.enabled` and an `observation.format` of `hps-observation/2`, which learning events need). Nothing else; no setting, environment variable or build flag.

**Fastest check (background, scripted agent, no model key).** The same prepared app copy as `cr-browser` with this branch's extension injected:

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts verify-app
```

It writes `e2e/test-results/cr-app/verify-result.json`. The unit and smoke halves run with `cd worker && npm test` and `cd extensions/hypeproof-chat && npm test` (`cr-verify.test.mjs`, `cr-verify.smoke.mjs`, `verify-panel.smoke.mjs`).

**By hand** (same setup as `cr-browser` above: `app-service.mjs` on 8787 with `on`, the kiosk fixture in the workspace, its preview open). The scripted agent answers a test run with one `verify_criterion` per criterion, choosing a plan by words in the criterion: "음료 고르기" (press 주문 시작), "주문이 완료" (the five-step order), "결제 완료" (the order, expecting text the fixture lacks), "오류" (the order, no errors), "흔들" (the order on the planted flaky page), "바깥" (a step to an external site).

| Step | What the student does | Expected (in student terms) |
|---|---|---|
| 1 | Runs "HypeProof: 내 제품 테스트하기" | A "내 제품 테스트" box opens in the chat: "이 버전은 아직 테스트하지 않았어요" |
| 2 | Removes the empty row and presses "테스트 시작" | "기대 조건은 1개에서 5개까지 적을 수 있어요." Nothing is sent |
| 3 | Sends `[cr:propose] 조건 하나 제안해 줘`, clicks the proposal, presses "테스트 시작" without "이대로 쓰기" | The row says "코치 제안 · 확인 필요"; the start is refused ("코치가 제안한 조건은 내가 확인해야 쓸 수 있어요…") |
| 4 | Types "주문 시작을 누르면 음료 고르기가 보인다", "주문하면 주문이 완료되었어요가 보인다", "주문하는 동안 오류가 없다" and presses "테스트 시작" | My sentence goes to the coach; "🧪 테스트 중" shows and the preview gets the orange outline while each step runs; then three "통과" rows and "검증됨 · 이 버전에서 기대 조건을 모두 통과했어요" |
| 5 | Presses "같은 조건으로 다시 테스트" | The same three "통과"; the coach is not asked again |
| 6 | Tests "주문하면 결제 완료가 보인다" | "실패 주문하면 결제 완료가 보인다", the state "통과하지 못한 조건이 있어요", a box to write what to fix |
| 7 | Writes "결제 완료 문구도 보이게 고쳐 주세요" and presses "고쳐 달라고 하기" | That sentence goes to the coach with the failed steps and evidence attached (not shown in the bubble) |
| 8 | Adds `<p>결제 완료</p>` after the done heading in `index.html` (what the coach would do), reopens the box | "파일이 바뀌었어요 · 다시 테스트해 주세요 (이전 결과는 남아 있어요)", the old result labelled "이전 버전의 테스트 결과" |
| 9 | Presses "같은 조건으로 다시 테스트" | Both rows "통과" and "검증됨" again; the fixed criterion is recorded as a re-test after the fix |
| 10 | Tests "흔들리는 화면에서도 주문이 완료된다", then re-tests | "결과가 매번 달라요" — never "통과" |
| 11 | Tests "바깥 사이트로 가도 주문이 된다" | "확인 안 됨" with "…범위 밖이라 거절했어요"; the browser never leaves the preview |
| 12 | Restarts `app-service.mjs` with `off` and reloads | "내 제품 테스트하기" is not in the palette; the coach is offered neither verify tool |

**Where the data is.** Everything is on the workspace's native observation batch (VS Code `workspaceState`, the `hps-observation/2` batch): `criterion_set` (the student's words), an `artifact` event tagged `hps-artifact-version/1` per tested version, the `verify_criterion` `tool_request` / `tool_result` pair (`hps-verify-result/1`: plan, steps, citations, verdict), and `test_observed` / `retest_confirmed` (actor `ai`) and `change_requested`. The report is recomputed from them each time the box opens. A stored screenshot of a verdict is a `blobs/` entry of the local record, as in `cr-browser`, deletable with the same command.

## `cr-publish` — Publish for User Test (#1393)

**Flag:** the same `curriculum_runtime: { enabled: true }`. The Service also needs `HPS_TEST_ORIGIN`, where published test versions are served: unset (the default) means no test can be started and no link can be made. Nothing else.

**Fastest check (background, no app, no phone).** Real Chromium as a 390 px phone against the real Service router:

```bash
cd worker && node --experimental-strip-types --experimental-sqlite test/cr-publish.test.mjs    # Service + App session, SQLite
cd worker && npm run test:cr-publish:d1                                                         # the same on local workerd D1
cd e2e && npm run test:cr-publish                                                                # the phone checks in Chromium
```

On local workerd D1 (`--d1`) every query is a new loopback TCP connection, and macOS keeps closed ones in TIME_WAIT for a while out of a 16,384-port range. The `--d1` run therefore opens 60 visits in the classroom-scale check instead of the SQLite run's 500 (the per-visit R2 cost is still compared first against last). If a second `--d1` run right after another fails with `EADDRNOTAVAIL` or `fetch failed`, wait about a minute and run it again; that is the Mac, not the change.

**In the app (background, scripted agent).** The same prepared copy as `cr-browser`:

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts publish-app
```

It writes `e2e/test-results/cr-app/publish-result.json`. Its local Service is `app-service.mjs` with a fourth argument `publish`: SQLite D1, an in-memory R2 and `HPS_TEST_ORIGIN=http://{project}.test.invalid:<port>`.

**By hand, with a phone.** Same setup as `cr-browser` above, but start the Service with `publish` and a public test origin from ngrok (a dev-only shared origin: every project shares it, which the Service refuses in production):

```bash
/opt/homebrew/bin/ngrok http 8787                       # note the https://….ngrok-free.app address
HPS_TEST_ORIGIN="https://<that host>" node --experimental-strip-types --experimental-sqlite e2e/curriculum-runtime/app-service.mjs 8787 "$STATE/local-participant-token.txt" on publish &
python3 scripts/studio-dev.py --state-dir "$STATE" --provider service run --service local
```

On this shared origin one part of CR-11 does not hold: "another project's published test version is refused". Every project's links are served from the one ngrok host, and the App allows the Experiment Browser by origin, so the agent and the test runner may act on another team's `/l/<link>/` there too. Check that case on the dedicated `http://{project}.test.invalid:<port>` origin (the Playwright runs above), never on the ngrok path.

With `scripts/dev-stack.sh` (wrangler dev) instead: apply the migration to the local D1 once (`cd worker && npx wrangler d1 execute hypeproof-studio --local --file=migrations/0032-curriculum-runtime-publish.sql`), put `HPS_TEST_ORIGIN=https://<ngrok host>` in `worker/.dev.vars`, and use an adult workshop cohort whose profile has the switch on locally (no shipped profile does, and the kids default never gets it). ngrok's free plan shows its own "You are about to visit" page on the phone's first open; that page is ngrok's, not a HypeProof login. These by-hand paths were written from the scripts, not executed end to end; the Playwright and Chromium runs above are the executed ones.

| Step | What the student does | Expected (in student terms) |
|---|---|---|
| 1 | Opens `index.html` of the kiosk fixture in the preview, runs "HypeProof: 사용자 테스트용으로 공개하기" | A "사용자 테스트용으로 공개" box: "검증 안 됨 · 이 버전은 아직 테스트하지 않았어요", "공개할 버전 7187b0db · 파일 3개", the file list (no `.env`, no file the page does not use) |
| 2 | Runs "내 제품 테스트하기" with "주문 시작을 누르면 음료 고르기가 보인다" until it passes (the first run on a fresh preview may say "확인 안 됨"; "같은 조건으로 다시 테스트"), then reopens the publish box | "검증됨 · 이 버전은 기대 조건을 모두 통과했어요" |
| 3 | Writes a hypothesis, a question, one success criterion, "학교 게시판" as the channel; tries "공개하고 테스트 시작" without a link period | The button stays off until a period (1·3·7·14일) is chosen; nothing is preselected |
| 4 | Chooses 3일 and presses "공개하고 테스트 시작" | "공개했어요: <주소>"; under the experiment, the link with its QR and "링크 끄기" |
| 5 | Scans the QR with a phone | The kiosk opens without any HypeProof login, sized for the phone |
| 6 | Adds `const k = "AIza…"` (any Gemini-shaped key) to `app.js` and publishes again | "app.js: 비밀값처럼 보이는 내용이 있어 공개하지 않았어요" with "app.js <그 줄>번째 줄 (gemini_key)"; nothing is uploaded |
| 7 | Removes the key, changes the heading, opens the box | "검증 안 됨 · 파일이 바뀐 뒤 아직 다시 테스트하지 않았어요"; the running experiment says "이전 버전 · 이 실험은 계속 이 버전을 보여 줘요" and its link still shows the old heading |
| 8 | Makes another link for the same experiment labelled "1:1 메시지", opens both links once on the phone, then reloads the "학교 게시판" page and goes back to its first page | "링크를 연 횟수: 학교 게시판 1 · 1:1 메시지 1 · 채널 이름 없음 0 · 알 수 없음 0" and "연 횟수예요. 원한다는 뜻은 아니에요." A reload or a return in the same tab is the same visit and does not add one; pasting the link into a chat app that only shows a preview does not add one either |
| 9 | Presses "링크 끄기" on "학교 게시판" and reloads it on the phone | The phone shows the browser's own error page (410), no kiosk; the "1:1 메시지" link still opens |
| 10 | Restarts the Service with `off` and reloads the window | The command is not in the palette; the share link answers like an unknown address |

**Where the data is.** On the Service: the D1 tables `cr_projects`, `cr_hypotheses`, `cr_product_versions`, `cr_experiments` and `cr_test_links` (one `hps-venture/1` document per row); the published files as R2 objects `test-versions/<digest>/<path>` of `HPS_TRACES`; each participant session as the per-session key `curriculum/<cohort>/<project>/sessions/published/<session id>` of the measurement-core record on the same bucket, with its `attribution` (project, experiment, product version, link, channel), written once per visit when the page's script opens it (`POST /l/<link>/__hp/session`); the per-link count in `cr_test_links.sessions_opened`, which the panel's counts read. In the App: the Project id and its test origin per signed-in person in `workspaceState` (`hypeproof-chat.crProjects`). With the in-memory fixtures (`app-service.mjs publish`, the tests), all of it is gone when the process ends.

## `cr-evidence` — Evidence capture (#1394)

**Flag:** the same `curriculum_runtime: { enabled: true }` and `HPS_TEST_ORIGIN` as `cr-publish`. Nothing else. The cohort's admin controls (`/admin/curriculum/cohorts/<cohort>/controls`) start at the defaults: data deleted 30 days after an experiment ended (its last link ended, or its last note when it never had a link), raw-input declarations allowed, no link expiry default, students may delete their test data, no team ceilings.

**Fastest check (background, no app, no phone).**

```bash
cd worker && node --experimental-strip-types --experimental-sqlite test/cr-evidence.test.mjs    # Service + App session, SQLite
cd worker && npm run test:cr-evidence:d1                                                         # the same on local workerd D1 and R2
cd e2e && npm run test:cr-evidence                                                                # a participant in Chromium as a 390 px phone
```

**In the app (background, scripted participants).** The same prepared copy as `cr-browser`, with this branch's extension and webview injected:

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts evidence-app
```

It publishes the kiosk fixture from the panel, opens three participant visits through the published runtime (the same requests the page's script makes), and writes `e2e/test-results/cr-app/evidence-result.json`.

**By hand, with a phone.** Set up `cr-publish`'s ngrok path above, publish, then:

| Step | What the student does | Expected (in student terms) |
|---|---|---|
| 1 | Publishes the kiosk with "같은 사람이 다시 와서 쓰는지 볼래요" ticked and `주문` in "기록할 과제 이름", opens the QR on a phone and orders a drink | Nothing visible changes on the phone; the kiosk works as before. Task names written in that box are recorded by name; any other task start or finish is recorded without its name, and the panel says how many ("기록할 과제 이름에 없는 이름 N개는 이름 없이 기록했어요") |
| 2 | Runs "HypeProof: 실험 증거 보기" | A "실험 증거" box: the experiment, "참가 세션 1개 · 메모 0개", "다시 온 기기: 아직 없음" |
| 3 | Opens the link again on the same phone the next day (or a minute later), then reopens the box | "다시 온 기기: <6글자> 1번 (간격 …일)" and "기기 기준이에요. 사람 수가 아니에요." An experiment published without the tick says "측정하지 않음", never 0 |
| 4 | Opens "기록 남기기", picks "인터뷰 메모", writes what the participant said, fills 누가 · 언제 · 어떤 상황, and tries to save without choosing "실제로 있었던 일" | The save button stays off until a source state is chosen; nothing is chosen for them |
| 5 | Chooses "실제로 있었던 일" and saves | "기록을 남겼어요."; the note appears under "원래 기록 보기" exactly as typed |
| 6 | Presses "기록에서 초안 만들기" | Under "관찰한 것": sentences like "'주문'을(를) 시작한 세션 2개 중 2개가 끝까지 마쳤어요." with "근거 2개" |
| 7 | Clicks that sentence | It opens the sessions it counts: "참가 세션 …", the time, "화면 · 누름", "주문 마침" |
| 8 | Presses "받아들이기" on a sentence, then "버리기" on another | The sentences read "받아들임" and "버림"; the original records under "원래 기록 보기" are unchanged |
| 9 | Presses "이 세션 지우기" on one session and confirms | A modal asks first; then "지웠어요. 지운 기록의 영수증이 남았어요."; the session is gone and so is any draft that counted it |
| 10 | Restarts the Service with `off` and reloads the window | "실험 증거 보기" is not in the palette; the events address of the link answers like an unknown address |

**Where the data is.** On the Service, in the same measurement-core record as `cr-publish`'s sessions (`curriculum/<cohort>/<project>/` on `HPS_TRACES`): participant events under `observations/published/<experiment>/<session>/e<seq>`, the student's notes under `observations/notes/<experiment>/<experiment>/note-…`, drafts under `drafts/<experiment>/<draft>@<revision>`, and tombstones of deleted sessions and experiments under `deleted/`. The participant pseudonym is on the session key. D1: `cr_link_rates` (one rate window per link; no events), `cr_cohort_controls` (the admin's controls), `cr_experiment_records` (one last-record time per experiment, for decision 6's retention clock; no evidence), and the Experiment row's `data_deleted_at` once its data was deleted. In the App: nothing beyond `cr-publish`'s remembered Project. With the in-memory fixtures, all of it is gone when the process ends. With `scripts/dev-stack.sh`, apply `migrations/0033-curriculum-runtime-evidence.sql` to the local D1 after 0032. These by-hand rows were written from the code and the executed runs above, not executed on a real phone.

## `cr-memory` — Venture Memory (#1395)

**Flag:** the same `curriculum_runtime: { enabled: true }` as `cr-publish`. Nothing else. With `scripts/dev-stack.sh`, apply `migrations/0034-curriculum-runtime-memory.sql` to the local D1 after 0032 and 0033.

**Fastest check (background, no app).**

```bash
cd worker && node --experimental-strip-types --experimental-sqlite --no-warnings test/cr-memory.test.mjs   # Service, SQLite
cd worker && npm run test:cr-memory:d1                                                                    # the same on local workerd D1 and R2
cd extensions/hypeproof-chat && node --experimental-strip-types test/cr-memory.smoke.mjs                    # App session, panel render
```

**In the app (background).** The same prepared copy as `cr-browser`, with this branch's extension and webview injected:

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts memory-app
```

It publishes the kiosk fixture, records a decision in the panel, closes the app, deletes the workspace's stored state (the chat history and the remembered Project with it), reopens and compares; it writes `e2e/test-results/cr-app/memory-result.json`.

**By hand.** After `cr-evidence`'s steps 1–8 (a published kiosk, a note, an accepted draft):

| Step | What the student does | Expected (in student terms) |
|---|---|---|
| 1 | Runs "HypeProof: 프로젝트 기억 보기" | A "프로젝트 기억" box: the project title, "아직 문제를 적지 않았어요.", the hypothesis with "아직 확인 중", the experiment "1주차 · …", and "확인한 것과 가정" with "확인한 것 N개 · 해석 N개 · 가정 N개" (the heading was the Week 5 question until `cr-skills`, CR-45) |
| 2 | Opens "결정 기록하기", writes "옵션 선택을 한 단계로 줄인다", ticks one sentence under 근거 and slides 2 and 3, saves | "결정을 기록했어요."; under 결정: "팀 결정: 옵션 선택을 한 단계로 줄인다 · 슬라이드 2, 3". A decision saved with no 근거 ticked reads "근거가 연결되지 않았어요" and is still shown |
| 3 | Publishes v1 of the kiosk, then picks v0 and v1 under 버전 and presses "비교하기" | The files that changed ("index.html · 바뀜"); with no decision linked to v1: "이 버전을 만든 결정이 기록되지 않았어요." |
| 4 | Closes the app, clears the chat ("대화 지우기"), reopens and runs the command again | The same hypotheses, experiments, decisions and versions as before |
| 5 | Restarts the Service with `off` and reloads the window | "프로젝트 기억 보기" is not in the palette; every memory address answers like an unknown address |

Writes with no panel yet (cr-skills and cr-review call them; by hand with the student token `T` and the Service `S=http://127.0.0.1:8787/v1/curriculum`):

```bash
curl -s -X POST "$S/projects/<prj>/hypotheses/<hyp>/revisions" -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"revision":1,"statement":"옵션이 한 단계면 처음 쓰는 사람도 혼자 주문할 수 있다","status":"revised","decision_id":"<dec>"}'
curl -s -X POST "$S/projects/<prj>/stakeholders" -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"label":"학교 매점 손님","roles":[{"role":"user","evidence_refs":["ev:<exp>/<draft>/<item>"],"basis":"observed"},{"role":"payer","evidence_refs":[]}]}'
curl -s -X POST "$S/experiments/<exp>/drafts/<draft>/review" -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"revision":<n>,"actions":[{"item":"<assumption item>","action":"promote","source_refs":["session:<ps-…>"]}],"reason":"참가 세션에서 확인"}'
```

After the first: under 가설, "처음엔 "…"라고 믿었어요. "…"를 보고 "…"라고 믿게 됐어요. 그래서 "…"로 바꿨어요." A revision with no decision reads "왜 바뀌었는지는 기록되지 않았어요." After the second: "누구의 일인가 · 학교 매점 손님 · 쓰는 사람, 돈 내는 사람 (가정) · 쓰는 사람이 돈도 내요". After the third: the assumption moves to 확인한 것 with "처음엔 가정이었는데 나중에 확인했어요", and its earlier revision opens under it. The promotion has no button in the panel yet; a `note:` reference to a record marked 연습 or 본인이 말한 것 is refused (`promotion_source_not_real`). Under "지금까지", every entry opens to the record it names (the hypothesis revision, the experiment, the version's files, the evidence item's revisions, the decision with what it rests on, the slide revision). A director's issuer token reads the same box's data at `GET $S/projects/<prj>/memory` and lists the teams at `GET $S/director/projects`.

**Where the data is.** D1: the Hypothesis and Experiment rows of `cr-publish`, extended in place (`revisions`, `stakeholder_id` in their `doc`), and migration 0034's `cr_decisions`, `cr_stakeholders`, `cr_metrics` and `cr_deck_slides` (one row per slide revision). Evidence items are NOT copied: they are the items of the drafts in the measurement-core record (`drafts/<experiment>/<draft>@<revision>` on `HPS_TRACES`), named `ev:<experiment>/<draft>/<item>`. The register, timeline, diff, belief changes and metric values are computed on every read. In the App: nothing beyond `cr-publish`'s remembered Project. These by-hand rows were written from the code and the executed runs, not executed by hand.

## `cr-skills` — Curriculum skills (#1396)

**Flag:** the same `curriculum_runtime: { enabled: true }`. No migration: skills write evidence drafts through `cr-evidence`'s store and read Venture Memory (0032–0034 applied).

**Fastest check (background, no app).**

```bash
cd worker && node --experimental-strip-types --experimental-sqlite --no-warnings test/cr-skills.test.mjs   # Service, SQLite
cd worker && npm run test:cr-skills:d1                                                                    # the same on local workerd D1 and R2
cd extensions/hypeproof-chat && node --experimental-strip-types test/cr-skills.smoke.mjs                    # App session, SDK settings, panel render
```

**In the app (background).** The same prepared copy, with this branch's extension and webview injected. The scripted model in `app-service.mjs` answers a skill prompt from the prompt alone:

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts skills-app
```

It writes `e2e/test-results/cr-app/skills-result.json` (the skill and capability headers the App sent and the Service answered with).

**By hand.** After `cr-memory`'s steps 1–2 (a published kiosk, an accepted draft, a team decision on slides 2–3). A real model answers through the coach route, so a class session must be open (`/console`), and a skill's answer may be refused: that is the gate working, not a crash.

| Step | What the student does | Expected (in student terms) |
|---|---|---|
| 1 | Runs "HypeProof: 커리큘럼 스킬" | A "커리큘럼 스킬" box: "N주차 질문: …" (the week the Service runs skills for, the newest running experiment's, read from the curriculum data), and seven choices: 실험 설계, 증거 정리, 제품 수정 계획, 발표 슬라이드 수정안, 인터뷰 준비, 비판적 검토, 데모 연습 |
| 2 | Picks "실험 설계", leaves the box empty, presses "실행하기" | "AI의 답이 규칙을 지켰어요."; sections 확인할 가정 (one of the open assumptions), 가설, 방법, 성공 기준 (each with a number); "제안이에요. 저장한 것은 없어요." |
| 3 | Picks "증거 정리", chooses the experiment, presses "실행하기" | Sections 본 것 / 해석 / 가정 / 다음 실험, each line with "(근거 N개)"; "실험 증거에 AI 초안으로 저장했어요. 하나씩 읽고 받아들이거나 고쳐 주세요." The "실험 증거" box shows a new draft whose items wait for review |
| 4 | Picks "발표 슬라이드 수정안", chooses the decision "… (슬라이드 2, 3)" | Patches for slides 2 and 3 only, each with "근거 N개"; nothing stored |
| 5 | Picks "인터뷰 준비", writes "주문이 어려운 이유", pastes a few lines of notes in "인터뷰 메모" | Open questions with their purpose; "들으면서 적을 칸" are short labels; "메모 정리 (적은 그대로)" puts each quote under one of those labels and quotes only words that are in the pasted notes |
| 6 | Picks "비판적 검토" | 근거가 약한 주장, 아직 시험하지 않은 주장 (every slide no experiment confirmed: one resting only on an assumption or an unreviewed AI item counts as not tested), 안전, and, because the kiosk calls `hypeproof.ai`, "AI 실패 대비" with three lines |
| 7 | Picks "데모 연습" | "데모 순서" lists each step as "1. <하는 일> — <보여 줄 화면>" with the claims under it as "주장: …", each the exact sentence of a reviewed evidence item (only the ending may change, "멈췄다" → "멈췄어요"); "예상 질문" answers are those sentences, or "아직 확인하지 못했어요" |
| 8 | Any refused answer | "AI의 답이 규칙을 지키지 않아 아무것도 저장하지 않았어요." and one Korean line per problem (for example "본 것(관찰)에 어느 기록에서 봤는지가 빠졌어요."); the rule code (`observation_without_source_refs`) is only on the line's `data-code` attribute, for a teacher or a test; nothing new in "실험 증거" |
| 9 | Restarts the Service with `off` and reloads the window | "커리큘럼 스킬" is not in the palette; the three skill addresses answer like an unknown address |

**Where the data is.** The skills, their contracts and the v5 curriculum are bundled files in `worker/src/skills/curriculum/` (nothing in the workspace is read). Only the Evidence skill writes: one `hps-evidence-draft/1` revision by `ai`, tagged `skill: "evidence@1.0.0"`, at `drafts/<experiment>/<draft>@1` on `HPS_TRACES`. Every other skill's result is shown and stored nowhere. A skill's model request is a `/v1/chat/completions` call with `x-hps-skill` and `x-hps-capability` (and, on a lesson seat, the profile's `x-hps-lesson-binding`) and no `model`, made once with no retry or model substitution; the Service answers with the same two headers and `x-hps-model`, and logs a `skill_request` line. Writing them onto the usage ledgers is `cr-gateway`'s (CR-34). These by-hand rows were written from the code and the executed runs, not executed by hand.

## `cr-review` — Weekly Review (#1398)

**Flag:** the same `curriculum_runtime: { enabled: true }`. With `scripts/dev-stack.sh`, apply `migrations/0036-chalk-feedback.sql` through `migrations/0038-curriculum-runtime-review.sql` to the local D1 in order, after 0032–0034 (0036 and 0037 are Chalk's; applying the whole `migrations/` directory in order does the same). The director needs an issuer token whose scope covers the cohort and the profile; nothing else is new.

**Fastest check (background, no app).**

```bash
cd worker && node --experimental-strip-types --experimental-sqlite --no-warnings test/cr-review.test.mjs   # Service and App session, SQLite
cd worker && npm run test:cr-review:d1                                                                    # the same on local workerd D1 and R2
cd extensions/hypeproof-chat && node --experimental-strip-types test/cr-review.smoke.mjs                    # App sessions, timing verdict, panel render
```

The first two include CR-T58 against the recorded provider: the real provider's ten answers to the Week 2 pack, replayed at their recorded times. The replay holds only while the product sends the prompt those answers were given: when the Experiment skill's text, the prompt builder or what its context carries changes, the case fails with "the Experiment skill's prompt is not the one recorded" and where the two first differ. Then measure the real provider again and refresh the recording (ten real Experiment-skill calls through the coach route, a few cents). The key is read from `worker/.dev.vars` into this one command's environment, so it is never typed and never lands in shell history:

```bash
cd worker && ANTHROPIC_API_KEY="$(sed -n 's/^ANTHROPIC_API_KEY=//p' .dev.vars)" node --experimental-strip-types --experimental-sqlite --no-warnings test/cr-review.test.mjs --record-provider --d1
```

It prints each run's times ("provider … ms · total … ms + commit … ms · pass · accepted") and writes `worker/test/fixtures/cr-review/provider-recording.json` only when all ten answered, with the commit checked out and whether the tree differed from it (`source.head`, `source.dirty`, read before the first provider call). The ten runs of 2026-10-06 took 12.7 s to 14.7 s each ([run record](curriculum-runtime-2026-10-06-review-provider.md)).

**In the app (background).** The same prepared copy, with this branch's extension and webview injected. `app-service.mjs` also writes a director's issuer token next to the learner's (`<token-file>.issuer`):

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts review-app
```

It prepares the pack in the learner's App, writes the director's decision and next experiment from a second App signed in with the issuer token only, reopens the learner's App with its workspace state deleted, and writes `e2e/test-results/cr-app/review-result.json`.

**By hand.** After `cr-memory`'s steps 1–2 (a published kiosk, an accepted draft, a team decision on slides 2–3). The AI's part is the Experiment skill through the coach route, so a class session must be open (`/console`) for the student's App; opening a pack never needs one.

| Step | Who and what | Expected (in student and director terms) |
|---|---|---|
| 1 | The student runs "HypeProof: 주간 리뷰" (also the calendar icon on the chat panel) | A "주간 리뷰" box: "N주차 · 아직 준비하지 않았어요" (N is the week of the newest experiment the team ran) and the button "주간 리뷰 준비하기" |
| 2 | Presses "주간 리뷰 준비하기" | "주간 리뷰를 준비했어요." and "준비 시간 N초 (AI 응답 M초)"; ten sections in order: "N주차 가설", "N주차에 한 실험", "관찰한 것", "해석", "제품·버전 변화", "지표", "바뀌는 발표 슬라이드" (slides 2 and 3 with the team decision, and "아직 제안된 슬라이드 수정이 없어요."), "아직 확인 안 된 가정", "디렉터와 정할 것", "다음 실험 제안 (AI)" with "AI가 기록을 보고 만든 제안이에요. 다음 실험은 디렉터와 팀이 정해요." An empty section says why in words ("정한 지표가 없어요."). Each line has "근거 N개", which opens the records it rests on |
| 3 | Presses it again with nothing changed | "바뀐 기록이 없어서 다시 만들지 않았어요. 지금 리뷰가 최신이에요."; no AI call |
| 4 | Accepts one more observation in "실험 증거", then runs "주간 리뷰" again | "준비한 뒤로 바뀐 기록이 있어요"; only the sections that read it say "준비한 뒤로 바뀌었어요" (관찰한 것, 디렉터와 정할 것, 다음 실험 제안). Preparing again remakes those three and asks the AI once |
| 5 | The director pastes the issuer token with "Chalk: 강사 토큰 입력", then runs "HypeProof: 주간 리뷰 (디렉터)" | "주간 리뷰 · 디렉터": one line per team of the class, "<팀> · N주차 · 최신이에요 / 준비한 뒤로 바뀐 기록이 있어요 / 아직 준비하지 않았어요". No team of another class. Opening is instant: no AI call |
| 6 | Opens the team, writes "옵션 선택을 한 단계로 줄인다" under 결정, ticks one sentence under "이 결정의 근거", slide 2, keeps "다음 실험도 함께 기록하기", edits the question, method and criteria the AI suggested, presses "결정 기록하기" | Until the Service answers, "결정을 기록하고 있어요…" stands where the button was. Then "결정과 다음 실험을 프로젝트 기억에 기록했어요."; under the pack: "디렉터 결정: 옵션 선택을 한 단계로 줄인다 · 슬라이드 2" and "다음 실험 초안 (N+1주차): …". Pressing again with the form unchanged: "이미 기록된 결정이에요. 다시 저장하지 않았어요." Changing the evidence, the slides or the next experiment and pressing again records a second decision |
| 7 | The student closes the app, clears the chat, reopens and runs "HypeProof: 프로젝트 기억 보기" | Under 결정: "디렉터 결정: 옵션 선택을 한 단계로 줄인다"; under 실험: the new one with "· 다음 실험 초안" |
| 8 | Restarts the Service with `off` and reloads the window | Neither "주간 리뷰" command is in the palette, with either token stored; the five review addresses answer like an unknown address |

The director may not cite a sentence the pack does not show, an AI draft the team has not reviewed, or a pack revision older than the one on screen: "고른 근거 중에 이 리뷰에 없는 것이 있어요. 새로 불러온 뒤 다시 골라 주세요." and the matching lines. A student's token cannot reach the director's write at all.

**Where the data is.** D1: migration 0038's `cr_weekly_reviews`, one row per pack revision (`project_id`, `week`, `revision`, the `hps-weekly-review/1` document with each section's digest, the timing the App measured up to sending the commit plus the Service's own commit time `commit_ms`, and who prepared it). The pack quotes stored statements and names its sources; it copies no evidence item. The director's decision is a `cr_decisions` row with `actor: "director"` and `review: {week, revision}`; the next experiment is a `cr_experiments` row with `status: "draft"` and `drafted_from`; a new hypothesis written with it is a `cr_hypotheses` row whose first revision is by `director:<id>`. Deleting a participant session or an experiment's data deletes the Project's packs too. In the App: nothing stored; the director's command follows its own context key, `hypeproof-chat.curriculumRuntimeDirector`. These by-hand rows were written from the code and the executed runs, not executed by hand.

## `cr-e2e` — the PRD §14 loop, Week 1 → Week 2 (#1400)

**Flag:** the same `curriculum_runtime: { enabled: true }`. The kit's Service sets it in its own process; no shipped profile turns it on.

**One command (the dev kit).** From the checkout, with worker and extension dependencies installed (`npm ci` in `worker/`, `extensions/hypeproof-chat/` and its `webview-ui/`) and port 8787 free (stop `scripts/dev-stack.sh`'s wrangler first):

```bash
bash scripts/cr-dev-kit.sh --fresh            # this Mac only: a published link opens in Chrome at http://prj-….localhost:8787
bash scripts/cr-dev-kit.sh --fresh --phone    # + an ngrok tunnel: a phone on mobile data opens the published link (step 7)
```

It starts, in order: (with `--phone`) `ngrok http 127.0.0.1:8787 --inspect=false` and reads the tunnel's https address from ngrok's output, keeping nothing else of it (see "Where the data is"); the local Service, `HPS_CR_CONTROL=0 e2e/curriculum-runtime/app-service.mjs 8787 … on publish` (the real Service router, the CR switch on for an adult workshop profile, SQLite D1 and an in-memory R2, its test control routes `/__cr/…` off, `HPS_TEST_ORIGIN` set to the tunnel or to `http://{project}.localhost:8787`); then the isolated development app, `scripts/studio-dev.py --provider service run --service local --inmemory-secrets` (built from this checkout, launched with `--use-inmemory-secretstorage`, so it never asks for the login keychain), with the kiosk-practice fixture in its workspace. It prints where everything is and waits; Ctrl-C stops the Service and the tunnel, and the app keeps running until you quit it. `--dry-run` prints what would start, `--no-app` starts the Service (and tunnel) only.

**Start the checklist with `--fresh`.** The Service starts empty every time, but the workspace and the app's stored browser and verification results stay from the last run, so without `--fresh` step 1 opens the page edited last time (not v0 `7187b0db`) and step 4 can read v0′ as already verified. `--fresh` puts the kiosk back as handed out and starts the app with no stored results; the previous workspace and app state are kept once, as `workspace.previous` and `user-data.previous`. It refuses while the development app of that state directory is running: quit it first.

**State directory.** One per checkout: `~/Library/Application Support/HypeProof Studio Development/cr-dev-kit-<id>`, where `<id>` is the first 12 hex digits of the SHA-256 of the checkout's path (the same rule `studio-dev.py` uses for its own default), because `studio-dev.py` binds a state directory to the checkout that first used it. `--state-dir` chooses another. The student's token is `local-participant-token.txt` there (the app reads it at every launch) and the director's issuer token is next to it (`….issuer`, pasted with "Chalk: 강사 토큰 입력").

The coach is scripted unless `--real-model`: it answers only the tagged requests below, and anything else with "[로컬 시험 응답] 받았어요.". `--real-model` lets the Service's own calls reach Anthropic with `ANTHROPIC_API_KEY` from `worker/.dev.vars`, read into the Service process only (never printed); it spends credit, and the coach is then asked in your own words instead of the tags. Everything the Service stored is in memory and gone when it stops. ngrok needs an account once (`ngrok config add-authtoken <token>`); its free plan shows its own notice page on a phone's first open, which is ngrok's, not a HypeProof login.

**What the tunnel exposes.** Only the published runtime (`/l/…`). Every request passes `e2e/curriculum-runtime/service-gate.mjs` before the Service router sees it: the check runs on the path the router will route (a dot segment, an encoded dot, slash or backslash, or a path that parsing would change is refused), and only a loopback Host reaches the Service's API; any other Host, a port-suffixed or upper-case form of the tunnel's included, reaches `/l/…` only. The test control routes (`/__cr/…`) are off in the kit's Service, so the gate refuses them on this Mac too, and the kit checks that at every start. In the specs' Service they answer only a loopback request that no browser made (no `Origin`, `Referer` or `Sec-Fetch-*` header) and take POST for anything they change, so a web page open on this Mac cannot flip the switch or wipe a run. With `--phone` and with `--real-model` the Service signs tokens with a secret made for that run, not the test harness's constant one. Before it prints the tunnel's address, the kit checks this itself: nine requests sent on this Mac as the tunnel delivers them (`/v1/health`, `/v1/profile`, `/__cr/state`, `/admin/cohorts`, `/l/%2e%2e/v1/profile`, `/l/../v1/profile`, `/l/x/..%2f..%2fv1/profile`, `Host: <tunnel>:443` and the upper-case Host) must be refused by the gate, five through the tunnel itself must be refused or never delivered, `/v1/health` must answer on this Mac and the published runtime must answer through the tunnel. If any of that fails it stops, and the tunnel and the Service stop with it. The Service needs the tunnel's address when it starts, so the tunnel is already open, through the same gate, for the few seconds the check takes: the check holds back the address, not the tunnel.

`--real-model` and the app launch were written from the scripts and not executed by an agent: the app launch takes the screen, and a real model spends credit. The `--no-app` paths ran on 2026-10-06 against a scratch state directory: `--fresh` reset an edited workspace (`d1779a7d` without `--fresh`, `7187b0db` with it) and refused while a process held that state directory's `user-data`; a published link opened at `http://prj-….localhost:8787` and, with `--phone`, through the tunnel; with a planted gate leak of `/v1/health` the tunnel check stopped the kit on both halves and nothing was left running. They ran again after review round 2, with ngrok's log kept nowhere and its inspector off, and the control routes off ([run record](curriculum-runtime-2026-10-06-e2e.md#the-dev-kit-and-its-parts)).

**Fastest check (background, the scripted loop in the app).** The same prepared app copy as `cr-browser`, with this branch's extension and webview injected:

```bash
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts loop-app      # §14, CR-T66 scripted run + its planted break
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts timing-app    # CR-T55, CR-T56 (30 samples each)
GATE=idle HPS_APP_PATH="<app copy>" bash scripts/e2e-quiet.sh npx playwright test -c curriculum-runtime/playwright.config.ts switch-app    # CR-T02, every item's inventory with the switch off and on
```

They write `e2e/test-results/cr-app/{loop,timing,switch}-result.json`; the loop prints one line per step with the record it read (`§14 step N PASS · read … · record …`). Steps 7–8 there are Chromium on this Mac as a 390 px phone, not a phone. The scripted loop ends with step 13 and step 15 PARTIAL (below) and fails on any other PARTIAL, such as step 5 needing a re-test. `switch-app`'s Worker-route walk launches no app and runs without the idle gate, but it starts the local Service on port 18931 like every run above. On a Mac where another run may hold that port (one of the commands above, or another lane's in-app run), give it a free one: `HPS_CR_APP_PORT=18981 npx playwright test -c curriculum-runtime/playwright.config.ts switch-app -g "Worker routes"`.

**The §14 checklist, by hand with the kit.** Start the kit with `--fresh`. One Week 1 → Week 2 loop in order; each step uses what the step before it left. With the scripted coach, send the tagged messages exactly as written; with `--real-model`, ask in your own words.

| Step | What the student (or the participant) does | Expected (in student terms) | Where the record is |
|---|---|---|---|
| 1 | Opens `index.html` in the workspace and runs "HypeProof: HTML 미리보기 (옆 패널)" | The kiosk "어르신도 쉬운 키오스크" opens beside; "HypeProof: 사용자 테스트용으로 공개하기" shows "검증 안 됨 · 이 버전은 아직 테스트하지 않았어요" and "공개할 버전 7187b0db · 파일 3개" (v0) | the App's version of the open page |
| 2 | Sends `[cr:observe] 지금 미리보기 화면을 봐 줘` | The preview gets the orange outline while the step runs; "[로컬 시험 응답] 지금 화면을 봤어요."; "HypeProof: 실험 브라우저 결과 기록 보기" lists the result as "현재 버전" | the browser result on the workspace's observation batch (`cr-browser`) |
| 3 | Runs "HypeProof: 화면에서 요소 골라 코치에게 묻기", clicks "주문 시작" in the preview, then sends `[cr:edit] 이 버튼을 어르신도 잘 보이게 더 크게 해 줘` | A chip "함께 보낼 요소 <button> “주문 시작” · 소스 위치: index.html:23" with a crop; then "[로컬 시험 응답] 고른 요소를 더 크게 고쳤어요." and the button is bigger. The publish box now says "공개할 버전 2ee31cbe" (v0′) | the edited `index.html`; the pick on the turn's record |
| 4 | Runs "HypeProof: 내 제품 테스트하기" and types three criteria ("조건 더하기" for each): "주문 시작을 누르면 음료 고르기가 보인다", "주문하면 주문이 완료되었어요가 보인다", "주문하는 동안 오류가 없다"; presses "테스트 시작" | "이 버전은 아직 테스트하지 않았어요" before the start; no row says "코치 제안" | `criterion_set` events (`cr-verify`) |
| 5 | Waits for the run | "🧪 테스트 중", then three "통과" and "검증됨 · 이 버전에서 기대 조건을 모두 통과했어요". If the first run says "확인 안 됨" for one row, press "같은 조건으로 다시 테스트" (a known `cr-verify` follow-up; it replays the same plans) and record this step as PARTIAL: a pass that needed a re-test is not a first-run pass | the `hps-verification/1` report, recomputed from the events |
| 6 | Opens the publish box again; writes the hypothesis "처음 쓰는 사람도 도움 없이 혼자 주문할 수 있다", the question, one success criterion, "학교 게시판" as the channel, chooses 3일 and presses "공개하고 테스트 시작" | "검증됨 · 이 버전은 기대 조건을 모두 통과했어요" before the press; then "공개했어요: <주소>" and, under the experiment, the link with its QR | Service: the test version (the report attached), the experiment and its hypothesis, the link |
| 7 | **Jay (pending):** with `--phone`, scans the QR with the phone's camera on mobile data and opens the link | The kiosk opens with no HypeProof login, sized for the phone (ngrok's notice page first, once) | the participant session opened on the Service |
| 8 | **Jay (pending):** on the phone, orders a drink: 주문 시작 → 아이스티 → 수량 늘리기 → 장바구니에 담기 → 주문하기 | "주문이 완료되었어요" on the phone; in Studio, "HypeProof: 실험 증거 보기" says "참가 세션 1개 · 메모 0개" | participant events (session, page view, clicks) on the experiment's record |
| 9 | In "실험 증거", opens "기록 남기기": "관찰 메모", what was seen, 누가 · 언제 · 어떤 상황, "실제로 있었던 일", 저장 | "기록을 남겼어요."; the note under "원래 기록 보기" exactly as typed | the note, with its provenance |
| 10 | Runs "HypeProof: 커리큘럼 스킬", picks "증거 정리", chooses the experiment, presses "실행하기" | "AI의 답이 규칙을 지켰어요."; 본 것 / 해석 / 가정 / 다음 실험, each line with "(근거 N개)"; "실험 증거에 AI 초안으로 저장했어요. 하나씩 읽고 받아들이거나 고쳐 주세요." The 본 것 lines cite the phone's session and the note | the AI draft on the experiment's record |
| 11 | In "실험 증거", presses "받아들이기" on each 관찰한 것, "고치기" on the 해석 (writes it in their own words, 저장) and "받아들이기" on the 가정 | The lines read "받아들임" and "고침"; "원래 기록 보기" is unchanged | the draft's new revisions; the raw records untouched |
| 12 | Runs "HypeProof: 프로젝트 기억 보기", opens "결정 기록하기", writes "음료와 수량을 한 화면에서 고르게 바꾼다", ticks the sentences under 근거 and slides 2 and 3, presses "결정 저장" | "결정을 기록했어요."; "팀 결정: 음료와 수량을 한 화면에서 고르게 바꾼다 · 슬라이드 2, 3"; still one 가설 and one 실험 | the team's decision |
| 13 | Sends `[cr:apply] 결정대로 고쳐 줘`. Then, **not the product**: no panel registers a version without starting another test or names the version a decision produced, so a harness script does both: `node --experimental-strip-types e2e/curriculum-runtime/register-version.mjs http://127.0.0.1:8787/v1 "$STATE/local-participant-token.txt" latest "$STATE/workspace" --link-decision latest` (`$STATE` is the kit's state directory; `latest` is the student's Project and its newest decision that names no version). Record this step as PARTIAL, not PASS: CR-71 is not met until a panel does it | The preview shows "음료와 수량을 이 화면에서 한 번에 골라요."; the command prints `"ok":true` with the version and the decision; "프로젝트 기억 보기" shows "· 버전 6a29e25c" on the decision | v1 on the Service, named by the decision's `resulting_version_id` |
| 14 | Runs "HypeProof: 주간 리뷰" and presses "주간 리뷰 준비하기"; then runs "주간 리뷰" again | "주간 리뷰를 준비했어요."; ten sections; under "제품·버전 변화": "실험한 버전: v0 (…)", "새 버전: v1 (…) · 바뀐 파일 1개" and "이 버전을 만든 팀 결정: …"; every line's "근거 N개" opens its records. The second open says "최신이에요" and asks no AI | the cached pack |
| 15 | In "커리큘럼 스킬", picks "발표 슬라이드 수정안", chooses the decision "… (슬라이드 2, 3)", presses "실행하기" | "슬라이드 2: 제공 가치" and "슬라이드 3: 해결 원리 — AI / Human / Safety", each "근거 N개", nothing for the other slides; "제안이에요. 저장한 것은 없어요." (storing and accepting patches is `cr-deck`'s, not shipped yet) | nothing stored |

**The live run (CR-T66's second half, pending Jay).** Steps 7 and 8 are the phone's: record the phone model, OS and browser versions, that it was on mobile data, the time from "공개하고 테스트 시작" to the first render on the phone (CR-20) and to "공개했어요" (CR-64), screenshots of the first and the final screen, and the participant session id and pseudonym Studio shows ("실험 증거" → "원래 기록 보기"). If the QR scan fails, type the address and record the QR half as not run. A step satisfied only by synthetic data is NOT RUN in the live run, not PASS: with the scripted coach, steps 3, 5, 10, 14's AI section and 15 are synthetic; run the live loop with `--fresh --phone --real-model` for them to count. Step 13 stays PARTIAL in the live run too while a harness script registers v1. The run record goes to `docs/testing/curriculum-runtime-<date>-evidence.md` (the procedure is §14 of [curriculum-runtime.md](curriculum-runtime.md)).

**Where the data is.** Every step writes where its own item's section above says. In the kit, the Service's records are in memory (`app-service.mjs`) and gone when it stops; the app's state is under the kit's state directory (`user-data/`, `workspace/`), next to the tokens and `service.log` (the Service's start line and its errors). The scripted runs write their per-step results to `e2e/test-results/cr-app/loop-result.json`.

What the tunnel adds (`--phone`): ngrok, a third party, carries every participant's request. Its edge ends the TLS connection, so it sees each phone's public IP address and the requests themselves; what it keeps on its side is ngrok's, under Jay's ngrok account and ngrok's terms, not the kit's. On this Mac the kit keeps none of it. ngrok's request inspector is off (`--inspect=false`; when on, it holds every request and answer in memory at `http://127.0.0.1:4040` while it runs). ngrok's log, which at its default level has one line per client connection with the client's IP address, goes to a filter that keeps only the tunnel's address (`tunnel.info` in the state directory, deleted when the kit stops) and drops the rest. The Service receives a participant's IP address from ngrok in `X-Forwarded-For`; the published runtime does not read it (only `/v1/report` and the classroom routes read a client address, and the tunnel reaches neither), and step 8 of the scripted loop checks that no stored participant event carries an identity-like key, `ip` included. An `ngrok.log` that an earlier version of the kit left in the state directory (it named every client's IP address) is deleted at the next start.
