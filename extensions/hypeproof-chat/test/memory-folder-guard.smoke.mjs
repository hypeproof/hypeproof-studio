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
import { FOLDER_GUARD_COPY, QUARANTINE_LIMITS, SNAPSHOT_MAX, TOO_MANY, clearStudioMemoryJournal, diffSnapshots, noteStudioMemoryChange, pruneQuarantine, purgeTaskQuarantine, revertTurnChanges, snapshotMemoryFolder } from '../src/memoryFolderGuard.ts';

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
    assert.deepEqual(r, { reverted: 3, kept: 0, failed: 0 });
    assert.deepEqual(ls(memDir(root)), ['a.md', 'b.md'], 'the folder is as it was');
    assert.equal(read(root, 'a.md'), '원래 a\n');
    assert.equal(read(root, 'b.md'), '원래 b\n');
    const kept = ls(q).map(n => fs.readFileSync(path.join(q, n), 'utf8')).sort();
    assert.deepEqual(kept, ['몰래 남긴 기억\n', '바뀐 a\n'], 'nothing the turn wrote is lost');
    assert.deepEqual(await revertTurnChanges(root, before, since, q), { reverted: 0, kept: 0, failed: 0 }, 'a second run finds nothing');
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
    assert.deepEqual(r, { reverted: 0, kept: 3, failed: 0 });
    assert.deepEqual(ls(memDir(root)), [added, 'edit.md'].sort());
    assert.equal(read(root, 'edit.md'), '학습자가 편집기에서 고쳤어요\n');
  });

  await t('bounds: a file past the item size is never read or copied and is reported; too many entries is not checked', async () => {
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
    assert.deepEqual(await revertTurnChanges(root, before, since, q), { reverted: 0, kept: 0, failed: 2 });
    assert.deepEqual(ls(q), [], 'nothing past the item size enters the quarantine');
    assert.ok(fs.existsSync(path.join(memDir(root), 'huge-new.md')), 'left in place (it is never read as memory), reported');
    const crowd = path.join(top, 'crowd'); fs.mkdirSync(memDir(crowd), { recursive: true });
    for (let i = 0; i <= SNAPSHOT_MAX.files; i++) fs.writeFileSync(path.join(memDir(crowd), `${i}.md`), 'x');
    assert.equal(await snapshotMemoryFolder(crowd), TOO_MANY, 'past the entry bound the snapshot stops before reading');
  });

  await t('quarantine: retention of seven days, per-activity count and byte caps, a task purge; owner-only modes', async () => {
    const base = path.join(top, 'qbase');
    const scope = 'a'.repeat(24), task = 'task-1';
    const dir = path.join(base, scope, task); fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'old.md'); fs.writeFileSync(old, 'x');
    const past = (Date.now() - QUARANTINE_LIMITS.retentionMs - 60_000) / 1000; fs.utimesSync(old, past, past);
    const fresh = path.join(dir, 'fresh.md'); fs.writeFileSync(fresh, 'z');
    await pruneQuarantine(base);
    assert.deepEqual(ls(dir), ['fresh.md'], 'retention alone: the week-old copy goes, a fresh one stays (no cap in play)');
    fs.rmSync(fresh);
    for (let i = 0; i < QUARANTINE_LIMITS.files + 3; i++) { const f = path.join(dir, `n${String(i).padStart(4, '0')}.md`); fs.writeFileSync(f, 'y'); const at = (Date.now() - (QUARANTINE_LIMITS.files + 3 - i) * 1000) / 1000; fs.utimesSync(f, at, at); }
    await pruneQuarantine(base);
    const left = ls(dir);
    assert.equal(left.includes('old.md'), false, 'past the retention: gone');
    assert.equal(left.length, QUARANTINE_LIMITS.files, 'count cap');
    assert.equal(left.includes('n0000.md'), false, 'the oldest go first');
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
    same(r, { reverted: 1, kept: 0, failed: 0 });
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
    same(await h.endMemoryFolderGuard('turn-3'), { reverted: 0, kept: 0, failed: 0 });
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
    for (const runtime of ['runLocalCoach({', 'runSdkCoach({']) assert.ok(send.indexOf(runtime) > start && send.indexOf(runtime) < end, `${runtime} runs inside the guarded turn`);
  });

  console.log(`memory folder guard: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
