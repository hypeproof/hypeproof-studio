// REQ-STUDIO-MEMORY-CAPACITY (CGP-KNOW-R-024 / REQ-KNOW-42) — memory capacity as used/limit, the host side:
//   1. the pure parts: the level at 0, 89%, 90%, 99% and 100% of the limit, and how many old items 오래된 기억 정리 picks;
//   2. the view carries the store's limit (`MEMORY_LIMITS.items`), and used counts every file, listed or not;
//   3. at the limit the store refuses a new file (`append()`), but a correction (today's only writer, R-025) replaces
//      its item and is allowed: the count stays; past the limit it is refused with its reason and leaves nothing behind;
//      the correction's pin still keeps a file replaced during the press; after a delete it writes again;
//   4. 오래된 기억 정리 (`deleteOld`) asks twice in native modals with its own words, removes exactly the picked listed
//      files, ignores names the list never showed, leaves unlisted files alone, and a 취소 at either step removes nothing;
//      a picked file replaced between the confirms is kept (the identity pinned before the first confirm).
// The real provider and host module on real files (VS Code stubbed).
//   node --experimental-strip-types test/memory-capacity.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ActivityMemory, MEMORY_LIMITS } from '../src/activityMemory.ts';
import { MEMORY_CAPACITY, memoryCapacity, memoryCleanupCount, memoryResultNotice } from '../src/activityMemoryView.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-capacity-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const files = root => fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : [];

