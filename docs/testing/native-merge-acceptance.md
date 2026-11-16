# Native merge acceptance (#4218)

The existing native workflow reports the stable `native / acceptance` check on
every pull request. It joins the existing contract, iOS and Android jobs; it does
not execute another native suite. Existing main path selection and manual
invocation retain full native acceptance.

A complete base/head/actual-merge Git comparison may prove an unrelated change.
The initial audited inputs are desktop extension source, webview source, desktop
tests and the named desktop smoke scheduling document. Shared manifests,
requirements/traceability, release casebooks, scripts, workflows, native changes,
deletions, special files and unknown inputs retain full native scope. No blanket
documentation exclusion applies. Adding a native dependency on an excluded input
requires updating this reviewed policy.

Both scope and aggregate execute the helper and existing native identity module
from the immutable event base. The helper embeds its versioned conservative
allowlist; its Git blob ID and the identity module's ID are in the receipt.
Both complete differences, modes/blob IDs, source head, tested checkout, native
tree/workflow, run and attempt are bound. An edited helper/workflow cannot exempt
itself. First adoption has no trusted helper yet and requires full native results.
A missing source object either keeps full scope or fails the gate before platform
allocation; it never creates an exclusion.

The aggregate always runs, but new work respects explicit cancellation. It
recomputes the scope receipt and requires every selected job to be `success`.
Pending, absent, failed, skipped or cancelled selected results remain failures.
Unrelated scope requires all three jobs to be skipped and reports
`NOT_APPLICABLE` / native execution **NOT_RUN**. Both lightweight jobs have
five-minute bounds. Existing platform timeouts, recipes and assertions are exact.

A full pass additionally verifies the existing current-attempt native-candidate
artifact through `verify-native-candidate.py`. Failed-job-only reruns that lack
current-attempt scope/candidate evidence cannot borrow older success; reconcile
and use the existing all-jobs rerun path deliberately if needed. No automatic
retry is introduced. The merge receipt is a distinct schema, grants no release
authority, and cannot replace TestFlight's exact native-candidate gate or signed-in
journey requirements.

## Verification and rollout

`python3 -m unittest discover -s apps/studio-native/tests -p 'test_native_merge_gate.py' -v`
creates real Git histories and executes the actual workflow shell blocks. It
covers native/full success, unrelated N/A, first adoption, complete multi-commit
diffs, source/control changes, missing objects, stale source/run/attempt receipts,
contradictory results, and pending/failing/cancelled/skipped/missing native jobs.
These are deterministic result-boundary controls, not native/device or GitHub
branch-protection acceptance.

This workflow alone does **not** prevent GitHub auto-merge. After the workflow is
reviewed and observed, the authorized operator must add `native / acceptance` to
both canonical required checks and effective main protection, preserving existing
contexts, App IDs, strictness and all other settings. The private companion patch
records the observed five live contexts and separate canonical process-check
drift; it must be rebound to a fresh protection read before application. No policy
or protection is mutated by this Studio change.

Actual early-enabled auto-merge blocking, unrelated PR runner allocation and
current-source success must be observed after that authorized rollout. Until
then, enforcement is **NOT_APPLIED / NOT_OBSERVED**. PR #4206's original failure
and the working TestFlight refusal remain historical evidence; this change does
not rewrite them or establish physical microphone/account/provider acceptance.
