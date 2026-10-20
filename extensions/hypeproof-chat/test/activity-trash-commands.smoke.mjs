import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityTrashCommands.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trash-commands-')));
const root = path.join(top, 'activity'), base = path.join(top, 'globalStorage');
fs.mkdirSync(root); fs.mkdirSync(base);
const commands = new Map();
let willDelete, didDelete;
let currentScope = 'activity/task', refusal = null, refusalFn = null;
let enabled = true, active = true, action = '복원', confirmation, changed = false;
let messages = [], warnings = [];
const uri = { scheme: 'file', fsPath: path.join(root, 'work.txt') };
const title = choice => typeof choice === 'string' ? choice : choice?.title;
const vscode = {
  commands: { registerCommand: (name, fn) => { commands.set(name, fn); return {}; } },
  workspace: { onWillDeleteFiles: fn => { willDelete = fn; return {}; }, onDidDeleteFiles: fn => { didDelete = fn; return {}; }, workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }], textDocuments: [], getConfiguration: () => ({ get: () => enabled }) },
  window: {
    showWarningMessage: async (text, options, ...choices) => { warnings.push({ text, options, choices }); if (changed) active = false; return choices.find(c => title(c) === confirmation); },
    showInformationMessage: async text => { messages.push(text); },
    showQuickPick: async items => typeof items[0] === 'string' ? action : items[0],
  },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, setTimeout, process });
