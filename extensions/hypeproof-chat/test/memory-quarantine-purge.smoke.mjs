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
import { ORIGINAL_PREFIX, PURGE_PENDING_PREFIX, PURGE_TOMBSTONE_PREFIX, QUARANTINE_LIMITS, clearStudioMemoryJournal, noteStudioMemoryChange, pruneQuarantine, purgeTaskQuarantine, revertTurnChanges, snapshotMemoryFolder } from '../src/memoryFolderGuard.ts';
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

  await t('a refused rename (EPERM/EBUSY) never deletes in place: the task is marked, and the next prune retries it', async () => {
    const base = path.join(top, 'refused'), scope = 'd'.repeat(24), dir = path.join(base, scope, 'task-5');
    const stampAt = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-');
    const purgedAt = Date.now() - 5_000;
    const old = seed(dir, `${stampAt(purgedAt - 60_000)}-1-before-archive.md`, '보관 전 사본\n');
    for (const code of ['EPERM', 'EBUSY']) {
      await purgeTaskQuarantine(base, scope, 'task-5', { rename: () => { throw Object.assign(new Error(code), { code }); }, now: () => purgedAt });
      assert.ok(fs.existsSync(old), `${code}: nothing is deleted from the live folder`);
      assert.ok(fs.existsSync(path.join(base, scope, PURGE_PENDING_PREFIX + 'task-5')), `${code}: the task is marked for the next prune`);
    }
    // The task is restored and a new turn writes a copy; the next prune is refused again: everything stays, still marked.
    const fresh = seed(dir, `${stampAt(Date.now())}-2-after-restore.md`, '새 턴의 사본\n');
    await pruneQuarantine(base, Date.now(), { rename: async () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } });
    assert.ok(fs.existsSync(old) && fs.existsSync(fresh), 'a refused retry deletes nothing');
    assert.ok(fs.existsSync(path.join(base, scope, PURGE_PENDING_PREFIX + 'task-5')), 'and keeps the mark');
    // The next prune can rename: the copy from before the purge goes, the new turn's copy comes back, the mark is gone.
    await pruneQuarantine(base);
    assert.equal(fs.existsSync(old), false, 'the copy from before the purge is gone');
    assert.equal(fs.readFileSync(fresh, 'utf8'), '새 턴의 사본\n', 'the restored task\'s new copy is kept');
    assert.deepEqual(fs.readdirSync(path.join(base, scope)), ['task-5'], 'no mark and no tombstone are left');
    // ENOENT is not a refusal: nothing to purge, no mark.
    await purgeTaskQuarantine(base, scope, 'never-there');
    assert.equal(fs.existsSync(path.join(base, scope, PURGE_PENDING_PREFIX + 'never-there')), false);
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
