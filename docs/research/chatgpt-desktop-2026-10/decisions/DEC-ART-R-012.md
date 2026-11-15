## DEC-ART-R-012: publish responsibility notice (2026-11-12, agent choice)

Built (notice for every seat, Studio-only):

- Placement (agent choice): an inline sheet beside the button that makes a new link, not a modal.
  The publish flow already has a visitor preview and an outbound checklist with a public step
  (CGP-KNOW-R-007); a third modal would train dismissal. The sheet comes first, so nothing is
  built or sent before it is acknowledged.
- Scope (agent choice): both link producers, `submit` (first publish) and `link` (another channel's
  link of a running experiment), are gated. A learner who published before this change reads the
  notice once at their next new link.
- Versioning (agent choice): `PUBLISH_NOTICE_VERSION` in `extensions/hypeproof-chat/src/publishNotice.ts`.
  Any copy change is a new version. Acknowledgments are kept per owner digest per version in machine
  `globalState` (not workspace state), so another learner on the same machine reads it and moving
  folders does not ask again. The record is local; it is not sent to the Service and Chalk cannot
  see it. A cleared profile asks again, which is the safe direction.
- Copy (agent choice): three bullets adapted from the observed ChatGPT terms modal (who can open it,
  who is responsible for its content, personal data), in the learner's register. No policy or
  removal claim is made, because no Studio removal policy is written down.

Not built (minor path, REQ-ART-12 parts 2 and 3, DES-ART-12 waiting state, Chalk badge):

- What exists: no served SX-41 flag (spec only, `docs/requirements/studio-learning-experience.md`
  SX-41, P2), no Service link state other than live/revoked/expired, no confirm route, no Chalk list.
  `curriculumRuntimeAllowed` lets minor cohorts publish ("Age does not decide it", 2026-10-05), so a
  minor cohort's link is reachable as soon as it is issued, before and after this change.
- Plan, in order, each its own PR behind a default-off profile flag, "Confirmed by Jay: no":
  1. Service (hypeproof-service): a served profile flag (for example
     `curriculum_runtime.publish_confirmation: "instructor"`, absent = off); `POST /experiments/:id/links`
     creates the link `pending_confirmation` when the flag is on; the test origin answers a pending
     link like a revoked one (no content, no session open, no events); an issuer-token route lists
     and confirms (or declines) pending links of the issuer's cohorts; the project read returns
     `pending_confirmation` with its request time. Negative test: a pending link's URL, files and
     `__hp` routes return no product content.
  2. Studio: a fourth sharing state `선생님 확인을 기다리고 있어요` with the spinner-free `기다리는 중` label
     and a time-since counter, refreshed by the existing 15-second and focus reads (no reload); copy
     stays off until confirmed.
  3. Chalk: pending confirmations listed in `/manage` with a count badge, confirm and decline.
- Open question 4 (agent answer, conservative): for a minor cohort the CR-20 one-minute clock starts
  at instructor confirmation, not at the learner's publish action. The waiting time is recorded
  separately (the counter above and the request/confirm times), never as a product miss and never
  as a reason to shorten or skip confirmation. DEC-15 stays Jay's decision.
- Confirmed by Jay: no (all choices above are agent choices).

