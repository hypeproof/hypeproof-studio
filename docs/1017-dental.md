# 1017-dental — Studio changes for the 2026-10-17 dental seminar

The Studio side of the 2026-10-17 dental seminar, as merged into `main`. It started as branch
`1017-dental` (from `main` e987aa34), grew Section 5 on branch `haiku`, and was brought up to
`main` 57368811 on 2026-10-14 together with Section 7 (GitHub calls through the gh CLI).
The Service side (cohort, prompts, skills and the `/v1/profile` fields this app reads) is the
companion pull request in `hypeproof/hypeproof-service`. Written 2026-10-14.

The pull request carries the feature code with its comments, the requirement rows in
`docs/studio-requirements.md`, this document, and the extension unit tests for these features.
End-to-end specs and rehearsal tooling stay local (see [What is not in this change](#what-is-not-in-this-change)).

## Summary

| # | Commit | What the participant gets |
|---|---|---|
| 1 | `feat(publish)` one-click GitHub Pages publishing from the class folder | The "인터넷에 올리기" button (and the coach's publish tool) puts the class folder's homepage on the participant's own GitHub Pages site and reports the address only after it is verified live |
| 2 | `feat(publish)` continue from GitHub on another computer | On a new computer the start page finds the class site the participant already published and offers "GitHub에서 이어하기" or "새로 하기" |
| 3 | `feat(chat)` classroom-operation panels follow the Service | "강사에게 도움 요청" and "수업 결과물 승인" disappear for cohorts that do not use them (the seminar) |
| 4 | `feat(chat)` one summary line for the coach's tool work | Instead of a raw line per tool call, one Korean line such as "홈페이지를 고치는 중…" while the coach works (for cohorts that ask for it, the seminar) |
| 5 | `style(start)` blank line in start.css | Whitespace only |
| 6 | `feat(chat)` photos attached to the chat as files | Drag a photo onto the chat (or paste it), press send: it is saved in the class folder's `images/` under its own name and the coach gets its path |
| 7 | `refactor(publish)` every GitHub REST call is a `gh api` process | Nothing visible. The GitHub credential stays inside the GitHub CLI the class already signs in |

Every behaviour change is gated by the served profile. Cohorts whose profile does not set the new
fields behave exactly as before.

## 1. One-click GitHub Pages publishing (REQ-P3)

### What the participant sees

- A header button "인터넷에 올리기" in the chat panel, and the coach tool
  `mcp__hypeproof__publish_site` when the participant asks the coach. Both call the same module,
  `extensions/hypeproof-chat/src/publish/`.
- First time only: GitHub sign-in through the gh CLI device flow. The one-time code is shown and
  the participant authorizes it in the browser; the app never presses that button.
- First publish to a repository: a consent prompt "이 저장소(<owner>/<repo>)에 홈페이지를
  공개합니다 — 이후 버튼을 누르면 확인 없이 바로 올라갑니다" with "공개하기". The answer is stored as
  a registration for that GitHub login and repository; later presses publish without asking.
  "HypeProof: 배포 등록 해제" removes it.
- Progress steps, then the result in the chat: the address `https://<login>.github.io/<repo>/`
  only when it is verified, otherwise a clear "still building" or a stop reason.

### Who can use it (gates)

- Only with a HypeProof-issued token whose served profile has `publishing.enabled: true` and
  `publishing.strategy: "per_user_github_pages"`, never for a minor cohort. Every press asks the
  Service again, so an expired token or a cohort that stopped allowing it hides the button and
  publishes nothing.
- Only from the class folder: the folder the activity connected in, else the profile's
  `workspace_root` (`~/HypeProofDentalSeminar` for the seminar). Any other open folder is refused
  with `not_class_folder`, naming both folders and the way back ("시작 화면에서 '이어서 하기'").
- GitHub calls go through the GitHub CLI (Section 7). The only exception is a scripted GitHub
  on this machine in a test or development run: an API base override is honoured there only, and
  only for a loopback address, because that path sends the participant's GitHub token itself.

### What a publish does

1. Preflight (`sitePreflight.ts`) on the folder. It **blocks** what works in the preview but
   breaks or leaks on Pages: file-name case mismatches, paths starting with "/", references to
   excluded files, secrets (GitHub, Supabase and other token formats, private keys), resident
   registration numbers, files over 50 MB, and `tel:` links that dial a number other than the one
   shown on the page. Problems that also break the preview are warnings. Dot files,
   `node_modules` and key files are never uploaded. Edit markers (`<!-- 여기고치기: … -->`) are
   counted per label and reported.
2. Repository: the folder's bound repository; a folder that never published from this computer
   gets the first free name of `<default>`, `<default>-2`, … (default from
   `publishing.default_repo_name`, `dental-homepage` for the seminar). An explicit name wins.
3. Pages is switched to `build_type=workflow` and read back before the workflow file lands
   (#500); the workflow YAML is the skill's, verbatim.
4. One atomic snapshot commit through the Git Data API (no `git` binary on the participant's
   computer). If the repository changed on GitHub since this app's last push, the publish stops
   with `remote_changed` ("GitHub에서 직접 고친 내용이 있어 올리지 않았어요.") instead of
   overwriting.
5. Bounded waits for the Actions run, then verification: success (`verified: true` and `url`)
   only when the live site serves this run's nonce (`hps-build.txt`) and the first page answers
   200. When time runs out the result is `ok: true, verified: false`, and `check_only` re-checks
   later without uploading.
6. `stage: "save"` uploads files only and does not touch the workflow or Pages: the class step
   where the participant sees the planned address answer 404 before publishing.
7. Optional custom-domain flow (`customDomain.ts`) when the profile sets
   `publishing.custom_domain`: DNS records are shown for the participant to apply, and HTTPS is
   checked. The class does not teach it.

### Other changes in this commit

- `chatPanelProvider.ts`: `SitePublisher` (one publish at a time, progress, device-code modal,
  result posted into the transcript, `sitePublishEnabled` context key).
- `browserMcp.ts`: registers `publish_site` on the in-process `hypeproof` MCP server from its own
  grant, independent of the browser tools. `sdkCoach.ts`, `sdkCoachHelpers.ts`: the grant comes
  from `profile.publishing`; publish and save ask through the approval path, `check_only` does
  not.
- `package.json`: commands `hypeproof-chat.publishSite` ("HypeProof: 홈페이지 인터넷에 올리기")
  and `hypeproof-chat.publishSiteUnregister` ("HypeProof: 배포 등록 해제").
- `scripts/apply-product-overrides.sh` (app build): trusts `https://github.com` and
  `https://*.github.io` links, so the sign-in page and the published address open without
  VSCodium's English "open the external website?" prompt.

## 2. Continue from GitHub on another computer (REQ-P4)

User requirement 2026-10-13 (hype-dental D-024): participants do not edit on github.com; they
may move to another computer. When a participant enters with a code, the start page looks at
GitHub first.

- Applies to cohorts behind the publish gate that name a class folder.
- The look uses `/user/repos` without starting a sign-in. A class site is a repository whose
  description is the one the button gives every repository it creates ("HypeProof Studio에서 만든
  홈페이지"), or a Pages site with `agent.md` at its root.
- Found: "GitHub에서 이어하기" replaces the single primary button; with several sites, a radio list
  (most recent first, preselected) with "N월 N일에 올림". "새로 하기" is the peer option.
- Nothing found, the look failed, or no answer within 15 seconds: the normal start, so entry is
  never held up. gh signed out: a quiet line "다른 컴퓨터에서 올린 홈페이지 불러오기 (GitHub
  로그인)", then the sites. While the sign-in waits, the card says "GitHub 로그인 기다리는 중…".
- "GitHub에서 이어하기" downloads the site into a fresh folder (the class folder, else `-2`, `-3`,
  …) and binds it to that repository (registration plus the commit it came from), so the next
  publish continues on top. If this computer's own folder is exactly what GitHub holds, it reopens
  that folder instead of downloading.
- "새로 하기" opens the next free folder, which publishes to a new repository on its first press.
- Download (`githubContinue.ts`): only what a publish uploads; every blob checked against its git
  id; never into an existing folder; the new folder is removed on any failure; unsafe paths are
  refused.

Files: `src/publish/githubContinue.ts` (new), `publishHost.ts`, `publishRegistry.ts`,
`publishSite.ts`, `pagesPublisher.ts`, `startPage.ts`, `startPageProtocol.ts`, `extension.ts`,
`chatPanelProvider.ts`, `webview-ui/src/StartPage.tsx`, `webview-ui/src/start.css`.

## 3. Classroom-operation panels follow the Service (REQ-STUDIO-CLASSROOM-PANELS)

Decision hype-dental D-025. "강사에게 도움 요청" and "수업 결과물 승인" are Chalk classroom-operation
panels (#751). The seminar does not use Chalk classroom operations.

- `classroomPanels.ts`: reads `classroom_panels` from the served profile. Only an explicit
  `false` hides a panel; an absent field keeps both.
- `ChatPanel.tsx` gates both panels on it. Instructor mode is unchanged.

## 4. One summary line for the coach's tool work (REQ-STUDIO-TOOL-ACTIVITY)

Decision hype-dental D-027. In the seminar rehearsal one coach turn drew more than twelve lines:
raw tool calls, five preview lines and a red error for an edit the coach retried by itself.

- `toolActivity.ts`: only `tool_activity: "summary"` in the served profile changes anything.
- In summary mode a stretch of work is **one** line that changes in place and disappears when
  the stretch ends (when the coach starts writing or the turn ends). The preview line shows only
  while the preview opens.

| Tool call | Line shown |
|---|---|
| Write, Edit, MultiEdit on `*.html` | ✍️ 홈페이지를 고치는 중… |
| Write, Edit on `agent.md` | 📝 agent.md에 정리하는 중… |
| Write, Edit on other files | ✍️ 파일을 고치는 중… |
| Read, Grep, Glob, LS | 🔍 파일을 살펴보는 중… |
| browser and live-preview tools (`mcp__hypeproof__browser_*`, `live_preview_*`) | 🖥️ 화면을 확인하는 중… |
| Bash, PowerShell | ⌨️ 명령을 실행하는 중… |
| WebSearch, WebFetch | 🌐 인터넷에서 찾아보는 중… |
| thinking | 💭 생각하는 중… |
| between tool calls | … 다음 단계를 준비하는 중… |
| anything else | 🔧 작업하는 중… |

- Not drawn in summary mode: tool names and inputs, the coach's thinking text, and failure lines
  for calls the coach retries. The coach's own reply still has to say what did not work.
- Unchanged: observation records and the session spool keep the raw tool labels; "고쳤어요" is
  still decided only by a write that succeeded; product notices (coach connection, pasted images)
  still show.

## 5. Photos attached to the chat as files (REQ-STUDIO-CHAT-PHOTO-FILES)

Decision hype-dental D-028, issue #1611 ("채팅 사진 드래그 앤드롭", "사진 보관 폴더 규약"). In
the seminar the photo step (17:05) asked the participant to copy photos into the class folder
in Finder and type their names. Now the participant drops them onto the chat.

- Gate: `input.image_files` on `/v1/profile`. Absent, drop and paste behave as before.
- Two ways in, same result:
  - **From Finder.** VS Code takes a file dropped onto the window before the chat sees it and
    opens it as a tab (#384). For a photo from outside the class folder, Studio asks once
    ("방금 연 이미지 "원장님.png"를 코치 채팅에 붙일까요?" → 붙이기), stages it, closes that
    tab and shows the chip in the chat. Opening a photo that is already in the class folder is
    not an attachment and asks nothing.
  - **Into the chat itself** (paste, or a drop the chat receives directly).
- Drop or paste → the photo's original bytes go to the host's staging folder
  (`<tmp>/hypeproof-studio-staged-images/<pid>-<random>/`). The chat shows a small preview
  (or the file name when the format cannot be drawn, such as HEIC) and the line
  "보내면 작업 폴더의 images 폴더에 저장돼요."
- × on a preview → that staged file is deleted at once.
- Send → the photos move into `<class folder>/images/` under their own names. Korean names
  from macOS are recomposed (NFC) and an existing file is never overwritten (`외관-2.jpg`).
  The message gets:

  ```
  [첨부한 사진]
  - images/외관.jpg
  ```

  on the model input, in the saved history and on the sent bubble, so later turns can name
  the files. The timeline shows "🖼️ 사진을 저장했어요 — images/외관.jpg".
- Not sent → deleted with the window. A crashed window's folder is deleted on the next start.
  A folder whose process is still alive belongs to another open window and is left alone.
- Limits: 10 photos per message, 25 MB each, photo types only (HEIC by file name).
- The photos are not shown to the model. The Service contract tells the coach to open a
  photo only when the participant asks to copy its look ("이 사진처럼", "똑같이").
- Code: `src/attachedImages.ts` (names, limits, staging), `chatPanelProvider.ts`
  (`stageAttachedImage`, `stageImageFromFile`, `commitAttachedImages`), `extension.ts` (the
  opened-photo-tab path), `protocol.ts` (`stageImage`, `discardStagedImage`,
  `sendMessage.attachments`, `imageStageRefused`, `imageStagedByHost`, `attachedImagesSaved`),
  `ChatPanel.tsx` / `App.tsx` (drop, paste, previews, send).
- Checked in a studio-dev app copy against a local Service with the real model (Azure
  gpt-6-luna), 2026-10-14: the dropped photo was saved byte-identical as
  `images/clinic-interior.png`, the staging folder emptied on send, on × and on closing the
  app; the Finder path asked once, closed the photo tab and saved `images/원장님.png`; with
  "첫 화면 사진을 이 사진으로 바꿔줘" the coach did not open the photo and linked a web copy;
  with "이 사진과 똑같은 색감으로…" it opened the photo (`Read(images/clinic-exterior.png)`)
  and said what it saw before changing the colour.
- Unchanged: the `image_paste` path (#421, the photo shown to the model and saved under
  `assets/`), which the seminar profile does not turn on.

## `/v1/profile` fields this change reads

| Field | Used for | When absent |
|---|---|---|
| `publishing.enabled`, `publishing.strategy` | the publish gate | no button, no tool |
| `publishing.default_repo_name` | default repository name | the participant names it |
| `publishing.custom_domain` | the custom-domain flow | not offered |
| `workspace_root` | the class folder | publishing refused (`not_class_folder`) |
| `classroom_panels` | the two classroom panels | both drawn |
| `tool_activity` | summary line | one line per tool call |
| `input.image_files` | photos attached as files, saved to `images/` | drop and paste as before |

The Service side is the companion `hypeproof/hypeproof-service` pull request. Deploy it before
shipping an app build that carries this change.

## Running the seminar on Claude Haiku 5.5

**No Studio code changes for this.**
- The model is the Service's choice. The Service change pins the seminar cohort to
  `claude-haiku-5-5` with thinking off.
- This app runs it on the existing Claude Agent SDK path.
- The model picker shows the one choice the Service serves, "Claude Haiku 5.5".

**Why Haiku 5.5.** Issue #1611 compared three setups on the same 10 class turns in the
Studio app (cue sheet v3, t01–t09 and t11, publishing excluded, reasoning off):

| | Claude SDK + GPT gpt-6-luna | Codex SDK + GPT gpt-6-luna | Claude SDK + Haiku 5.5 |
|---|---|---|---|
| Time | 286 s | 441 s | 225 s |
| Cost per participant (10 turns) | $0.074 | $0.117 | $0.085 |
| Map-rule misses | 0 | 1 of 3 runs | 0 |
| Reply length (10 turns) | 2,627 chars | 5,124 chars | 12,744 chars |

Haiku 5.5 needs no app change, unlike the Codex path, which needs a 328 MB binary shipped
with the app.

**Watch in class.**
- Haiku's replies are longer.
- In the comparison run it left placeholders on the visible page for information it was not
  given: `[가까운 역·출구 정보를 입력해 주세요]`, `사업자등록번호 000-00-00000`, and an empty
  photo box.

**Checked.**
- The 10-turn comparison ran in a studio-dev copy of this app's code line. That copy did not
  have Sections 4 and 5.
- The Service branch `haiku` was run locally against the Anthropic API. It served the single
  Haiku 5.5 choice with `input.image_files: true`, and answered a request sent with
  adaptive thinking and effort `max` with thinking off and effort `high`.
- The two together (this branch's app with the photo drop, on Haiku 5.5) have not yet been
  run as one class rehearsal.

## 7. GitHub calls through the gh CLI

Sections 1 and 2 first talked to `api.github.com` with their own HTTP client. The client read
the participant's token with `gh auth token` and put it on each request. The class already
installs and signs in the GitHub CLI (`gh auth login`), so the CLI now carries every request
and the token no longer passes through this extension.

- `githubApi.ts`: `createGitHubApi` takes a transport. It keeps what `gh api` does not do:
  one request at a time, the rate-limit waits (`retry-after`, `x-ratelimit-reset`, the
  one-minute secondary wait), and retries on 5xx and dropped connections.
- `createGhTransport`: one `gh api --hostname github.com --method <M> --include` process per
  request. The JSON body goes on stdin, so a photo's base64 is never on an argument vector.
  Status and headers (`x-oauth-scopes`, `retry-after`) are read from the `--include` output.
  gh exits non-zero on 4xx and 5xx but still prints the response, so the exit code is ignored
  when a status line came back. If gh lost its login during a run, the call answers 401 and the
  auth step starts a new sign-in.
- `createFetchTransport`: plain HTTP, used only for a scripted GitHub on loopback in tests and
  development runs (`publishConfig.ts`). A real run has no API base override and stays on
  `gh api`.
- `githubAuth.ts`: the gh provider exposes the `gh` it resolved (`bin()`), so requests run the
  same executable. `gh auth token` is now only the "is anyone signed in" check.
- `publishSite.ts`, `publishHost.ts`: `PublishSiteDeps.apiBase` became `transport(token)`.
  `fetch` remains only for the unauthenticated read of the published page.

Checked against real GitHub with the signed-in gh, on the sandbox repository approved for
these runs:
- `GET /user` with its scopes, a 404, and the repository list.
- A first publish: repository created, Pages on, files committed, Actions build, live in 54 s,
  and an independent fetch answered 200 with the page's marker.
- A second publish into the same repository: live in 50 s.
- Continue from GitHub: `findClassRepos` listed the site, `downloadRepo` brought down its 4
  files, and `remoteHead` matched the downloaded commit.

## Merging with `main` (2026-10-14)

`main` moved 14 commits while this work was on branches. Four files conflicted and both sides
were kept:
- `extension.ts`: main's `begin(profile, commit, selectedDirectory)` and this change's GitHub
  source for the start page.
- `startPage.ts`: main keeps the served profile unchanged and passes the local folder as
  `selectedDirectory` (#1641). "GitHub에서 이어하기" now does the same: the downloaded folder
  becomes the selected folder and is no longer written into `profile.workspace_root`.
- `sdkCoachHelpers.ts`: main's roster tools (`consult`, `site_check`) and the `publish_site`
  grant.
- `StartPage.tsx`: main's pass display and purchase hide/cancel, and the GitHub card.

Test fixtures use generic names ("가상치과", `neo-dental`), as the customer-name check on `main`
requires.

## Verification done

- Under Node 22, the CI version: extension typecheck and build; `npm test` in
  `extensions/hypeproof-chat` (147 smoke tests and the six suites); `npm run
  test:service-integration`; e2e `test:cr-publish`; `scripts/check-customer-names.py`.
- Real GitHub through gh, as listed in Section 7.
- During development: app-level runs in an app copy against a scripted GitHub (publish,
  continue on a second computer, the token gate, the panels) and the seminar rehearsal with a
  person at the keyboard.

## What is not in this change

- **End-to-end specs and rehearsal tooling**: the app-level publish specs, the class-rehearsal
  harness, local stack scripts, model labels used only in local rehearsals, and any keys or
  account names. They name a test account and stay local.
- **The Codex SDK trial** is on branch `dental-codex`.
