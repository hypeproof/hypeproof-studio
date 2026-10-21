---
title: Studio Release Process
product: studio
doc_type: release
status: canonical
owner: core
version: 0.1.5
last_reviewed: 2026-10-15
audience: release managers, developers
source_paths:
  - scripts/release/release-cut.mjs
  - scripts/release/create.mjs
  - scripts/release/version.mjs
  - scripts/release/smoke/smoke.mjs
  - .github/workflows/release-cut.yml
  - .github/workflows/verify-unified-release.yml
  - .github/workflows/build-mac.yml
  - scripts/resolve-version.sh
  - config/pr-body-contract.json
  - docs/RELEASE-CHECKLIST.md
  - release.json
  - chalk/release.json
quality_gates:
  - version-documented
  - rollback-documented
  - source-paths-exist
---

# Studio Release Process

This document gives the rules for a Studio App release. It covers the App only.
Service, Chalk and Module deployments are separate and are not in this document.

The step-by-step procedure for release day is in
[docs/RELEASE-CHECKLIST.md](../RELEASE-CHECKLIST.md).

The previous process (before 2026-10-15) is archived in
[docs/archive/release/](../archive/release/06-release-process-2026-06.md).

## Rules

The team agreed on these rules (hypeproof/hackathon-2026-10-refactoring#12, 2026-10-12
to 2026-10-15).

1. Release the App once a week.
2. Each release starts from a release cut: a fixed candidate commit, smoke, an rc build
   and a release PR.
3. A member checks the rc build against the release PR checklist. This member is the
   release manager for that week. The team selects this member. The system does not.
4. One approval from a member with write access releases the App.
5. A stable `v` tag that has no approved release PR is not published. It stays a draft.
6. A hotfix does not need the release manager check or the approval. It needs a PR, CI
   and smoke.
7. Write release PRs and all PR bodies in English.

The day and the cutoff time of the weekly release are not decided yet. Decide them before
the release cut runs on a schedule.

## Status

Not all parts of this process exist yet. This table shows the state on 2026-10-15.

| Part | State | Reference |
|---|---|---|
| Release cut: range, smoke, release PR body (dry-run) | In `main` | #1608, #1609 |
| Release cut: rc tag, rc builds, release PR (`mode=create`) | In `main`, not run on Actions yet | #1687, #1689 |
| Release check section in PRs and issues | In `main`, not enforced | #1680, #1682 |
| `hype-pr` checks the Release check section | In `main`, not enforced in Studio | hypeproof-harness#324 |
| Hotfix rules in `hype-pr` and the hotfix issue form | In `main` | hypeproof-harness#326, #1686 |
| Publish gate (rule 5) | Pull request open | #1683, #1684 |
| Approval workflow: approval → `v` tag | Not started | — |
| Smoke credentials | S4 available; S3 missing as observed 2026-10-16 | #1704 |

