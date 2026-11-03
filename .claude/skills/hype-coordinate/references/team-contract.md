# HypeProof delivery contract

The default delivery unit is one user-visible vertical outcome owned by one Delivery
Captain. A persistent five-role relay is not the default.

## Critical path

- The Captain owns requirements needed for the slice, implementation, tests, PR
  fixes, exact-head merge, deployment, and real-product evidence.
- Produce a diff, failing test, or concrete reproduction within ten minutes.
  Twenty minutes without one and without an external blocker triggers context reset
  or owner replacement.
- Use one writer per PR. A specialist may edit only bounded, non-overlapping files
  and returns a commit directly to the Captain.
- Packet IDs, session IDs, GitHub ACK comments, watcher tokens, and routing agents
  never block coding, fixing, merging, or deployment.

## Verification

Independent verification starts for a changed claim identity: source SHA, package
digest, test/acceptance revision, OS/architecture, Service or relevant environment
(including theme, certificate trust and account capabilities). The verifier records
that identity, reuses unaffected evidence, and
reports PASS, FAIL, BLOCKED, or NOT RUN directly to the Captain. A review comment or
status change alone does not justify same-SHA retesting. The verifier never edits the
author branch or acts as a human approver.

## Integration and evidence

When enforced checks and required evidence pass, the Captain exact-head merges
without requesting reviewers unless GitHub enforces a real human gate. Verify the
merge SHA, main CI, deployment, and the actual production URL, installed App, or
instructor flow. A document, local test, PR, CI run, preview, deployment, and real
product observation prove different claims.

## Watcher

A deterministic no-model watcher may emit one revision-deduplicated notification to
the current owner. It does not choose product scope, create GitHub comments, require
acknowledgment, or become a delivery state machine. Its failure never stops active
work. The existing coordinate scripts remain available only for legacy recovery
until an alert-only watcher replaces them.

## Optional specialists

Use Intent only for a real product ambiguity or conflict with approved Intent. Use
Studio or Chalk specialists only for a bounded non-overlapping implementation
subtask. Specialists begin work immediately, run relevant tests, return a commit
SHA and evidence, and stop. They do not discover the global backlog, poll, merge,
deploy, or create coordination state.

Use English for engineering and GitHub records. Report to the requesting user in Korean.

For release preparation and rotating managers, use `hype-release`. Its shared
state records operational ownership and observations; the product engine retains
signed acceptance and the repository publisher retains publication authority.
