# ADR 0012 — Employee class data belongs to HypeProof; consent to collection is the price of free use

- Status: **Accepted** (2026-11-12, sponsor TJ — AGENTS.md DEC-028)
- Scope: Service `worker/src/lib/class-data-policy.ts` (policy keys), `worker/src/routes/classroom-participation.ts`
  (notice and consent); Studio `extensions/hypeproof-chat/src/classroomOpsHost.ts` (notice and consent before a seat
  connects); question-card answers (#3776)
- Related: Epic #751 E5, issue #3781, `docs/requirements/classroom-admin.md` "Employee class data · 2026-11-12"

## Context

An employee (재직자) class is a one-day, seven-hour practice for 20–30 adults, often from one company, taught by
HypeProof instructors and partners. Studio has been free since 2026-11-11 (pass sales closed, Service #379). With
question cards (#3776) an instructor collects learners' written answers during class, so ownership of answers and
class usage data, and whether the employer may see them, had to be decided. Until now classroom operations data had
no such decision; only end-of-class record collection (`class_report`) had its own consent (`notice-v1`).

## Decision

Sponsor, 2026-11-12: "재직자 답변은 당연히 하입프루프에 귀속되는거지. 무료로 쓰게 하는 대신에 사용하는 데이터 수집에
동의하는거야. 고용주는 볼일이 없어."

| Topic | Decision | Code key (`CLASS_DATA_POLICY`) |
|---|---|---|
| Ownership | Question-card answers and class usage data are collected and kept by HypeProof | `controller: 'hypeproof'`, `covers` |
| Exchange | Consent to that collection is the condition of using Studio for free | first sentence of the notice |
| Employer | No access to individual answers or usage; no aggregates either until a later decision adds them | `access.employer: 'none'`, `employer_aggregates: false` |
| Partner | Same as the employer. A partner's instructor who teaches the run sees answers only as that run's instructor | `access.partner: 'none'` |
| Instructor | Instructors assigned to the run (creator and added co-instructors) see its answers for teaching | `access.instructor: 'assigned_run'` |
| Retention | HypeProof's data policy; no automatic deletion | `retention: { mode: 'hypeproof_policy', auto_delete: false }` |
| Consent unit | class run × learner × notice version; a new version needs a new consent | `notice_version: 'class-data-v1'`, `purpose: 'class_participation'` |
| Minors | Cannot consent in the app | `adult_only: true` |
| Withdrawal | Any time. The Service closes the seat's class connection (nothing further is collected) and removes that class's answers (answer storage lands with #3776) | consent API `consent:false` |

Consent is asked at two points:

1. Before a learner connects a class seat, the app shows the Service's notice
   (`GET /v1/classroom/ops/participation/notice`). On accept the app connects, then records version and time with
   `POST …/participation/consent`. On decline the code is not used and the seat is not connected; personal Studio use
   is unaffected. If the Service does not record the consent, the app lets the new connection go at once, so no usage
   is reported that a recorded consent does not cover.
2. When a learner first answers without a live consent (older version, withdrawn, recording failed) the Service
   refuses the answer and the app shows the same notice again (#3776).

The instructor status view shows `participation_consent: given | missing` per seat. Consent never hides a seat.

## What this does not change

- End-of-class record collection (`class_report`, `notice-v1`) keeps its own consent; this one does not replace it.
- Report delivery (`ops_delivery`) is off in production. Under this decision an employer may not be a delivery
  recipient; re-read this ADR before enabling delivery.
- The connect message "대화 내용과 파일은 보내지 않으며" stays true: an answer is only what the learner typed into a card.
  The message now says the instructor also sees the consent state and question-card answers.

## Known gap

An app older than this change never shows the notice. Against an operations-enabled Service it can still connect a
seat with a per-seat ticket, and that seat reports usage without a recorded consent (the board shows the seat as
`missing`). The enablement step (#3780) ships the new app first and treats `missing` seats as "update the app".

## Human items (not blockers for development or staging)

- Final legal review of the draft wording `CLASS_DATA_NOTICE`. If the wording changes, bump `notice_version` and
  set `wording_review` to reviewed. Owner: not assigned.
- Whether the privacy policy needs a "class participation data" section. Owner: not assigned.