Until the approval workflow exists, a member pushes the `v` tag by hand after the approval.
See [Approval](#approval).

## Flow

1. The release cut fixes the candidate commit. The candidate is `origin/main` at that time.
   Later merges go to the next release.
2. The release cut calculates the range: all commits after the last stable `v` tag.
3. Smoke runs against the production Service and Chalk.
4. If smoke fails, the release cut opens an issue and stops. It does not create a tag or a PR.
5. If smoke passes, the release cut creates the rc tag and starts the rc builds. It also opens
   the release PR.
6. The rc builds run the automatic E2E on every platform in
   `config/release-platforms.json` (macOS only since 2026-10-19; Windows is dispatch-only,
   see [fast-mac-release.md](fast-mac-release.md)). Then they publish the rc as a
   prerelease. The Mac build reuses the previous base app when the base is unchanged.
7. The release manager installs the rc build and does the checks in the release PR.
8. A member with write access approves the release PR.
9. The `v` tag goes on the same commit as the rc tag.
10. The `v` tag builds run the automatic E2E again.
11. The publish gate checks the approval. Then the release becomes public.

## Version

The git tag gives the version. CI sets `HPS_VERSION` from the tag.
`scripts/resolve-version.sh` writes it into `product.json`, `Info.plist` and the bundled
`hypeproof-chat` extension. For untagged local builds, the version comes from
`extensions/hypeproof-chat/package.json`.

### Format

Use `v<year>.<month×100+day>.<n>`. `scripts/release/version.mjs` calculates it.

| Release | Tag |
|---|---|
| First release on 2026-10-13 | `v2026.1013.0` |
| Second release on 2026-10-13 | `v2026.1013.1` |
| First release on 2026-01-05 | `v2026.105.0` |
| First candidate for `v2026.1013.0` | `v2026.1013.0-rc.1` |

Do not change this format without a reason that covers all of these limits:

- Do not write a leading zero (`0105`). The updater in installed Apps (`isUpdateVersion`)
  rejects it. Installed Apps then never update to that release.
- Do not add a fourth number (`v2026.10.13.1`) or an underscore. `resolve-version.sh`
  rejects them and the build fails.
- Do not count releases of one day with `-` or `+` (`v2026.1013.0-2`). The updater ignores
  the part after `-` and `+` when it compares versions. It sees the same version and does
  not update.

A tag with `-` (for example `-rc.1`) is a prerelease. The updater does not install
prereleases.

## Release dependency check

`release.json` (Studio) and `chalk/release.json` (Chalk) declare the Service contracts that
each product needs. The check itself is the Harness engine, not code in this repository:
`scripts/release-deps/` in `hypeproof/hypeproof-harness` (see its README). It answers
whether every live release, plus the candidate, has a live provider for each requirement.

- Studio requires `studio-api` at the line of `@hypeproof/service-contracts` pinned in
  `extensions/hypeproof-chat/package.json`. That is the package bundled into the App. The
  root `package.json` is test tooling and is not shipped.
- Chalk requires `chalk-admin` at the line pinned in `chalk/package.json`.
- The App sends its version without the `v` in `x-hps-client-version`. Tag `v2026.1017.0`
  is reported as `2026.1017.0`. See [Version](#version).
- When you change one of these pins, keep it in `config/service-packages.json`.
  `scripts/release/test/release-manifest.test.mjs` fails otherwise.

## Release check in PRs

Every PR body has a `## Release check` section. The release cut copies it into the release
PR checklist. Write three lines:

```text
Release manager check: yes|no — <reason>
How to verify: <where> → <what to click or run> → <expected result>
Smoke: <yes|no> — <reason>
Smoke check: <scripts/release/smoke/checks/sN-*.mjs or #issue, only for yes>
```

- Write `Release manager check` on the first line.
- Answer `yes` when a user can see or meet the changed behavior in the rc App.
- Answer `no` when the PR changes release tooling, CI, vendored tooling, or docs only.
  A `no` answer puts the PR in the automatic group regardless of its title type or files.
  The reason is shown in the release PR to explain why no check is needed.
- `How to verify` is required only when the answer is `yes`. The release manager reads it.
- Write all three parts of `How to verify`. The release manager must be able to do it
  without the author.
- Answer `Smoke: yes` when the PR adds a dependency on another repository or a server
  (Service, Chalk). Otherwise answer `no`.
- Read the linked issue and the diff before you write the section.
- If the issue says that smoke is needed and the PR says no, add a line
  `Smoke differs from issue: <reason>`.
- The rule applies to PRs opened after it is enforced. Earlier PRs are not changed.

`hype-pr` checks the section when it creates a PR. The check is on only when
`config/pr-body-contract.json` sets `release_check.enforced` to `true`.

Issue bodies are not checked. An issue is written before the code, so the smoke answer
in an issue is only an estimate.

## Smoke

Smoke is a short check in code against the production Service and Chalk. It does not
open the App. Each check gives `PASS`, `FAIL` or `NOT_RUN`. The worst result is the
result of the smoke.

| Check | What it checks | Needs |
|---|---|---|
| S1 | Service `/v1/health` is ok and has a version | — |
| S3 | A token reaches its cohort | `HPS_ACCEPTANCE_ISSUER`, scoped only to `synthetic-release-acceptance` |
| S4 | Chat API through `scripts/run-sdk-contract.sh` | `HPS_CANARY_ISSUER` |
| S5 | CI check-runs on the candidate commit | — |

S2 (Chalk `/health`) and S6 (Chalk Lab tokens) were removed: the web Chalk (`chalk.hypeproof-ai.xyz`) will be retired soon, and the `chalk/` code is planned to move to its own repository with its own release smoke. The Studio App does not call Chalk.

The runner executes checks in this order:

1. S1, S5 — read-only. These checks do not open a session.
2. S3, S4 — these checks open a live session.

If S1 or S5 is `FAIL`, the runner marks S3 and S4 as `NOT_RUN` and does not open a session.

- `NOT_RUN` means that the check could not run. It is not a pass.
- A smoke credential must have the smallest scope. For S4, use an issuer token for the
  `canary-internal` cohort and the `canary-sdk-contract` profile only. Never use a token
  that can reach a real cohort.
- To add a check, add one file in `scripts/release/smoke/checks/`.

## Release cut

The `release-cut` workflow runs every day at 17:00 KST (08:00 UTC). Its `gate` job
(`scripts/release/daily-gate.mjs`) skips the scheduled run when no app path changed since the last
stable `v` tag, when the live-class freeze does not answer `proceed`, or when the repository
variable `RELEASE_CUT_DAILY` is `off`; otherwise it cuts with `create` (`dry-run` when the variable
is `dry-run`). Pause the schedule with
`gh variable set RELEASE_CUT_DAILY --body off --repo hypeproof/hypeproof-studio`; delete the variable
to resume. The release PR also carries the black-box cases selected for this candidate; the process
is in the [release casebook](../operations/release-casebook/README.md).

You can also run it from the Actions tab. A manual run has two modes.

| Mode | What it does | Permissions |
|---|---|---|
| `dry-run` (default) | Calculates the range, runs smoke and writes the release PR body as an artifact | Read |
| `create` | Also creates the rc tag, the rc builds, branch `release/<version>` and the release PR, or the smoke failure issue | Write, in a separate job |

The run has two jobs. The `cut` job runs in both modes and has read permissions only. The
`create` job runs only in `create` mode, after `cut` passes. A `create` run shows both jobs.

- `since` is for a trial only. It moves the baseline back in time. `create` refuses it.
- `accept_not_run` lets `create` continue when a smoke check is `NOT_RUN`. The release PR
  shows the `NOT_RUN` result. Use it only while a credential is missing.
- A second cut on the same day creates the next rc of the same version. It moves the release
  branch and updates the release PR. Approvals given before that are for the old candidate.
- The release cut calculates the range from commits, never from dates. A date search
  dropped 22 of 217 PRs because the tag time (KST) and the search time (UTC) differ.

## Approval

1. Open the release PR. Install the rc with the one-liner at the top and do the checks on it,
   including the black-box cases in section 4 that an agent pre-test comment did not already pass.
2. Mark each item as checked, as not possible with a reason, or as a problem with an issue
   number. Any P0 black-box case FAIL means no approval
   ([judgement rules](../operations/release-casebook/README.md#판정-규칙)).
3. Approve the release PR with an account that has write access.

Until the approval workflow exists, also do these steps:

4. Push the `v` tag on the rc commit:
   `git tag <version> <version>-rc.N^{} && git push origin <version>`
5. Merge the release PR. It adds only `releases/<version>.md`.

Make sure that the approval is on the latest commit of the release PR. A later rc moves
the release branch, and an approval of an earlier candidate does not count.

## Publish gate

This part is in pull request #1684. It is not in `main` yet.

Pushing a tag cannot be prevented: the repository plan (GitHub Free, private) has no tag
protection. The gate is in `verify-unified-release.yml`, right before the release becomes
public. A stable `v` tag passes in one of two ways:

- **Approval:** a `release` PR from `release/<tag>` has an approval from a member with write
  access, on the PR's current commit. An `<tag>-rc.N` tag is on the same commit as the tag.
- **Hotfix:** every commit since the last public App release came from a PR with the
  `hotfix` label into a `hotfix/*` branch.

If neither is true, the release stays a draft. A lookup error also keeps it a draft.
`mirror-release.yml` does not copy a draft to the public mirror.

## Hotfix

Use a hotfix only for an urgent fix to a released version.

1. Create the branch `hotfix/<last v tag>` from the last `v` tag. If that branch exists,
   use it. All hotfixes for one tag go on one branch.
2. Open an issue with the hotfix form. It needs the failure, the impact, the cause PR and
   the affected tag.
3. Open a PR from a `fix/...` branch into the hotfix branch. `hype-pr` adds the `hotfix`
   label. The Release check needs the `Smoke` line. `How to verify` is not needed.
4. Merge the PR after CI passes. Run smoke.
5. Tag the end of the hotfix branch with the next version number of the day.
6. Bring the same fix to `main` with
   `hype-pr create ... --base main --forward-of <hotfix PR>`. This PR has the label
   `hotfix-forward` and the line `Forward-port of #<hotfix PR>`.

Do not make a hotfix on `main`. `main` contains PRs that are not approved for release.

A merge into a hotfix branch does not close the issue. GitHub closes issues only for merges
into the default branch. The issue closes when the forward-port PR merges. An open hotfix
issue therefore shows a fix that is not on `main` yet. This GitHub behavior is from its
documentation and is not tested here yet.

## In-App Updates

Studio checks the public `hypeproof/hypeproof-studio-releases` stable release 30 seconds
after activation and every 24 hours after that. It does not install silently. The user
starts the download and confirms the restart. If the user dismisses a version, its banner
does not show for seven days. Service and Module deployments do not use this path.

The updater supports macOS arm64 and Windows x64. Release assets must carry the GitHub
SHA-256 digest and the expected byte size. A failed check does not prove that the installed
version is current. A failed download must not reach the installer. See REQ-I1 through
REQ-I13 and issue #730.

Verification commands:

```bash
cd extensions/hypeproof-chat
npm test
npm run typecheck
npm run build:extension
cd webview-ui && npm run build
cd ../../../e2e
node update-check/run.mjs
```

The last command copies the installed macOS App into a temporary directory. It injects the
built extension and checks the update command against the public release API. It never
installs an update. Platform CI runs the macOS swap and rollback fixtures and the Windows
PowerShell wrapper with a mocked installer. These do not replace a real upgrade and restart
of the packaged App on each OS.

A merge does not update installed Apps. A new App release and its public mirror are
necessary. Some older Apps with a broken updater need one manual reinstall (REQ-I10).

## Trial and classroom delivery

Personal trial and classroom sessions use one App artifact and one stable update channel.
A participation code selects the Service profile and the access limits. It does not select
a different App build. Publish each App release once to `hypeproof-studio-releases`. Then
verify both entry paths against that artifact. A successful mirror makes an update
available. It does not replace a running App and does not prove that the user restarted.

On macOS, the ordinary shortcut and the personal-trial shortcut must both open
`/Applications/HypeProof Studio.app`. A trial can keep separate user-data, extensions and
workspace directories. Its shortcut must not open an App under `releases/v*/`. Keep those
directories when you update. Label isolated App or Service copies for development as local
rehearsals. They do not prove that a public release reached the user.

For each release report, record these items separately for trial and for classroom:

- The public App tag, the asset digest and the source commit.
- After the restart: the executable path, the product version and commit, and the bundled
  extension version. An old process stays old even when a newer file is on disk.
- The Service endpoint and its `/v1/health` version. Confirm the profile with the existing
  authenticated API. Do not log the token.
- The Module version or pin. If there is no pin, record the compiled Service prompt revision.

A Service deployment reaches both profiles that use that Service. A local gateway continues
to serve its own code. App, Service and Module deployments stay separate. Do not rebuild the
App for a Service-only change. Do not report a localhost result as a public deployment.
Use the existing App updater for download, backup and restart. Do not add a trial updater.

If one entry path is old or not tested, report the delivery as incomplete. Name the missing
path and the action. See NAT-01/12 and the
[native trial laptop checks](../testing/studio-native-trial-laptop.md).

## Managed candidate drafts (#1758)

This opt-in build handoff stops at draft assets. It does not activate the daily
release engine, collect installed-App acceptance, approve a candidate or promote a
channel. The ordinary release flow above remains the default. Its Mac dispatch
now defaults to the workflow ref instead of silently checking out `main`.

After checking the actual account's public standard-runner eligibility and remaining
artifact/storage allowance, select `mode=create`, `managed_draft=true` in the existing
`release-cut` workflow. Its `create.mjs --managed-draft` path reuses version planning,
tags and release PRs. Both existing OS workflows receive the full candidate SHA as
`ref` and `candidate_sha`. Before any remote mutation, the candidate must contain the
exact reviewed `build-contract.mjs`, its artifact-identity helper and both builder
workflows. An older candidate is refused because its workflow code could ignore the
new inputs. No new provider, runner tier, service or model credential is introduced.

The annotated `vX.Y.Z-rc.N` tag stores `hps-managed-draft/1` with the candidate SHA,
that publication tag and final `vX.Y.Z` version. Both workflows check actual checkout,
workflow SHA and peeled tag SHA before build preparation. The annotation is
authoritative for managed mode: tag pushes and retries with missing or false inputs
still stop before automatic acceptance. Partial/malformed markers fail closed.
Conflicting version/ref inputs are rejected; inputs enter the shell through environment
variables, never interpolated shell source. The final version reaches the existing
pre-sign/pre-package stamping path; no post-sign version rewrite is added.

The managed draft contains the original packages and `draft-build-<platform>.json`.
That inventory binds source SHA, annotated tag object, final embedded App/extension
version, package name, byte size and SHA256. Windows requires the portable ZIP and
both User/System installers. Mac identity is read from the new ZIP's extracted App;
Windows identity is read from the portable smoke's extracted App. Before uploading,
the workflow compares the inventory again and checks the remote tag object and peeled
commit. It refuses published releases and never uses upload `--clobber`.

The inventory's `acceptance: NOT_RUN` and `promotion: NOT_AUTHORIZED` are deliberate.
An extracted App identity plus package hashes does not prove installer payload equality,
installed-App behavior, N-1→N update, signing/notarization, public Service behavior,
model budget, release-manager approval or same-byte channel promotion. It is not a
signed verifier receipt or a remote authorization boundary. Those require the release
engine's later evidence and publisher adapters. Do not manually start the existing
model-backed acceptance workflow for this draft: its current tag-version contract
expects the RC suffix and this managed handoff does not reserve model spend.

Use the release-cut workflow's `GITHUB_TOKEN` path for this handoff. Local/PAT tag pushes
can start a push build in addition to an explicit dispatch; this change does not promise
exactly-once builds, resumable dispatch or a measured zero-cost run. The durable tag
marker keeps both paths draft-only, but build deduplication and account quota reservations
belong to the subsequent engine adapter. Unknown quota or possible incremental spend
means do not start an operational build. Rebuilding a stable tag is not same-byte
promotion and remains outside this slice.

Offline controls (no GitHub CLI/API, OS build or model call):

```bash
node --test scripts/release/test/build-contract.test.mjs scripts/release/test/create.test.mjs scripts/release/test/release-cut.test.mjs
python3 scripts/check-workflow-shells.py
python3 scripts/docs-harness/check.py --min-score 95
```

Actual Mac/Windows build, install/update, manager approval, quota observation and
publication are **NOT_RUN** for this implementation. Standard-runner selection alone
is not proof that an account has no incremental charge.

## Rollback

If a public release is broken:

1. In the GitHub release of `hypeproof/hypeproof-studio` and of the public mirror, change
   the broken version to a draft or a prerelease. New downloads then stop. The updater
   reads only the latest stable release.
2. Revert the cause on `main` with a PR.
3. Release the fix through the [hotfix](#hotfix) process with the next version number.

Do not make an older version the latest release again. Users who already updated may not
go back to it, because the updater installs only a higher version.

Keep the previous release artifact until the new release completes at least one workshop
or rehearsal. If the Service contract changed, the rollback must also keep token and
profile compatibility. If the App changed preview or storage behavior, the rollback must
keep the member's local `~/HypeProofGames` directory. Do not delete generated work.

This rollback process is a recommendation. The team has not confirmed it yet.

### S3 and S5 failure handling

S3 requires an issuer scoped only to the synthetic acceptance cohort/profile, with
`can_start_session`, `max_session_hours >= 1`, and `max_hours >= 1`. It opens a fresh
synthetic classroom seat for one hour, checks its served profile and activity binding,
and closes the session and confirms token revocation in `finally`. It sends no model
requests. It refuses an existing live session (`force: false`); rerun after that session
finishes. A cleanup failure is FAIL. There is no administrator-credential fallback.
The check remains NOT_RUN until the scoped secret is provisioned and does not prove
App installation or classroom rehearsal.

S5 selects the latest run/attempt for each workflow ID and job name. A superseded
failure in the same job is retained in GitHub history but does not fail the new result.
Different workflows with the same job name, missing jobs in newer runs, and external
checks remain independent. The selected pending run remains NOT_RUN; a selected
failure remains FAIL. Only the current release-cut run itself is omitted.
