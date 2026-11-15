# Desktop smoke scheduling (#3864)

`pr-ci.yml` keeps the existing six browser smoke recipes and the required
`extension / smoke` check. The only exclusion is an exact-source decision from
`scripts/ci/desktop-smoke-scope.py` and `config/desktop-smoke-scope.json` **read
from the immutable pull-request base**, not from the candidate checkout.

The initial policy audits `apps/studio-native/`, the exact native mobile workflow,
and two named testing documents. It does not exempt arbitrary documentation,
package/lock files, shared scripts, Service contracts, requirement-work ledgers,
or configuration. The native testing document is instructions/evidence rather
than an extension runtime fixture. Native release, platform, repository and
metadata checks retain their own selection and assertions.

`config/traceability.json` is exceptional only for additive local native evidence
links on the already-audited `ST-TEST-NATIVE-MOBILE` node. All original links,
including its desktop test links, remain unchanged and ordered; node IDs,
owners, stages, dependencies, schema and other metadata remain exact. Any other
traceability delta runs the full desktop smoke set. This covers the actual #3855
native evidence addition without treating shared metadata as documentation.

The scope job uses complete Git objects for both merge-base→PR-head and
base→tested-merge differences. It binds full base/head/checkout SHAs, merge base,
paths, file modes/blob IDs, path digest and trusted classifier/policy blob IDs.
The tested merge must have those exact base/head parents. Deletion, rename,
symlink, unknown path, mixed change, missing object or uncertain parsing keeps
full scope. Changing the general workflow, classifier or policy cannot exempt
that change. Existing main runs always keep full smoke. The first adoption,
whose base has no classifier, also requires all six shards.

The always-running aggregate downloads only this run/attempt's receipt and
recomputes it with trusted-base code. It accepts either all six selected shards
succeeding or a matching `NOT_APPLICABLE` receipt with an unrun matrix. Missing,
stale, altered or contradictory evidence, a failed scope producer, or selected
failed/cancelled/skipped shards fail. An exclusion reports **desktop smoke NOT
RUN**, never six passing tests. A dependency install failure cannot be recast as
an exclusion.

## Focused verification

Run `python3 scripts/ci/test_desktop_smoke_scope.py` through the shared resource
wrapper. These controls create real Git histories/merge commits and execute the
actual CLI plus the workflow's classification/aggregate shell blocks. They cover
native/docs exclusion, a desktop edit hidden before a final native commit,
self-modified authority, metadata boundaries, deletion/rename/symlinks, missing
objects, changed identities, altered receipts and unsuccessful job outcomes.
The repository-control CI job runs this same command; no browser dependency is
needed to decide whether browser jobs are applicable.

The local historical replay uses the ten exact before/after blobs from #3855
(`ef24c4510cf3fa5ae22df6a8f5ed1fba86a88eff`) in an isolated Git fixture with the
new classifier on its trusted base. It establishes classification and aggregate
behavior, not a historical change to that PR's execution.

Rollout remains unmeasured until one actual native-only and one audited docs-only
PR show the expected skipped matrix and valid aggregate. Record both source and
tested merge SHA, desktop runner count and queue-to-verdict duration against
#3855. No savings, native/device acceptance, release approval or change to branch
protection follows from these local controls. Making native CI mandatory at
merge is a separate #3697 follow-up.
