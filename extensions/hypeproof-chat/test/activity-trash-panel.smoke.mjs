// CGP-KNOW-D-013 (DES-KNOW-24) — the 내 작품 panel's trash, end to end through the real provider's
// message routing into the real encrypted store (activityTrashCommands.ts + activityTrash.ts).
// VS Code is stubbed; files are real temporary files.
//   node --experimental-strip-types test/activity-trash-panel.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trash-panel-')));
const work = path.join(top, 'work'), base = path.join(top, 'globalStorage');
fs.mkdirSync(work); fs.mkdirSync(base);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// The commands module with its own VS Code stub (the provider never calls these APIs itself).
let enabled = false, dirty = null, refusal = null, answer = 'confirm', duringConfirm = null;
const dialogs = [];
const cmdVscode = {
  commands: { registerCommand: () => ({}) },
  workspace: {
    onWillDeleteFiles: () => ({}), onDidDeleteFiles: () => ({}),
    get workspaceFolders() { return [{ uri: { scheme: 'file', fsPath: work } }]; },
    get textDocuments() { return dirty ? [{ uri: { scheme: 'file', fsPath: path.join(work, dirty) }, isDirty: true }] : []; },
    getConfiguration: () => ({ get: (key, fallback) => key === 'activityTrashEnabled' ? enabled : fallback }),
  },
  window: {
    showWarningMessage: async (text, options, ...items) => {
      dialogs.push({ text, options, items });
      if (duringConfirm) await duringConfirm();
      return answer === 'confirm' ? items.find(item => !item.isCloseAffordance) : items.find(item => item.isCloseAffordance);
    },
    showInformationMessage: async () => undefined,
  },
};
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityTrashCommands.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? cmdVscode : require(id), console, Buffer, setTimeout, process });

const f = await createTaskHarness(path.join(top, 'tasks'));
const h = f.h;
h.cachedProfile = { profile_id: 'synthetic-personal' };
h._instructorMode = { isInstructor: false };
h.resolveCoachCwd = () => work;
let provenancePosts = 0;
h.postArtifactProvenance = async () => { provenancePosts++; };
const secrets = new Map();
const keyring = { get: async k => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async k => { secrets.delete(k); } };
h.folderWriteRefusalFor = file => (refusal && file.endsWith(refusal) ? '이 폴더에는 쓸 수 없어요.' : null);
const api = mod.exports.registerActivityTrash({ subscriptions: [], globalStorageUri: { fsPath: base }, secrets: keyring }, {
  active: () => !!h.activityTrashBinding, binding: () => h.activityTrashBinding, refusal: file => h.folderWriteRefusalFor(file),
});
h.setActivityTrashPanel(api);

const states = () => f.posts.filter(m => m.type === 'activityTrashState');
const last = () => states().at(-1);
const list = async () => { await f.handle(f.scoped({ type: 'activityTrashRequest' })); return last().view; };
let seq = 0;
const press = async (action, target, extra = {}) => {
  const requestId = `r${++seq}`;
  await f.handle(f.scoped({ type: 'activityTrashAction', requestId, scope: extra.scope ?? (await list())?.scope ?? 'none', action, target, ...extra }));
  const answerState = last();
  assert.equal(answerState.requestId, requestId, `answer correlates to ${requestId}`);
  return answerState;
};
const file = name => path.join(work, name);
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };

