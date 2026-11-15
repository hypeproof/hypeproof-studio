// #4124 (CGP-KNOW-R-028 follow-ups 1 and 3) — a task's memory quarantine goes with the task, without racing a new turn.
// 1. purgeTaskQuarantine renames the task folder to a tombstone before it first yields, then deletes only the tombstone.
//    The task handler does not await it, so a new turn right after archive → restore writes into a fresh folder that the
//    late delete can no longer reach. pruneQuarantine finishes a tombstone a crash left behind.
// 2. Behaviour, on the real provider and task store (test/task-workspace-harness.mjs): 보관하기 and 옮기기 remove that
//    task's quarantine folder and leave the others; a refused move keeps it; a host without global storage, or without a
//    memory scope, is a no-op that never throws, and the archive still happens.
// Run: node --experimental-strip-types test/memory-quarantine-purge.smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { ORIGINAL_PREFIX, PURGE_PENDING_PREFIX, PURGE_TMP_GRACE_MS, PURGE_TOMBSTONE_PREFIX, QUARANTINE_LIMITS, clearStudioMemoryJournal, noteStudioMemoryChange, pruneQuarantine, purgeTaskQuarantine, revertTurnChanges, snapshotMemoryFolder } from '../src/memoryFolderGuard.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log(`  ok   ${name}`); };
const top = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-quarantine-purge-'));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const scopeKey = (scope) => createHash('sha256').update(`hps-memory-quarantine/1\0${scope}`).digest('hex').slice(0, 24);
const seed = (dir, name = `${stamp()}-1-copy.md`, text = '격리된 기억\n') => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); return path.join(dir, name); };

