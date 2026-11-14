// CGP-KNOW-R-028 follow-up (#4014): the turn-end check of a keep-off task's memory folder puts back whatever the
// turn's shell (or any path the host cannot see) added, changed or deleted, keeps the turn's versions in a quarantine,
// and leaves Studio's own changes alone. Real files throughout; the provider through the task harness.
//   node --experimental-strip-types test/memory-folder-guard.smoke.mjs
//
// Positive: an added file is moved to the quarantine; a changed file gets its earlier bytes back and the turn's
// version is quarantined; a deleted file comes back; the turn shows one line and keeps it with the turn.
// Negative controls: Studio's own append/remove and the learner's editor save during the turn are kept; a keep-on turn
// takes no snapshot and its shell write stays; a turn that changed nothing posts nothing; a file too large to have
// been kept is reported, not silently dropped.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTaskHarness } from './task-workspace-harness.mjs';
import { ActivityMemory, MEMORY_LIMITS } from '../src/activityMemory.ts';
import { FOLDER_GUARD_COPY, MOVED_PREFIX, NAME_ONLY, quarantinedAt, QUARANTINE_LIMITS, SNAPSHOT_MAX, clearStudioMemoryJournal, diffSnapshots, noteStudioMemoryChange, noteStudioMemorySave, pruneQuarantine, purgeTaskQuarantine, quarantineOrder, revertTurnChanges, snapshotMemoryFolder } from '../src/memoryFolderGuard.ts';

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-guard-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const ls = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const read = (root, name) => fs.readFileSync(path.join(memDir(root), name), 'utf8');

