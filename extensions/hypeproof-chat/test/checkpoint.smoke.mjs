// CGP-AGENT-R-027 / REQ-CGP-AGENT-53 — "저장 지점 남기기" on real temp folders and the real provider.
//   node --experimental-strip-types test/checkpoint.smoke.mjs
// Covers: the seat gate (adult website tracks only, fail closed), the AI-suggested message (from the
// turn's own answer, file-name fallback), hostile message cleaning, the store outside the work folder
// (no .git, folder bytes unchanged, nothing a publish could carry), checkpoints surviving turn pruning,
// the 바뀐 것 history, and the host binding (turn, task, busy, stale walk, single flight, evidence without text).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointApplies, checkpointStoreDir, cleanCheckpointMessage, suggestCheckpointMessage, saveCheckpoint, listCheckpoints, CHECKPOINT_KEEP } from '../src/checkpoint.ts';
import { takeRestorePoint, scanFolder, diffRestorePoint, reviewTurnFiles, listRestorePoints, turnRestoreStoreDir, pruneRestorePoints } from '../src/turnRestore.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const ADULT_SITE = { profile_id: 'synthetic-site', game: { template_tier: 'website' } };

test('seat gate: adult website track only; minors, other tiers, unknown, instructor and no profile are refused', () => {
  assert.equal(checkpointApplies(ADULT_SITE, false), true);
  assert.equal(checkpointApplies({ ...ADULT_SITE, minor_cohort: true }, false), false, 'minor flag');
  assert.equal(checkpointApplies({ ...ADULT_SITE, game: { template_tier: 'search-webapp' } }, false), false, 'adult non-website tier');
  for (const tier of ['kids', 'teen', 'game', undefined]) assert.equal(checkpointApplies({ ...ADULT_SITE, game: tier ? { template_tier: tier } : undefined }, false), false, `tier ${tier}`);
  assert.equal(checkpointApplies(ADULT_SITE, true), false, 'instructor');
  assert.equal(checkpointApplies(ADULT_SITE, undefined), false, 'unknown instructor state fails closed');
  assert.equal(checkpointApplies(null, false), false);
});

test('suggestion: first prose line of the AI answer, markdown and code skipped; file-name fallback says so', () => {
  const ai = suggestCheckpointMessage('```html\n<p>x</p>\n```\n| a | b |\n---\n## **메인 페이지**에 [예약 버튼](https://x) 추가\n\n자세히는…', { added: [], changed: ['index.html'], deleted: [] });
  assert.deepEqual(ai, { message: '메인 페이지에 예약 버튼 추가', source: 'ai' });
  const long = suggestCheckpointMessage('가'.repeat(300), { added: [], changed: [], deleted: [] });
  assert.equal(Array.from(long.message).length, 72);
  const hostile = suggestCheckpointMessage('\u202e악성\u0000\u2028두 번째', { added: [], changed: [], deleted: [] });
  assert.equal(hostile.message, '악성');
  for (const empty of ['', '   ', '```\ncode only\n```', '---', undefined, 42]) {
    const s = suggestCheckpointMessage(empty, { added: ['images/a.png'], changed: ['index.html', 'css/site.css'], deleted: [] });
    assert.deepEqual(s, { message: 'index.html, site.css 외 1개 바꿈', source: 'files' }, JSON.stringify(empty));
  }
  assert.equal(suggestCheckpointMessage('', { added: [], changed: ['a.html'], deleted: [] }).message, 'a.html 바꿈');
});

test('message cleaning: controls, bidi, separators, blank runs, cap; empty is refused', () => {
  assert.equal(cleanCheckpointMessage('  첫 줄\u202e\u2066\r\n\n\n\n둘째\u2029셋째\u0007\t끝  '), '첫 줄\n\n둘째\n셋째 끝');
  assert.equal(cleanCheckpointMessage('e\u0301'), '\u00e9', 'NFC');
  for (const bad of ['', ' \n\t ', '\u200b\u202e', null, 5, {}]) assert.equal(cleanCheckpointMessage(bad), null, JSON.stringify(bad));
  assert.equal(Array.from(cleanCheckpointMessage('😀'.repeat(250))).length, 200);
  const cp = (...n) => String.fromCodePoint(...n);
  assert.equal(cleanCheckpointMessage('a' + cp(0xe0041, 0xe0042) + 'b' + cp(0x061c) + 'c' + cp(0xfff9) + 'd' + cp(0x180e)), 'abcd', 'tag characters, ALM, interlinear annotation, MVS');
  const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
  assert.equal(cleanCheckpointMessage(family), family, 'ZWJ emoji sequence survives');
});

