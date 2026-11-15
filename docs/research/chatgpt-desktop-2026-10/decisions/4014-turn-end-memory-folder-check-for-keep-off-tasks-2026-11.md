## #4014: turn-end memory-folder check for keep-off tasks (2026-11-14, agent-selected)

Closes the shell gap left by CGP-KNOW-R-028 without a policy change. It is host-side only, and it builds on the switches.

- **When.** Only turns that begin with keep off: a snapshot at turn start and a compare in the turn's own `finally`,
  for every runtime.
- **What happens to changes (agent choice).** Nothing is deleted:
  - additions are moved into the extension's global storage (`memory-quarantine/<scope hash>/`);
  - changes are put back, with the turn's version quarantined;
  - deletions are restored from the snapshot.
  A put-back is written beside the file and renamed over it, never left half-written.
- **Whose change (agent choice).** Every `ActivityMemory` change is journaled synchronously, and so is the learner's
  editor save of a memory file. Those are left alone; everything else in a keep-off turn is attributed to the turn.
  No question is asked, because the journal already covers every path Studio itself writes through.
- **Snapshot bounds (verifier should-fix: fail closed).** Every name is listed, up to 10,000, so new names are always
  moved out. Contents are read for 250 entries, memory-named first, up to the item size; the rest are tracked by name
  only (told in the turn).
- **Studio's last state wins (verifier should-fix).** The journal keeps bytes, so a learner's save survives a later
  shell overwrite in the same turn. Editor saves are journaled from disk (BOM and CRLF safe).
- **Not covered, named:** background processes the turn started that write after it ended.
- **Quarantine bounds (agent choice, coordinator's privacy constraint).**
  - It is scoped per OS account (global storage), per seat activity (a keyed hash of its scope) and per task, with modes
    0700/0600.
  - Three pools per activity (verifier rounds 5 and 6). The learner's own displaced bytes (`orig-…`) are protected: never
    removed by count, at most 1,000, and at that cap an item is left and reported rather than an original dropped (bytes
    that exist nowhere else are kept past it). Copies of what the turn wrote: 200 and that many items' bytes, oldest
    first. Moved files: 200, oldest first. Equal stamps are ordered by name.
  - A stamp more than 60 s ahead counts as oldest, one within 60 s is clamped to now. Known residual, not handled: a
    real entry written while the clock ran more than 60 s fast is removed at the next prune after the clock is corrected.
  - It is kept seven days at most, applied at every check and at activation.
  - A task's folder is purged when the task is archived or moved.
  - It is never uploaded or logged.
  - It is named in the SHELL-R-027 deletion docs as a local copy that a deletion request does not reach.
- **The line names only the count:** `이 작업에서 기억에 쓴 내용 N개를 되돌렸어요.`

