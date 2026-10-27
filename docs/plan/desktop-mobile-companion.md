# Desktop-first mobile companion — delivery plan

Status: approved direction, implementation and product acceptance incomplete.
Decision date: 2026-10-27. Parent: hypeproof/hypeproof-studio#2803.

## Confirmed intent

Jay asked to prioritize a computer-owned workspace that a phone/tablet connects
to, with local execution and a bounded Service relay. Children create and review
working web artifacts using familiar touch/voice/photo interactions. Adults use
the same connection for bounded work automation over explicitly selected local
resources. Work exceeding the mobile surface moves to the computer without
requiring the person to explain the project again.

The first setup happens on the computer. This is not a requirement to sit at the
computer for every subsequent request. In a classroom, the instructor prepares
the host; a learner does not need their own computer, CLI or GitHub account.

Use the existing [Product Intent](../PRODUCT-INTENT.md): useful work first,
visible human judgment, minimum necessary intervention, and evidence over claims.
Creating an artifact is not proof of a learning outcome.

## Scope correction and prior work

- The original REA v0.4 remains preserved. Its cloud-owned continuity and
  off-device recurring-execution acceptance are not fulfilled by a local host.
- Service #197/#205 and Studio #2832/#2841 describe synthetic cloud record
  experiments. Preserve those branches; do not reinterpret them as a production
  local relay or silently migrate their records.
- This plan changes the initial companion delivery order. Reconcile the parent
  and child issue acceptance explicitly through the existing MCP intake.
- Offline reading/drafting remains possible for already available content. New
  host execution waits while the computer is asleep, off, disconnected or revoked.
  There is no automatic paid cloud fallback.

## Product boundaries

| Surface | Responsibility |
|---|---|
| Desktop Studio | Canonical selected workspace, existing task/history stores, scoped tools, execution, build and durable receipts |
| Mobile | Selected project view, local drafts/outbox, review and version-bound decisions; never an unrestricted remote terminal |
| Service | Identity, scope, device revocation, metering and bounded relay; not a permanent copy of the workspace |
| Classroom host | Instructor-owned setup and isolated learner work; queue and capacity are explicit |

There are three routes: mobile interaction using available content, computer
execution with the learner staying on mobile, and continuation on the desktop
surface. Authorization is checked before routing. A desktop route is not a grant
to read other folders, execute arbitrary commands, send messages or spend money.

## Delivery order

| Slice | Priority | Observable result | Dependencies |
|---|---|---|---|
| DMC-0 | P0 | Agreed REA, supersession map, executable routing scenarios | This conversation and current source audit |
| DMC-1 | P0 | Choose an existing local workspace and inspect its host identity, owner and allowed capabilities without uploading content | DMC-0; reuse existing Studio stores and account boundary |
| DMC-2 | P0 | Pair one phone with explicit desktop confirmation; revoke it and observe denial | DMC-1; Service identity/relay contract and authenticated device proof |
| DMC-3 | P0 | Submit a bounded request on mobile, execute on the connected computer, inspect the exact result on mobile | DMC-2; durable request IDs, scoped dispatcher and result transport |
| DMC-4 | P0 | Survive sleep, disconnect, duplicate delivery and process restart without losing work or repeating execution | DMC-3; persistent inbox/outbox and receipt reconciliation |
| DMC-5 | P0 | Instructor prepares host; learner joins and revises one web artifact using touch-first controls | DMC-4; learner isolation and measured classroom capacity |
| DMC-6 | P1 | Adult reviews a document automation result; external effects require the applicable approval | DMC-4; selected-resource adapters and version-bound approval |
| DMC-7 | P1 | Desktop-only request opens the same project/version and pending intent on desktop | DMC-4; handoff checkpoint and explicit claim |
| DMC-8 | P1 | Android/iOS installed-device acceptance for input, resume, accessibility and notifications | DMC-3/4; platform implementation; real devices |

DMC-0 cannot close the parent Epic or claim a working mobile connection. Do not
make generic cloud sync, native packaging, model training or a second coordinator
a prerequisite for the first bounded request. The native UI recommendation is
research, not a human-confirmed framework selection or measured device result.

## First complete vertical acceptance

Using synthetic data, prepare a workspace on the desktop and approve one mobile
connection. On mobile, request a change to a simple web quiz. The computer executes
only the reviewed in-scope operation. Inspect and use the exact resulting version
on mobile, request a revision, then reopen the task after a disconnect. Preserve
the previous working version. An unauthorized second device cannot see or alter it.

Run the same core with an adult document fixture. Neither scenario may silently
send mail, publish a public link, add a paid cloud runner or export another user's
data. End-to-end acceptance needs the real adapters; a fake relay only proves its
test boundary.

## Decisions still open

Minimum child age and pilot conditions; class size and host hardware; phone/tablet
targets and native framework; device identity lifecycle; retention/backup pricing;
how a classroom artifact is taken home without the instructor host remaining
online. Keep these explicit. Do not invent a retention duration or promise 24/7
availability. They do not block synthetic development.

## Evidence discipline

Keep research, source tests, local integrated transport, emulator, installed real
device, classroom and production evidence separate. Track implementation in
[the requirements](../requirements/desktop-mobile-companion.md) and
[the test contract](../testing/desktop-mobile-companion.md). New tests start
NOT_RUN; no live operation is enabled by this plan.