async function folder() {
  const tmp = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'checkpoint-')));
  const root = join(tmp, 'work'), base = join(tmp, 'storage');
  await fs.mkdir(join(root, 'css'), { recursive: true });
  await fs.writeFile(join(root, 'index.html'), '<h1>old</h1>\n');
  await fs.writeFile(join(root, 'css', 'site.css'), 'h1{}\n');
  return { tmp, root, base, cleanup: () => fs.rm(tmp, { recursive: true, force: true }) };
}

test('library: checkpoint lives outside the work folder, changes nothing there, survives turn pruning, keeps 20', async () => {
  const f = await folder();
  try {
    const before = await scanFolder(f.root);
    const store = checkpointStoreDir(f.base, f.root, 'task-1');
    assert.ok(!store.startsWith(f.root), 'store is not inside the work folder');
    const out = await saveCheckpoint({ store, root: f.root, turnId: 'turn-1', message: ' 예약 버튼 추가 ' });
    assert.equal(out.ok, true);
    const after = await scanFolder(f.root);
    assert.equal(after.digest, before.digest, 'work folder bytes unchanged');
    assert.deepEqual(after.dirs, before.dirs, 'no .git or other folder created');
    await assert.rejects(fs.stat(join(f.root, '.git')));
    const history = await listCheckpoints(store);
    assert.deepEqual(history.map((h) => [h.message, h.fileCount]), [['예약 버튼 추가', 2]]);
    // Turn points in the turn store prune to 10; the checkpoint store is separate.
    const turnStore = turnRestoreStoreDir(f.base, f.root, 'task-1');
    for (let i = 0; i < 12; i++) await takeRestorePoint({ store: turnStore, root: f.root, id: `t${i}`, turnId: `t${i}`, kind: 'turn', now: 1000 + i });
    await pruneRestorePoints(turnStore, 10);
    assert.equal((await listCheckpoints(store)).length, 1, 'turn pruning never removes a checkpoint');
    assert.ok((await listRestorePoints(turnStore)).every((p) => p.kind !== 'checkpoint'));
    for (let i = 0; i < CHECKPOINT_KEEP + 3; i++) assert.equal((await saveCheckpoint({ store, root: f.root, turnId: 't', message: `m${i}`, now: Date.now() + 60_000 + i })).ok, true);
    const kept = await listCheckpoints(store);
    assert.equal(kept.length, CHECKPOINT_KEEP);
    assert.equal(kept[0].message, `m${CHECKPOINT_KEEP + 2}`, 'newest first');
    // Refusals store nothing.
    assert.deepEqual(await saveCheckpoint({ store, root: f.root, turnId: 't', message: '\u202e  ' }), { ok: false, error: 'empty_message' });
    assert.deepEqual(await saveCheckpoint({ store, root: f.root, turnId: 't', message: '가'.repeat(201) }), { ok: false, error: 'too_long' });
    assert.deepEqual(await saveCheckpoint({ store, root: f.root, turnId: 't', message: 'x', stillCurrent: () => false }), { ok: false, error: 'stale' });
    assert.deepEqual(await saveCheckpoint({ store, root: f.root, turnId: 't', message: 'x', limits: { entriesMax: 1 } }), { ok: false, error: 'folder_too_large' });
    assert.equal((await listCheckpoints(store)).length, CHECKPOINT_KEEP, 'refused saves left no point');
  } finally { await f.cleanup(); }
});

async function hostFixture(profile = ADULT_SITE) {
  const f = await folder();
  const hostRoot = join(f.tmp, 'host');
  await fs.mkdir(hostRoot);
  const h = await createTaskHarness(hostRoot);
  h.h.resolveCoachCwd = () => f.root;
  h.h.profileGeneration = 1;
  h.h.cachedProfile = profile;
  h.h._instructorMode = { isInstructor: false };
  h.h.provenanceRecorder = () => null;
  h.h.postArtifactProvenance = async () => {};
  h.h.post = async (message) => h.posts.push(message);
  const events = [];
  h.h.spool = { recordWorkflow: (e) => events.push(e) };
  const base = h.h.context.globalStorageUri.fsPath;
  const taskKey = h.h.turnRestoreTaskKey();
  const store = turnRestoreStoreDir(base, f.root, taskKey);
  const { point } = await takeRestorePoint({ store, root: f.root, id: 'turn', turnId: 'turn', kind: 'turn' });
  await fs.writeFile(join(f.root, 'index.html'), '<h1>new</h1>\n');
  const views = () => h.posts.filter((m) => m.type === 'turnReviewState').map((m) => m.view);
  return { ...f, ...h, events, base, taskKey, store, point, cpStore: checkpointStoreDir(base, f.root, taskKey), views,
    end: (text) => h.h.endTurnRestore({ store, root: f.root, point, taskKey }, 'turn', 'msg', text),
    save: (message, turnId = 'turn') => h.handle(h.scoped({ type: 'checkpointSave', turnId, message })) };
}

