// REQ-STUDIO-MEMORY-NOTICE (CGP-KNOW-R-031 / REQ-KNOW-49, CGP-KNOW-D-031 / DES-KNOW-49) — the first time memory would be
// used in an activity, the learner sees once what is stored, where, who reads it and how to delete it, with one 확인.
//   1. the pure parts (memoryNotice.ts): the record REQ-KNOW-44 reads, its writer and the due rule; the copy is four
//      lines and one 확인, with no 켜기/나중에/끄기 choice;
//   2. the real provider (VS Code stubbed) on real files: personal and trial seats, a minor cohort included, are told the
//      notice is due once the store holds an item; class, lesson and instructor seats and an empty store are not; 확인
//      writes `hps.memoryNotice.v1` {activity: true} for the activity open now only, after which it is never due again
//      there; a press for another activity, a double press and a failed save behave.
//   node --experimental-strip-types test/memory-notice.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MEMORY_NOTICE_COPY, MEMORY_NOTICE_KEY, MEMORY_NOTICE_MAX, markMemoryNoticeSeen, memoryNoticeDue, memoryNoticeSeen } from '../src/memoryNotice.ts';

const require = createRequire(import.meta.url);
const extension = fileURLToPath(new URL('..', import.meta.url));
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-notice-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const put = (root, name, text) => {
  const dir = path.join(root, '.hypeproof', 'memory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};

try {
  await t('record: only an own `true` for this activity counts as seen', async () => {
    assert.equal(memoryNoticeSeen(undefined, 'a1'), false);
    assert.equal(memoryNoticeSeen({ a1: 'yes' }, 'a1'), false);
    assert.equal(memoryNoticeSeen({ a2: true }, 'a1'), false);
    assert.equal(memoryNoticeSeen({ a1: true }, null), false);
    assert.equal(memoryNoticeSeen([true], '0'), false);
    assert.equal(memoryNoticeSeen(Object.create({ a1: true }), 'a1'), false, 'an inherited value is not a record');
    assert.equal(memoryNoticeSeen({ a1: true }, 'a1'), true);
    assert.equal(MEMORY_NOTICE_KEY, 'hps.memoryNotice.v1', 'the key REQ-KNOW-44 (CGP-KNOW-R-026) reads');
  });

  await t('record: 확인 adds this activity, keeps valid ones, drops junk and caps the oldest', async () => {
    assert.deepEqual({ ...markMemoryNoticeSeen(undefined, 'a1') }, { a1: true });
    assert.deepEqual({ ...markMemoryNoticeSeen({ a0: true, bad: 'x', a1: true }, 'a1') }, { a0: true, a1: true });
    for (const bad of ['', null, 7, '__proto__', 'x'.repeat(601)]) assert.equal(markMemoryNoticeSeen({}, bad), null, `refuses ${String(bad).slice(0, 10)}`);
    const many = Object.fromEntries(Array.from({ length: MEMORY_NOTICE_MAX }, (_, i) => [`old-${i}`, true]));
    const next = markMemoryNoticeSeen(many, 'new');
    assert.equal(Object.keys(next).length, MEMORY_NOTICE_MAX);
    assert.ok(next.new && !next['old-0'] && next['old-1'], 'the oldest goes first; the new one stays');
    assert.equal(memoryNoticeSeen(next, 'new'), true, 'the writer and the reader agree');
  });

  await t('due: a bound activity with something to use and no record; never otherwise', async () => {
    assert.deepEqual(memoryNoticeDue({ activity: 'a1', bound: true, stored: undefined, items: 1 }), { activity: 'a1' });
    assert.equal(memoryNoticeDue({ activity: 'a1', bound: true, stored: undefined, items: 0 }), null, 'an empty store uses no memory');
    assert.equal(memoryNoticeDue({ activity: 'a1', bound: false, stored: undefined, items: 3 }), null, 'no binding, no notice');
    assert.equal(memoryNoticeDue({ activity: 'a1', bound: true, stored: { a1: true }, items: 3 }), null, 'once only');
    assert.equal(memoryNoticeDue({ activity: undefined, bound: true, stored: undefined, items: 3 }), null);
  });

  await t('copy: four lines (무엇을, 어디에, 누가 보는지, 지우는 법) and one 확인; no switch words', async () => {
    assert.deepEqual(MEMORY_NOTICE_COPY.lines.map(l => l.label), ['무엇을', '어디에', '누가 보는지', '지우는 법']);
    assert.equal(MEMORY_NOTICE_COPY.confirm, '확인');
    const all = JSON.stringify(MEMORY_NOTICE_COPY);
    for (const word of ['켜기', '나중에', '끄기', '동의', '허용']) assert.ok(!all.includes(word), `no "${word}"`);
    assert.ok(MEMORY_NOTICE_COPY.lines[1].text.includes('.hypeproof/memory/'), 'where: the real folder');
    assert.ok(/내 작품/.test(MEMORY_NOTICE_COPY.lines[3].text) && /모두 지울/.test(MEMORY_NOTICE_COPY.lines[3].text), 'how to delete: the real place');
  });

  // The real provider; only activityConnections is swapped for a scripted one (scope and the activity record).
  const bundle = await build({
    stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extension, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent',
    plugins: [{ name: 'scripted-connections', setup(b) {
      b.onResolve({ filter: /^\.\/activityConnections$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'connections', namespace: 'runtime' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'runtime' }, () => ({ loader: 'ts', resolveDir: extension,
        contents: `export * from ${JSON.stringify(path.join(extension, 'src/activityConnections.ts'))}; export const activityConnections=()=>globalThis.runtime.connections;` }));
    } }],
  });
  const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
  const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux };
  const TRIAL = { ...PERSONAL, profile_id: 'synthetic-trial', activity_kind: 'trial' };
  const MINOR = { ...PERSONAL, profile_id: 'synthetic-minor', minor_cohort: true, game: { template_tier: 'kids' } };
  const CLASSROOM = { profile_id: 'synthetic-class', activity_kind: 'classroom', activity_id: 'act-1', ux };
  const LESSON = { ...PERSONAL, lesson: { sha256: 'abc', content: { steps: [] } } };

  const seat = ({ profile = PERSONAL, record = { kind: 'personal' }, instructor = false, items = 1, failSave = false } = {}) => {
    const root = fs.mkdtempSync(path.join(top, 'seat-'));
    for (let i = 0; i < items; i++) put(root, `item-${i}.md`, `기억 ${i}`);
    const posts = [], state = new Map();
    const connections = { scope: 'a1', current: { service: 'http://127.0.0.1:1/v1', serverId: 'srv', ...record }, token: async () => 'synthetic-token', acquire: () => () => {} };
    const vscode = {
      env: { appName: 'HypeProof Studio' },
      workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (k, d) => d }) },
      window: { createOutputChannel: () => ({ appendLine() {} }) },
      commands: { executeCommand: async () => undefined },
      Uri: { file: fsPath => ({ fsPath }), joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }) },
    };
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports, runtime: { connections }, console, process: { ...process, env: { PATH: process.env.PATH } },
      require: id => id === 'vscode' ? vscode : require(id),
      Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, performance,
      fetch: async () => { throw new Error('Network is forbidden in this test'); },
    });
    const { ChatPanelProvider } = module.exports;
    const p = Object.create(ChatPanelProvider.prototype);
    const copy = v => JSON.parse(JSON.stringify(v));
    const view = { posts: [] };
    Object.assign(p, {
      context: { workspaceState: { get: (k, d) => state.get(k) ?? d, update: async (k, v) => { if (failSave) throw new Error('disk full'); state.set(k, copy(v)); } }, globalState: { get: () => undefined, update: async () => {} }, subscriptions: [] },
      _instructorMode: { isInstructor: instructor }, cachedProfile: profile, nativeHistoryScope: 'task-a',
      post: async m => { posts.push(copy(m)); }, resolveCoachCwd: () => root,
      currentTaskStore: () => ({ getView: () => ({ activeTaskId: 'task-a', tasks: [{ id: 'task-a', title: '작업' }], archived: [] }) }),
    });
    const source = { postMessage: async m => { view.posts.push(copy(m)); return true; } };
    const last = () => view.posts.filter(m => m.type === 'memoryNoticeState').at(-1);
    return {
      root, state, posts, connections,
      ask: async () => { await p.handleMessage({ type: 'memoryNoticeRequest', activityId: 'a1', taskId: 'task-a' }, source); return last(); },
      ack: async (activity = 'a1', activityId = 'a1') => { await p.handleMessage({ type: 'memoryNoticeAck', activityId, taskId: 'task-a', activity }, source); return last(); },
    };
  };

  await t('host: personal, trial and minor personal seats are told the notice is due; 확인 writes the record once', async () => {
    for (const [label, profile, record] of [['personal', PERSONAL, { kind: 'personal' }], ['trial', TRIAL, { kind: 'trial' }], ['minor cohort', MINOR, { kind: 'personal' }]]) {
      const run = seat({ profile, record });
      const first = await run.ask();
      assert.deepEqual(first.notice, { activity: 'a1' }, `${label}: due`);
      assert.equal(first.activityId, 'a1', `${label}: the answer names its activity, so a stale one is dropped`);
      assert.equal(run.state.get(MEMORY_NOTICE_KEY), undefined, `${label}: showing it records nothing`);
      assert.equal(run.posts.length, 0, `${label}: answered to the asking view only, not broadcast`);
      const after = await run.ack();
      assert.equal(after.notice, null, `${label}: gone after 확인`);
      assert.deepEqual(run.state.get(MEMORY_NOTICE_KEY), { a1: true }, `${label}: the record REQ-KNOW-44 reads`);
      assert.equal((await run.ask()).notice, null, `${label}: never again in this activity`);
      // A double press (or a second window) changes nothing.
      await run.ack();
      assert.deepEqual(run.state.get(MEMORY_NOTICE_KEY), { a1: true });
    }
  });

  await t('host: class, lesson and instructor seats and an empty store get no notice, and 확인 there writes nothing (확인 counts only on a notice that is due)', async () => {
    for (const [label, options] of [
      ['classroom', { profile: CLASSROOM, record: { kind: 'classroom' } }],
      ['lesson on the activity', { record: { kind: 'personal', lesson: true } }],
      ['lesson served now', { profile: LESSON }],
      ['instructor', { instructor: true }],
      ['instructor state unknown', { instructor: null }],
      ['empty store', { items: 0 }],
    ]) {
      const run = seat(options);
      assert.equal((await run.ask()).notice, null, `${label}: not due`);
      await run.ack();
      assert.equal(run.state.get(MEMORY_NOTICE_KEY), undefined, `${label}: nothing recorded`);
    }
  });

  await t('host: the first item makes it due; a press for another activity marks nothing; a failed save keeps it shown', async () => {
    const run = seat({ items: 0 });
    assert.equal((await run.ask()).notice, null);
    put(run.root, 'first.md', '처음 남긴 기억');
    assert.deepEqual((await run.ask()).notice, { activity: 'a1' }, 'due once the store holds an item');
    // The view showed activity a1, but the learner has since switched to a2: that press is not a2's notice.
    run.connections.scope = 'a2';
    await run.ack('a1', 'a2');
    assert.equal(run.state.get(MEMORY_NOTICE_KEY), undefined, 'a press for another activity records nothing');
    assert.deepEqual((await run.ack('a1', undefined)), { type: 'memoryNoticeState', notice: { activity: 'a2' }, activityId: 'a2', taskId: 'task-a' }, 'and a2 still shows its own notice');
    assert.equal(run.state.get(MEMORY_NOTICE_KEY), undefined);
    const failing = seat({ failSave: true });
    assert.deepEqual((await failing.ack()).notice, { activity: 'a1' }, 'a failed save leaves the notice up, so 확인 can be pressed again');
  });

  await t('host: an activity switch while the store is read answers nothing stale', async () => {
    // handleMessage runs synchronously up to the store read; the switch lands while that read is in flight.
    const run = seat();
    const asking = run.ask();
    run.connections.scope = 'a2';
    assert.equal((await asking).notice, null, 'the notice read for a1 is not offered once a2 is open');
    run.connections.scope = 'a1';
    const pressing = run.ack();
    run.connections.scope = 'a2';
    await pressing;
    assert.equal(run.state.get(MEMORY_NOTICE_KEY), undefined, 'a 확인 whose read straddled the switch records nothing');
  });

  console.log(`memory notice: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