try {
  await t('race: a copy a new turn writes right after an unawaited purge survives; the old copies go', async () => {
    const base = path.join(top, 'race'), scope = 'b'.repeat(24), task = 'task-1', dir = path.join(base, scope, task);
    const old = seed(dir, `${stamp()}-1-old.md`, '보관 전 사본\n');
    const purge = purgeTaskQuarantine(base, scope, task); // not awaited, exactly like the task handler
    // The restored task's new turn writes its copy now, before the purge's delete runs.
    const fresh = seed(dir, `${stamp()}-2-new-turn.md`, '새 턴의 사본\n');
    await purge;
    assert.equal(fs.existsSync(old), false, 'the archived task\'s copies are gone');
    assert.equal(fs.readFileSync(fresh, 'utf8'), '새 턴의 사본\n', 'the new turn\'s copy survives the late delete');
    assert.deepEqual(fs.readdirSync(path.join(base, scope)), [task], 'no tombstone is left behind');
  });

  await t('tombstone: the rename happens before the first await, and prune finishes a tombstone a crash left', async () => {
    const base = path.join(top, 'tomb'), scope = 'c'.repeat(24), dir = path.join(base, scope, 'task-2');
    seed(dir);
    const purge = purgeTaskQuarantine(base, scope, 'task-2');
    assert.equal(fs.existsSync(dir), false, 'the task folder is moved away synchronously');
    assert.equal(fs.readdirSync(path.join(base, scope)).filter((n) => n.startsWith(PURGE_TOMBSTONE_PREFIX)).length, 1, 'into one tombstone');
    await purge;
    // A crash between rename and delete: the tombstone is swept on the next prune; a real task folder is untouched.
    const left = path.join(base, scope, `${PURGE_TOMBSTONE_PREFIX}task-3-abcdef012345`); seed(left);
    const keep = seed(path.join(base, scope, 'task-4'));
    await pruneQuarantine(base);
    assert.equal(fs.existsSync(left), false, 'a left-over tombstone is removed');
    assert.ok(fs.existsSync(keep), 'a task folder is kept');
    // Malformed keys and a missing folder touch nothing and never throw.
    await purgeTaskQuarantine(base, '../..', 'x'); await purgeTaskQuarantine(base, scope, '../task-4'); await purgeTaskQuarantine(base, scope, 'missing');
    assert.ok(fs.existsSync(keep));
  });

  // ─── a refused rename (EPERM/EBUSY): marked with the exact names, retried at prune, resumable after a crash ───
  const refused = (code = 'EPERM') => ({ rename: () => { throw Object.assign(new Error(code), { code }); } });
  const busyRetry = { rename: async () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } };
  const markOf = (scopeDir, task) => JSON.parse(fs.readFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + task), 'utf8'));
  const stampAt = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-');

  await t('a refused rename never deletes in place: the mark names the exact files and the tombstone; a refused retry keeps everything', async () => {
    const base = path.join(top, 'refused'), scope = 'd'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-5');
    const old = seed(dir, `${stampAt(Date.now() - 60_000)}-1-before-archive.md`, '보관 전 사본\n');
    const orig = seed(dir, `${ORIGINAL_PREFIX}${stampAt(Date.now() - 60_000)}-2-k.md`, '보관 전 원본\n');
    for (const code of ['EPERM', 'EBUSY']) {
      await purgeTaskQuarantine(base, scope, 'task-5', refused(code));
      assert.ok(fs.existsSync(old) && fs.existsSync(orig), `${code}: nothing is deleted from the live folder`);
    }
    const mark = markOf(scopeDir, 'task-5');
    assert.deepEqual(mark.files, [path.basename(orig), path.basename(old)].sort(), 'the mark lists exactly what the folder held at purge time');
    assert.ok(mark.tomb.startsWith(PURGE_TOMBSTONE_PREFIX) && !('at' in mark), 'and the tombstone name, with no clock in it');
    // Restore + new turn; the next prune is refused again: everything stays, still marked.
    const fresh = seed(dir, `${stampAt(Date.now())}-3-after-restore.md`, '새 턴의 사본\n');
    await pruneQuarantine(base, Date.now(), busyRetry);
    assert.ok(fs.existsSync(old) && fs.existsSync(orig) && fs.existsSync(fresh), 'a refused retry deletes nothing');
    assert.ok(fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-5')), 'and keeps the mark');
    // The next prune can rename: only the listed files go; the new turn's copy is back; nothing else is left.
    await pruneQuarantine(base);
    assert.ok(!fs.existsSync(old) && !fs.existsSync(orig), 'the listed files are gone');
    assert.equal(fs.readFileSync(fresh, 'utf8'), '새 턴의 사본\n', 'the restored task\'s new copy is kept');
    assert.deepEqual(fs.readdirSync(scopeDir), ['task-5'], 'no mark and no tombstone are left');
    // ENOENT is not a refusal: nothing to purge, no mark.
    await purgeTaskQuarantine(base, scope, 'never-there');
    assert.equal(fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'never-there')), false);
  });

  await t('the clock steps back after the purge: a restored task\'s new copy stamped earlier than the purge is still kept', async () => {
    const base = path.join(top, 'clockback'), scope = '2'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-6');
    const old = seed(dir, `${stampAt(Date.now())}-1-before.md`, '보관 전\n');
    await purgeTaskQuarantine(base, scope, 'task-6', refused());
    // The clock stepped back 5 s: the new turn's copy carries an EARLIER stamp than the purge-time copy.
    const fresh = seed(dir, `${stampAt(Date.now() - 5_000)}-2-after-restore.md`, '시계가 뒤로 간 뒤의 사본\n');
    await pruneQuarantine(base);
    assert.ok(!fs.existsSync(old), 'the purge-time copy goes');
    assert.equal(fs.readFileSync(fresh, 'utf8'), '시계가 뒤로 간 뒤의 사본\n', 'the new copy stays: the decision is by name, not by time');
  });

  await t('a crash after the retry renamed the folder (before any move-back) resumes at the next prune; nothing is lost', async () => {
    const base = path.join(top, 'crash-rename'), scope = '3'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-7');
    const old = path.basename(seed(dir, `${stampAt(Date.now())}-1-before.md`, '보관 전\n'));
    await purgeTaskQuarantine(base, scope, 'task-7', refused());
    const freshName = path.basename(seed(dir, `${stampAt(Date.now())}-2-after.md`, '새 사본\n'));
    // Simulate the crash: the retry's rename happened, nothing else did (no move-back, the mark still there).
    const { tomb } = markOf(scopeDir, 'task-7');
    fs.renameSync(dir, path.join(scopeDir, tomb));
    // A prune whose rename would now get ENOENT for the task folder must NOT drop the mark and remove the tombstone whole.
    await pruneQuarantine(base);
    assert.equal(fs.readFileSync(path.join(dir, freshName), 'utf8'), '새 사본\n', 'the unlisted copy was moved back from the tombstone');
    assert.ok(!fs.existsSync(path.join(dir, old)) && !fs.existsSync(path.join(scopeDir, tomb)), 'the listed copy and the tombstone are gone');
    assert.deepEqual(fs.readdirSync(scopeDir), ['task-7'], 'the mark is gone too');
  });

  await t('a crash during the move-back resumes: what is still in the tombstone is moved back, never deleted', async () => {
    const base = path.join(top, 'crash-move'), scope = '4'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-8');
    const old = path.basename(seed(dir, `${stampAt(Date.now())}-1-before.md`, '보관 전\n'));
    await purgeTaskQuarantine(base, scope, 'task-8', refused());
    const a = path.basename(seed(dir, `${stampAt(Date.now())}-2-a.md`, '새 A\n')), b = path.basename(seed(dir, `${stampAt(Date.now())}-3-b.md`, '새 B\n'));
    const { tomb } = markOf(scopeDir, 'task-8');
    // The crash: renamed, then only A was moved back.
    fs.renameSync(dir, path.join(scopeDir, tomb)); fs.mkdirSync(dir); fs.renameSync(path.join(scopeDir, tomb, a), path.join(dir, a));
    await pruneQuarantine(base);
    assert.equal(fs.readFileSync(path.join(dir, a), 'utf8'), '새 A\n'); assert.equal(fs.readFileSync(path.join(dir, b), 'utf8'), '새 B\n', 'B, still in the tombstone at the crash, is moved back');
    assert.ok(!fs.existsSync(path.join(dir, old)), 'the listed copy is gone');
    assert.deepEqual(fs.readdirSync(scopeDir), ['task-8']);
  });

  await t('a tombstone a mark names, still holding an unlisted file it cannot move back, is never removed whole', async () => {
    const base = path.join(top, 'stuck'), scope = '5'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-9');
    seed(dir, `${stampAt(Date.now())}-1-before.md`);
    await purgeTaskQuarantine(base, scope, 'task-9', refused());
    const name = path.basename(seed(dir, `${stampAt(Date.now())}-2-new.md`, '새 사본\n'));
    const { tomb } = markOf(scopeDir, 'task-9');
    fs.renameSync(dir, path.join(scopeDir, tomb));
    // The same name already exists in a re-created task folder (it cannot be moved back over it).
    seed(dir, name, '다른 바이트\n');
    await pruneQuarantine(base); await pruneQuarantine(base);
    assert.equal(fs.readFileSync(path.join(scopeDir, tomb, name), 'utf8'), '새 사본\n', 'the unlisted file stays in the tombstone');
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), '다른 바이트\n', 'and the live file is not overwritten');
    assert.ok(fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-9')), 'the mark is kept, so the tombstone is never swept');
  });

  await t('a torn or unreadable mark (or a temp file of its atomic write) keeps the task\'s tombstone: never swept whole', async () => {
    for (const [what, write] of [
      ['torn mark', (scopeDir, task) => fs.writeFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + task), '{"files":["a.md"],"to')],
      ['empty mark', (scopeDir, task) => fs.writeFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + task), '')],
      ['temp file only', (scopeDir, task) => fs.writeFileSync(path.join(scopeDir, `${PURGE_PENDING_PREFIX}${task}.tmp-0123456789ab`), '{"fil')],
    ]) {
      const base = path.join(top, 'torn-' + what.replace(/ /g, '-')), scope = '6'.repeat(24), scopeDir = path.join(base, scope);
      const tomb = path.join(scopeDir, `${PURGE_TOMBSTONE_PREFIX}task-10-abcdef012345`);
      const kept = seed(tomb, `${stampAt(Date.now())}-2-new.md`, '중단된 재시도의 새 사본\n');
      write(scopeDir, 'task-10');
      await pruneQuarantine(base); await pruneQuarantine(base);
      assert.equal(fs.readFileSync(kept, 'utf8'), '중단된 재시도의 새 사본\n', `${what}: the tombstone and its new copy are kept`);
    }
    // Control: a tombstone with no mark of any kind is a finished purge and is swept.
    const base = path.join(top, 'torn-control'), scopeDir = path.join(base, '7'.repeat(24));
    const tomb = path.join(scopeDir, `${PURGE_TOMBSTONE_PREFIX}task-11-abcdef012345`); seed(tomb);
    await pruneQuarantine(base);
    assert.equal(fs.existsSync(tomb), false, 'control: an unmarked tombstone is swept');
    // And a mark for another task (task-11-x) does not protect task-11's tombstone.
    seed(tomb); fs.writeFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-11-x'), '');
    await pruneQuarantine(base);
    assert.equal(fs.existsSync(tomb), false, 'a mark of a different task key does not protect it');
  });

  await t('the mark is written atomically (temp file, then rename): no temp file is left and the mark parses', async () => {
    const base = path.join(top, 'atomic'), scope = '8'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-12');
    seed(dir, `${stampAt(Date.now())}-1-a.md`);
    await purgeTaskQuarantine(base, scope, 'task-12', refused());
    assert.deepEqual(fs.readdirSync(scopeDir).sort(), [PURGE_PENDING_PREFIX + 'task-12', 'task-12'], 'only the mark and the task folder');
    assert.ok(Array.isArray(markOf(scopeDir, 'task-12').files));
  });

  await t('a second refused purge unions the names: archived copies moved to the tombstone by an interrupted retry never come back', async () => {
    const base = path.join(top, 'union'), scope = '9'.repeat(24), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-13');
    const first = path.basename(seed(dir, `${stampAt(Date.now())}-1-first-archive.md`, '첫 보관 사본\n'));
    await purgeTaskQuarantine(base, scope, 'task-13', refused());
    // An interrupted retry: the folder went to the tombstone; then restore + a new turn + archive again (refused again).
    const { tomb } = markOf(scopeDir, 'task-13');
    fs.renameSync(dir, path.join(scopeDir, tomb));
    const second = path.basename(seed(dir, `${stampAt(Date.now())}-2-second-archive.md`, '두 번째 보관 사본\n'));
    await purgeTaskQuarantine(base, scope, 'task-13', refused());
    const m = markOf(scopeDir, 'task-13');
    assert.deepEqual(m.files, [first, second].sort(), 'the names from both purges');
    assert.equal(m.tomb, tomb, 'the first tombstone name is kept');
    await pruneQuarantine(base);
    assert.ok(!fs.existsSync(path.join(dir, first)), 'the first archive\'s copy did not come back');
    assert.ok(!fs.existsSync(path.join(dir, second)), 'the second archive\'s copy is gone too');
  });

  await t('cleanup (1): out of rounds with a listed name still live, the mark stays, so that name is purged at the next prune', async () => {
    const base = path.join(top, 'rounds'), scope = 'a1'.repeat(12), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-14');
    const listedName = path.basename(seed(dir, `${stampAt(Date.now())}-1-a.md`, '보관 사본\n'));
    await purgeTaskQuarantine(base, scope, 'task-14', refused());
    // Round 1 renames the folder away; a writer puts a file with the listed name back into the live folder at once (so
    // round 2 runs), and again after round 2's rename (so names are still left when the rounds run out).
    let renames = 0;
    const rename = async (a, b) => { fs.renameSync(a, b); renames++; if (renames <= 2) seed(dir, listedName, '같은 이름의 재기록\n'); };
    await pruneQuarantine(base, Date.now(), { rename });
    assert.ok(fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-14')), 'the mark is kept while a listed name is still live');
    await pruneQuarantine(base);
    assert.ok(!fs.existsSync(path.join(dir, listedName)), 'the next prune purges it');
    assert.ok(!fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-14')), 'and only then removes the mark');
  });

  await t('cleanup (2): a stale temp file of an atomic mark write is removed after the grace period and stops pinning tombstones', async () => {
    const base = path.join(top, 'stale-tmp'), scope = 'b2'.repeat(12), scopeDir = path.join(base, scope);
    const tomb = path.join(scopeDir, `${PURGE_TOMBSTONE_PREFIX}task-15-abcdef012345`); seed(tomb);
    const tmp = path.join(scopeDir, `${PURGE_PENDING_PREFIX}task-15.tmp-0123456789ab`); fs.writeFileSync(tmp, '{"fi');
    await pruneQuarantine(base);
    assert.ok(fs.existsSync(tmp) && fs.existsSync(tomb), 'within the grace period it is kept, and so is the tombstone');
    const old = (Date.now() - PURGE_TMP_GRACE_MS - 60_000) / 1000; fs.utimesSync(tmp, old, old);
    await pruneQuarantine(base);
    assert.ok(!fs.existsSync(tmp), 'past the grace period it is removed');
    assert.ok(!fs.existsSync(tomb), 'and the tombstone it pinned is swept');
  });

  await t('cleanup (3): a tombstone pinned by an unreadable mark ages out by the retention, then the mark goes', async () => {
    const base = path.join(top, 'unreadable-age'), scope = 'c3'.repeat(12), scopeDir = path.join(base, scope);
    const tomb = path.join(scopeDir, `${PURGE_TOMBSTONE_PREFIX}task-16-abcdef012345`);
    const oldCopy = seed(tomb, `${stampAt(Date.now() - QUARANTINE_LIMITS.retentionMs - 60_000)}-1-old.md`);
    const freshCopy = seed(tomb, `${stampAt(Date.now())}-2-fresh.md`, '최근 사본\n');
    const mark = path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-16'); fs.writeFileSync(mark, 'not json');
    const old = (Date.now() - QUARANTINE_LIMITS.retentionMs - 60_000) / 1000; fs.utimesSync(mark, old, old);
    await pruneQuarantine(base);
    assert.ok(!fs.existsSync(oldCopy), 'a copy past the retention ages out of the pinned tombstone');
    assert.equal(fs.readFileSync(freshCopy, 'utf8'), '최근 사본\n', 'a recent copy is kept');
    assert.ok(fs.existsSync(mark), 'the mark stays while its tombstone holds something');
    fs.renameSync(freshCopy, path.join(tomb, `${stampAt(Date.now() - QUARANTINE_LIMITS.retentionMs - 60_000)}-2-fresh.md`));
    await pruneQuarantine(base); await pruneQuarantine(base);
    assert.ok(!fs.existsSync(tomb), 'emptied by the retention, the tombstone goes');
    assert.ok(!fs.existsSync(mark), 'then the old unreadable mark');
    // Control: a recent unreadable mark keeps everything (it may be a mark being repaired).
    const tomb2 = path.join(scopeDir, `${PURGE_TOMBSTONE_PREFIX}task-17-abcdef012345`); const c = seed(tomb2, `${stampAt(Date.now())}-1-x.md`);
    fs.writeFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-17'), 'not json');
    await pruneQuarantine(base);
    assert.ok(fs.existsSync(c) && fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-17')), 'control: a recent unreadable mark keeps all');
  });

  await t('cleanup (4): a crash mid-write of the mark never leaves a torn mark (atomic write pinned)', async () => {
    const base = path.join(top, 'torn-write'), scope = 'd4'.repeat(12), scopeDir = path.join(base, scope), dir = path.join(scopeDir, 'task-18');
    seed(dir, `${stampAt(Date.now())}-1-a.md`);
    const crash = (file, data) => { fs.writeFileSync(file, data.slice(0, 7)); throw new Error('crash mid-write'); };
    await purgeTaskQuarantine(base, scope, 'task-18', { ...refused(), writeFile: crash });
    assert.equal(fs.existsSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-18')), false, 'no mark under the mark\'s name: the torn bytes are only in a temp file');
    // A valid mark exists; a second purge crashes mid-write: the valid mark is left as it was.
    await purgeTaskQuarantine(base, scope, 'task-18', refused());
    const before = fs.readFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-18'), 'utf8');
    seed(dir, `${stampAt(Date.now())}-2-b.md`);
    await purgeTaskQuarantine(base, scope, 'task-18', { ...refused(), writeFile: crash });
    assert.equal(fs.readFileSync(path.join(scopeDir, PURGE_PENDING_PREFIX + 'task-18'), 'utf8'), before, 'the previous mark is intact');
  });

  await t('originals in a tombstone (or a marked task) are not counted against the cap', async () => {
    clearStudioMemoryJournal();
    const base = path.join(top, 'origtomb'), scopeDir = path.join(base, '1'.repeat(24));
    const tomb = path.join(scopeDir, `${PURGE_TOMBSTONE_PREFIX}held-abcdef012345`); fs.mkdirSync(tomb, { recursive: true });
    const stampOf = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-');
    for (let i = 0; i < QUARANTINE_LIMITS.originals; i++) fs.writeFileSync(path.join(tomb, `${ORIGINAL_PREFIX}${stampOf(Date.now() - 1000)}-${i + 1}-o${String(i).padStart(4, '0')}.md`), 'o');
    const memDir = (r) => path.join(r, '.hypeproof', 'memory');
    const root = path.join(top, 'origtomb-ws'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'k.md'), '학습자 기억\n');
    const since = Date.now(), before = await snapshotMemoryFolder(root);
    fs.rmSync(path.join(memDir(root), 'k.md')); await noteStudioMemoryChange(memDir(root), 'k.md', null);
    fs.writeFileSync(path.join(memDir(root), 'k.md'), '학습자 기억\n');
    const r = await revertTurnChanges(root, before, since, path.join(scopeDir, 'turn'));
    assert.equal(r.failed, 0, 'the tombstone\'s originals do not fill the live pool, so nothing is refused');
    assert.ok(fs.readdirSync(path.join(scopeDir, 'turn')).some((n) => n.startsWith(ORIGINAL_PREFIX)), 'the learner\'s bytes are kept as an original');
  });

  // ─── behaviour on the real provider ───
  const harness = async (name) => {
    const root = path.join(top, name); fs.mkdirSync(root, { recursive: true });
    let f;
    f = await createTaskHarness(root, (message) => {
      if (message.type === 'activityFreeze' && message.nonce) void f.handle(f.scoped({ type: 'saveActivityDraft', nonce: message.nonce, draft: { text: '', images: [], queued: null } }));
    });
    // The binding is a getter on the provider (personal activity + memory store); the fixture pins its scope.
    const bind = (v) => Object.defineProperty(f.h, 'activityMemoryBinding', { value: v, writable: true, configurable: true });
    bind({ root, scope: 'memory-scope-' + name });
    const q = (task) => path.join(root, 'memory-quarantine', scopeKey('memory-scope-' + name), task);
    return { f, root, q, bind };
  };

  await t('보관하기 removes the archived task\'s quarantine and leaves the other tasks\' (behaviour, not source text)', async () => {
    const { f, q } = await harness('archive');
    const first = f.store.getView().activeTaskId;
    await f.handle(f.scoped({ type: 'taskCreate' }));
    const second = f.store.getView().activeTaskId;
    await f.handle(f.scoped({ type: 'taskSelect', id: first }));
    seed(q(first)); const other = seed(q(second));
    await f.handle(f.scoped({ type: 'taskArchive' }));
    assert.deepEqual(Array.from(f.store.getView().archived, (x) => x.id), [first], 'the task is archived');
    assert.equal(fs.existsSync(q(first)), false, 'its quarantine is gone by the time the handler returns');
    assert.ok(fs.existsSync(other), 'another task\'s quarantine stays');
    // Restore and a new turn's copy: the earlier purge cannot reach it.
    await f.handle(f.scoped({ type: 'taskRestore', id: first }));
    const fresh = seed(q(first), `${stamp()}-9-after-restore.md`);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(fresh), 'a copy written after restore survives');
  });

  await t('옮기기 removes the moved task\'s quarantine; a refused move keeps it', async () => {
    const { f, root, q } = await harness('move');
    const { TaskWorkspaceStore } = f.internals;
    const otherFolder = path.join(root, 'other');
    await mkdir(path.join(root, 'task-workspaces'), { recursive: true });
    const destination = new TaskWorkspaceStore(path.join(root, 'task-workspaces'), JSON.stringify(['synthetic-personal-b', otherFolder]));
    await destination.initialize();
    f.connections.list = async () => [
      { ref: 'ref-b', id: 'synthetic-personal-b', name: '그림 연습', kind: 'personal', workspace: otherFolder },
      { ref: 'ref-class', id: 'synthetic-class', name: '3반 수업', kind: 'classroom', workspace: path.join(root, 'class') },
    ];
    f.h.cachedProfile = { activity_kind: 'personal', lesson: null };
    const first = f.store.getView().activeTaskId;
    await f.store.append(first, [{ id: 'q', role: 'user', content: '질문', createdAt: 1 }]);
    const copy = seed(q(first));
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-class', requestId: 'r-class' }));
    assert.ok(f.store.getTask(first), 'the refused move keeps the task');
    assert.ok(fs.existsSync(copy), 'and its quarantine');
    await f.handle(f.scoped({ type: 'taskMove', id: first, destination: 'ref-b', requestId: 'r-ok' }));
    assert.equal(f.store.getTask(first), undefined, 'the task moved');
    assert.equal(fs.existsSync(q(first)), false, 'its quarantine went with it');
  });

  await t('no global storage, or no scope: the purge does nothing, never rejects, and the archive still happens', async () => {
    // Rejections are counted: the handler does not await the purge, so a purge that threw would surface only here.
    const rejections = []; const onRejection = (e) => rejections.push(e); process.on('unhandledRejection', onRejection);
    try {
      // No global storage (the provider's context field shadowed): a seeded copy at the usual place is left as it is.
      const { f, root, q } = await harness('no-storage');
      const first = f.store.getView().activeTaskId;
      await f.handle(f.scoped({ type: 'taskCreate' }));
      await f.handle(f.scoped({ type: 'taskSelect', id: first }));
      const kept = seed(q(first));
      Object.defineProperty(f.h.context, 'globalStorageUri', { value: undefined, configurable: true });
      const errors = f.posts.filter((m) => m.type === 'taskWorkspaceError' && m.error).length;
      await f.handle(f.scoped({ type: 'taskArchive' }));
      await new Promise((r) => setTimeout(r, 30));
      assert.deepEqual(Array.from(f.store.getView().archived, (x) => x.id), [first], 'no-storage: the archive happened');
      assert.equal(f.posts.filter((m) => m.type === 'taskWorkspaceError' && m.error).length, errors, 'no-storage: no error is posted');
      assert.ok(fs.existsSync(kept), 'no-storage: nothing was purged (no storage known, nothing touched)');
      // No scope at all (no memory binding and no activity record): the purge resolves and touches nothing.
      const bare = Object.assign(Object.create(f.h), { context: Object.create(f.h.context) });
      Object.defineProperty(bare, 'activityMemoryBinding', { value: undefined });
      Object.defineProperty(bare.context, 'globalStorageUri', { value: { fsPath: root } });
      const other = seed(q('task-other'));
      assert.equal(await f.h.purgeTaskMemoryQuarantine.call(bare, 'task-other'), undefined, 'no-scope: it resolves');
      assert.ok(fs.existsSync(other), 'no-scope: nothing was purged');
      assert.deepEqual(rejections, [], 'no purge rejected');
    } finally { process.off('unhandledRejection', onRejection); }
  });
  console.log(`memory-quarantine-purge: ${passed} passed`);
} finally { fs.rmSync(top, { recursive: true, force: true }); }