try {
  await t('pure: added is quarantined, changed and deleted are put back; the turn versions are kept', async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'pure'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'a.md'), '원래 a\n');
    fs.writeFileSync(path.join(memDir(root), 'b.md'), '원래 b\n');
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    // "The shell": a name built at run time, an edit and a delete.
    fs.writeFileSync(path.join(memDir(root), `${['x', 'y'].join('')}.md`), '몰래 남긴 기억\n');
    fs.writeFileSync(path.join(memDir(root), 'a.md'), '바뀐 a\n');
    fs.unlinkSync(path.join(memDir(root), 'b.md'));
    assert.deepEqual(diffSnapshots(before, await snapshotMemoryFolder(root)), { added: ['xy.md'], changed: ['a.md'], removed: ['b.md'] });
    const q = path.join(top, 'q-pure');
    const r = await revertTurnChanges(root, before, since, q);
    assert.deepEqual(r, { reverted: 3, kept: 0, failed: 0, unchecked: false });
    assert.deepEqual(ls(memDir(root)), ['a.md', 'b.md'], 'the folder is as it was');
    assert.equal(read(root, 'a.md'), '원래 a\n');
    assert.equal(read(root, 'b.md'), '원래 b\n');
    const kept = ls(q).map(n => fs.readFileSync(path.join(q, n), 'utf8')).sort();
    assert.deepEqual(kept, ['몰래 남긴 기억\n', '바뀐 a\n'], 'nothing the turn wrote is lost');
    assert.deepEqual(await revertTurnChanges(root, before, since, q), { reverted: 0, kept: 0, failed: 0, unchecked: false }, 'a second run finds nothing');
  });

  await t("negative control: Studio's own changes during the turn (append, remove, the learner's editor save) are kept", async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'studio'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'old.md'), '지울 기억\n');
    fs.writeFileSync(path.join(memDir(root), 'edit.md'), '고칠 기억\n');
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    const store = new ActivityMemory(root);
    const added = await store.append('학습자가 기억 목록에서 남긴 것');
    await store.remove('old.md');
    fs.writeFileSync(path.join(memDir(root), 'edit.md'), '학습자가 편집기에서 고쳤어요\n');
    await noteStudioMemoryChange(memDir(root), 'edit.md', Buffer.from('학습자가 편집기에서 고쳤어요\n'));
    const r = await revertTurnChanges(root, before, since, path.join(top, 'q-studio'));
    assert.deepEqual(r, { reverted: 0, kept: 3, failed: 0, unchecked: false });
    assert.deepEqual(ls(memDir(root)), [added, 'edit.md'].sort());
    assert.equal(read(root, 'edit.md'), '학습자가 편집기에서 고쳤어요\n');
  });

  await t('bounds: a file past the item size is never read or copied and is reported; past the read bound new names are still moved out', async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'big'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'big.md'), 'ㄱ'.repeat(MEMORY_LIMITS.bytes));
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    assert.equal(before.get('big.md').bytes, null, 'a large file is not kept in memory');
    assert.match(before.get('big.md').digest, /^stat:/, 'and is compared by its stat');
    fs.writeFileSync(path.join(memDir(root), 'big.md'), 'small now\n');
    fs.writeFileSync(path.join(memDir(root), 'huge-new.md'), 'x'.repeat(MEMORY_LIMITS.bytes + 1));
    const q = path.join(top, 'q-big');
    assert.deepEqual(await revertTurnChanges(root, before, since, q), { reverted: 0, kept: 0, failed: 2, unchecked: false });
    assert.deepEqual(ls(q).map(n => fs.readFileSync(path.join(q, n), 'utf8')), ['small now\n'], 'only the copy within the item size is kept aside; nothing past it is read or copied');
    assert.ok(fs.existsSync(path.join(memDir(root), 'huge-new.md')), 'left in place (it is never read as memory), reported');
    // Past the read bound, fail closed: a crowd of stray files cannot hide a planted item.
    const crowd = path.join(top, 'crowd'); fs.mkdirSync(memDir(crowd), { recursive: true });
    for (let i = 0; i <= SNAPSHOT_MAX.files + 5; i++) fs.writeFileSync(path.join(memDir(crowd), `.stray-${i}`), 'x');
    const crowdSince = Date.now();
    const crowdBefore = await snapshotMemoryFolder(crowd);
    assert.equal(crowdBefore.partial, true, 'some entries are tracked by name only');
    assert.ok([...crowdBefore.values()].some(e => e.digest === NAME_ONLY));
    fs.writeFileSync(path.join(memDir(crowd), 'planted.md'), '심어 둔 기억\n');
    let cr = await revertTurnChanges(crowd, crowdBefore, crowdSince, path.join(top, 'q-crowd'));
    assert.equal(fs.existsSync(path.join(memDir(crowd), 'planted.md')), false, 'a new name is always moved out');
    assert.equal(cr.reverted, 1);
    // And when the planted item itself sorts past the read bound (memory-named fillers fill the read set first).
    const full = path.join(top, 'crowd-full'); fs.mkdirSync(memDir(full), { recursive: true });
    for (let i = 0; i <= SNAPSHOT_MAX.files + 5; i++) fs.writeFileSync(path.join(memDir(full), `a-${String(i).padStart(4, '0')}.md`), 'x');
    const fullSince = Date.now();
    const fullBefore = await snapshotMemoryFolder(full);
    fs.writeFileSync(path.join(memDir(full), 'zz-planted.md'), '심어 둔 기억\n');
    const fullAfter = await snapshotMemoryFolder(full);
    assert.equal(fullAfter.get('zz-planted.md').digest, NAME_ONLY, 'the planted item is past the read bound');
    cr = await revertTurnChanges(full, fullBefore, fullSince, path.join(top, 'q-full'));
    assert.equal(fs.existsSync(path.join(memDir(full), 'zz-planted.md')), false, 'still moved out (fail closed)');
    assert.equal(cr.unchecked, true);
    assert.equal(cr.unchecked, true, 'and the turn says some contents could not be checked');
  });

  await t('a flood of new memory files cannot hide a rewrite of an item tracked at turn start; junk names leave no copies', async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'flood'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'm-item.md'), '원래 기억\n');
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    assert.notEqual(before.get('m-item.md').digest, NAME_ONLY, 'content-tracked at turn start');
    for (let i = 0; i < SNAPSHOT_MAX.files + 10; i++) fs.writeFileSync(path.join(memDir(root), `a${String(i).padStart(3, '0')}.md`), 'x');
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(memDir(root), `.junk-${i}`), 'j');
    fs.writeFileSync(path.join(memDir(root), 'm-item.md'), '몰래 바꾼 기억\n');
    const after = await snapshotMemoryFolder(root);
    assert.equal(after.get('m-item.md').digest, NAME_ONLY, 'the flood pushed the item out of the end read set');
    const q = path.join(top, 'q-flood');
    const r = await revertTurnChanges(root, before, since, q);
    assert.equal(read(root, 'm-item.md'), '원래 기억\n', 'the rewrite is still put back');
    assert.deepEqual(ls(memDir(root)), ['m-item.md'], 'every new file is gone');
    assert.equal(r.failed, 0);
    const kept = ls(q);
    const moved = kept.filter(n => n.startsWith(MOVED_PREFIX));
    assert.equal(moved.length, 30, 'junk names are moved (renamed) into the quarantine, not copied or deleted');
    assert.ok(moved.every(n => fs.readFileSync(path.join(q, n), 'utf8') === 'j'));
    assert.equal(kept.length - moved.length, SNAPSHOT_MAX.files + 10 + 1, 'the memory-named adds and the rewrite are kept aside');
  });

  await t("no data loss: a learner's photo dropped in mid-turn is moved, not deleted; an item swapped for a folder keeps its bytes", async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'no-loss'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'item.md'), '지켜야 할 기억\n');
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    const photo = Buffer.alloc(200_000, 7); // larger than the item size: not a memory file, never copied
    fs.writeFileSync(path.join(memDir(root), 'photo.png'), photo);
    fs.rmSync(path.join(memDir(root), 'item.md'));
    fs.mkdirSync(path.join(memDir(root), 'item.md'));
    fs.writeFileSync(path.join(memDir(root), 'item.md', 'inside'), 'x');
    const q = path.join(top, 'q-no-loss');
    const r = await revertTurnChanges(root, before, since, q);
    const files = ls(q);
    const movedPhoto = files.find(n => n.startsWith(MOVED_PREFIX) && n.endsWith('photo.png'));
    assert.ok(movedPhoto, 'the photo is moved into the quarantine');
    assert.deepEqual(fs.readFileSync(path.join(q, movedPhoto)), photo, 'byte for byte');
    assert.equal(fs.existsSync(path.join(memDir(root), 'photo.png')), false);
    const kept = files.filter(n => n.endsWith('item.md')).map(n => fs.readFileSync(path.join(q, n), 'utf8'));
    assert.deepEqual(kept, ['지켜야 할 기억\n'], "the item's earlier bytes are kept aside when it cannot be put back");
    assert.equal(r.failed, 1, 'the folder swap is reported');
    assert.equal(r.reverted, 1, 'the photo move');
  });

  await t("a moved file with an old or future mtime keeps the turn's age: not pruned at once, does not outrank newer copies", async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'mtimes'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'item.md'), '원래 기억\n');
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    const photo = path.join(memDir(root), 'photo.png'); fs.writeFileSync(photo, Buffer.alloc(100, 1));
    const thirtyDaysAgo = (Date.now() - 30 * 24 * 3600_000) / 1000; fs.utimesSync(photo, thirtyDaysAgo, thirtyDaysAgo);
    const future = path.join(memDir(root), '.junk-future'); fs.writeFileSync(future, 'j');
    const inAYear = (Date.now() + 365 * 24 * 3600_000) / 1000; fs.utimesSync(future, inAYear, inAYear);
    fs.writeFileSync(path.join(memDir(root), 'item.md'), '바뀐 기억\n');
    const base = path.join(top, 'q-mtimes'); const q = path.join(base, 'c'.repeat(24), 'task');
    await revertTurnChanges(root, before, since, q);
    await pruneQuarantine(base);
    const names = ls(q);
    assert.ok(names.some(n => n.startsWith(MOVED_PREFIX) && n.endsWith('photo.png')), 'the 30-day-old photo survives the prune right after its move');
    assert.ok(names.some(n => n.endsWith('item.md')), "the rewrite's copy is still there");
    for (const n of names) assert.ok(Math.abs(quarantinedAt(n) - Date.now()) < 60_000, `every entry is aged from the move: ${n}`);
    const photoName = names.find(n => n.endsWith('photo.png'));
    assert.ok(Math.abs(fs.statSync(path.join(q, photoName)).mtimeMs - Date.now()) < 60_000, 'and its mtime says now too');
    assert.equal(quarantinedAt('no-stamp.md'), 0, 'a name without a stamp counts as oldest');
  });

  await t('moves are capped per turn and moved files sit outside the byte cap', async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'many-moves'); fs.mkdirSync(memDir(root), { recursive: true });
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    for (let i = 0; i < QUARANTINE_LIMITS.movesPerTurn + 7; i++) fs.writeFileSync(path.join(memDir(root), `.j${String(i).padStart(4, '0')}`), 'j');
    const q = path.join(top, 'q-many', 'a'.repeat(24), 't');
    const r = await revertTurnChanges(root, before, since, q);
    assert.equal(r.reverted, QUARANTINE_LIMITS.movesPerTurn, 'at most movesPerTurn moves');
    assert.equal(r.failed, 7, 'the rest is left in place and reported');
    assert.equal(ls(memDir(root)).length, 7);
    const big = path.join(top, 'q-bytecap', 'b'.repeat(24), 't'); fs.mkdirSync(big, { recursive: true });
    const hugeName = `${MOVED_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}-1-huge.bin`;
    fs.writeFileSync(path.join(big, hugeName), Buffer.alloc(QUARANTINE_LIMITS.bytes + 10, 1));
    await pruneQuarantine(path.join(top, 'q-bytecap'));
    assert.ok(fs.existsSync(path.join(big, hugeName)), 'a moved file is not removed by the byte cap');
  });

  await t("the learner's save during the turn wins over the turn's later shell overwrite", async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'save-then-shell'); fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'e.md'), 'v0 원래\n');
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    fs.writeFileSync(path.join(memDir(root), 'e.md'), 'v1 학습자가 저장\n');
    await noteStudioMemorySave(path.join(memDir(root), 'e.md'));
    fs.writeFileSync(path.join(memDir(root), 'e.md'), 'v2 셸이 덮어씀\n');
    const q = path.join(top, 'q-save');
    const r = await revertTurnChanges(root, before, since, q);
    assert.equal(read(root, 'e.md'), 'v1 학습자가 저장\n', "the learner's save, not the pre-turn version");
    assert.equal(r.reverted, 1);
    assert.deepEqual(ls(q).map(n => fs.readFileSync(path.join(q, n), 'utf8')), ['v2 셸이 덮어씀\n'], 'the overwrite is kept aside');
  });

  await t("a BOM file's editor save is journaled from disk and kept", async () => {
    clearStudioMemoryJournal();
    const root = path.join(top, 'bom'); fs.mkdirSync(memDir(root), { recursive: true });
    const since = Date.now();
    const before = await snapshotMemoryFolder(root);
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('BOM으로 저장한 기억\r\n')]);
    fs.writeFileSync(path.join(memDir(root), 'bom.md'), bom);
    await noteStudioMemorySave(path.join(memDir(root), 'bom.md'));
    const r = await revertTurnChanges(root, before, since, path.join(top, 'q-bom'));
    assert.deepEqual(r, { reverted: 0, kept: 1, failed: 0, unchecked: false });
    assert.deepEqual(fs.readFileSync(path.join(memDir(root), 'bom.md')), bom, 'byte for byte');
  });

  await t('quarantine: retention of seven days, per-activity count and byte caps, a task purge; owner-only modes', async () => {
    const base = path.join(top, 'qbase');
    const scope = 'a'.repeat(24), task = 'task-1';
    const dir = path.join(base, scope, task); fs.mkdirSync(dir, { recursive: true });
    const stampOf = (t) => new Date(t).toISOString().replace(/[:.]/g, '-');
    const old = path.join(dir, `${stampOf(Date.now() - QUARANTINE_LIMITS.retentionMs - 60_000)}-1-old.md`); fs.writeFileSync(old, 'x');
    const fresh = path.join(dir, `${stampOf(Date.now())}-1-fresh.md`); fs.writeFileSync(fresh, 'z');
    // The file's own times say nothing: a fresh-named file with an ancient mtime stays, an old-named one with a new mtime goes.
    fs.utimesSync(fresh, 1, 1);
    await pruneQuarantine(base);
    assert.deepEqual(ls(dir), [path.basename(fresh)], 'retention by the stamp in the name, not by mtime');
    fs.rmSync(fresh);
    for (let i = 0; i < QUARANTINE_LIMITS.files + 3; i++) fs.writeFileSync(path.join(dir, `${stampOf(Date.now() - (QUARANTINE_LIMITS.files + 3 - i) * 1000)}-${i}-n${String(i).padStart(4, '0')}.md`), 'y');
    await pruneQuarantine(base);
    const left = ls(dir);
    assert.equal(left.length, QUARANTINE_LIMITS.files, 'count cap');
    assert.equal(left.some(n => n.endsWith('n0000.md')), false, 'the oldest (by stamp) go first');
    await purgeTaskQuarantine(base, scope, task);
    assert.equal(fs.existsSync(dir), false, 'a task purge removes its folder');
    await purgeTaskQuarantine(base, '../..', 'x');
    assert.ok(fs.existsSync(base), 'a malformed key touches nothing');
    // Modes from a real revert.
    clearStudioMemoryJournal();
    const root = path.join(top, 'modes'); fs.mkdirSync(memDir(root), { recursive: true });
    const since = Date.now(); const before = await snapshotMemoryFolder(root);
    fs.writeFileSync(path.join(memDir(root), 'new.md'), '비밀 기억\n');
    const q = path.join(top, 'qmodes', scope, 'task-2');
    await revertTurnChanges(root, before, since, q);
    assert.equal(fs.statSync(q).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.dirname(q)).mode & 0o777, 0o700);
    for (const n of ls(q)) assert.equal(fs.statSync(path.join(q, n)).mode & 0o777, 0o600);
  });

  await t('a flood of moved junk never evicts a saved original; moves have their own cap', async () => {
    const base = path.join(top, 'qflood');
    const stampOf = (t) => new Date(t).toISOString().replace(/[:.]/g, '-');
    const a = path.join(base, 'c'.repeat(24), 'turn-a'), b = path.join(base, 'c'.repeat(24), 'turn-b');
    fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
    // Turn A saved a swapped item's original a minute ago; turn B then moved more junk than the cap.
    const original = `${stampOf(Date.now() - 60_000)}-1-goal.md`;
    fs.writeFileSync(path.join(a, original), '원래 목표\n');
    const now = Date.now();
    for (let i = 0; i < QUARANTINE_LIMITS.moved + 50; i++) fs.writeFileSync(path.join(b, `${MOVED_PREFIX}${stampOf(now)}-${i + 1}-junk${String(i).padStart(4, '0')}`), 'j');
    await pruneQuarantine(base, now);
    assert.deepEqual(ls(a), [original], 'the earlier turn\'s original survives');
    assert.equal(ls(b).length, QUARANTINE_LIMITS.moved, 'moves are capped on their own');
    // One turn's entries share a stamp: which moves stay is fixed by name, not by readdir order.
    const kept = new Set(ls(b));
    assert.ok([...kept].every(n => n.startsWith(MOVED_PREFIX)), 'only moves in the move pool');
    const all = Array.from({ length: QUARANTINE_LIMITS.moved + 50 }, (_, i) => `${MOVED_PREFIX}${stampOf(now)}-${i + 1}-junk${String(i).padStart(4, '0')}`).sort();
    assert.deepEqual([...kept].sort(), all.slice(0, QUARANTINE_LIMITS.moved), 'equal stamps fall back to the name');
    // The order itself, from a shuffled list (readdir order differs by platform: sorted on Linux, not on APFS).
    const entries = [{ file: 'q/b', at: 5 }, { file: 'q/c', at: 9 }, { file: 'q/a', at: 5 }, { file: 'q/d', at: 1 }];
    assert.deepEqual(entries.slice().sort(quarantineOrder).map(e => e.file), ['q/c', 'q/a', 'q/b', 'q/d'], 'newest first, equal stamps by path');
    assert.deepEqual(entries.slice().reverse().sort(quarantineOrder).map(e => e.file), ['q/c', 'q/a', 'q/b', 'q/d'], 'whatever the input order');
  });

  await t('a stamp planted in the future is not trusted: it neither outranks real copies nor escapes the retention', async () => {
    const now = Date.now();
    const stampOf = (t) => new Date(t).toISOString().replace(/[:.]/g, '-');
    assert.equal(quarantinedAt(`${stampOf(now + 365 * 24 * 3600_000)}-1-x.md`, now), 0, 'a far-future stamp counts as oldest');
    assert.equal(quarantinedAt(`${MOVED_PREFIX}${stampOf(now + 365 * 24 * 3600_000)}-1-x`, now), 0, 'for moves too');
    assert.equal(quarantinedAt(`${stampOf(now + 30_000)}-1-x.md`, now), now, 'a stamp within the clock skew is clamped to now');
    const dir = path.join(top, 'qfuture', 'd'.repeat(24), 'task');
    fs.mkdirSync(dir, { recursive: true });
    const real = `${stampOf(now - 3600_000)}-1-real.md`;
    fs.writeFileSync(path.join(dir, real), '진짜 사본\n');
    for (let i = 0; i < QUARANTINE_LIMITS.files; i++) fs.writeFileSync(path.join(dir, `${stampOf(now + 365 * 24 * 3600_000)}-${i + 1}-planted.md`), 'p');
    await pruneQuarantine(path.join(top, 'qfuture'), now);
    assert.deepEqual(ls(dir), [real], 'the real copy stays and the planted future copies age out at once');
  });

  // ---- the provider ----
  const work = path.join(top, 'activity');
  fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h.memoryWriteLedgers = new Map(); h.turnTimelines = new Map(); h.rememberedNames = new Map(); h.rememberTurnWrites = new Map();
  h.cachedProfile = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } }, game: { template_tier: 'website' } };
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  const binding = h.activityMemoryBinding;
  assert.ok(binding, 'memory store binding');
  const root = binding.root;
  const taskId = h.currentTaskStore().getView().activeTaskId;
  const set = change => f.handle(f.scoped({ type: 'taskMemorySet', taskId, ...change }));
  const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
  const lines = stream => f.posts.filter(m => m.type === 'toolLog' && m.streamId === stream).map(m => m.label);

  await t('provider: a keep-off turn puts back a shell write the string check could not see, says so, keeps the line', async () => {
    fs.mkdirSync(memDir(root), { recursive: true });
    fs.writeFileSync(path.join(memDir(root), 'keep.md'), '원래 기억\n');
    await set({ keep: false });
    h.taskMemoryStreams = new Map([['turn-1', taskId]]);
    await h.startMemoryFolderGuard('turn-1');
    // A command that builds the path at run time: no ".hypeproof" in its text.
    const dir = [root, '.' + 'hype' + 'proof', 'memory'].join(path.sep);
    fs.writeFileSync(path.join(dir, 'sneak.md'), '남기면 안 되는 기억\n');
    const realFetch = globalThis.fetch; const sent = []; const logged = [];
    globalThis.fetch = (...a) => { sent.push(String(a[0])); return realFetch(...a); };
    const realLog = { log: console.log, error: console.error, warn: console.warn };
    for (const k of ['log', 'error', 'warn']) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
    let r;
    try { r = await h.endMemoryFolderGuard('turn-1'); } finally { globalThis.fetch = realFetch; Object.assign(console, realLog); }
    assert.deepEqual(sent, [], 'nothing is uploaded');
    assert.ok(!logged.join('\n').includes('남기면 안 되는 기억'), 'nothing of the content is logged');
    same(r, { reverted: 1, kept: 0, failed: 0, unchecked: false });
    assert.deepEqual(ls(memDir(root)), ['keep.md']);
    same(lines('turn-1'), [FOLDER_GUARD_COPY.reverted(1)]);
    assert.equal(FOLDER_GUARD_COPY.reverted(1), '이 작업에서 기억에 쓴 내용 1개를 되돌렸어요.');
    assert.ok(!lines('turn-1').join(' ').includes('남기면') && !lines('turn-1').join(' ').includes('sneak'), 'the line names the count only');
    assert.ok(h.getHistory().some(m => m.tool?.label === FOLDER_GUARD_COPY.reverted(1)), 'the line is kept with the turn');
    const q = path.join(h.context.globalStorageUri.fsPath, 'memory-quarantine');
    const stored = fs.readdirSync(q).flatMap(d => fs.readdirSync(path.join(q, d)).flatMap(t2 => fs.readdirSync(path.join(q, d, t2)).map(n => fs.readFileSync(path.join(q, d, t2, n), 'utf8'))));
    assert.ok(stored.includes('남기면 안 되는 기억\n'), 'the turn version is kept outside the store');
  });

  await t('provider: archiving the task purges its quarantine', async () => {
    const q = path.join(h.context.globalStorageUri.fsPath, 'memory-quarantine');
    const scopeDir = fs.readdirSync(q)[0];
    assert.ok(fs.existsSync(path.join(q, scopeDir, taskId)), 'the turn copy is filed under the task');
    await h.purgeTaskMemoryQuarantine(taskId);
    assert.equal(fs.existsSync(path.join(q, scopeDir, taskId)), false);
  });

  await t('provider negative controls: keep on takes no snapshot; a turn that changed nothing posts nothing', async () => {
    await set({ keep: true });
    h.taskMemoryStreams = new Map([['turn-2', taskId]]);
    await h.startMemoryFolderGuard('turn-2');
    fs.writeFileSync(path.join(memDir(root), 'allowed.md'), '켜 둔 작업의 기억\n');
    assert.equal(await h.endMemoryFolderGuard('turn-2'), null, 'no guard on a keep-on turn');
    assert.ok(ls(memDir(root)).includes('allowed.md'), 'its write stays');
    await set({ keep: false });
    h.taskMemoryStreams.set('turn-3', taskId);
    await h.startMemoryFolderGuard('turn-3');
    same(await h.endMemoryFolderGuard('turn-3'), { reverted: 0, kept: 0, failed: 0, unchecked: false });
    same(lines('turn-3'), []);
    await set({ keep: true });
  });

  await t('wiring: every turn (all runtimes) starts the guard after its task is bound and ends it before the turn closes', async () => {
    const src = fs.readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
    const send = src.slice(src.indexOf('  private async handleSend('), src.indexOf('  private async runBrowserLoop('));
    const bound = send.indexOf('this.taskMemoryStreams.set(streamId, this.activeTaskId());');
    const start = send.indexOf('await this.startMemoryFolderGuard(streamId);');
    assert.ok(bound > 0 && start > bound, 'the guard starts right after the turn is bound to its task');
    const end = send.indexOf('await this.endMemoryFolderGuard(streamId)');
    const restore = send.indexOf('await this.endTurnRestore(turnRestorePoint, streamId');
    assert.ok(end > 0 && end < restore, 'the guard ends in the turn finally, before the turn restore point closes');
    assert.match(src, /msg\.type === 'taskArchive'\) \{ await store\.archiveTask\(msg\.taskId, expected\); await this\.purgeTaskMemoryQuarantine\(msg\.taskId\); \}/, 'an archived task loses its quarantine');
    assert.match(src, /msg\.type === 'taskMove'\) \{ moved = await this\.moveTask\(store, msg\.id, msg\.destination, expected\); await this\.purgeTaskMemoryQuarantine\(msg\.id\); \}/, 'a moved task too');
    assert.ok(src.includes('void pruneQuarantine(this.memoryQuarantineBase())'), 'retention applied at activation');
    assert.ok(src.includes('void noteStudioMemorySave(file);') && !src.includes('Buffer.from(document.getText()'), "the editor save is journaled from disk, not from the editor's text");
    for (const runtime of ['runLocalCoach({', 'runSdkCoach({']) assert.ok(send.indexOf(runtime) > start && send.indexOf(runtime) < end, `${runtime} runs inside the guarded turn`);
  });

  console.log(`memory folder guard: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