const secrets = new Map();
const keyring = { get: async k => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async k => { secrets.delete(k); } };
module.exports.registerActivityTrash({ subscriptions: [], globalStorageUri: { fsPath: base }, secrets: keyring }, { active: () => active, refusal: file => refusalFn ? refusalFn(file) : refusal, binding: () => ({ root, scope: currentScope }) });
const remove = (target = uri) => commands.get('hypeproof-chat.trashFile')(target);
const manage = () => commands.get('hypeproof-chat.activityTrash')();
const native = async (files, token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }) => {
  const waits = [];
  willDelete({ files, token, waitUntil: promise => waits.push(promise) });
  await Promise.all(waits);
};
const storeFiles = () => { const dir = path.join(base, 'activity-trash'); return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(n => n.endsWith('.blob')) : []; };
try {
  fs.writeFileSync(uri.fsPath, 'original');
  await remove(); // Cancel must leave file untouched.
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'original');
  enabled = false; confirmation = '휴지통으로 이동'; await remove();
  assert.equal(fs.existsSync(uri.fsPath), true);
  enabled = true; changed = true; await remove(); // Activity/run gate changes during modal.
  assert.equal(fs.existsSync(uri.fsPath), true);
  changed = false; active = true; await remove();
  assert.equal(fs.existsSync(uri.fsPath), false);
  assert.equal(fs.existsSync(path.join(root, '.hypeproof')), false, 'no trash inside the work folder');
  fs.writeFileSync(uri.fsPath, 'occupied');
  await manage();
  assert.ok(messages.some(text => text.includes('같은 이름')));
  assert.equal(fs.readFileSync(path.join(root, 'work (1).txt'), 'utf8'), 'original');
  await remove();
  action = '영구 삭제'; confirmation = '취소'; await manage();
  // One Cancel: a single close-affordance item and no plain-string duplicate for the workbench to add to.
  const purgeModal = warnings.findLast(w => w.options?.modal === true && w.text.includes('영구 삭제할까요'));
  assert.ok(purgeModal);
  assert.deepEqual(purgeModal.choices.map(title), ['영구 삭제', '취소']);
  assert.equal(purgeModal.choices.filter(c => c?.isCloseAffordance === true).length, 1);
  assert.equal(purgeModal.choices.some(c => typeof c === 'string'), false);
  action = '복원'; await manage(); // Purge Cancel kept bytes restorable.
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'occupied');
  confirmation = '휴지통으로 이동'; await remove();
  action = '영구 삭제'; confirmation = '영구 삭제'; await manage();
  await manage();
  assert.equal(messages.at(-1), '활동 휴지통이 비어 있어요.');
  // Native Explorer deletion preserves a copy before it removes the source.
  fs.writeFileSync(uri.fsPath, 'native bytes');
  await native([uri]);
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'native bytes');
  fs.unlinkSync(uri.fsPath);
  didDelete({ files: [uri] });
  action = '복원'; await manage();
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'native bytes');
  // The folder write gate also governs Explorer snapshots: a refused file is never copied.
  refusal = 'restricted'; warnings = [];
  const before = storeFiles().length;
  await native([uri]);
  assert.equal(storeFiles().length, before);
  assert.ok(warnings.some(w => w.text.includes('모두 보관하지 못했어요')));
  refusal = null;
  // The write gate is per file: in a folder, a refused file is not copied, the others are, and the learner is told.
  fs.mkdirSync(path.join(root, 'mixed')); fs.writeFileSync(path.join(root, 'mixed', 'ok.txt'), 'ok'); fs.writeFileSync(path.join(root, 'mixed', 'no.txt'), 'no');
  const mixed = { scheme: 'file', fsPath: path.join(root, 'mixed') };
  const gate = file => file.endsWith('no.txt') ? 'restricted' : null;
  warnings = []; const beforeMixed = storeFiles().length;
  refusalFn = gate; await native([mixed]); refusalFn = null;
  assert.equal(storeFiles().length, beforeMixed + 1);
  assert.ok(warnings.some(w => w.text.includes('모두 보관하지 못했어요')));
  refusal = null;
  // A cancelled participant: the files after it are not copied, and the learner is told (VS Code deletes them anyway).
  const two = [{ scheme: 'file', fsPath: path.join(root, 'mixed', 'ok.txt') }, { scheme: 'file', fsPath: path.join(root, 'mixed', 'no.txt') }];
  warnings = []; await native(two, { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) });
  assert.ok(warnings.some(w => w.text.includes('취소되어')));
  // The originals stay, so their pending copies stay hidden.
  // File replacement while confirmation is open must never delete the replacement.
  const originalWarning = vscode.window.showWarningMessage;
  vscode.window.showWarningMessage = async (_text, options, ...choices) => {
    if (options?.modal) fs.writeFileSync(uri.fsPath, 'replacement during dialog');
    return choices.find(c => title(c) === '휴지통으로 이동');
  };
  await remove();
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'replacement during dialog');
  vscode.window.showWarningMessage = originalWarning;
  // Same folder, different task/activity: a modal never acts on the new scope.
  vscode.window.showWarningMessage = async (_t, _o, ...choices) => { currentScope = 'another/task'; return choices.find(c => title(c) === '휴지통으로 이동'); };
  await remove();
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'replacement during dialog');
  vscode.window.showWarningMessage = originalWarning;
  currentScope = 'activity/task';
  confirmation = '휴지통으로 이동';
  refusal = 'restricted'; await remove();
  assert.equal(fs.existsSync(uri.fsPath), true);
  refusal = null;
  vscode.workspace.textDocuments = [{ uri, isDirty: true }]; await remove();
  assert.equal(fs.existsSync(uri.fsPath), true);
  vscode.workspace.textDocuments = [];
  // Native cancellation leaves the source intact and shows no deleted entry, but keeps the copy:
  // VS Code still deletes after a cancelled participant, and the copy then appears.
  let cancelled = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  await native([uri], cancelled);
  cancelled.isCancellationRequested = true;
  action = '복원'; await manage();
  assert.equal(messages.at(-1), '활동 휴지통이 비어 있어요.');
  assert.equal(fs.existsSync(uri.fsPath), true);
  fs.unlinkSync(uri.fsPath); // the delete VS Code performs anyway
  await manage();
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), 'replacement during dialog');

  // Folders: within the cap they go to the trash file by file; over the cap a plain permanent-delete confirm.
  const folder = { scheme: 'file', fsPath: path.join(root, 'site') };
  fs.mkdirSync(path.join(folder.fsPath, 'img'), { recursive: true });
  fs.writeFileSync(path.join(folder.fsPath, 'index.html'), '<h1>');
  fs.writeFileSync(path.join(folder.fsPath, 'img', 'a.png'), 'png');
  // The explicit folder command refuses the whole gesture when any file in it is refused.
  confirmation = '휴지통으로 이동'; refusalFn = file => file.endsWith('a.png') ? 'restricted' : null;
  await remove(folder); refusalFn = null;
  assert.equal(fs.readFileSync(path.join(folder.fsPath, 'index.html'), 'utf8'), '<h1>');
  assert.equal(fs.existsSync(path.join(folder.fsPath, 'img', 'a.png')), true);
  await remove(folder);
  assert.equal(fs.existsSync(folder.fsPath), false);
  assert.ok(messages.at(-1).includes('2개'));
  // Over the cap (5,000 files): no copy at all, and the confirm is a permanent delete with one Cancel.
  const big = { scheme: 'file', fsPath: path.join(root, 'big') };
  fs.mkdirSync(path.join(big.fsPath, 'node_modules'), { recursive: true });
  for (let i = 0; i < 5001; i++) fs.writeFileSync(path.join(big.fsPath, 'node_modules', `${i}.js`), '');
  const storeBefore = storeFiles().length;
  warnings = []; confirmation = '취소'; await remove(big);
  assert.equal(fs.existsSync(big.fsPath), true, 'Cancel keeps the folder');
  const bigModal = warnings.find(w => w.options?.modal === true);
  assert.ok(bigModal.text.includes('너무 커서') && bigModal.text.includes('영구 삭제'));
  assert.deepEqual(bigModal.choices.map(title), ['영구 삭제', '취소']);
  assert.equal(bigModal.choices.filter(c => c?.isCloseAffordance === true).length, 1);
  warnings = []; await native([big]);
  assert.ok(warnings.some(w => w.text.includes('너무 커서')));
  assert.equal(storeFiles().length, storeBefore, 'over the cap nothing is copied');
  confirmation = '영구 삭제'; await remove(big);
  assert.equal(fs.existsSync(big.fsPath), false);
  assert.equal(storeFiles().length, storeBefore);
  // One Explorer delete of several folders shares one cap (verify R3): 3 x 2,000 files or 3 x 90 MB copy nothing and warn.
  const many = ['m1', 'm2', 'm3'].map(d => ({ scheme: 'file', fsPath: path.join(root, d) }));
  const sparse = (f, n) => { const fd = fs.openSync(f, 'w'); fs.ftruncateSync(fd, n); fs.closeSync(fd); };
  const storeBeforeGesture = storeFiles().length;
  for (const f of many) { fs.mkdirSync(f.fsPath); for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(f.fsPath, `${i}.js`), ''); }
  warnings = []; await native(many);
  assert.ok(warnings.some(w => w.text.includes('너무 커서')), 'three folders of 2,000 files pass the cap together');
  assert.equal(storeFiles().length, storeBeforeGesture);
  for (const f of many) fs.rmSync(f.fsPath, { recursive: true });
  for (const f of many) { fs.mkdirSync(f.fsPath); sparse(path.join(f.fsPath, 'video.mp4'), 90 * 1024 * 1024); }
  warnings = []; await native(many);
  assert.ok(warnings.some(w => w.text.includes('너무 커서')), 'three folders of 90 MB pass the cap together');
  assert.equal(storeFiles().length, storeBeforeGesture);
  for (const f of many) fs.rmSync(f.fsPath, { recursive: true });
  // Control: three small folders in one gesture are all kept, with no warning.
  for (const f of many) { fs.mkdirSync(f.fsPath); fs.writeFileSync(path.join(f.fsPath, 'note.txt'), f.fsPath); }
  warnings = []; await native(many);
  assert.equal(storeFiles().length, storeBeforeGesture + 3);
  assert.equal(warnings.length, 0);

  // Permanent folder delete: activity, consent, scope and unsaved files are checked again after its modal (V17).
  const linked = { scheme: 'file', fsPath: path.join(root, 'linked') };
  fs.mkdirSync(linked.fsPath); fs.writeFileSync(path.join(linked.fsPath, 'page.html'), 'page'); fs.symlinkSync(os.tmpdir(), path.join(linked.fsPath, 'out'));
  const duringModal = async (answer, change, undo) => {
    vscode.window.showWarningMessage = async (text, options, ...choices) => { warnings.push({ text, options, choices }); if (options?.modal) change(); return choices.find(c => title(c) === answer); };
    warnings = [];
    try { await remove(linked); } finally { vscode.window.showWarningMessage = originalWarning; undo(); }
    return warnings.find(w => w.options?.modal);
  };
  const changes = {
    'activity left': [() => { active = false; }, () => { active = true; }],
    'write refused': [() => { refusal = 'restricted'; }, () => { refusal = null; }],
    'task changed': [() => { currentScope = 'another/task'; }, () => { currentScope = 'activity/task'; }],
    'unsaved file inside': [() => { vscode.workspace.textDocuments = [{ uri: { scheme: 'file', fsPath: path.join(linked.fsPath, 'page.html') }, isDirty: true }]; }, () => { vscode.workspace.textDocuments = []; }],
  };
  for (const [why, [change, undo]] of Object.entries(changes)) {
    const modal = await duringModal('영구 삭제', change, undo);
    assert.ok(modal?.text.includes('링크') && modal.text.includes('영구 삭제'), `${why}: the permanent-delete modal was shown`);
    assert.equal(fs.readFileSync(path.join(linked.fsPath, 'page.html'), 'utf8'), 'page', `${why}: the folder stays`);
    assert.ok(fs.lstatSync(path.join(linked.fsPath, 'out')).isSymbolicLink(), why);
  }
  await duringModal('영구 삭제', () => {}, () => {});
  assert.equal(fs.existsSync(linked.fsPath), false, 'control: confirmed with nothing changed, it is removed');
  assert.ok(fs.existsSync(os.tmpdir()), 'the link target is untouched');

  // Trash-folder path: a file added while its modal is open stops the gesture and nothing moves (V18).
  const grow = { scheme: 'file', fsPath: path.join(root, 'grow') };
  fs.mkdirSync(grow.fsPath); fs.writeFileSync(path.join(grow.fsPath, 'a.txt'), 'a'); fs.writeFileSync(path.join(grow.fsPath, 'b.txt'), 'b');
  const storeBeforeGrow = storeFiles().length;
  vscode.window.showWarningMessage = async (text, options, ...choices) => { if (options?.modal) fs.writeFileSync(path.join(grow.fsPath, 'c.txt'), 'new'); return choices.find(c => title(c) === '휴지통으로 이동'); };
  try { await remove(grow); } finally { vscode.window.showWarningMessage = originalWarning; }
  for (const name of ['a.txt', 'b.txt', 'c.txt']) assert.ok(fs.existsSync(path.join(grow.fsPath, name)), name);
  assert.equal(storeFiles().length, storeBeforeGrow);
  console.log('activity trash host: cancellation, default-off, stale activity, write gate, one Cancel, folder cap, gesture cap, permanent-delete recheck and separate purge confirmation PASS');
} finally { fs.rmSync(top, { recursive: true, force: true }); }
