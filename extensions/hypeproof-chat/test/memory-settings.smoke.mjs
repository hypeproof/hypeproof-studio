// CGP-KNOW-D-023 (DES-KNOW-41) — the "AI가 기억하는 것" list's host side, on the R-023 store and host (one store):
//   1. every listed item carries the identity it was listed with (`pin`);
//   2. a delete confirmed in the chat's own dialog (`confirmedPin`) asks no second native modal and removes exactly that file;
//   3. a pin that no longer matches (the file was replaced or rewritten after the listing) refuses and removes nothing;
//   4. a malformed pin is ignored, so the host's own native confirm still decides (the 내 작품 path is unchanged);
//   5. a seat without the store (class) has no view and nothing is removed.
// The real provider and host module on real files (VS Code stubbed).
//   node --experimental-strip-types test/memory-settings.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ActivityMemory } from '../src/activityMemory.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-settings-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const files = root => fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : [];

try {
  let answers = [];
  const dialogs = [];
  const hostVscode = {
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    commands: { executeCommand: async () => undefined },
    window: { showWarningMessage: async (text, options, ...items) => {
      dialogs.push(text);
      return (answers.shift() ?? 'cancel') === 'confirm' ? items.find(i => !i.isCloseAffordance) : items.find(i => i.isCloseAffordance);
    } },
  };
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityMemoryHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? hostVscode : require(id), console, Buffer, process, TextDecoder });
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
  const press = async (name, extra = {}) => {
    const requestId = `s${++seq}`;
    const scope = (await list())?.scope ?? 'none';
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope, action: 'delete', name, ...extra }));
    assert.equal(last().requestId, requestId);
    return last().result;
  };
  const store = new ActivityMemory(work);
  const a = await store.append('발표는 금요일이에요.', 1_000);
  const b = await store.append('색은 초록', 2_000);
  const c = await store.append('글꼴은 크게', 3_000);

  await t('view: every listed item carries the identity it was listed with', async () => {
    const view = await list();
    assert.equal(view.entries.length, 3);
    for (const entry of view.entries) assert.match(entry.pin, /^[0-9a-f]{32}$/, entry.name);
    assert.equal(new Set(view.entries.map(e => e.pin)).size, 3, 'distinct files, distinct pins');
  });

  await t('delete: confirmed in the chat\'s dialog, no second native modal; exactly that file goes', async () => {
    const pin = (await list()).entries.find(e => e.name === a).pin;
    dialogs.length = 0;
    const r = await press(a, { confirmedPin: pin });
    assert.deepEqual([r.action, r.name, r.error], ['delete', a, undefined]);
    assert.deepEqual(dialogs, [], 'no native modal');
    assert.deepEqual(files(work), [b, c].sort());
    assert.ok(!(await store.contextItems()).some(i => i.text.includes('금요일')), 'absent from the next context read');
  });

  await t('delete: a file replaced or rewritten after the listing is refused (its pin no longer matches)', async () => {
    const pin = (await list()).entries.find(e => e.name === b).pin;
    fs.writeFileSync(path.join(memDir(work), b), '색은 파랑');
    const r = await press(b, { confirmedPin: pin });
    assert.match(r.error, /바뀌었어요/);
    assert.equal(fs.readFileSync(path.join(memDir(work), b), 'utf8'), '색은 파랑', 'kept');
  });

  await t('delete: a malformed pin is ignored, so the host\'s own confirm decides (내 작품 path unchanged)', async () => {
    dialogs.length = 0; answers = ['cancel'];
    const r = await press(c, { confirmedPin: 'not-a-pin' });
    assert.equal(r.cancelled, true);
    assert.equal(dialogs.length, 1, 'the native confirm was shown');
    assert.ok(files(work).includes(c));
    dialogs.length = 0; answers = ['cancel'];
    assert.equal((await press(c)).cancelled, true, 'no pin: the native confirm, as before');
    assert.equal(dialogs.length, 1);
  });

  await t('seat: a class seat has no view and a confirmed delete removes nothing', async () => {
    const pin = (await list()).entries.find(e => e.name === c).pin;
    const saved = h.cachedProfile;
    h.cachedProfile = { profile_id: 'synthetic-class', activity_kind: 'classroom' };
    try {
      assert.equal(await list(), null, 'no view');
      const requestId = `s${++seq}`;
      await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope: 'x', action: 'delete', name: c, confirmedPin: pin }));
      assert.ok(last().result.error, 'refused');
    } finally { h.cachedProfile = saved; }
    assert.ok(files(work).includes(c), 'kept');
  });

  console.log(`memory settings: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
