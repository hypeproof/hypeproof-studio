# 1017-dental — Studio changes for the 2026-10-17 dental seminar

Branch `1017-dental` of `jayleekr/hypeproof-studio`, built from `origin/main` e987aa34.
Companion branch: `1017-dental` of `hypeproof/hypeproof-service` (cohort, prompts, skills and
the `/v1/profile` fields this app reads). Written 2026-10-14.

This branch carries feature code with its comments, the requirement rows in
`docs/studio-requirements.md`, and this document. Unit tests, end-to-end tests and rehearsal
tooling are deliberately left out (see [What is not on this branch](#what-is-not-on-this-branch)).

## Summary

| # | Commit | What the participant gets |
|---|---|---|
| 1 | `feat(publish)` one-click GitHub Pages publishing from the class folder | The "인터넷에 올리기" button (and the coach's publish tool) puts the class folder's homepage on the participant's own GitHub Pages site and reports the address only after it is verified live |
| 2 | `feat(publish)` continue from GitHub on another computer | On a new computer the start page finds the class site the participant already published and offers "GitHub에서 이어하기" or "새로 하기" |
| 3 | `feat(chat)` classroom-operation panels follow the Service | "강사에게 도움 요청" and "수업 결과물 승인" disappear for cohorts that do not use them (the seminar) |
| 4 | `feat(chat)` one summary line for the coach's tool work | Instead of a raw line per tool call, one Korean line such as "홈페이지를 고치는 중…" while the coach works (for cohorts that ask for it, the seminar) |
| 5 | `style(start)` blank line in start.css | Whitespace only |

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
- GitHub API endpoint overrides are honoured only in development runs and only for loopback
  addresses, because the API base receives the participant's GitHub token.

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

## `/v1/profile` fields this branch reads

| Field | Used for | When absent |
|---|---|---|
| `publishing.enabled`, `publishing.strategy` | the publish gate | no button, no tool |
| `publishing.default_repo_name` | default repository name | the participant names it |
| `publishing.custom_domain` | the custom-domain flow | not offered |
| `workspace_root` | the class folder | publishing refused (`not_class_folder`) |
| `classroom_panels` | the two classroom panels | both drawn |
| `tool_activity` | summary line | one line per tool call |

The Service side is branch `1017-dental` of `hypeproof/hypeproof-service`. Deploy it before
shipping an app build from this branch.

## Verification done

- Extension typecheck and build pass on this branch.
- The extension code on this branch equals the locally tested code plus main's changes since
  2026-10-12, compared line by line.
- With the local unit-test updates applied on top (not committed here), the full extension suite
  passes.
- During development: app-level runs in an app copy against a scripted GitHub (publish,
  continue on a second computer, the token gate, the panels), one opt-in run against a real
  GitHub account and repository, and the seminar rehearsal with a person at the keyboard.

## What is not on this branch

- **Tests.** No unit or end-to-end test files. Consequence: on this branch alone three existing
  tests no longer match the new wiring and fail: `test/cr-switch.smoke.mjs` (the MCP registration
  now also spreads `hypeproofMcpRegistration`), `test/history-identity.smoke.mjs` (the publish
  result is a fourth app-made reply) and `test/student-goal.smoke.mjs` (`postConfig` now asks
  `sitePublisher` whether the button may show, and the test's stand-in provider has none). Their updates, and the new tests for these features, are kept on the
  local branch `feat/summary-tool-activity` and must come with any pull request to `main`.
- **Rehearsal and local-only tooling**: e2e specs, the class-rehearsal harness, local stack
  scripts, model labels used only in local rehearsals, and any keys or account names.
- **The Codex SDK trial** is on branch `dental-codex`.