test('real host: the review offers a checkpoint with the AI answer prefilled, and a save lands in the panel history', async () => {
  const f = await hostFixture();
  try {
    await f.end('예약 버튼을 메인에 추가했어요.\n\n다음으로…');
    const cp = f.h.turnReview.view.checkpoint;
    assert.deepEqual([cp.suggestion, cp.source, cp.history.length], ['예약 버튼을 메인에 추가했어요.', 'ai', 0]);
    assert.deepEqual(f.views().at(-1).checkpoint.suggestion, cp.suggestion, 'posted to the webview');
    const folderBefore = await scanFolder(f.root);
    await f.save('메인에 예약 버튼 추가 (직접 고침)');
    const view = f.h.turnReview.view.checkpoint;
    assert.equal(view.saving, false);
    assert.match(view.notice, /웹에 올리지 않았어요/);
    assert.equal(JSON.stringify(view.history.map((e) => e.message)), JSON.stringify(['메인에 예약 버튼 추가 (직접 고침)']));
    assert.equal(view.savedId, view.history[0].id);
    assert.equal((await scanFolder(f.root)).digest, folderBefore.digest, 'save never touches the work folder');
    assert.equal(f.events.length, 1);
    const e = f.events[0];
    assert.equal(e.event, 'checkpoint_save');
    assert.equal(e.payload.edited, true);
    assert.equal(e.payload.suggestion_source, 'ai');
    assert.ok(!JSON.stringify(e).includes('예약'), 'evidence carries no message text');
    assert.ok(!JSON.stringify(e).includes('index.html'), 'evidence carries no path');
    // The next turn's review shows the saved checkpoint in its history.
    await f.end('');
    assert.equal(JSON.stringify(f.h.turnReview.view.checkpoint.history.map((x) => x.message)), JSON.stringify(['메인에 예약 버튼 추가 (직접 고침)']));
    assert.equal(f.h.turnReview.view.checkpoint.source, 'files');
  } finally { await f.cleanup(); }
});

test('real host: no checkpoint for a minor, a kids tier, a non-website tier or the instructor', async () => {
  for (const [label, profile, instructor] of [['minor', { ...ADULT_SITE, minor_cohort: true }, false], ['kids', { ...ADULT_SITE, game: { template_tier: 'kids' } }, false], ['search-webapp', { ...ADULT_SITE, game: { template_tier: 'search-webapp' } }, false], ['instructor', ADULT_SITE, true]]) {
    const f = await hostFixture(profile);
    try {
      f.h._instructorMode = { isInstructor: instructor };
      await f.end('답');
      assert.equal(f.h.turnReview.view.checkpoint, undefined, label);
      await f.save('강제 저장');
      assert.equal((await listCheckpoints(f.cpStore)).length, 0, `${label}: a forged save stores nothing`);
    } finally { await f.cleanup(); }
  }
});

test('real host: forged turn, busy work, empty or long text, a seat change and a double press store nothing extra', async () => {
  const f = await hostFixture();
  try {
    await f.end('제안');
    await f.save('다른 턴', 'turn-other');
    assert.equal((await listCheckpoints(f.cpStore)).length, 0, 'other turn id');
    f.h.pendingSends = 1;
    await f.save('바쁠 때');
    assert.match(f.h.turnReview.view.checkpoint.notice, /진행 중인 작업이 끝난 뒤/);
    f.h.pendingSends = 0;
    await f.save('  \u202e ');
    assert.match(f.h.turnReview.view.checkpoint.notice, /메시지를 적어 주세요/);
    await f.save('가'.repeat(201));
    assert.match(f.h.turnReview.view.checkpoint.notice, /200자까지/);
    assert.equal((await listCheckpoints(f.cpStore)).length, 0);
    // The work folder changing (or a turn starting) during the folder walk drops the point.
    const realCwd = f.h.resolveCoachCwd;
    let calls = 0;
    f.h.resolveCoachCwd = () => (++calls > 1 ? f.tmp : realCwd());
    await f.save('도중에 폴더 바뀜');
    assert.match(f.h.turnReview.view.checkpoint.notice, /작업이 바뀌어서/);
    assert.equal((await listCheckpoints(f.cpStore)).length, 0, 'stale walk dropped');
    f.h.resolveCoachCwd = realCwd;
    const realBusy = f.h.hasActiveStream;
    calls = 0;
    f.h.hasActiveStream = function () { return ++calls > 2 ? true : realBusy.call(this); };
    await f.save('도중에 턴 시작');
    assert.match(f.h.turnReview.view.checkpoint.notice, /작업이 바뀌어서/);
    assert.equal((await listCheckpoints(f.cpStore)).length, 0, 'turn started mid-walk: dropped');
    f.h.hasActiveStream = realBusy;
    // Double press: one checkpoint.
    await Promise.all([f.save('한 번'), f.save('한 번')]);
    assert.equal((await listCheckpoints(f.cpStore)).length, 1, 'single flight');
    // The seat stops qualifying: the offer is withdrawn and nothing is stored.
    f.h.cachedProfile = { ...ADULT_SITE, minor_cohort: true };
    await f.save('좌석 바뀜');
    assert.equal(f.h.turnReview.view.checkpoint, undefined);
    assert.equal((await listCheckpoints(f.cpStore)).length, 1);
  } finally { await f.cleanup(); }
});

