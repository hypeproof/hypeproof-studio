{{DRY_RUN_BANNER}}
# Release {{VERSION}}

**rc install (macOS, side by side — the main install is untouched):**

```bash
{{INSTALL_ONELINER}}
```

The release manager works through the sections in order. Black-box process: [release casebook](https://github.com/hypeproof/hypeproof-studio/blob/main/docs/operations/release-casebook/README.md).

## 1. Candidate

| Item | Value |
|---|---|
| Candidate commit | `{{CANDIDATE_SHA}}` |
| Range | `{{BASELINE}}..{{CANDIDATE_SHORT}}` · {{PR_COUNT}} PRs |
| rc tag | `{{RC_TAG}}` |
| rc build · automatic E2E | {{RC_BUILD_LINK}} |
| Service at smoke time | `{{SERVICE_VERSION}}` |

## 2. Automatic checks

### Smoke — {{SMOKE_RESULT}}

| Check | Result | Detail |
|---|---|---|
{{SMOKE_ROWS}}

### Automatic E2E (rc build acceptance)

- [ ] `verify-unified-release` passed on macOS and Windows. {{RC_BUILD_LINK}}

## 3. Dependency and deploy changes

These PRs changed Service pins, build/deploy/release workflows, migrations or wrangler config. Confirm what each one needs before this release goes out.

{{DEPENDENCY_ITEMS}}

## 4. Feature checklist

New features and user-visible fixes. Check each on the rc build and mark it `checked`, `could not check — reason` or `problem → issue #`. "How to check" comes from the PR author.

{{FEATURE_ITEMS}}

### Changed requirements

Requirement ids in the range's commit messages and requirement-doc diffs.

{{CHANGED_REQUIREMENTS}}

### Black-box cases

Run on the rc install above. An agent pre-test comment (`hps-blackbox-run/1`) may already cover some cases; the release manager runs the rest. Any P0 FAIL means no approval.

{{BLACKBOX_CASES}}

## 5. Automatic — no manual check

CI, build, docs, test and dependency-update PRs. The automatic checks above cover them.

{{AUTOMATIC_ITEMS}}

## 6. Missing smoke declarations

PRs after the smoke baseline without a `smoke:` line.

{{SMOKE_MISSING}}

## 7. Rollback

{{ROLLBACK}}

## 8. Approval

- Release manager: {{RELEASE_MANAGER}}
- Conditions: smoke PASS, every box above ticked, no P0 black-box case FAIL, an approving review from that member at the PR's exact head.
- After the approval the v tag goes on the same commit as `{{RC_TAG}}`; the publish gate checks this.
- On approval, `{{FINAL_TAG}}` is tagged on `{{CANDIDATE_SHORT}}` and published.
