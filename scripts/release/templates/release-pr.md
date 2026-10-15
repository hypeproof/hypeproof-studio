{{DRY_RUN_BANNER}}
# Release {{VERSION}}

The release manager works through the sections in order.

## 1. Candidate

| Item | Value |
|---|---|
| Candidate commit | `{{CANDIDATE_SHA}}` |
| Range | `{{BASELINE}}..{{CANDIDATE_SHORT}}` · {{PR_COUNT}} PRs |
| rc tag | `{{RC_TAG}}` |
| rc build · automatic E2E | {{RC_BUILD_LINK}} |
| Service at smoke time | `{{SERVICE_VERSION}}` |
| Chalk at smoke time | `{{CHALK_VERSION}}` |

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
- Conditions: smoke PASS, every box above ticked, an approving review from that member.
- After the approval the v tag goes on the same commit as `{{RC_TAG}}`; the publish gate checks this.
- On approval, `{{FINAL_TAG}}` is tagged on `{{CANDIDATE_SHORT}}` and published.
