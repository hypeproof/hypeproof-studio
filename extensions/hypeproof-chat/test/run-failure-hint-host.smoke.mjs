// CGP-SHELL-R-019 (REQ-SHELL-19): the real provider's send path carries the coach observation after three failed runs,
// and only where it may. A scripted model runtime records every request (the memory-use.smoke.mjs harness):
// - agent-sdk: three turns whose Bash results fail → the fourth request's memoryContext holds the pinned line, once;
//   the learner's text, the saved conversation and the session spool hold none of it; a success starts over;
// - adult and minor seats alike;
// - tips off (팁 그만 보기), a lesson without `learning`, a non-lesson seat and an instructor seat: never;
// - proxy: the same line rides in contextText, beside (not in) the learner's text, after three failed preview starts.
//   node --experimental-strip-types test/run-failure-hint-host.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runFailureObservation } from '../src/runFailureHint.ts';

const require = createRequire(import.meta.url);
const extension = fileURLToPath(new URL('..', import.meta.url));
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'run-failure-hint-')));
const LINE = runFailureObservation(3);
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };

const bundle = await build({
  stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export { FOLDER_CONSENT_KEY } from './src/folderConsent';", resolveDir: extension, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent',
  plugins: [{ name: 'scripted-runtime', setup(b) {
    const swap = { './proxyClient': 'proxy', './activityConnections': 'connections', './sdkCoach': 'sdk' };
    b.onResolve({ filter: /^\.\/(proxyClient|activityConnections|sdkCoach)$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: swap[args.path], namespace: 'runtime' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({ loader: 'ts', resolveDir: extension, contents: args.path === 'proxy'
      ? `export * from ${JSON.stringify(path.join(extension, 'src/proxyClient.ts'))}; export const proxyChat=(a)=>globalThis.runtime.proxy(a); export const verifyActivity=async()=>{};`
      : args.path === 'sdk'
      ? `export * from ${JSON.stringify(path.join(extension, 'src/sdkCoach.ts'))}; export const runSdkCoach=(a)=>globalThis.runtime.sdk(a);`
      : `export * from ${JSON.stringify(path.join(extension, 'src/activityConnections.ts'))}; export const activityConnections=()=>globalThis.runtime.connections;` }));
  } }],
});

const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
const STEPS = [{ id: 's1', title: '첫 단계', instructions: '페이지를 만들어요', hint: '', acceptance: '' }, { id: 's2', title: '둘째', instructions: '', hint: '', acceptance: '' }];
const LEARNING = { week: 1, mission: '나만의 페이지' };
const lessonProfile = ({ minor = false, learning = true, browser = false } = {}) => ({
  profile_id: minor ? 'synthetic-minor-lesson' : 'synthetic-lesson', activity_kind: 'classroom', activity_id: 'act-1', ux, ...(minor ? { minor_cohort: true } : {}),
  // The proxy runtime runs tools only in its browser loop (profile.browser_control); its one run tool is the preview start.
  ...(browser ? { browser_control: { enabled: true } } : {}),
  lesson: { course_id: 'c', version: 'v', sha256: 'abc', content: { schema: 'hps-session-design/1', title: '수업', steps: STEPS, ...(learning ? { learning: LEARNING } : {}) } },
});

/**
 * One seat. `script` returns, per turn, the run results the scripted runtime reports: [toolName, isError][].
 */
const seat = ({ profile, runtimeName = 'agent-sdk', instructor = false, script = () => [] }) => {
  const root = fs.mkdtempSync(path.join(top, 'turn-'));
  const sdkCalls = [], proxyCalls = [], posts = [], state = new Map(), global = new Map(), history = [], spooled = [];
  const connections = { scope: 'a1', current: { service: 'http://127.0.0.1:1/v1', serverId: 'srv', kind: 'classroom' }, token: async () => 'synthetic-token', acquire: () => () => {} };
  let turns = 0, toolSeq = 0;
  const runtime = {
    connections,
    sdk: async a => {
      sdkCalls.push({ userText: a.userText, memoryContext: a.memoryContext, history: a.history });
      for (const [name, isError] of script(turns++)) {
        const id = `toolu_${++toolSeq}`;
        a.onActivity?.({ kind: 'tool_use', id, name, input: { command: 'npm test' } });
        a.onActivity?.({ kind: 'tool_result', id, isError, ...(isError ? { reason: '/Users/learner-name/secret: Exit code 1' } : {}) });
      }
      a.onDelta?.('네'); return {};
    },
    proxy: async a => {
      proxyCalls.push({ userText: a.userText, contextText: a.contextText, scratch: (a.toolTurns ?? []).length });
      // The first iteration of a turn asks for the preview; the host runs it (this rig's preview host fails it).
      if (!(a.toolTurns ?? []).length && script(turns).length) return { text: '', toolUses: [{ id: `call_${++toolSeq}`, name: 'live_preview_start', input: {} }] };
      turns++;
      a.onDelta?.('네'); return { text: '네', toolUses: [] };
    },
  };
  const spool = new Proxy({}, { get: (_, name) => (...args) => { spooled.push({ name: String(name), args: JSON.stringify(args) }); return undefined; } });
  const vscode = {
    env: { appName: 'HypeProof Studio' },
    workspace: { createFileSystemWatcher: () => ({ onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }), dispose() {} }),
      workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (k, d) => ({ coachRuntime: runtimeName, proxyUrl: 'http://127.0.0.1:1/v1' })[k] ?? d }) },
    window: { createOutputChannel: () => ({ appendLine() {} }), showOpenDialog: async () => undefined, showWarningMessage: async () => undefined, showInformationMessage: async () => undefined },
    commands: { executeCommand: async () => undefined },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    Uri: { file: fsPath => ({ fsPath }), joinPath: (u, ...n) => ({ fsPath: path.join(u.fsPath, ...n) }) },
    ProgressLocation: { Window: 10 },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, runtime, console, process: { ...process, env: { PATH: process.env.PATH } },
    require: id => id === 'vscode' ? vscode : require(id),
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    fetch: async () => { throw new Error('Network is forbidden in this test'); },
  });
  const { ChatPanelProvider, FOLDER_CONSENT_KEY } = module.exports;
  const p = Object.create(ChatPanelProvider.prototype);
  const copy = v => JSON.parse(JSON.stringify(v));
  Object.assign(p, {
    context: { globalStorageUri: { fsPath: path.join(top, 'storage') }, workspaceState: { get: (k, d) => state.get(k) ?? d, update: async (k, v) => state.set(k, copy(v)) }, globalState: { get: k => global.get(k), update: async (k, v) => global.set(k, v) }, secrets: { get: async () => 'synthetic-token' }, subscriptions: [] },
    nativeHistoryScope: 'task-a', pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: profile, accessState: null, servedWorkspaceRoot: null,
    getHistory: () => history, appendHistory: async items => { for (const it of items) history.push(copy(it)); },
    post: async m => { posts.push(copy(m)); }, postConfig: async () => {}, getCoach: () => ({ name: '코치', personality: '', configured: true }),
    ensureProfile: async () => profile, loadAccess: async () => {},
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
    resolveCoachCwd: () => root, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    provenanceRecorder: () => null, spool, maybeOfferSdkSeed: async () => {},
    currentTaskStore: () => ({ getView: () => ({ activeTaskId: 'task-a', tasks: [{ id: 'task-a', title: '작업' }], archived: [] }) }),
  });
  global.set(FOLDER_CONSENT_KEY, { 'act-1': { [root]: { level: 'read', at: 1 } } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  let msg = 0;
  return {
    p, sdkCalls, proxyCalls, history, spooled, posts,
    send: async (text = `안 돼요 ${msg + 1}`) => { await p.handleMessage({ type: 'sendMessage', activityId: 'a1', taskId: 'task-a', text, history: [], toolMode: 'auto', userMessageId: `u-${++msg}` }); await settle(); },
    focus: async stepId => { await p.handleMessage({ type: 'lessonFocus', activityId: 'a1', taskId: 'task-a', stepId }); },
  };
};
const ctx = c => c.memoryContext ?? c.contextText ?? '';
const carries = c => ctx(c).includes(LINE);
const fail3 = n => (n < 3 ? [['Bash', true]] : []);

try {
  // A minor seat is pinned to the proxy runtime (the provider's runtime choice); with browser control its run is the preview
  // start, which this rig's preview host fails.
  for (const minor of [false, true]) {
    const who = minor ? 'minor (proxy)' : 'adult (agent-sdk)';
    await t(`${who}: after three failed runs the next request carries the observation once, model-only`, async () => {
      const tool = minor ? 'live_preview_start' : 'Bash';
      const run = seat({ profile: lessonProfile({ minor, browser: minor }), runtimeName: minor ? 'proxy' : 'agent-sdk', script: n => (n < 3 ? [[tool, true], [tool, true]] : n === 4 ? [[tool, true]] : []) });
      for (let i = 0; i < 5; i++) await run.send();
      const calls = minor ? run.proxyCalls.filter(c => c.scratch === 0) : run.sdkCalls;
      assert.equal(calls.length, 5, `control: every turn reached the runtime (${run.sdkCalls.length} sdk, ${run.proxyCalls.length} proxy)`);
      assert.deepEqual(calls.map(carries), [false, false, false, true, false], `the fourth request only (retries in a turn count once); tool lines: ${JSON.stringify(run.posts.filter(m => m.type === 'toolLog').map(m => [m.entry?.label, m.entry?.state]).slice(0, 8))}`);
      const fourth = calls[3];
      assert.ok(!fourth.userText.includes('[관찰]'), "never in the learner's text (the Service records the last user message)");
      assert.ok(!ctx(fourth).includes('Exit code') && !ctx(fourth).includes('learner-name') && !ctx(fourth).includes('npm test'), 'a count only: no error text, path or command');
      const saved = JSON.stringify(run.history) + JSON.stringify(run.spooled) + JSON.stringify(run.posts);
      assert.ok(!saved.includes('[관찰]'), 'not in the saved conversation, the session spool or any webview post');
      assert.ok(run.history.some(m => m.role === 'user'), 'control: the conversation was saved');
      for (let i = 0; i < 3; i++) await run.send();
      const later = minor ? run.proxyCalls.filter(c => c.scratch === 0) : run.sdkCalls;
      assert.equal(later.length, 8, 'control: three more turns ran');
      assert.ok(!later.slice(5).some(carries), 'once per step per session');
    });
  }

  await t('a successful run starts over; a step change starts over', async () => {
    // Turns 0 and 1 fail, turn 2's retries end in success (a reset), turns 3, 4 and 5 fail: the seventh request carries it.
    const ok = seat({ profile: lessonProfile(), script: n => (n === 2 ? [['Bash', true], ['Bash', false]] : n < 6 ? [['Bash', true]] : []) });
    for (let i = 0; i < 7; i++) await ok.send();
    assert.deepEqual(ok.sdkCalls.map(carries), [false, false, false, false, false, false, true], 'retries that ended in success reset the count; three more failures after it');
    const step = seat({ profile: lessonProfile(), script: n => (n < 3 ? [['Bash', true]] : []) });
    await step.send(); await step.send();
    await step.focus('s2');
    assert.equal(step.p.lessonFocus?.stepId, 's2', 'control: the focus moved to s2');
    await step.send(); await step.send();
    assert.ok(!step.sdkCalls.some(carries), 'two on s1, then a step change: nothing');
  });

  // An instructor seat and a local runtime are refused by hintSeatFor (run-failure-hint.smoke.mjs); their send paths are other runtimes.
  await t('never: tips off, a lesson without learning, a non-lesson seat', async () => {
    const off = seat({ profile: lessonProfile(), script: fail3 });
    assert.equal(await off.p.setLessonTips(false), 'memory-only', 'control: tips are off for this window');
    for (let i = 0; i < 4; i++) await off.send();
    assert.ok(!off.sdkCalls.some(carries), '팁 그만 보기: no observation');
    const bare = seat({ profile: lessonProfile({ learning: false }), script: fail3 });
    for (let i = 0; i < 4; i++) await bare.send();
    assert.equal(bare.sdkCalls.length, 4, 'control: turns ran');
    assert.ok(!bare.sdkCalls.some(carries), 'no learning block: skipped');
    const plain = seat({ profile: { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux }, script: fail3 });
    for (let i = 0; i < 4; i++) await plain.send();
    assert.ok(!plain.sdkCalls.some(carries), 'no lesson: never');
  });

  await t('proxy: the observation rides in contextText beside the learner text after three failed preview starts', async () => {
    const run = seat({ profile: lessonProfile({ browser: true }), runtimeName: 'proxy', script: n => (n < 3 ? [['live_preview_start', true]] : []) });
    for (let i = 0; i < 4; i++) await run.send();
    const firsts = run.proxyCalls.filter(c => c.scratch === 0);
    assert.equal(firsts.length, 4, 'control: four turns reached the proxy');
    assert.deepEqual(firsts.map(carries), [false, false, false, true], 'the fourth turn carries it');
    assert.ok(!firsts[3].userText.includes('[관찰]'), 'beside, not in, the learner text');
  });
  await t('proxy without browser control: the coach runs no tool, so nothing is counted and nothing is sent', async () => {
    const run = seat({ profile: lessonProfile({ minor: true }), runtimeName: 'proxy', script: () => [['live_preview_start', true]] });
    for (let i = 0; i < 4; i++) await run.send();
    assert.equal(run.proxyCalls.filter(c => c.scratch === 0).length, 4, 'control: four turns reached the proxy');
    assert.equal(run.posts.filter(m => m.type === 'toolLog').length, 0, 'no tool ran (the ordinary proxy send runs none)');
    assert.ok(!run.proxyCalls.some(carries), 'never');
  });
  console.log(`run-failure-hint-host: ${passed} passed`);
} finally { fs.rmSync(top, { recursive: true, force: true }); }