try {
  fs.writeFileSync(file('작품.html'), '<h1>내 작품</h1>');
  const original = sha(file('작품.html'));

  await t('default off: no trash view, and a press is refused without touching the file', async () => {
    assert.equal(await list(), null);
    const r = await press('move', '작품.html', { scope: 'anything' });
    assert.ok(r.result.error); assert.equal(dialogs.length, 0);
    assert.equal(sha(file('작품.html')), original);
  });

  enabled = true;
  await t('on: the view carries the task scope and an empty list', async () => {
    const view = await list();
    assert.deepEqual(view.entries, []); assert.equal(view.scope, h.activityTrashBinding.scope);
  });

  await t('instructor and no task workspace: no view', async () => {
    h._instructorMode = { isInstructor: true }; assert.equal(await list(), null);
    h._instructorMode = { isInstructor: false };
    const tw = h.taskWorkspace; h.taskWorkspace = undefined; assert.equal(await list(), null); h.taskWorkspace = tw;
    assert.ok(await list());
  });

  await t('move: native confirm names the file and has one Cancel; Cancel leaves the bytes', async () => {
    answer = 'cancel';
    const r = await press('move', '작품.html');
    assert.equal(r.result.cancelled, true);
    const d = dialogs.at(-1);
    assert.equal(d.options.modal, true); assert.equal(d.options.detail, '작품.html');
    assert.deepEqual(d.items.map(i => i.title), ['휴지통으로 이동', '취소']);
    assert.equal(d.items.filter(i => i.isCloseAffordance).length, 1);
    assert.equal(sha(file('작품.html')), original);
    answer = 'confirm';
  });

  await t('move refused while a turn runs, while unsaved, under folder refusal, for a stale scope', async () => {
    const before = dialogs.length;
    h.pendingSends = 1; assert.match((await press('move', '작품.html')).result.error, /AI가 일하는 동안/); h.pendingSends = 0;
    h.turnRestoreBusy = true; assert.ok((await press('move', '작품.html')).result.error); h.turnRestoreBusy = false;
    dirty = '작품.html'; assert.match((await press('move', '작품.html')).result.error, /저장하지 않은/); dirty = null;
    refusal = '작품.html'; assert.ok((await press('move', '작품.html')).result.error); refusal = null;
    assert.match((await press('move', '작품.html', { scope: '["other",null]' })).result.error, /작업 상태가 바뀌었어요/);
    assert.equal(dialogs.length, before, 'no refused press reaches a confirm');
    assert.equal(sha(file('작품.html')), original);
  });

  await t('move refuses traversal, absolute paths, folders and unknown actions', async () => {
    fs.mkdirSync(file('folder'));
    for (const target of ['../outside.txt', '/etc/hosts', 'folder', '']) assert.ok((await press('move', target)).result.error, target);
    assert.ok((await press('rename', '작품.html')).result.error);
    const scope = (await list()).scope, n = states().length;
    await f.handle(f.scoped({ type: 'activityTrashAction', requestId: 'bad id!', scope, action: 'move', target: '작품.html' }));
    assert.equal(states().length, n, 'a malformed request id gets no answer');
    assert.equal(fs.existsSync(file('작품.html')), true);
  });

  let moved;
  await t('move: file leaves the folder, lands in the trash with path and time; the send reservation is released', async () => {
    const count = provenancePosts;
    const r = await press('move', '작품.html');
    assert.equal(r.result.action, 'move'); assert.equal(r.result.path, '작품.html'); assert.ok(r.result.id);
    assert.equal(fs.existsSync(file('작품.html')), false);
    assert.equal(r.view.entries.length, 1); assert.equal(r.view.entries[0].path, '작품.html');
    assert.ok(Math.abs(r.view.entries[0].at - Date.now()) < 60_000);
    assert.equal(h.turnRestoreBusy, false);
    assert.equal(provenancePosts, count + 1, 'the 내 작품 list is refreshed');
    moved = r.result.id;
  });

  await t('the send reservation is held during the native confirm', async () => {
    fs.writeFileSync(file('b.txt'), 'b');
    let reserved;
    duringConfirm = async () => { reserved = h.turnRestoreBusy; };
    await press('move', 'b.txt');
    duringConfirm = null;
    assert.equal(reserved, true); assert.equal(h.turnRestoreBusy, false);
  });

  await t('a second press while one waits on its confirm is refused, not queued', async () => {
    fs.writeFileSync(file('c.txt'), 'c');
    const scope = (await list()).scope;
    let second;
    duringConfirm = async () => { duringConfirm = null; second = await api.act('move', 'c.txt', scope); };
    await press('move', 'c.txt');
    assert.match(second.error, /앞의 파일 작업/);
  });

  await t('Undo (restore) returns identical bytes to the original path, without a confirm', async () => {
    const before = dialogs.length;
    const r = await press('restore', moved);
    assert.deepEqual([r.result.action, r.result.path, r.result.renamed], ['restore', '작품.html', false]);
    assert.equal(sha(file('작품.html')), original);
    assert.equal(dialogs.length, before);
    assert.ok(!r.view.entries.some(e => e.id === moved));
  });

  await t('restore onto an occupied name writes a suffixed file and says which', async () => {
    const id = (await press('move', '작품.html')).result.id;
    fs.writeFileSync(file('작품.html'), 'new one');
    const r = await press('restore', id);
    assert.equal(r.result.renamed, true); assert.equal(r.result.path, '작품 (1).html');
    assert.equal(sha(file('작품 (1).html')), original);
    assert.equal(fs.readFileSync(file('작품.html'), 'utf8'), 'new one');
  });

  await t('restore and purge refuse an unknown id and a stale scope', async () => {
    assert.ok((await press('restore', 'not-an-id')).result.error);
    const id = (await list()).entries[0].id;
    assert.ok((await press('restore', id, { scope: 'stale' })).result.error);
    assert.ok((await press('purge', id, { scope: 'stale' })).result.error);
    assert.ok((await list()).entries.some(e => e.id === id));
  });

  await t('permanent delete: native confirm names the file; Cancel keeps it; confirm removes it', async () => {
    const entry = (await list()).entries[0];
    answer = 'cancel';
    const kept = await press('purge', entry.id);
    assert.equal(kept.result.cancelled, true); assert.ok(kept.view.entries.some(e => e.id === entry.id));
    const d = dialogs.at(-1);
    assert.equal(d.options.detail, entry.path); assert.deepEqual(d.items.map(i => i.title), ['영구 삭제', '취소']);
    answer = 'confirm';
    const gone = await press('purge', entry.id);
    assert.equal(gone.result.action, 'purge'); assert.ok(!gone.view.entries.some(e => e.id === entry.id));
  });

  await t('bytes changed during the move confirm: refused, the new bytes stay', async () => {
    fs.writeFileSync(file('e.txt'), 'before');
    duringConfirm = async () => { fs.writeFileSync(file('e.txt'), 'changed while asking'); };
    const r = await press('move', 'e.txt');
    duringConfirm = null;
    assert.match(r.result.error, /파일이 바뀌었어요/);
    assert.equal(fs.readFileSync(file('e.txt'), 'utf8'), 'changed while asking');
    assert.ok(!r.view.entries.some(e => e.path === 'e.txt'));
  });

  await t('an unknown action never reaches the store', async () => {
    let calls = 0;
    const real = api.act;
    h.setActivityTrashPanel({ view: api.view, act: async (...args) => { calls++; return real(...args); } });
    const r = await press('rename', '작품.html');
    h.setActivityTrashPanel(api);
    assert.equal(calls, 0); assert.match(r.result.error, /작업 상태가 바뀌었어요/);
  });

  await t('the profile changes during the move confirm: no mutation, a correlated refusal', async () => {
    fs.writeFileSync(file('d.txt'), 'd');
    duringConfirm = async () => { h.cachedProfile = null; };
    const r = await press('move', 'd.txt');
    duringConfirm = null; h.cachedProfile = { profile_id: 'synthetic-personal' };
    assert.ok(r.result.error); assert.equal(fs.readFileSync(file('d.txt'), 'utf8'), 'd');
  });

  await t('no trash file is ever written inside the work folder', async () => {
    const names = fs.readdirSync(work, { recursive: true }).map(String);
    assert.ok(!names.some(n => /\.(blob|meta)$/.test(n) || n.includes('activity-trash')), names.join(','));
  });

  console.log(`activity-trash panel host: ${passed} checks PASS`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
