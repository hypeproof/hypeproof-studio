// REQ-STUDIO-MEMORY-MANAGER (CGP-KNOW-R-023 / REQ-KNOW-41) — the learner views and deletes each remembered item: the
// real store on real files, then the real provider's routing into the real host module (VS Code stubbed). Each listed
// file names the task it was kept from (a listed task, one in 보관함, one that is gone, or none recorded); 지우기 has one
// Cancel; 모두 지우기 needs a second native confirm and removes exactly the files the learner's list showed; a deleted
// item is absent from the very next `contextItems()` read, the only reader a request may use.
//   node --experimental-strip-types test/memory-manager.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ActivityMemory } from '../src/activityMemory.ts';
import { memoryResultNotice } from '../src/activityMemoryView.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-manager-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const put = (root, name, text) => { fs.mkdirSync(memDir(root), { recursive: true }); fs.writeFileSync(path.join(memDir(root), name), text); };
const files = root => fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : [];

try {
  let answers = [];
  const dialogs = [];
  const hostVscode = {
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    commands: { executeCommand: async () => undefined },
    window: { showWarningMessage: async (text, options, ...items) => {
      dialogs.push({ text, options, items });
      const answer = answers.shift() ?? 'cancel';
      if (answer === 'dismiss') return undefined;
      return answer === 'confirm' ? items.find(i => !i.isCloseAffordance) : items.find(i => i.isCloseAffordance);
    } },
  };
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityMemoryHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? hostVscode : require(id), console, Buffer, process, TextDecoder });
  // The host module runs in its own realm: compare plain copies.
  const memorySource = (...args) => JSON.parse(JSON.stringify(mod.exports.memorySource(...args)));

  await t('source: a listed task links, an archived one names 보관함, an unknown id is gone, no id says so; titles are text, capped', async () => {
    const tasks = [{ id: 'a', title: '내 웹페이지', archived: false }, { id: 'b', title: '지난 숙제', archived: true }, { id: 'c', title: `‮위험​ ${'가'.repeat(100)}`, archived: false }, { id: 'd', title: '   ', archived: false }];
    assert.deepEqual(memorySource('a', tasks), { kind: 'task', id: 'a', title: '내 웹페이지' });
    assert.deepEqual(memorySource('b', tasks), { kind: 'archived', title: '지난 숙제' });
    assert.deepEqual(memorySource('zzz', tasks), { kind: 'gone' });
    assert.deepEqual(memorySource(null, tasks), { kind: 'none' });
    assert.deepEqual(memorySource('a', null), { kind: 'gone' }, 'no task list: never a link');
    const capped = memorySource('c', tasks);
    assert.ok(!/[‮​]/.test(capped.title), 'bidi and zero-width removed');
    assert.equal([...capped.title].length, 81); assert.ok(capped.title.endsWith('…'));
    assert.equal(memorySource('d', tasks).title, '이름 없는 작업');
  });

  const work = path.join(top, 'activity'); fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h.cachedProfile = { profile_id: 'synthetic-minor', minor_cohort: true, game: { template_tier: 'kids-quest' } };
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding, overview: () => h.activityMemoryOverviewTasks, tasks: () => h.activityMemoryTasks }));
  const last = () => f.posts.filter(m => m.type === 'activityMemoryState').at(-1);
  const list = async () => { await f.handle(f.scoped({ type: 'activityMemoryRequest' })); return last().view; };
  let seq = 0;
  const press = async (action, name, extra = {}) => {
    const requestId = `r${++seq}`;
    const scope = extra.scope ?? (await list())?.scope ?? 'none';
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope, action, name, ...('names' in extra ? { names: extra.names } : {}) }));
    assert.equal(last().requestId, requestId);
    return last().result;
  };
  const expected = () => ({ taskId: f.store.getView().activeTaskId, revision: f.store.getView().revision });
  const first = f.store.getView().activeTaskId;
  await f.store.rename(first, '내 웹페이지');
  await f.store.create('지난 숙제', expected());
  const second = f.store.getView().activeTaskId;
  await f.store.archiveTask(second, expected());
  await f.store.select(first, expected());
  const store = new ActivityMemory(work);
  const fromFirst = await store.append('발표는 금요일이에요.', 4_000, first);
  const fromArchived = await store.append('색은 초록', 3_000, second);
  const fromGone = await store.append('제목은 별빛', 2_000, 'task-that-was-deleted');
  const fromNone = await store.append('글꼴은 크게', 1_000);

  await t('list: every item shows its text, its time and the task it came from, on a minor seat too (DEC-02)', async () => {
    const view = await list();
    assert.ok(view, 'a minor seat has the memory view');
    const byName = Object.fromEntries(view.entries.map(e => [e.name, e]));
    assert.deepEqual(byName[fromFirst].source, { kind: 'task', id: first, title: '내 웹페이지' });
    assert.deepEqual(byName[fromArchived].source, { kind: 'archived', title: '지난 숙제' });
    assert.deepEqual(byName[fromGone].source, { kind: 'gone' });
    assert.deepEqual(byName[fromNone].source, { kind: 'none' });
    assert.equal(byName[fromFirst].text, '발표는 금요일이에요.\n', 'the item text, without the task line');
    assert.equal(typeof byName[fromFirst].at, 'number');
    assert.ok(!JSON.stringify(view.entries).includes('hypeproof-task'), 'the task line is never shown as text');
  });

  await t('list: no task list (no task workspace) names no task and links none', async () => {
    const api = mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding });
    const view = JSON.parse(JSON.stringify(await api.view()));
    assert.ok(view.entries.every(e => e.source.kind === 'gone' || e.source.kind === 'none'));
  });

  await t('delete one: Cancel and a closed dialog keep it; confirm removes it from the list and the next context read', async () => {
    answers = ['cancel'];
    assert.equal((await press('delete', fromGone)).cancelled, true);
    answers = ['dismiss'];
    assert.equal((await press('delete', fromGone)).cancelled, true);
    assert.ok(files(work).includes(fromGone));
    answers = ['confirm'];
    assert.deepEqual(await press('delete', fromGone), { action: 'delete', name: fromGone });
    assert.ok(!last().view.entries.some(e => e.name === fromGone));
    assert.ok(!(await store.contextItems()).some(i => i.name === fromGone || i.text.includes('별빛')), 'absent from the next context read');
  });

  await t('delete all: refused before any dialog for a stale scope, a non-list, too many names or nothing listed', async () => {
    const before = dialogs.length, kept = files(work);
    const names = (await list()).entries.map(e => e.name);
    assert.match((await press('deleteAll', '', { names, scope: '["other",null]' })).error, /작업 상태가 바뀌었어요/);
    // The provider refuses a malformed press before the host sees it.
    assert.match((await press('deleteAll', '', { names: 'all' })).error, /작업 상태가 바뀌었어요/);
    assert.match((await press('deleteAll', '', {})).error, /작업 상태가 바뀌었어요/, 'no names at all');
    assert.match((await press('deleteAll', '', { names: [names[0], 7] })).error, /작업 상태가 바뀌었어요/);
    assert.match((await press('deleteAll', '', { names: Array.from({ length: 201 }, (_, i) => `${i}.md`) })).error, /작업 상태가 바뀌었어요/);
    assert.match((await press('deleteAll', '', { names: ['../x.md', 'missing.md'] })).error, /지울 기억 파일이 없어요/);
    assert.equal(dialogs.length, before, 'no confirm shown');
    assert.deepEqual(files(work), kept);
  });

  await t('delete all: two native confirms with one Cancel each; Cancel or Escape at either step deletes nothing', async () => {
    const names = (await list()).entries.map(e => e.name);
    const kept = files(work);
    for (const script of [['cancel'], ['dismiss'], ['confirm', 'cancel'], ['confirm', 'dismiss']]) {
      answers = [...script];
      const at = dialogs.length;
      const r = await press('deleteAll', '', { names });
      assert.deepEqual(r, { action: 'deleteAll', cancelled: true }, script.join('>'));
      assert.equal(dialogs.length - at, script.length, `${script.join('>')}: the second confirm only after the first`);
      assert.deepEqual(files(work), kept, script.join('>'));
    }
    const [one, two] = dialogs.slice(-2);
    for (const d of [one, two]) {
      assert.equal(d.options.modal, true);
      assert.equal(d.items.length, 2); assert.equal(d.items.filter(i => i.isCloseAffordance).length, 1);
      assert.equal(d.items.find(i => i.isCloseAffordance).title, '취소');
    }
    assert.equal(one.text, `기억 파일 ${names.length}개를 모두 지울까요?`);
    assert.match(one.options.detail, /되돌릴 수 없어요/);
    assert.equal(two.text, `정말 기억 파일 ${names.length}개를 지울까요?`);
    assert.equal(two.items[0].title, `${names.length}개 지우기`);
  });

  await t('delete all: a task switch between the confirms deletes nothing', async () => {
    const names = (await list()).entries.map(e => e.name);
    const kept = files(work);
    const original = hostVscode.window.showWarningMessage;
    let calls = 0;
    hostVscode.window.showWarningMessage = async (...args) => { if (++calls === 1) h.taskChanging = true; return original(...args); };
    answers = ['confirm', 'confirm'];
    const at = dialogs.length;
    try { assert.match((await press('deleteAll', '', { names, scope: (await list()).scope })).error, /작업 상태가 바뀌었어요/); }
    finally { hostVscode.window.showWarningMessage = original; h.taskChanging = false; answers = []; }
    assert.equal(dialogs.length - at, 1, 'a switch during the first confirm ends the press before the second');
    assert.deepEqual(files(work), kept);
    // A switch during the second confirm also deletes nothing.
    calls = 0;
    hostVscode.window.showWarningMessage = async (...args) => { if (++calls === 2) h.taskChanging = true; return original(...args); };
    answers = ['confirm', 'confirm'];
    try { assert.match((await press('deleteAll', '', { names, scope: (await list()).scope })).error, /작업 상태가 바뀌었어요/); }
    finally { hostVscode.window.showWarningMessage = original; h.taskChanging = false; answers = []; }
    assert.deepEqual(files(work), kept);
  });

  await t('delete all: only the files the list showed go; a file added or replaced meanwhile and unlisted files stay', async () => {
    put(work, '.hidden.md', '목록에 없는 파일');
    const view = await list();
    const names = view.entries.map(e => e.name);
    assert.equal(view.other, 1);
    const swapped = names.find(n => n === fromNone);
    const original = hostVscode.window.showWarningMessage;
    let calls = 0;
    hostVscode.window.showWarningMessage = async (...args) => {
      if (++calls === 1) {
        assert.match(args[1].detail, /목록에 없는 파일 1개는 지우지 않아요/);
        put(work, 'later.md', '목록을 연 뒤에 생긴 기억');
        fs.rmSync(path.join(memDir(work), swapped)); put(work, 'swap-holder.md', '자리'); put(work, swapped, '바뀐 기억');
      }
      return original(...args);
    };
    answers = ['confirm', 'confirm'];
    let r;
    try { r = await press('deleteAll', '', { names, scope: view.scope }); } finally { hostVscode.window.showWarningMessage = original; }
    assert.deepEqual(r, { action: 'deleteAll', removed: names.length - 1, kept: 3 }, "the replaced file, the one added meanwhile and its placeholder stay");
    assert.equal(memoryResultNotice(r), `기억 파일 ${names.length - 1}개를 지웠어요. 3개는 남아 있어요. 목록에서 확인해 주세요.`);
    assert.deepEqual(files(work), ['.hidden.md', swapped, 'later.md', 'swap-holder.md'].sort());
    assert.equal(fs.readFileSync(path.join(memDir(work), swapped), 'utf8'), '바뀐 기억', 'the replaced file is kept');
    const context = (await store.contextItems()).map(i => i.text.trim());
    for (const gone of ['발표는 금요일이에요.', '색은 초록']) assert.ok(!context.includes(gone), `${gone} absent from the next context read`);
  });

  await t('delete all: confirmed twice, every listed file is gone and the next context read is empty', async () => {
    fs.rmSync(path.join(memDir(work), '.hidden.md'));
    // A listed file the learner's list did not name stays.
    const shown = (await list()).entries.map(e => e.name);
    answers = ['confirm', 'confirm'];
    assert.deepEqual(await press('deleteAll', '', { names: shown.slice(1) }), { action: 'deleteAll', removed: shown.length - 1, kept: 1 });
    assert.deepEqual(files(work), [shown[0]], 'only the named files go');
    put(work, 'again.md', '다시 남긴 기억');
    const names = (await list()).entries.map(e => e.name);
    answers = ['confirm', 'confirm'];
    const r = await press('deleteAll', '', { names });
    assert.deepEqual(r, { action: 'deleteAll', removed: names.length, kept: 0 });
    assert.equal(memoryResultNotice(r), `기억 파일 ${names.length}개를 지웠어요.`);
    assert.deepEqual(files(work), []);
    assert.deepEqual(last().view.entries, []);
    assert.deepEqual(await store.contextItems(), []);
  });

  await t('delete all: a named link, FIFO or hard link is never removed and never opened; the first confirm counts them', async () => {
    const outside = path.join(top, 'outside.md'); fs.writeFileSync(outside, '활동 밖 파일');
    put(work, 'real.md', '지울 기억');
    fs.symlinkSync(outside, path.join(memDir(work), 'link.md'));
    execFileSync('mkfifo', [path.join(memDir(work), 'pipe.md')]);
    fs.linkSync(outside, path.join(memDir(work), 'hard.md'));
    const view = await list();
    assert.deepEqual(view.entries.map(e => e.name), ['real.md']);
    assert.equal(view.other, 3);
    const original = hostVscode.window.showWarningMessage;
    let detail = '';
    hostVscode.window.showWarningMessage = async (...args) => { detail ||= args[1].detail; return original(...args); };
    answers = ['confirm', 'confirm'];
    let r;
    try { r = await press('deleteAll', '', { names: ['real.md', 'link.md', 'pipe.md', 'hard.md'], scope: view.scope }); }
    finally { hostVscode.window.showWarningMessage = original; }
    assert.match(detail, /목록에 없는 파일 3개는 지우지 않아요/);
    assert.deepEqual(r, { action: 'deleteAll', removed: 1, kept: 0 });
    assert.deepEqual(files(work), ['hard.md', 'link.md', 'pipe.md']);
    assert.equal(fs.readFileSync(outside, 'utf8'), '활동 밖 파일');
    for (const name of files(work)) fs.rmSync(path.join(memDir(work), name));
  });

  await t('delete all: during the second confirm a file turned link, rewritten in place, a relinked folder or a new activity root keeps everything it touches', async () => {
    const outside = path.join(top, 'outside2.md'); fs.writeFileSync(outside, '활동 밖 파일');
    const seed = () => { for (const [n, x] of [['a.md', '하나'], ['b.md', '둘둘'], ['c.md', '셋']]) put(work, n, x); };
    const during = async (mutate, names) => {
      const view = await list();
      const original = hostVscode.window.showWarningMessage;
      let calls = 0;
      hostVscode.window.showWarningMessage = async (...args) => { if (++calls === 2) mutate(); return original(...args); };
      answers = ['confirm', 'confirm'];
      try { return await press('deleteAll', '', { names: names ?? view.entries.map(e => e.name), scope: view.scope }); }
      finally { hostVscode.window.showWarningMessage = original; answers = []; }
    };
    seed();
    const r = await during(() => {
      fs.rmSync(path.join(memDir(work), 'a.md')); fs.symlinkSync(outside, path.join(memDir(work), 'a.md'));
      fs.writeFileSync(path.join(memDir(work), 'b.md'), '바뀐'); // same size, same inode, new content
    });
    assert.deepEqual(r, { action: 'deleteAll', removed: 1, kept: 1 }, 'only the untouched c.md goes');
    assert.ok(fs.lstatSync(path.join(memDir(work), 'a.md')).isSymbolicLink());
    assert.equal(fs.readFileSync(outside, 'utf8'), '활동 밖 파일');
    assert.equal(fs.readFileSync(path.join(memDir(work), 'b.md'), 'utf8'), '바뀐');
    for (const name of files(work)) fs.rmSync(path.join(memDir(work), name));
    // The memory folder itself swapped for a link to a folder with the same names.
    seed();
    const elsewhere = path.join(top, 'elsewhere'); fs.mkdirSync(elsewhere);
    for (const n of ['a.md', 'b.md', 'c.md']) fs.writeFileSync(path.join(elsewhere, n), '다른 곳');
    const moved = path.join(top, 'moved-memory');
    const r2 = await during(() => { fs.renameSync(memDir(work), moved); fs.symlinkSync(elsewhere, memDir(work)); });
    // Every pinned removal is refused (the store walk sees a link); nothing in the linked folder goes.
    assert.equal(r2.removed, 0, JSON.stringify(r2));
    assert.deepEqual(fs.readdirSync(elsewhere).sort(), ['a.md', 'b.md', 'c.md']);
    fs.rmSync(memDir(work)); fs.renameSync(moved, memDir(work));
    // The activity root changes while the second confirm is open.
    const other = path.join(top, 'other-activity'); fs.mkdirSync(other);
    for (const n of ['a.md', 'b.md', 'c.md']) put(other, n, '다른 활동');
    try { assert.match((await during(() => { h.resolveCoachCwd = () => other; })).error, /작업 상태가 바뀌었어요/); }
    finally { h.resolveCoachCwd = () => work; }
    assert.deepEqual(files(work), ['a.md', 'b.md', 'c.md']);
    assert.deepEqual(files(other), ['a.md', 'b.md', 'c.md']);
    for (const name of files(work)) fs.rmSync(path.join(memDir(work), name));
  });

  await t('the extension wires the host to the provider\'s task list (secondary: source)', async () => {
    // The checks above wire the host themselves; this pins the real activation's wiring line.
    const ext = fs.readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
    const call = ext.match(/provider\.setActivityMemoryPanel\(registerActivityMemory\(\{([^}]*)\}\)\)/);
    assert.ok(call, 'extension.ts registers the memory host');
    assert.match(call[1], /\btasks: \(\) => provider\.activityMemoryTasks\b/, 'source links read the activity\'s tasks');
    assert.match(call[1], /\bbinding: \(\) => provider\.activityMemoryBinding\b/);
  });

  await t('no view and no delete for an instructor', async () => {
    h._instructorMode = { isInstructor: true };
    assert.equal(await list(), null);
    assert.ok((await press('deleteAll', '', { names: ['a.md'], scope: 'x' })).error);
    h._instructorMode = { isInstructor: false };
  });

  console.log(`memory manager: ${passed} checks PASS`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
