// CGP-KNOW-R-028 / DES-KNOW-46 (REQ-KNOW-46): two per-task memory switches, "이 작업에서 기억 쓰기" and
// "이 작업을 기억에 남기기". The pure ledger, then the real provider on real files (the task harness), then the
// Agent SDK runtime's own file tools, bundled as they ship.
//   node --experimental-strip-types test/task-memory-switches.smoke.mjs
//
// Positive: defaults on; keep off refuses the remember tool, the memory write path and the coach's Write/Edit into
// .hypeproof/memory/ with the switch's sentence, and nothing reaches the disk; keep back on writes again; use off
// leaves the request without memory; the switches are per task and per activity.
// Negative controls: a write outside the memory folder is untouched by the switch; use cannot change once the task
// has a sent message (the host decides the lock); a change for another task id is ignored; malformed ledger values
// fall back to on.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTaskHarness } from './task-workspace-harness.mjs';
import { runRemember, REMEMBER_REPLIES } from '../src/memoryRememberTool.ts';
import { MEMORY_NOTICE_KEY, markMemoryNoticeSeen } from '../src/memoryNotice.ts';
import { TASK_MEMORY_COPY, TASK_MEMORY_KEY, acceptTaskMemory, setSwitches, switchesFor, useLocked, TASK_MEMORY_MAX } from '../src/taskMemorySwitches.ts';

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-memory-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const files = root => (fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : []);
const text = r => r.content.map(c => c.text).join('\n');
const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux, game: { template_tier: 'website' } };
const TASK = '0e6bd2f1-7c44-4a39-9d2b-0d7e1a8b5c11';

