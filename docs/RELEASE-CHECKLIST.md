# Studio Release Checklist

Use this checklist on release day. The rules and the reasons are in
[docs/dev/06-release-process.md](dev/06-release-process.md).

The previous checklist for v0.1.0 is archived in
[docs/archive/release/RELEASE-CHECKLIST-v0.1.0.md](archive/release/RELEASE-CHECKLIST-v0.1.0.md).

## 1. Before the cut

- [ ] Make sure that no class is live. The release workflows stop for a live session.
- [ ] Make sure that the PRs for this release are merged into `main`. Later merges go to
      the next release.
- [ ] Select the release manager for this week. The release manager is a member with
      write access.

## 2. Release cut

1. Open the Actions tab of `hypeproof/hypeproof-studio`.
2. Select the `release-cut` workflow.
3. Click **Run workflow**. Set `mode` to `create`.
4. Check scoped credentials before the cut. S3 requires `HPS_ACCEPTANCE_ISSUER` (missing as of 2026-10-16); S4 requires `HPS_CANARY_ISSUER`. Provision missing credentials and rerun. Only an explicitly approved exception may set `accept_not_run`. The release PR then shows
   the `NOT_RUN` checks.
5. Wait for the run to finish. Read the job summary.

- [ ] If smoke failed: open the smoke failure issue. Find the cause with the authors in the
      range. Merge a fix. Then run the release cut again.
- [ ] If smoke passed: record the rc tag, the two build runs and the release PR link.

## 3. rc build

The rc builds take one to two hours for each OS. They run the automatic E2E on macOS and
Windows. Then they publish the rc as a prerelease.

- [ ] Make sure that `verify-unified-release` passed for the rc tag.
- [ ] Install the rc build with the one-liner at the top of the prerelease notes. It
      installs beside the main App, in `~/Applications/HypeProof-RC-<version>/` with its own
      profile, and checks the zip's SHA-256 and the product version:

      ```bash
      curl -fsSL https://github.com/hypeproof/hypeproof-studio/releases/download/<rc tag>/install-mac.sh | bash
      ```

- [ ] Testers who want double-click files get `HypeProof-<rc tag>-Test-Kit.zip` from the
      same page. A browser download of a Mac zip is quarantined; the one-liner is not.

Installed Apps do not update to a prerelease. Install the rc build by hand.

## 4. Release manager check

Do these steps on the rc build.

1. Read section 3 of the release PR (dependency and deploy changes). Confirm what each PR
   needs before the release goes out.
2. Do each check in section 4 (feature checklist). Follow the `how to check` line.
3. Mark each item: `checked`, `could not check — <reason>`, or `problem → #<issue>`.
4. If an item has no `how to check` line, ask the author or read the linked issue.
5. Tick the boxes in the release PR.

- [ ] If you found a problem that blocks the release: do not approve. Open an issue. Merge
      a fix. Run the release cut again. It creates the next rc and updates the release PR.

## 5. Approval and publication

1. Approve the release PR. Use an account with write access.
2. Make sure that the approval is on the latest commit of the release PR.

Until the approval workflow exists, also do these steps:

3. Push the `v` tag on the rc commit. Replace the version and the rc number:

   ```bash
   git fetch origin --tags
   git tag v2026.1013.0 'v2026.1013.0-rc.1^{}'
   git push origin v2026.1013.0
   ```

4. Wait for the `v` tag builds and `verify-unified-release`. The publish gate checks the
   approval. Then the release becomes public and the mirror updates.
5. Merge the release PR.

- [ ] If the release stayed a draft: read the publish gate result in the job summary. Fix
      the cause. Run `verify-unified-release` again for the tag.

## 6. After publication

Record these items separately for the personal trial path and the classroom path.
The reason for each item is in
[Trial and classroom delivery](dev/06-release-process.md#trial-and-classroom-delivery).

- [ ] The public App tag, the asset digest and the source commit.
- [ ] After the restart: the executable path, the App version and commit, and the bundled
      extension version.
- [ ] The Service `/v1/health` version and the profile, from the authenticated API.
- [ ] The Module pin, or the compiled Service prompt revision.
- [ ] On macOS, both shortcuts open `/Applications/HypeProof Studio.app`.
- [ ] If one path is old or not tested, report the delivery as incomplete. Name the path and
      the action.

## 7. Endpoint or configuration change

When a default that the App ships changes (for example the Service host), all distributed
builds are old. Do a full release, and also do these steps:

- [ ] Find the groups of users first. Send one message for each group, not one message for all.
  - Users of an old build need the new build.
  - Users of the current build already have the new default. Do not send them a settings change.
  - Users without a token get 401 or 403 for every URL. Tell them how to get a token.
- [ ] Before you send a message, follow its steps on a clean installation. If you cannot
      reproduce the failure that it fixes, the message is wrong.
- [ ] On the new build, tell users to remove an old `hypeproofChat.proxyUrl` setting.
      An old setting hides the new default.

## 8. Hotfix

Use the [hotfix process](dev/06-release-process.md#hotfix). Skip sections 3 to 5 of this
checklist. Do sections 6 and 7.

- [ ] The hotfix PR goes into `hotfix/<last v tag>` and has the `hotfix` label.
- [ ] CI and smoke passed.
- [ ] The tag is the next version number of the day.
- [ ] The forward-port PR to `main` is open.

## 9. Rollback

Use the [rollback process](dev/06-release-process.md#rollback).

- [ ] Change the broken release to a draft or a prerelease in the main repository and in the
      public mirror.
- [ ] Revert the cause on `main`.
- [ ] Release the fix as a hotfix.