try {
  await t('pure: level by used/limit (90% near, 100% full) and the cleanup pick back to 80%', async () => {
    const L = MEMORY_LIMITS.items;
    assert.equal(L, 200, 'the limit constant');
    assert.deepEqual([0, 179, 180, 199, 200, 230].map(n => memoryCapacity(n, L).level), ['ok', 'ok', 'near', 'near', 'full', 'full']);
    assert.equal(memoryCapacity(230, L).percent, 100, 'the bar never passes 100%');
    assert.equal(memoryCapacity(9, 10).level, 'near', 'a small limit: 9/10 is 90%');
    assert.deepEqual([memoryCleanupCount(200, L), memoryCleanupCount(180, L), memoryCleanupCount(161, L), memoryCleanupCount(120, L)], [40, 20, 1, 1]);
    assert.deepEqual(MEMORY_CAPACITY, { near: 0.9, after: 0.8 });
    assert.equal(memoryResultNotice({ action: 'deleteOld', removed: 3, kept: 0 }), '오래된 기억 3개를 지웠어요.');
    assert.equal(memoryResultNotice({ action: 'deleteOld', removed: 2, kept: 1 }), '오래된 기억 2개를 지웠어요. 1개는 지우지 못했어요. 목록에서 확인해 주세요.');
  });

  let answers = [];
  const dialogs = [];
  // Runs once, right after the next native modal answers (a file changed while the learner reads the second confirm).
  let afterDialog = null;
  const hostVscode = {
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    commands: { executeCommand: async () => undefined },
    window: { showWarningMessage: async (text, options, ...items) => {
      dialogs.push({ text, buttons: items.map(i => i.title) });
      if (afterDialog) { const run = afterDialog; afterDialog = null; run(); }
      return (answers.shift() ?? 'cancel') === 'confirm' ? items.find(i => !i.isCloseAffordance) : items.find(i => i.isCloseAffordance);
    } },
  };
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityMemoryHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? hostVscode : require(id), console, Buffer, process, TextDecoder });
  const work = path.join(top, 'activity'); fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  // An adult seat, so the R-025 correction (today's only writer) is open.
  h.cachedProfile = { profile_id: 'synthetic-adult', game: { template_tier: 'website' } };
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding, overview: () => h.activityMemoryOverviewTasks, tasks: () => h.activityMemoryTasks }));
  const last = () => f.posts.filter(m => m.type === 'activityMemoryState').at(-1);
  const list = async () => { await f.handle(f.scoped({ type: 'activityMemoryRequest' })); return last().view; };
  let seq = 0;
  const press = async (action, extra = {}) => {
    const requestId = `c${++seq}`;
    const scope = (await list())?.scope ?? 'none';
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope, action, name: '', ...extra }));
    assert.equal(last().requestId, requestId);
    return last().result;
  };
  const store = new ActivityMemory(work);
  const made = [];
  for (let i = 0; i < MEMORY_LIMITS.items - 1; i++) made.push(await store.append(`메모 ${i}번은 폴더 정리에 관한 것이에요.`, 1_000 + i));
  // One entry the list never shows (a folder): it counts toward the limit and nothing here removes it.
  fs.mkdirSync(path.join(memDir(work), 'kept-folder'));

  await t('view: the limit rides the view; used counts listed and unlisted files', async () => {
    const view = await list();
    assert.equal(view.limit, MEMORY_LIMITS.items);
    assert.equal(view.entries.length + view.other, MEMORY_LIMITS.items, 'used = entries + other');
    assert.equal(memoryCapacity(view.entries.length + view.other, view.limit).level, 'full');
  });

  await t('at exactly the limit: a new file is refused, but a correction replaces its item and the count stays', async () => {
    await assert.rejects(store.append('하나 더', 9_999), error => error.code === 'full');
    const target = (await list()).entries[0].name;
    const r = await press('correct', { name: target, text: '고친 메모예요: 폴더 이름은 학급 신문이에요.' });
    assert.deepEqual([r.action, r.name, r.error], ['correct', target, undefined], JSON.stringify(r));
    const left = files(work);
    assert.equal(left.length, MEMORY_LIMITS.items, 'the count stays at the limit');
    assert.ok(!left.includes(target), 'the old file is gone');
    assert.ok((await list()).entries.some(e => e.text?.trim() === '고친 메모예요: 폴더 이름은 학급 신문이에요.'), 'the new words are listed');
    await assert.rejects(store.append('하나 더', 9_999), error => error.code === 'full', 'a plain append is still refused');
  });

  await t('above the limit (unlisted entries past it): a correction is refused with its reason and leaves nothing behind', async () => {
    fs.mkdirSync(path.join(memDir(work), 'kept-folder-2'));
    try {
      const before = files(work);
      assert.equal(before.length, MEMORY_LIMITS.items + 1);
      const target = (await list()).entries[0].name;
      const r = await press('correct', { name: target, text: '또 고친 메모예요.' });
      assert.match(r.error, /기억 파일이 너무 많아서 고치지 못했어요/);
      assert.deepEqual(files(work), before, 'no new copy, nothing removed');
    } finally { fs.rmdirSync(path.join(memDir(work), 'kept-folder-2')); }
  });

  await t('at the limit: a file replaced during the correction is kept and the new copy is dropped', async () => {
    const view = await list();
    const target = view.entries[1].name;
    const before = new Set(files(work));
    // Swap the file (same name, new identity) inside the press, after the host pinned it.
    const fsReaddir = fs.promises.readdir;
    let swapped = false, inPress = false;
    fs.promises.readdir = async (...args) => {
      const out = await fsReaddir.apply(fs.promises, args);
      if (!swapped && inPress && String(args[0]).endsWith(path.join('.hypeproof', 'memory')) && out.includes(target)) {
        swapped = true;
        const file = path.join(memDir(work), target);
        fs.writeFileSync(file + '.swap', '바뀐 메모예요.\n'); fs.renameSync(file + '.swap', file);
      }
      return out;
    };
    try {
      const requestId = `c${++seq}`;
      inPress = true;
      await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope: view.scope, action: 'correct', name: target, text: '다시 고친 메모예요.' }));
      inPress = false;
      assert.ok(swapped, 'the swap happened inside the press');
      assert.match(last().result.error, /바뀌었어요/);
      assert.deepEqual(new Set(files(work)), before, 'the replaced file stays and the new copy is gone');
      assert.equal(fs.readFileSync(path.join(memDir(work), target), 'utf8'), '바뀐 메모예요.\n');
    } finally { fs.promises.readdir = fsReaddir; }
  });

  await t('at the limit: the replace allowance cannot grow the store (forged, unlisted, missing or reused target)', async () => {
    const before = files(work);
    assert.equal(before.length, MEMORY_LIMITS.items);
    const listed = (await list()).entries[0].name;
    // Names that are not a listed memory file: no allowance, so the full store refuses the write.
    for (const target of ['not-there.md', 'kept-folder', '../outside.md', '', listed.toUpperCase()]) {
      await assert.rejects(store.append('위조 대상', 70_000, null, target), error => error.code === 'full', `replacing "${target}"`);
    }
    assert.deepEqual(files(work), before, 'nothing written');
    // The same listed file named twice without removing it: the first write takes the allowance, the second is refused.
    const extra = await store.append('한 번 바꿀 메모', 71_000, null, listed);
    await assert.rejects(store.append('두 번 바꿀 메모', 72_000, null, listed), error => error.code === 'full', 'second replace of the same file');
    assert.equal(files(work).length, MEMORY_LIMITS.items + 1, 'at most one past the limit, only inside one replacement');
    fs.rmSync(path.join(memDir(work), extra));
    assert.deepEqual(files(work), before);
  });

  await t('deleteOld: 취소 at either native step removes nothing', async () => {
    const names = made.slice(0, 3);
    answers = ['cancel']; dialogs.length = 0;
    assert.deepEqual(await press('deleteOld', { names }), { action: 'deleteOld', cancelled: true });
    answers = ['confirm', 'cancel'];
    assert.deepEqual(await press('deleteOld', { names }), { action: 'deleteOld', cancelled: true });
    assert.equal(files(work).length, MEMORY_LIMITS.items);
    assert.match(dialogs[0].text, /고른 오래된 기억 3개를 지울까요/);
    assert.deepEqual(dialogs[0].buttons, ['오래된 기억 지우기', '취소']);
  });

  await t('deleteOld: removes exactly the picked listed files; never-shown names and unlisted files stay', async () => {
    const picked = made.slice(0, 40);
    answers = ['confirm', 'confirm']; dialogs.length = 0;
    const r = await press('deleteOld', { names: [...picked, 'kept-folder', '../outside.md', 'not-there.md'] });
    assert.deepEqual(r, { action: 'deleteOld', removed: 40, kept: 0 });
    assert.deepEqual(dialogs.map(d => d.text), ['고른 오래된 기억 40개를 지울까요?', '정말 기억 파일 40개를 지울까요?']);
    const left = files(work);
    for (const name of picked) assert.ok(!left.includes(name), `${name} removed`);
    assert.ok(left.includes('kept-folder'), 'the unlisted entry is untouched');
    assert.equal(left.length, MEMORY_LIMITS.items - 40);
    const view = await list();
    assert.equal(memoryCapacity(view.entries.length + view.other, view.limit).level, 'ok', 'back to 80%');
  });

  await t('deleteOld: a picked file replaced between the confirms is kept (pinned identity), the rest go', async () => {
    const [swapped, ...gone] = made.slice(40, 43);
    const file = path.join(memDir(work), swapped);
    answers = ['confirm', 'confirm']; dialogs.length = 0;
    // Same name, new file: what the learner confirmed is not what is there now.
    afterDialog = () => { fs.writeFileSync(file + '.new', '바뀐 메모예요.\n'); fs.renameSync(file + '.new', file); };
    const r = await press('deleteOld', { names: [swapped, ...gone] });
    assert.deepEqual(r, { action: 'deleteOld', removed: 2, kept: 1 });
    const left = files(work);
    assert.ok(left.includes(swapped), 'the replaced file stays');
    for (const name of gone) assert.ok(!left.includes(name), `${name} removed`);
    assert.equal(fs.readFileSync(file, 'utf8'), '바뀐 메모예요.\n');
  });

  await t('after cleanup the store writes again', async () => {
    const name = await store.append('새 메모예요.', 50_000);
    assert.ok(files(work).includes(name));
  });

  await t('provider: deleteOld without a names list is refused before the host acts', async () => {
    answers = ['confirm', 'confirm']; dialogs.length = 0;
    const requestId = `c${++seq}`;
    const scope = (await list()).scope;
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope, action: 'deleteOld', name: '' }));
    assert.match(last().result.error, /작업 상태가 바뀌었어요/);
    assert.deepEqual(dialogs, [], 'no modal');
  });

  console.log(`memory capacity: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
