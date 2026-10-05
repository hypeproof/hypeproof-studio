-- cr-review (#1398; recon R5, R9; CR-48–CR-53) — the Weekly Review Pack, Venture Memory's WeeklyReviews.
--
-- One row per prepared revision of one team's (Project's) pack for one curriculum week. Each row
-- holds one hps-venture/1 document (`doc`, JSON, format hps-weekly-review/1): the ten sections as
-- they were composed, each with the digest of what it was composed from. A pack is a cached view
-- of Venture Memory and the measurement-core record (SX-48): its claims name their sources by
-- reference, the evidence stays in the record, and a pack whose sources changed is marked stale
-- when it is opened. Rows are immutable; a new preparation writes the next revision, and a
-- director's decision names the revision it was written from. Deleting a team's participant data
-- (CR-69) deletes its packs.
--
-- Additive and re-runnable. Applying it in production is Jay's decision (recon §9). Number 0036
-- is reserved by an open Chalk PR; 0037 is chalk-judgements.

CREATE TABLE IF NOT EXISTS cr_weekly_reviews (
  project_id TEXT NOT NULL REFERENCES cr_projects(id),
  week       INTEGER NOT NULL,
  revision   INTEGER NOT NULL,
  doc        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, week, revision)
);
