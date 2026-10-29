// REQ-STUDIO-ACTIVITY-MEMORY-SCOPE (CGP-KNOW-R-005 / REQ-KNOW-07) — memory is scoped to one personal activity.
// A class or lesson activity never reads or writes the learner's personal memory, and the scope comes from the
// activity as it was made: a lesson or class kind served later fails closed, it never re-scopes the store.
//   1. the pure scope rule (personalMemoryActivity);
//   2. the real provider and host module (VS Code stubbed) on real files: personal seats get the view, class and
//      lesson seats get none, and a delete or correction posted from a class seat changes nothing on disk;
//   3. the real provider with a scripted model runtime: with personal memory holding X, no request of a class,
//      lesson or personal turn contains X (no request carries memory yet; this pins the class half).
//   node --experimental-strip-types test/activity-memory-scope.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { personalMemoryActivity } from '../src/activityMemory.ts';
import { MEMORY_SCOPE_LABEL } from '../src/activityMemoryView.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const extension = fileURLToPath(new URL('..', import.meta.url));
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'activity-memory-scope-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const fresh = name => { const dir = path.join(top, name); fs.mkdirSync(dir); return dir; };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const put = (root, name, text) => { fs.mkdirSync(memDir(root), { recursive: true }); fs.writeFileSync(path.join(memDir(root), name), text); };
const X = '비밀 기억 X: 좋아하는 색은 초록이에요.';

const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
// An adult workshop tier, so the overview gate (minor or unknown tier: none) does not hide the scope gate behind it.
const game = { template_tier: 'website' };
const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux, game };
const TRIAL = { ...PERSONAL, profile_id: 'synthetic-trial', activity_kind: 'trial' };
const CLASSROOM = { profile_id: 'synthetic-class', activity_kind: 'classroom', activity_id: 'act-1', ux, game };
const LESSON = { ...PERSONAL, lesson: { sha256: 'abc', content: { steps: [] } } };
const BOUND = { ...PERSONAL, lesson_binding: { enforced: true } };

