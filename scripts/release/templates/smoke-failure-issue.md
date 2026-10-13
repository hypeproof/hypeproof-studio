{{DRY_RUN_BANNER}}
# Smoke failed — release {{VERSION}} stopped

This cycle stopped before the rc tag. No release PR was opened.

| Item | Value |
|---|---|
| Candidate commit | `{{CANDIDATE_SHA}}` |
| Range | `{{BASELINE}}..{{CANDIDATE_SHORT}}` · {{PR_COUNT}} PRs |
| Owner | release manager {{RELEASE_MANAGER}} |

## Checks

| Check | Result | Detail |
|---|---|---|
{{SMOKE_ROWS}}

## Next

1. Decide whether the failure is in the code or in the environment (Service, network, credential).
2. If it is the code, ask the authors below to look at their PRs in the range.
3. When a fix is merged, run release-cut again.

## Authors in range

{{AUTHORS}}
