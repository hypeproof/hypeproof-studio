# 프로젝트 변경: switching the class folder to another GitHub project

> Written 2026-10-15 · Issue #1691 · Requirement REQ-P5 (`docs/studio-requirements.md`) · Builds on REQ-P4 "GitHub에서 이어하기"

## What changed

A participant can move the open class folder to another of their GitHub repositories without leaving Studio. The user requirement (2026-10-15) was: saying "프로젝트 변경" lists the repositories, and picking one commits the work done so far, then switches to the picked repository. That repository is pulled into its existing folder, or cloned when there is none.

| Entry | Where |
|---|---|
| **프로젝트 변경** button | Chat header, next to **인터넷에 올리기**, under the same gate (`config.sitePublish`). HP shell defaults hide editor/view title actions (#725), so the header is where a participant can press it. |
| Chat sentence | `프로젝트 변경` and close variants (`프로젝트 변경해 줘`, `프로젝트 바꿔줘`, `저장소 변경`). A sentence that only mentions the words goes to the coach as usual. |
| Command | `HypeProof: 프로젝트 변경` (`hypeproof-chat.switchProject`) |

## Flow

1. **Gate.** The same gates as the publish button apply:
   - the profile allows publishing;
   - the token is accepted now;
   - no coach turn or publish is running;
   - the open folder is the class folder.
2. **List.** GitHub sign-in uses the gh CLI. If the participant is not signed in, the same device-code flow as the start page runs.
   - Class sites come first, with the same rule as REQ-P4: the button's repository description, or Pages plus a root `agent.md`.
   - The participant's other repositories come next. Forks and archived repositories are left out.
   - The repository the open folder is bound to is marked `지금 작업 중`.
3. **Leave the current work.**
   - If the folder equals its repository on GitHub, nothing is asked.
   - Otherwise the participant chooses between **올리고 바꾸기** and **올리지 않고 바꾸기**.
     - Uploading runs the same publish as the button.
     - The save stage is not used because it drops `pages.yml` from the snapshot. On a published repository that would stop future deployments.
   - A folder that never published can be uploaded to a new repository or left as it is. In both cases the local folder stays.
4. **Bring the picked repository here** (`decideTarget`):

   | This computer | GitHub | Action |
   |---|---|---|
   | No folder bound to it, or only the folder being left | has commits | **clone** into `<class folder>-<repo>` (then `-2`, `-3`) |
   | Its folder | equals the folder, or is empty | **open** as it is |
   | Its folder | unchanged since this computer last pushed or pulled it | **open** as it is: the local difference is newer work made here |
   | Its folder | moved (edited on github.com, or published elsewhere) | **pull** |

   A pull:
   - downloads and checks every blob first, so a failed download changes nothing;
   - makes the site files exactly GitHub's, deleting site files GitHub no longer has;
   - leaves dot entries and `node_modules`, which are never published;
   - copies the folder to `<folder>.before-pull-<stamp>` first, but only when the local site files differed from what this computer last pushed or pulled.
5. **Bind and open.**
   - The folder is registered to the repository with the head commit, so the button publishes there next.
   - It is then opened as the activity's workspace the same way the start page enters a folder: activity commit, then `ensureWorkspace`. The window reloads.
   - Chat history lives in `workspaceState`, so the conversation is that folder's own. A cloned project starts empty; a revisited project resumes its own.
6. **First coach turn.** The switch leaves a note in `globalState` (`hps.projectSwitch.brief.v1`). The next turn in that folder prepends a model-only instruction:
   - if the folder has `agent.md`: read it before anything else, confirm the project in a line or two, then answer;
   - otherwise: read `index.html` first.

   The note is used once, only in that folder, and only within 24 hours.

## Files

| File | Change |
|---|---|
| `extensions/hypeproof-chat/src/publish/projectSwitch.ts` | New. Pure logic over the injected GitHub API and the file system: chat-phrase match, target list, folder ↔ GitHub comparison by git blob id, the decision table, pull, clone folder naming, first-turn note. |
| `extensions/hypeproof-chat/src/publish/publishHost.ts` | `SitePublisher.switchProject()`: gates, list (QuickPick), leaving the current work, clone/pull/open, registry binding. |
| `extensions/hypeproof-chat/src/chatPanelProvider.ts` | `switchProject()` entry, chat-phrase intercept (answers without a coach turn), `switchProject` webview message, first-turn note. |
| `extensions/hypeproof-chat/src/extension.ts` | Command registration; the folder opener (activity commit + `ensureWorkspace`). |
| `extensions/hypeproof-chat/src/protocol.ts`, `webview-ui/src/App.tsx`, `webview-ui/src/ChatPanel.tsx` | The header button and its message. |
| `extensions/hypeproof-chat/package.json` | Command contribution, gated by `hypeproof-chat.sitePublishEnabled`. |
| `docs/studio-requirements.md`, `config/traceability.json` | REQ-P5 row; `projectSwitch.ts` added to `ST-IMP-PUBLISH`. |

## Validation

- `npm run typecheck` passes for the extension and the webview.
- A local smoke test (`test/project-switch.smoke.mjs`) runs against the scripted GitHub. It is not in this PR, by the author's rule of shipping feature code and docs only.
  - It covers the phrase match with positive and negative cases, and the list order.
  - It checks comparison controls: equal after a download, unequal after a local edit, and dot entries ignored.
  - It runs the decision table.
  - It checks a pull after another computer's commit: new file arrives, removed file goes, dot entry stays, backup equals the old folder.
  - It checks that a corrupted download is refused and leaves the folder unchanged.
  - It checks clone folder naming and the note text.
  - The existing `github-continue` smoke still passes.
- A development app copy (`scripts/studio-dev.py prepare`) was built from this branch and run against a local Service with the 1017 seminar profile.

## Not covered

- The pull is not a merge. When GitHub moved and the folder also has unpublished edits, GitHub's version wins and the edits stay in the backup copy.
- Cloudflare Pages or another host watching a repository is not changed by a switch. It keeps following the repository it was connected to.
