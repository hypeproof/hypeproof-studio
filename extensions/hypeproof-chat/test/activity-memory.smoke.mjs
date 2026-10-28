// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030 / REQ-KNOW-48) — memory as readable files inside the
// activity: the real store on real temporary files, then the real provider's message routing into
// the real host module (VS Code stubbed). Each item is one file; Studio only adds new files and
// deletes on an explicit learner press; a deleted file is absent from the next context read; a
// link or a file outside `.hypeproof/memory/` is never read.
//   node --experimental-strip-types test/activity-memory.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ActivityMemory, MEMORY_LIMITS, memoryFileName } from '../src/activityMemory.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'activity-memory-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const fresh = name => { const dir = path.join(top, name); fs.mkdirSync(dir); return dir; };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const put = (root, name, text) => { fs.mkdirSync(memDir(root), { recursive: true }); fs.writeFileSync(path.join(memDir(root), name), text); };

try {
  await t('no folder: an empty list, nothing created by reading', async () => {
    const root = fresh('empty');
    const store = new ActivityMemory(root);
    assert.deepEqual(await store.list(), { entries: [], other: 0, unsafe: false });
    assert.deepEqual(await store.contextItems(), []);
    assert.equal(fs.existsSync(path.join(root, '.hypeproof')), false);
  });

  await t('append: each item is a new readable file in .hypeproof/memory/, never an overwrite', async () => {
    const root = fresh('append');
    const store = new ActivityMemory(root);
    const a = await store.append('좋아하는 색은 초록이에요.', 1_000);
    const b = await store.append('발표는 금요일이에요.', 1_000);
    assert.notEqual(a, b);
    assert.ok(memoryFileName(a) && memoryFileName(b));
    assert.equal(fs.readFileSync(path.join(memDir(root), a), 'utf8'), '좋아하는 색은 초록이에요.\n');
    assert.equal(fs.readFileSync(path.join(memDir(root), b), 'utf8'), '발표는 금요일이에요.\n');
    assert.deepEqual((await store.contextItems()).map(i => i.text.trim()).sort(), ['발표는 금요일이에요.', '좋아하는 색은 초록이에요.'].sort());
    // The store has no edit path: its only writes are append (exclusive create) and remove.
    const methods = Object.getOwnPropertyNames(ActivityMemory.prototype).filter(n => n !== 'constructor');
    assert.deepEqual(methods.sort(), ['append', 'contextItems', 'folder', 'identify', 'list', 'pathOf', 'readFile', 'remove'].sort());
    // An existing name is never overwritten: force a collision and the write fails, bytes intact.
    const crypto = require('node:crypto');
    const real = crypto.randomBytes;
    crypto.randomBytes = () => Buffer.from(a.slice(-11, -3), 'hex'); syncBuiltinESMExports();
    try { await assert.rejects(store.append('덮어쓰기', 1_000), /EEXIST/); } finally { crypto.randomBytes = real; syncBuiltinESMExports(); }
    assert.equal(fs.readFileSync(path.join(memDir(root), a), 'utf8'), '좋아하는 색은 초록이에요.\n');
    await assert.rejects(store.append('   \u202E\u200B  '), /empty/);
    await assert.rejects(store.append('가'.repeat(MEMORY_LIMITS.chars + 1)), /invalid/);
  });

  await t('delete: the file is gone and absent from the very next context read', async () => {
    const root = fresh('delete');
    const store = new ActivityMemory(root);
    const keep = await store.append('남길 기억');
    const drop = await store.append('지울 기억');
    assert.equal((await store.contextItems()).length, 2);
    await store.remove(drop);
    assert.equal(fs.existsSync(path.join(memDir(root), drop)), false);
    const after = await store.contextItems();
    assert.deepEqual(after.map(i => i.name), [keep]);
    assert.ok(!after.some(i => i.text.includes('지울 기억')));
    await assert.rejects(store.remove(drop), /missing/);
  });

  await t('never outside the activity: a linked .hypeproof or memory folder is refused and not read', async () => {
    const outside = fresh('outside');
    put(outside, 'secret.md', '바깥 기억');
    for (const which of ['.hypeproof', 'memory']) {
      const root = fresh(`link-${which.replace('.', '')}`);
      if (which === '.hypeproof') fs.symlinkSync(path.join(outside, '.hypeproof'), path.join(root, '.hypeproof'));
      else { fs.mkdirSync(path.join(root, '.hypeproof')); fs.symlinkSync(memDir(outside), memDir(root)); }
      const store = new ActivityMemory(root);
      assert.deepEqual(await store.list(), { entries: [], other: 0, unsafe: true });
      assert.deepEqual(await store.contextItems(), []);
      await assert.rejects(store.append('새 기억'), /unsafe/);
      await assert.rejects(store.remove('secret.md'), /unsafe/);
      assert.equal(fs.readFileSync(path.join(memDir(outside), 'secret.md'), 'utf8'), '바깥 기억', 'the outside file is untouched');
    }
    // A file in the store that links (or hard-links) outside is skipped, counted, and never deleted.
    const root = fresh('file-links');
    put(root, 'ok.md', '안쪽 기억');
    // A separate target for the link: one link count, so only the no-follow open keeps it out.
    put(outside, 'linked.md', '링크된 바깥 기억');
    fs.symlinkSync(path.join(memDir(outside), 'linked.md'), path.join(memDir(root), 'link.md'));
    fs.linkSync(path.join(memDir(outside), 'secret.md'), path.join(memDir(root), 'hard.md'));
    const store = new ActivityMemory(root);
    const listing = await store.list();
    assert.deepEqual(listing.entries.map(e => e.name), ['ok.md']);
    assert.equal(listing.other, 2);
    assert.deepEqual((await store.contextItems()).map(i => i.text), ['안쪽 기억']);
    await assert.rejects(store.remove('link.md'), /not_file/);
    await assert.rejects(store.remove('hard.md'), /not_file/);
    for (const name of ['../ok.md', '../../outside/.hypeproof/memory/secret.md', '.hidden.md', 'a/b.md', 'x.html', '', 'e\u0301.md']) {
      await assert.rejects(store.remove(name), /invalid/, name);
    }
    assert.equal(fs.readFileSync(path.join(memDir(outside), 'secret.md'), 'utf8'), '바깥 기억');
  });

  await t('hostile contents and names: control/bidi stripped, large or non-text files listed but never read into context', async () => {
    const root = fresh('hostile');
    put(root, 'bidi.md', 'A\u202Eevil\u2028B\u0007C\r\nD');
    put(root, 'big.md', 'x'.repeat(MEMORY_LIMITS.bytes + 1));
    put(root, 'bin.txt', Buffer.from([0xff, 0xfe, 0x00]));
    put(root, '\u202Egpj.md', '이름이 숨은 파일');
    put(root, 'notes.json', '{}');
    fs.mkdirSync(path.join(memDir(root), 'folder.md'));
    const listing = await new ActivityMemory(root).list();
    const byName = Object.fromEntries(listing.entries.map(e => [e.name, e]));
    assert.deepEqual(Object.keys(byName).sort(), ['bidi.md', 'big.md', 'bin.txt']);
    assert.equal(byName['bidi.md'].text, 'AevilBC\nD');
    assert.equal(byName['big.md'].text, null);
    assert.equal(byName['bin.txt'].text, null);
    assert.equal(listing.other, 3);
    assert.deepEqual((await new ActivityMemory(root).contextItems()).map(i => i.name), ['bidi.md']);
  });

  await t('a FIFO in the store never blocks: list() settles, skips it, and it is never read or deleted', async () => {
    if (process.platform === 'win32') { console.log('  skip FIFO on win32'); return; }
    const root = fresh('fifo');
    put(root, 'ok.md', '안쪽 기억');
    const pipe = path.join(memDir(root), 'pipe.md');
    execFileSync('mkfifo', [pipe]);
    const store = new ActivityMemory(root);
    // Four at once: a blocking open() would take every libuv thread and stall unrelated fs calls.
    const settled = Promise.all([store.list(), store.list(), store.list(), store.list(), fs.promises.stat(root)]);
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 1500); });
    const outcome = await Promise.race([settled, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      // Release the blocked readers (a writer end opens them) so the runner can exit, then fail.
      for (let i = 0; i < 4; i++) { try { fs.closeSync(fs.openSync(pipe, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch {} }
      await settled.catch(() => undefined);
      assert.fail('list() blocked on a FIFO');
    }
    const [listing] = outcome;
    assert.deepEqual(listing.entries.map(e => e.name), ['ok.md']);
    assert.equal(listing.other, 1);
    assert.deepEqual((await store.contextItems()).map(i => i.name), ['ok.md']);
    await assert.rejects(store.pathOf('pipe.md'), /not_file/);
    await assert.rejects(store.remove('pipe.md'), /not_file/);
    assert.ok(fs.lstatSync(pipe).isFIFO(), 'the FIFO is left alone');
  });

  await t('remove with a pinned identity refuses a file replaced under the same name', async () => {
    const root = fresh('pinned');
    put(root, 'a.md', '처음 기억');
    const store = new ActivityMemory(root);
    const pinned = await store.identify('a.md');
    fs.rmSync(path.join(memDir(root), 'a.md'));
    put(root, 'b-holder.md', '자리 차지');   // keep the old inode number from being reused at once
    put(root, 'a.md', '바뀐 기억');
    await assert.rejects(store.remove('a.md', pinned), /changed/);
    assert.equal(fs.readFileSync(path.join(memDir(root), 'a.md'), 'utf8'), '바뀐 기억');
    await store.remove('a.md', await store.identify('a.md'));
    assert.equal(fs.existsSync(path.join(memDir(root), 'a.md')), false);
  });

  // The provider and host module: the panel's requests, end to end.
  const work = fresh('activity');
  let answer = 'confirm';
  const dialogs = [], commands = [];
  const hostVscode = {
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    commands: { executeCommand: async (...args) => { commands.push(args); } },
    window: { showWarningMessage: async (text, options, ...items) => { dialogs.push({ text, options, items }); if (answer === 'dismiss') return undefined; return answer === 'confirm' ? items.find(i => !i.isCloseAffordance) : items.find(i => i.isCloseAffordance); } },
  };
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityMemoryHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? hostVscode : require(id), console, Buffer, process, TextDecoder });
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h.cachedProfile = { profile_id: 'synthetic-personal' };
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding }));
  const last = () => f.posts.filter(m => m.type === 'activityMemoryState').at(-1);
  const list = async () => { await f.handle(f.scoped({ type: 'activityMemoryRequest' })); return last().view; };
  let seq = 0;
  const press = async (action, name, extra = {}) => {
    const requestId = `m${++seq}`;
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope: extra.scope ?? (await list())?.scope ?? 'none', action, name }));
    assert.equal(last().requestId, requestId);
    return last().result;
  };

  await t('panel: always on (no setting), shows the folder and every file with its text', async () => {
    put(work, 'color.md', '좋아하는 색은 초록이에요.');
    const view = await list();
    assert.equal(view.folder, '.hypeproof/memory/');
    assert.equal(view.scope, h.activityTrashBinding.scope);
    assert.deepEqual(view.entries.map(e => [e.name, e.text]), [['color.md', '좋아하는 색은 초록이에요.']]);
  });

  await t('panel: no view for an instructor, mid-switch, or without a task workspace', async () => {
    h._instructorMode = { isInstructor: true }; assert.equal(await list(), null);
    h._instructorMode = { isInstructor: false };
    h.taskChanging = true; assert.equal(await list(), null); h.taskChanging = false;
    const tw = h.taskWorkspace; h.taskWorkspace = undefined; assert.equal(await list(), null); h.taskWorkspace = tw;
    assert.ok(await list());
  });

  await t('open: the exact store file in a read-only editor; nothing outside the store opens', async () => {
    commands.length = 0;
    const r = await press('open', 'color.md');
    assert.equal(r.error, undefined);
    assert.equal(commands[0][0], 'vscode.open');
    assert.equal(commands[0][1].fsPath, path.join(memDir(work), 'color.md'));
    assert.equal(commands[1][0], 'workbench.action.files.setActiveEditorReadonlyInSession');
    commands.length = 0;
    for (const name of ['../../tasks', '../color.md', 'missing.md']) assert.ok((await press('open', name)).error, name);
    assert.equal(commands.length, 0);
  });

  await t('delete: native confirm with one Cancel; Cancel keeps the file; confirm removes it from list and context', async () => {
    answer = 'cancel';
    const cancelled = await press('delete', 'color.md');
    assert.equal(cancelled.cancelled, true);
    const d = dialogs.at(-1);
    assert.equal(d.options.modal, true); assert.equal(d.options.detail, 'color.md');
    assert.deepEqual(d.items.map(i => i.title), ['지우기', '취소']);
    assert.equal(d.items.filter(i => i.isCloseAffordance).length, 1);
    assert.ok(fs.existsSync(path.join(memDir(work), 'color.md')));
    // A dialog closed without a choice (Escape, window close) answers undefined: that is a cancel too.
    answer = 'dismiss';
    const dismissed = await press('delete', 'color.md');
    assert.equal(dismissed.cancelled, true);
    assert.ok(fs.existsSync(path.join(memDir(work), 'color.md')), 'a dismissed dialog deletes nothing');
    answer = 'confirm';
    const done = await press('delete', 'color.md');
    assert.deepEqual(done, { action: 'delete', name: 'color.md' });
    assert.equal(fs.existsSync(path.join(memDir(work), 'color.md')), false);
    assert.deepEqual(last().view.entries, []);
    assert.deepEqual(await new ActivityMemory(work).contextItems(), []);
  });

  await t('delete: a stale scope, an unknown action or a bad name is refused before any confirm', async () => {
    put(work, 'keep.md', '남길 기억');
    const before = dialogs.length;
    assert.match((await press('delete', 'keep.md', { scope: '["other",null]' })).error, /작업 상태가 바뀌었어요/);
    assert.ok((await press('rename', 'keep.md')).error);
    assert.ok((await press('delete', '../keep.md')).error);
    assert.equal(dialogs.length, before);
    assert.ok(fs.existsSync(path.join(memDir(work), 'keep.md')));
  });

  await t('delete: a file replaced during the confirm is refused, the new one kept', async () => {
    put(work, 'swap.md', '확인한 기억');
    const scope = (await list()).scope;
    const original = hostVscode.window.showWarningMessage;
    hostVscode.window.showWarningMessage = async (...args) => {
      fs.rmSync(path.join(memDir(work), 'swap.md')); put(work, 'swap-holder.md', '자리'); put(work, 'swap.md', '새 기억');
      return original(...args);
    };
    try { assert.match((await press('delete', 'swap.md', { scope })).error, /바뀌었어요/); }
    finally { hostVscode.window.showWarningMessage = original; }
    assert.equal(fs.readFileSync(path.join(memDir(work), 'swap.md'), 'utf8'), '새 기억');
  });

  await t('delete: a task switch during the confirm cancels the delete', async () => {
    const scope = (await list()).scope;
    const original = hostVscode.window.showWarningMessage;
    hostVscode.window.showWarningMessage = async (...args) => { h.taskChanging = true; return original(...args); };
    try {
      const r = await press('delete', 'keep.md', { scope });
      assert.match(r.error, /작업 상태가 바뀌었어요/);
    } finally { hostVscode.window.showWarningMessage = original; h.taskChanging = false; }
    assert.ok(fs.existsSync(path.join(memDir(work), 'keep.md')));
  });

  console.log(`activity memory files: ${passed} checks PASS`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
