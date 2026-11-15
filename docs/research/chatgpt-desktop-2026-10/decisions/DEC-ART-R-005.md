## DEC-ART-R-005: instructor comment on an approved artifact version (2026-11-13, agent choice)

Built (Service hypeproof/hypeproof-service#437, Studio + Chalk in this PR):

- Channel (agent choice): a new distribution content kind `comment` on the existing U2 ledger, not a new message channel.
  Targets, re-offer, withdrawal and device receipts are the ones notices and question cards already use. The learner's
  answer is a row in `classroom_question_answers`, so it inherits the class-data consent (ADR 0012), secret masking,
  instructor-only reads and erasure on consent withdrawal. No new table, no migration.
- Anchor (agent choice): `artifact_sha256` (the sha256 of index.html that the learner approved, U1b) plus a permille
  rectangle or a plain element reference. Chalk offers nine regions because it has no viewer of the approved page
  (REQ-ART-22, P2). The rectangle contract already admits a precise click-to-place anchor later. Line numbers are never
  used.
- Which versions (agent choice): a verified collection's extent now names `approved_versions`, the approved pages whose
  bytes arrived. Chalk offers a comment only for those versions. Studio shows a comment only on a version that this
  learner approved on this device, read from their own spool sessions by identity. That makes "never on another
  learner's artifact" a device-side check and not only a Service promise. The Service also sends a comment to one seat
  only and never to a different seat later.
- Thread (agent choice): one current state per learner per comment revision, `{handled, reply?}`. Each answer
  replaces the last. There is no message history, and an instructor follow-up is a new revision. This keeps the
  stored data the same shape as a question-card text answer.
- Switch (agent choice): comments ride `ops_questions` ("learners in this run may write back") instead of a new run flag.
- Pin (agent choice): a 16 px pin on a page outline in the inbox's side list, not on the live preview tab. The native
  BrowserTab has no trusted in-tab surface (the same gap as CGP-ART-D-002, D-006 and D-008). The place is also said in
  words. The instructor colour is a filled Paper disc with a control-boundary ring. The learner's own annotations are
  outlined and numbered, never filled.
- Coach (agent choice): there is no forward-to-coach action. The REQ allows an explicit forward, but nothing requires
  one, and leaving it out keeps the negative condition trivially true. A learner can still quote the comment by typing it.

Parked for Jay (not built, Confirmed by Jay: no):

- Minor learners. The class-data consent is `adult_only: true`, so a child profile cannot send a reply or a handled
  state. The Service refuses with `guardian_consent_required`, and Studio says `이 수업은 보호자 동의가 필요해 앱에서
  답글을 보낼 수 없습니다. 의견은 계속 볼 수 있습니다.` A minor can still read comments. Question: may a minor send the
  handled state (no text), and may a minor send a reply? Recommended: allow the handled state only, stored under the run
  and deleted with it, and keep text replies adult-only until a guardian-consent path exists. Either way this is a new
  data category about minors, so it needs Jay.

Confirmed by Jay: no (all choices above are agent choices).