test('real host: a save refuses while a revert runs, and a revert refuses while a save runs', async () => {
  const f = await hostFixture();
  try {
    await f.end('제안');
    f.h.turnRestoreBusy = true;
    await f.save('되돌리는 중');
    assert.equal((await listCheckpoints(f.cpStore)).length, 0);
    f.h.turnRestoreBusy = false;
    f.h.checkpointSaving = true;
    await f.h.handleTurnReviewMessage({ type: 'turnRevert', turnId: 'turn' });
    assert.match(f.h.turnReview.view.notice, /진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요/);
    await f.h.handleTurnReviewMessage({ type: 'turnKeep', turnId: 'turn' });
    assert.ok(f.h.turnReview, 'a keep during a save does not drop the review (and the save)');
    assert.match(f.h.turnReview.view.notice, /저장 지점을 남기는 중이에요/);
    assert.equal(await fs.readFile(join(f.root, 'index.html'), 'utf8'), '<h1>new</h1>\n', 'no revert ran');
  } finally { await f.cleanup(); }
});

// A refused save is byte-for-byte invisible: every manifest and every blob of the checkpoint store
// (the existing save points) stays exactly as it was, whichever refusal fires.
async function storeBytes(dir) {
  const out = {};
  async function walk(d) {
    let names = [];
    try { names = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else out[p.slice(dir.length)] = (await fs.readFile(p)).toString('base64');
    }
  }
  await walk(dir);
  return out;
}

test('library: every refusal leaves the existing save points (manifests and blobs) byte-identical', async () => {
  const f = await folder();
  try {
    const store = checkpointStoreDir(f.base, f.root, 'task-1');
    for (let i = 0; i < CHECKPOINT_KEEP; i++) {
      await fs.writeFile(join(f.root, 'index.html'), `<h1>v${i}</h1>\n`);
      assert.equal((await saveCheckpoint({ store, root: f.root, turnId: 't', message: `m${i}`, now: 5000 + i })).ok, true);
    }
    const before = await storeBytes(store);
    assert.ok(Object.keys(before).length > 2 * CHECKPOINT_KEEP, 'manifests and blobs exist');
    await fs.writeFile(join(f.root, 'index.html'), '<h1>brand new bytes</h1>\n');
    const refusals = [
      [{ message: String.fromCharCode(0x202e) + '  ' }, 'empty_message'],
      [{ message: '가'.repeat(201) }, 'too_long'],
      [{ message: 'x', stillCurrent: () => false }, 'stale'],
      [{ message: 'x', limits: { entriesMax: 1 } }, 'folder_too_large'],
    ];
    for (const [extra, error] of refusals) {
      const out = await saveCheckpoint({ store, root: f.root, turnId: 't', now: Date.now() + 9e6, ...extra });
      assert.deepEqual(out, { ok: false, error });
      assert.deepEqual(await storeBytes(store), before, `${error}: store unchanged`);
    }
  } finally { await f.cleanup(); }
});

test('real host: a stale-dropped save keeps the existing save point readable', async () => {
  const f = await hostFixture();
  try {
    await f.end('제안');
    await f.save('첫 저장');
    const before = await storeBytes(f.cpStore);
    await fs.writeFile(join(f.root, 'index.html'), '<h1>changed later</h1>\n');
    const realCwd = f.h.resolveCoachCwd;
    let calls = 0;
    f.h.resolveCoachCwd = () => (++calls > 1 ? f.tmp : realCwd());
    await f.save('도중에 폴더 바뀜');
    assert.deepEqual(await storeBytes(f.cpStore), before);
    assert.equal((await listCheckpoints(f.cpStore)).length, 1);
  } finally { await f.cleanup(); }
});

test('real host: a seat that stops qualifying never re-offers the checkpoint when the bar is re-posted', async () => {
  const f = await hostFixture();
  try {
    await f.end('제안');
    f.h.cachedProfile = { ...ADULT_SITE, minor_cohort: true };
    f.posts.length = 0;
    await f.handle(f.scoped({ type: 'turnReviewRequest' }));
    const v = f.views().at(-1);
    assert.ok(v, 'bar still posted');
    assert.equal(v.checkpoint, undefined, 'no checkpoint for the changed seat');
  } finally { await f.cleanup(); }
});
