-- #1013 feedback-loop — a person's feedback, the learner's own answer to it, and the instructor's lesson retrospective
-- that starts the next draft. Additive: no existing table or column is touched, every statement is safe to re-apply.
-- Read and written only while the Service sets HPS_FEEDBACK_LOOP=enabled; apply this file to a database before that.
-- Contract: docs/testing/chalk-authoring.md#feedback-loop-20261005.
-- Numbered 0039, not 0038: 0038 is 0038-curriculum-runtime-review.sql (#1398, branch feat/cr-review), developed at the same time.

-- The learner's decision after a person's feedback on one share they chose to send (AE-43): revise, keep or hold, and why.
-- Bound to the feedback text it answers (its sha256), so a later edit of the feedback is visibly a different question.
-- Rows live and die with the share: a withdrawn or purged share takes its answers with it (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS classroom_share_responses (
 share_id TEXT NOT NULL REFERENCES classroom_shares(id) ON DELETE CASCADE,
 feedback_sha256 TEXT NOT NULL,
 feedback_revision INTEGER NOT NULL,
 decision TEXT NOT NULL CHECK (decision IN ('revise','keep','hold')),
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY (share_id, feedback_sha256)
);

-- Which lesson the learner was executing when they sent a share, as the chat gate resolves it (their code's lesson, or the
-- setting they are switched to where settings are enforced). Written once, right after the share is stored, while the
-- switch is on: identifiers and a hash, no content. A share without a row is "lesson unknown" to a retrospective, never
-- attributed to a version on a guess. Deleted with the share (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS classroom_share_lessons (
 share_id TEXT PRIMARY KEY REFERENCES classroom_shares(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL,
 version TEXT NOT NULL,
 lesson_sha256 TEXT NOT NULL,
 source TEXT NOT NULL,
 recorded_at INTEGER NOT NULL
);

-- The instructor's retrospective of one frozen lesson version (AE-42, CH-05): hypothesis, sourced findings, keep/revise/hold
-- decisions and the instructor's own notes on what was not observed. `doc_json` holds the instructor's words and REFERENCES
-- to shares (id + part) only, never a copy of a learner's content, so withdrawal and expiry keep working. Editable while
-- open (CAS on `revision`); written once into the next draft (`applied_*`), after which it is immutable.
CREATE TABLE IF NOT EXISTS lesson_retrospectives (
 retro_id TEXT PRIMARY KEY,
 cohort_id TEXT NOT NULL,
 course_id TEXT NOT NULL,
 base_version TEXT NOT NULL,
 base_sha256 TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision >= 1),
 doc_json TEXT NOT NULL,
 request_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 applied_draft_revision INTEGER,
 applied_request_id TEXT,
 applied_at INTEGER,
 UNIQUE (cohort_id, course_id, request_id),
 FOREIGN KEY (cohort_id, course_id) REFERENCES authoring_drafts(cohort_id, course_id)
);
CREATE INDEX IF NOT EXISTS lesson_retrospectives_course ON lesson_retrospectives(cohort_id, course_id, created_at);
