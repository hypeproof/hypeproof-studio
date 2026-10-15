<!--
Filed via the issue → PR flow in CONTRIBUTING.md.
Branch name should be fix/issue-<N>-<slug> or feat/issue-<N>-<slug>.
-->

Closes #<!-- issue number — required so the merge auto-closes it -->

## What & why

<!-- What changed, and the problem it solves. Keep it concrete. -->

## Area

<!-- delete the ones that don't apply -->
- worker (`worker/`)
- extension (`extensions/hypeproof-chat/`)
- docs / scripts
- build / `vscodium-base` submodule (bump policy: .claude/rules/build-pipeline.md)

## AI Native Asset(s) served

<!-- Required for chat-panel changes. Cite the 7 AI Native Asset(s) from
     docs/seven-assets.md / METAPLAN §4.5. If a chat-panel change serves none,
     it is probably noise. -->

## Tested

<!-- Which "Run & test" layer(s) you ran (CONTRIBUTING.md). -->
- [ ] `cd worker && npm test && npm run typecheck`
- [ ] `cd e2e && npm test` (built .app + dev-stack running)
- [ ] manual: <!-- what you clicked through -->

## Release check

How to verify: <where> → <what to click or run> → <expected result>
Smoke: <yes|no> — <reason>
Smoke check: <scripts/release/smoke/checks/sN-*.mjs, or #follow-up-issue; only when the answer is yes>

<!--
Read the linked issue (the intent) and your diff, then fill the three lines above.
The release manager reads the first line, so keep "How to verify" first.
Answer yes for Smoke when this adds a dependency on another repository or a server
(Service, Chalk, ...). If the issue answered "Smoke needed?" with yes and you answer no,
add a line "Smoke differs from issue" with the reason.
Hotfix PR (base hotfix/<tag>): How to verify may be left out; the Smoke lines are still required.
Port of a hotfix to main: add a line "Forward-port of #<hotfix PR>".
Enforced by hype-pr once config/pr-body-contract.json sets release_check.enforced.
-->

## Checklist

- [ ] Branched off `main` (no direct push to `main`)
- [ ] No secrets in the diff (`worker/.dev.vars` stays local)
- [ ] Submodule pointer untouched unless this PR is intentionally a bump
- [ ] No workflow grants write/deploy permissions to external PR or comment triggers
- [ ] Branch protection / required checks remain compatible with this change