try {
  await t('rule: personal and trial activities only; class, lesson and unknown fail closed', async () => {
    const personal = { kind: 'personal' }, trial = { kind: 'trial' };
    for (const [record, profile, want, label] of [
      [personal, PERSONAL, true, 'personal'],
      [trial, TRIAL, true, 'trial'],
      [personal, { profile_id: 'no-kind' }, true, 'a profile without a kind keeps the kind the activity was made with'],
      [personal, { ...PERSONAL, minor_cohort: true }, true, 'minors included (DEC-02)'],
      [personal, { ...PERSONAL, lesson_binding: { enforced: false } }, true, 'an unenforced binding is not a lesson'],
      [{ kind: 'classroom' }, CLASSROOM, false, 'class activity'],
      [{ kind: 'classroom' }, PERSONAL, false, 'made as a class: a personal profile later does not re-scope it'],
      [personal, CLASSROOM, false, 'made personal, served as class now: refused, not re-scoped'],
      [{ kind: 'personal', lesson: true }, PERSONAL, false, 'a lesson recorded on the activity'],
      [personal, LESSON, false, 'a lesson served now'],
      [personal, BOUND, false, 'an enforced lesson binding'],
      [{ kind: 'team' }, { activity_kind: 'team' }, false, 'team activity'],
      [{}, PERSONAL, false, 'a record without a kind'],
      [undefined, PERSONAL, false, 'no record'],
      [personal, null, false, 'no profile loaded'],
      [{ kind: 'Personal' }, PERSONAL, false, 'kinds are exact'],
    ]) assert.equal(personalMemoryActivity(record, profile), want, label);
  });

  // The provider and host module, as in activity-memory.smoke.mjs.
  const work = fresh('activity');
  put(work, 'color.md', X);
  const dialogs = [], commands = [];
  const hostVscode = {
    Uri: { file: fsPath => ({ scheme: 'file', fsPath }) },
    commands: { executeCommand: async (...args) => { commands.push(args); } },
    window: { showWarningMessage: async (text, options, ...items) => { dialogs.push(text); return items.find(i => !i.isCloseAffordance); } },
  };
  const hostBundle = await build({ entryPoints: [fileURLToPath(new URL('../src/activityMemoryHost.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  vm.runInNewContext(hostBundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? hostVscode : require(id), console, Buffer, process, TextDecoder });
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  h.cachedProfile = PERSONAL;
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding, overview: () => h.activityMemoryOverviewTasks }));
  const last = () => f.posts.filter(m => m.type === 'activityMemoryState').at(-1);
  const list = async () => { await f.handle(f.scoped({ type: 'activityMemoryRequest' })); return last().view; };
  let seq = 0;
  const press = async (action, name, scope, text) => {
    const requestId = `s${++seq}`;
    await f.handle(f.scoped({ type: 'activityMemoryAction', requestId, scope, action, name, ...(text ? { text } : {}) }));
    assert.equal(last().requestId, requestId);
    return last().result;
  };
  const record = f.connections.active;
  const seats = [
    ['classroom profile', { profile: CLASSROOM }],
    ['lesson served now', { profile: LESSON }],
    ['enforced lesson binding', { profile: BOUND }],
    ['lesson recorded on the activity', { record: { ...record, lesson: true } }],
    ['activity made as a class', { record: { ...record, kind: 'classroom' } }],
    ['no profile loaded', { profile: null }],
  ];
  const as = async (seat, fn) => {
    const saved = { profile: h.cachedProfile, record: f.connections.active };
    if ('profile' in seat) h.cachedProfile = seat.profile;
    if (seat.record) f.connections.active = seat.record;
    try { return await fn(); } finally { h.cachedProfile = saved.profile; f.connections.active = saved.record; }
  };

  await t('provider: a personal or trial activity shows its own memory', async () => {
    const view = await list();
    assert.ok(view, 'personal view');
    assert.ok(Array.isArray(h.activityMemoryOverviewTasks), 'control: an adult personal seat has an overview');
    assert.deepEqual(view.entries.map(e => e.text), [X]);
    await as({ profile: TRIAL, record: { ...record, kind: 'trial' } }, async () => assert.ok(await list(), 'trial view'));
  });

  await t('provider: class and lesson seats get no memory view, no overview, no binding', async () => {
    for (const [label, seat] of seats) await as(seat, async () => {
      assert.equal(h.activityMemoryBinding, undefined, label);
      assert.equal(h.activityMemoryOverviewTasks, null, label);
      assert.equal(await list(), null, label);
    });
  });

  await t('provider: a delete or correction posted from a class seat changes nothing and asks nothing', async () => {
    const scope = (await list()).scope;
    const before = fs.readdirSync(memDir(work)).sort();
    for (const [label, seat] of seats) await as(seat, async () => {
      for (const [action, text] of [['delete'], ['correct', '바뀐 문장'], ['open']]) {
        const result = await press(action, 'color.md', scope, text);
        assert.ok(result.error, `${label} ${action} refused`);
        assert.equal(last().view, null, `${label}: the answer carries no memory`);
      }
    });
    assert.deepEqual(dialogs, [], 'no confirm was shown');
    assert.deepEqual(commands, [], 'nothing was opened');
    assert.deepEqual(fs.readdirSync(memDir(work)).sort(), before, 'no file written or removed');
    assert.equal(fs.readFileSync(path.join(memDir(work), 'color.md'), 'utf8'), X);
  });

  await t('provider: its own gates hold even behind a host binding that admits every seat', async () => {
    // The host re-reads the binding too; this pins the provider's own checks, so neither layer leans on the other.
    const scope = (await list()).scope;
    h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => ({ root: work, scope }), overview: () => [] }));
    try {
      for (const [label, seat] of seats) await as(seat, async () => {
        assert.equal(await list(), null, `${label}: no view`);
        for (const [action, text] of [['delete'], ['correct', '바뀐 문장'], ['open']]) {
          const result = await press(action, 'color.md', scope, text);
          assert.ok(result.error, `${label} ${action} refused by the provider`);
        }
      });
      assert.deepEqual(dialogs, [], 'no confirm was shown');
      assert.deepEqual(commands, [], 'nothing was opened');
      assert.equal(fs.readFileSync(path.join(memDir(work), 'color.md'), 'utf8'), X);
    } finally {
      h.setActivityMemoryPanel(mod.exports.registerActivityMemory({ binding: () => h.activityMemoryBinding, overview: () => h.activityMemoryOverviewTasks }));
    }
    // The extension wires the host to the same gated binding (secondary: source).
    const ext = fs.readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
    assert.match(ext, /registerActivityMemory\(\{ binding: \(\) => provider\.activityMemoryBinding,/, 'the host reads the scoped binding');
  });

  await t('view: the scope label is fixed text and there is no scope message to change it', async () => {
    assert.equal(MEMORY_SCOPE_LABEL, '기억 범위: 이 작업 공간 안에서만 · 수업 활동에서는 이 기억을 읽거나 쓰지 않아요.');
    const protocol = fs.readFileSync(new URL('../src/protocol.ts', import.meta.url), 'utf8');
    assert.deepEqual(protocol.match(/type: "[^"]*[Mm]emory[^"]*"/g)?.filter(m => /scope|Scope/.test(m)) ?? [], [], 'no memory-scope message');
    const contributes = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).contributes ?? {};
    const settings = [contributes.configuration ?? []].flat().flatMap(c => Object.keys(c.properties ?? {}));
    assert.deepEqual(settings.filter(key => /memor|기억|scope/i.test(key)), [], 'no setting changes the scope');
  });

  // Requests: the real provider with a scripted model runtime records every request it makes.
  const turnBundle = await build({
    stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export { FOLDER_CONSENT_KEY } from './src/folderConsent';", resolveDir: extension, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent',
    plugins: [{ name: 'scripted-runtime', setup(b) {
      const swap = { './proxyClient': 'proxy', './activityConnections': 'connections' };
      b.onResolve({ filter: /^\.\/(proxyClient|activityConnections)$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: swap[args.path], namespace: 'runtime' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({ loader: 'ts', resolveDir: extension, contents: args.path === 'proxy'
        ? `export * from ${JSON.stringify(path.join(extension, 'src/proxyClient.ts'))}; export const proxyChat=(a)=>globalThis.runtime.proxy(a); export const verifyActivity=async()=>{};`
        : `export * from ${JSON.stringify(path.join(extension, 'src/activityConnections.ts'))}; export const activityConnections=()=>globalThis.runtime.connections;` }));
    } }],
  });
  const turn = (profile, record) => {
    const root = fs.mkdtempSync(path.join(top, 'turn-'));
    put(root, 'color.md', X);
    const calls = [], state = new Map(), global = new Map(), history = [];
    const connections = { scope: 'a1', current: { service: 'http://127.0.0.1:1/v1', serverId: 'srv', ...record }, token: async () => 'synthetic-token', acquire: () => () => {} };
    const runtime = { connections, proxy: async a => { calls.push(JSON.stringify(a)); a.onDelta?.('네'); return { text: '네', toolUses: [] }; } };
    const vscode = {
      env: { appName: 'HypeProof Studio' },
      workspace: { createFileSystemWatcher: () => ({ onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), dispose() {} }),
        workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (k, d) => ({ coachRuntime: 'proxy', proxyUrl: 'http://127.0.0.1:1/v1' })[k] ?? d }) },
      window: { createOutputChannel: () => ({ appendLine() {} }), showOpenDialog: async () => undefined, showWarningMessage: async () => undefined, showInformationMessage: async () => undefined },
      commands: { executeCommand: async () => undefined },
      RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
      Uri: { file: fsPath => ({ fsPath }), joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }) },
      ProgressLocation: { Window: 10 },
    };
    const module = { exports: {} };
    vm.runInNewContext(turnBundle.outputFiles[0].text, {
      module, exports: module.exports, runtime, console, process: { ...process, env: { PATH: process.env.PATH } },
      require: id => id === 'vscode' ? vscode : require(id),
      Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, performance,
      fetch: async () => { throw new Error('Network is forbidden in this test'); },
    });
    const { ChatPanelProvider, FOLDER_CONSENT_KEY } = module.exports;
    const p = Object.create(ChatPanelProvider.prototype);
    const copy = v => JSON.parse(JSON.stringify(v));
    Object.assign(p, {
      context: { globalStorageUri: { fsPath: path.join(top, 'storage') }, workspaceState: { get: (k, d) => state.get(k) ?? d, update: async (k, v) => state.set(k, v) }, globalState: { get: k => global.get(k), update: async (k, v) => global.set(k, v) }, secrets: { get: async () => 'synthetic-token' }, subscriptions: [] },
      nativeHistoryScope: 'task-a', pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
      _instructorMode: { isInstructor: false, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: profile, accessState: null, servedWorkspaceRoot: null,
      getHistory: () => history, appendHistory: async items => { for (const it of items) history.push(copy(it)); },
      post: async () => {}, postConfig: async () => {}, getCoach: () => ({ name: '코치', personality: '', configured: true }),
      ensureProfile: async () => profile, loadAccess: async () => {},
      pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
      isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
      prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
      resolveCoachCwd: () => root, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
      buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
      provenanceRecorder: () => null, turnRequestScope: () => JSON.stringify(['a1', 'task-a']),
    });
    global.set(FOLDER_CONSENT_KEY, { 'act-1': { [root]: { level: 'read', at: 1 } } });
    return { calls, root, send: text => p.handleMessage({ type: 'sendMessage', activityId: 'a1', text, history: [], toolMode: 'auto', userMessageId: 'u-1' }) };
  };

  await t('requests: with personal memory holding X, no class, lesson or personal turn request contains X', async () => {
    for (const [label, profile, record] of [
      ['classroom', CLASSROOM, { kind: 'classroom' }],
      ['lesson', LESSON, { kind: 'personal', lesson: true }],
      ['personal (no request carries memory yet)', PERSONAL, { kind: 'personal' }],
    ]) {
      const run = turn(profile, record);
      await run.send('오늘 할 일을 정리해 줘');
      assert.equal(run.calls.length, 1, `${label}: control, the turn reached the model`);
      assert.ok(run.calls[0].includes('오늘 할 일을 정리해 줘'), `${label}: control, the capture holds the request text`);
      assert.ok(!run.calls[0].includes('초록'), `${label}: no personal memory in the request`);
      // A class turn writes nothing into the personal store either.
      assert.deepEqual(fs.readdirSync(memDir(run.root)), ['color.md'], `${label}: the store is unchanged`);
    }
  });

  console.log(`activity memory scope: ${passed} passed`);
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}