try {
  // ---- the pure ledger ----
  await t('ledger: defaults on, malformed entries fall back to on, defaults are pruned, bounds hold', () => {
    assert.deepEqual(switchesFor({}, 's', TASK), { use: true, keep: true });
    assert.deepEqual(switchesFor({}, 's', null), { use: true, keep: true });
    const bad = acceptTaskMemory({ s: { [TASK]: { use: 'no', keep: false }, 'bad id!': { use: false, keep: false } }, '': {}, x: 5 });
    assert.deepEqual(bad, {}, 'nothing malformed survives');
    const off = setSwitches({}, 's', TASK, { keep: false }, false);
    assert.equal(off.ok, true);
    assert.deepEqual(off.ledger, { s: { [TASK]: { use: true, keep: false } } });
    const back = setSwitches(off.ledger, 's', TASK, { keep: true }, false);
    assert.deepEqual(back.ledger, {}, 'back to the default leaves no entry');
    assert.deepEqual(setSwitches({}, 's', TASK, { use: false }, true), { ok: false, reason: 'locked' });
    assert.equal(setSwitches({}, 's', TASK, { keep: false }, true).ok, true, 'keep may change after the first send');
    assert.equal(setSwitches({}, 's', TASK, { use: true }, true).ok, true, 'no change is not a locked change');
    for (const change of [{}, { use: 'x' }, { other: true }]) assert.equal(setSwitches({}, 's', TASK, change, false).ok, false);
    assert.equal(setSwitches({}, 's', '../x', { keep: false }, false).ok, false);
    let big = {};
    for (let i = 0; i < TASK_MEMORY_MAX.tasks + 5; i++) big = setSwitches(big, 's', `task-${i}`, { keep: false }, false).ledger;
    assert.equal(Object.keys(big.s).length, TASK_MEMORY_MAX.tasks, 'oldest tasks go first');
    assert.equal(useLocked(0), false);
    assert.equal(useLocked(1), true);
  });

  // ---- the real provider ----
  const work = path.join(top, 'activity');
  fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h.memoryWriteLedgers = new Map();
  h.turnTimelines = new Map();
  h.rememberedNames = new Map();
  h.rememberTurnWrites = new Map();
  h.cachedProfile = PERSONAL;
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  const binding = h.activityMemoryBinding;
  assert.ok(binding, 'the harness has a memory store binding');
  const taskId = h.currentTaskStore().getView().activeTaskId;
  assert.ok(taskId, 'an open task');
  const set = change => f.handle(f.scoped({ type: 'taskMemorySet', taskId, ...change }));
  const write = (streamId, file) => h.memoryFolderWriteRefusal(streamId, 'Write', { file_path: file });

  await t('defaults: the view shows both on, the remember tool is offered and writes', async () => {
    assert.equal(JSON.stringify(h.taskMemoryView()), JSON.stringify({ taskId, use: true, keep: true, useLocked: false }));
    const host = h.memoryRememberHostFor('turn-a');
    assert.ok(host);
    assert.equal((await runRemember(host, { note: '짧은 문장을 좋아해요.' })).isError, undefined);
    assert.equal(files(work).length, 1);
    assert.equal(write('turn-a', path.join(memDir(work), 'note.md')), null, 'keep on: the coach may write there');
    assert.equal(h.memoryFolderWriteRefusal('turn-a', 'Bash', { command: 'echo x > .hypeproof/memory/a.md' }), null, 'keep on: the shell is decided as before');
  });

  await t('keep off: no remember tool, every memory write refused with the sentence, nothing on disk', async () => {
    const realFetch = globalThis.fetch; const sent = [];
    globalThis.fetch = (...args) => { sent.push(String(args[0])); return realFetch(...args); };
    await set({ keep: false });
    assert.equal(JSON.stringify(h.context.workspaceState.get(TASK_MEMORY_KEY)[binding.scope][taskId]), JSON.stringify({ use: true, keep: false }));
    assert.equal(h.taskMemoryView().keep, false);
    const before = files(work);
    assert.equal(h.memoryRememberHostFor('turn-b'), undefined, 'the tool is not offered');
    assert.equal(await h.recordTurnMemoryWrite('turn-b', '남기면 안 되는 기억'), null, 'the one write path refuses');
    assert.equal(write('turn-b', path.join(memDir(work), 'x.md')), TASK_MEMORY_COPY.keepRefusal, "the coach's Write into the memory folder");
    assert.equal(h.memoryFolderWriteRefusal('turn-b', 'Edit', { file_path: path.join(memDir(work), 'deep', 'y.md') }), TASK_MEMORY_COPY.keepRefusal, 'Edit, nested');
    assert.equal(write('turn-b', path.join(work, 'index.html')), null, 'negative control: a page write is not a memory write');
    assert.equal(write('turn-b', path.join(work, '.hypeproof', 'memory-notes.md')), null, 'negative control: a sibling name is outside the folder');
    assert.equal(h.memoryFolderWriteRefusal('turn-b', 'Read', { file_path: path.join(memDir(work), 'x.md') }), null, 'reading is not writing');
    const sh = command => h.memoryFolderWriteRefusal('turn-b', 'Bash', { command });
    for (const command of ['echo x > .hypeproof/memory/a.md', 'cp note.md ./.HYPEPROOF/memory/', `printf x >> ${path.join(memDir(work), 'b.md')}`, 'cat .hypeproof/memory/a.md'])
      assert.equal(sh(command), TASK_MEMORY_COPY.keepRefusal, `shell refused: ${command}`);
    for (const command of ['npm test', 'ls', 'echo memory > notes.md'])
      assert.equal(sh(command), null, `negative control, shell untouched: ${command}`);
    assert.deepEqual(files(work), before);
    globalThis.fetch = realFetch;
    assert.deepEqual(sent, [], 'no request leaves the client while keep is off');
  });

  await t('a host made before keep went off refuses on its next call (the switch is read again)', async () => {
    await set({ keep: true });
    const host = h.memoryRememberHostFor('turn-c');
    assert.ok(host);
    await set({ keep: false });
    const r = await runRemember(host, { note: '중간에 끈 기억' });
    assert.equal(r.isError, true);
    assert.equal(text(r), REMEMBER_REPLIES.unavailable);
    await set({ keep: true });
    assert.ok(h.memoryRememberHostFor('turn-d'), 'keep back on: offered again');
  });

  await t('use off: the request carries no memory; use on carries it (positive control on the same activity)', async () => {
    // The first-use notice counts as seen for this activity, as it is after the learner read it once.
    await h.context.workspaceState.update(MEMORY_NOTICE_KEY, markMemoryNoticeSeen(h.context.workspaceState.get(MEMORY_NOTICE_KEY), f.activity.id));
    const on = await h.takeMemoryContext(PERSONAL);
    assert.ok(on && on.text.includes('짧은 문장을 좋아해요.'), 'use on: the stored item rides on the request');
    await set({ use: false });
    assert.equal(h.taskMemoryView().use, false);
    assert.equal(await h.takeMemoryContext(PERSONAL), null, 'use off: nothing rides on the request');
    await set({ use: true });
    assert.ok(await h.takeMemoryContext(PERSONAL), 'use on again');
  });

  await t('use is locked once the task has a sent message; keep still changes', async () => {
    const store = h.currentTaskStore();
    await store.appendMessages?.(taskId, [{ id: 'u1', role: 'user', content: '안녕', createdAt: Date.now() }]);
    if (!(h.currentTaskStore().getView().tasks.find(x => x.id === taskId)?.messageCount > 0)) {
      await h.appendHistory([{ id: 'u1', role: 'user', content: '안녕', createdAt: Date.now() }]);
    }
    const view = h.taskMemoryView();
    assert.equal(view.useLocked, true, 'locked after the first message');
    await set({ use: false });
    assert.equal(h.taskMemoryView().use, true, 'the host refused the locked change');
    await set({ keep: false });
    assert.equal(h.taskMemoryView().keep, false, 'keep is not locked');
    await set({ keep: true });
  });

  await t('a change for another task id is ignored', async () => {
    // Sent as a stale webview would: its own task id, not the open one (no scoping helper rewrites it).
    await f.handle({ type: 'taskMemorySet', activityId: f.activity.id, taskId: TASK, keep: false });
    assert.equal(h.taskMemoryView().keep, true);
    assert.equal(switchesFor(acceptTaskMemory(h.context.workspaceState.get(TASK_MEMORY_KEY)), binding.scope, TASK).keep, true);
  });

  await t('no store binding (class seat, instructor): no view and the guard stays out of the way', async () => {
    h.cachedProfile = { ...PERSONAL, activity_kind: 'classroom' };
    assert.equal(h.taskMemoryView(), undefined);
    assert.equal(write('turn-e', path.join(memDir(work), 'x.md')), null);
    h.cachedProfile = PERSONAL;
    h._instructorMode = { isInstructor: true };
    assert.equal(h.taskMemoryView(), undefined);
    h._instructorMode = { isInstructor: false };
  });

  // ---- the Agent SDK runtime's file tools ----
  const bundleDir = fs.mkdtempSync(path.join(top, 'sdk-'));
  const out = path.join(bundleDir, 'sdk.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/sdkCoach.ts', import.meta.url))], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', external: ['@anthropic-ai/claude-agent-sdk', 'zod'], plugins: [{ name: 'vscode-stub', setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};', loader: 'js' })); } }] });
  const { runSdkCoach } = createRequire(import.meta.url)(out);
  await t('SDK: canUseTool denies a Write into the memory folder with the sentence when the host refuses it', async () => {
    let options;
    const sdk = { query: args => { options = args.options; return (async function* () { yield { type: 'result', subtype: 'success', is_error: false }; })(); }, tool: (name, description, schema, handler) => ({ name, description, handler }), createSdkMcpServer: s => s };
    // The host's own check, keep off for this turn: the same function the provider passes.
    h.taskMemoryStreams = new Map([['sdk-turn', taskId]]);
    await set({ keep: false });
    const refusal = (name, input) => h.memoryFolderWriteRefusal('sdk-turn', name, input);
    await runSdkCoach({ sdk, zod: { string: () => ({}) }, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'synthetic', model: 'synthetic', profile: PERSONAL, systemPrompt: '', history: [], userText: 'synthetic', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta: () => {}, requestApproval: async () => true, cwd: work, memoryFolderRefusal: refusal });
    assert.ok(options?.canUseTool, 'the runtime built its gate');
    const denied = await options.canUseTool('Write', { file_path: path.join(memDir(work), 'z.md'), content: 'x' }, { toolUseID: 'tu1', signal: new AbortController().signal });
    assert.equal(denied.behavior, 'deny');
    assert.equal(denied.message, TASK_MEMORY_COPY.keepRefusal);
    const other = await options.canUseTool('Write', { file_path: path.join(work, 'index.html'), content: 'x' }, { toolUseID: 'tu2', signal: new AbortController().signal });
    assert.notEqual(other.message, TASK_MEMORY_COPY.keepRefusal, 'negative control: a page write is decided by the usual policy');
    const shell = await options.canUseTool('Bash', { command: 'echo x > .hypeproof/memory/q.md' }, { toolUseID: 'tu3', signal: new AbortController().signal });
    assert.equal(shell.behavior, 'deny');
    assert.equal(shell.message, TASK_MEMORY_COPY.keepRefusal, 'a shell command naming the memory folder is refused before the policy');
    await set({ keep: true });
  });

  console.log(`task memory switches: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
