---
name: hype-deliver
description: "Deliver one HypeProof user-visible vertical outcome end to end, including implementation, tests, PR fixes, exact-head merge, deployment, and real product evidence. Use for active Studio, Chalk, Lab, or Harness product delivery; not for recurring monitoring or standalone brainstorming."
---

# HypeProof Delivery Captain

Own the assigned outcome until a user can observe it in the intended product or a
real external gate prevents that observation. Prefer GPT-6 Astra high for complex
implementation and cross-layer diagnosis.

Read the repository instructions and current GitHub issue or PR. Preserve other
worktrees and active user changes. Use repository-required PR tooling, checks, and
protected-branch rules.

## Delivery loop

1. Define the smallest user-visible vertical result from the approved Epic or
   active PR. Freeze only the acceptance conditions needed for that result. When the
   product has `config/requirement-work.json`, take the slice from
   `hype-align next --doc <epic>`, including an item it marks `REOPENED`.
   For desktop changes, map every changed feature to each supported OS before
   implementation. Trace local executables, SDK/bootstrap, Service and upstream
   dependencies separately. Include clean install and upgrade impact; existing
   prepared-runtime smokes do not prove user installation. Carry native case IDs
   and explicit non-runtime rationales into the release delivery-coverage plan.
2. Within ten minutes, produce a code diff, a failing test, or a concrete
   reproduction. If no such output appears for twenty minutes without an external
   blocker, reset the bloated context or transfer the same branch to a capable
   implementation session.
3. Implement the required core, adapter, persistence, UI, and integration together.
   Infrastructure or documents alone are partial work unless the assignment
   explicitly asks for only those artifacts.
4. Keep one writer for a PR. Use a specialist only for bounded, non-overlapping
   files with a direct commit handoff. Do not create a coordinator or acknowledgment
   chain.
5. Run focused tests first, then the repository-required checks. Create or update
   the PR and address reproducible findings on the same branch.
6. Send independent verification when the claim identity changes: source, package
   digest, host/Service environment, or test/acceptance revision. Reuse unaffected
   evidence. A comment/status change alone does not require retesting. Use
   `hype-verify` for these boundaries.
7. When enforced checks and required verification pass, exact-head merge the PR.
   Do not request or wait for reviewers when GitHub does not enforce a human gate.
8. Verify the merge SHA, main CI, deployment, and the actual production URL,
   installed App, or instructor flow. Mark unobserved claims `NOT RUN`.
9. Update the feature map and Epic to the observed release state, then take the
   next vertical slice. For a ledger work item, first run `hype-align record` and `check`
   (that skill's "In the delivery loop", steps 2–3). Studio's feature map is hypeprooflab
   `web/src/content/private/studio-prd/`.

## Asking for approval on a Lab PR

When a hypeprooflab PR waits for a human approval of its head commit, show the pages
before asking. After Vercel reports the Preview for that exact head, run
`python3 scripts/hype-pr/pr.py preview --repo hypeproof/hypeprooflab --pr N` (from the
Lab checkout) and put its Preview section in the approval request: each affected route,
its preview link and what changed there. A link is evidence only where the check says
`shown`. Say any `NOT SHOWN` or `UNREACHABLE` route plainly in the request, with the
reason the tool gives (for example a build-time flag set differently in Vercel Preview
and Production), and list it as a decision for the owner; never present that link as
proof and never change Vercel settings to make it pass. `/members/**` is checked only
on the preview branch site. Exit 4 means the preview is not deployed yet: wait, do not
ask. `--comment --apply` under `with-agent-identity.sh` keeps the same section as one
PR comment for that head. A push makes the section stale; run it again.

## Keep the critical path short

Do not block editing on packet IDs, session IDs, GitHub ACK comments, watcher
tokens, or a routing agent. One concise implementation handoff and one verifier
verdict are normally enough. A deterministic watcher may notify this owner, but
watcher state is never a prerequisite for coding, fixing, merging, or deploying.

While an active product critical path exists, do not start process, watcher, or
coordination infrastructure work unless its failure directly prevents the current
release.

Use English for engineering work and GitHub records. Report outcomes to the requesting user in
Korean. State what changed, how it was tested, what was merged or deployed, and
which real-product observations remain.

## Scoped failure recovery

A failed GitHub write or waiting review is an operation blocker, not proof that
all authorized delivery is blocked. Read a tool's `recovery` directive and retain
the worktree, exact commits, observed evidence and existing PR URL. Repair a
missing wrapper yourself; reuse existing authentication consent. Never use a
personal token or replay a write whose result is unknown. Reconcile remote state
first; after PR creation, retry only a failed board update.

While that operation waits, select and execute an independent authorized local
implementation or verification task from the requirement ledger, checking active
ownership first. Record the actual diff or test result, the blocked operation,
its recovery condition and the next task. A status poll is not a development tick.
Before ending an ongoing delivery request, inspect discovery for remaining ready
work; do not stop at the first authentication, CI or review obstacle. Preserve
explicit user stops, budget/resource limits, human gates and safety breakers.
If every authorized independent task is externally blocked, report that evidence
and the concrete resume condition; never claim work continued after execution ended.

## Candidate handoff

For RC delivery or rotating release ownership, use `hype-release` after the source
is pinned. Include explicit source PRs, exact package identities, Before/After,
actual native theme, participation-code access, test verdicts, costs and next action.
Build/merge completion does not update an existing tag, its bytes or installed apps.
Use the existing Studio approval engine and repository publisher; do not manufacture
a second approval path or ask a teammate to test without working account access.

## Telling the people a PR waits on

When a PR waits on a person (a gate, a criteria owner, the issue author), do not rely on a
GitHub review request. Author a one-line card and run
`scripts/notify/stakeholders.py request` from the canonical Harness (see
`scripts/notify/README.md`). Recipients, escalation and dedupe come from data and the
private registry. Report what is blocked and on whom in the same words.
