// Actual provider/SDK methods with scripted runtime boundaries. No network, CLI or paid calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { turnToolsAvailability, retryTurnToolMode, WebSearchActivity } from '../src/turnTools.ts';
import { SdkWebCitations } from '../src/sdkWebCitations.ts';
import { PublishReadGate } from '../src/publishReadGate.ts';
import { validActivityDraft, preservedDraftContent } from '../src/activityDraft.ts';
import { canReserveRecovery, recoveryFull } from '../src/recoveryCapacity.ts';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START } from '../src/browserMcp.ts';

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL('..', import.meta.url));
const profile = { profile_id: 'adult-test', tools: { web_search: true }, coach_runtime: 'agent-sdk', sdk_tools: { read: true, write: true, browser: true, subagents: true }, ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } } };
const toolUse = (id, name = 'WebSearch', input = { query: 'source question' }) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, value, error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: error, content: 'Model-facing text is not a source.' }] }, tool_use_result: value });
const searchOutput = (url = 'https://example.test/reference') => ({ query: 'source question', results: ['commentary https://invented.test/', { tool_use_id: 'server-search-id', content: [{ title: 'Observed search hit', url }] }] });
const copy = value => JSON.parse(JSON.stringify(value));
const temporary = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-turn-tools-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

test('recovery admission bounds count and UTF-8 bytes without deleting legacy disk input', async t => {
  const next={text:'새 요청',images:[],toolMode:'auto'};
  const legacy=Array.from({length:12},(_,i)=>({text:`보관 ${i}`,images:['data:image/png;base64,cGhvdG8='],toolMode:'web-search'}));
  assert.equal(canReserveRecovery(legacy.slice(0,7),next),true);
  assert.equal(canReserveRecovery(legacy.slice(0,8),next),false);
  const large={text:'큰 사진',toolMode:'auto',images:Array.from({length:3},()=>`data:image/png;base64,${'A'.repeat(8*1024*1024)}`)};
  assert.equal(validActivityDraft({text:'',images:[],queued:null,recovered:[large]}),true,'valid older drafts remain readable');
  assert.equal(recoveryFull([large]),true,'byte budget applies even to one recovered item');
  assert.equal(canReserveRecovery([],large),false,'reserve the potential refusal before sending');
  const root=temporary(t),store=new TaskWorkspaceStore(root,'capacity');await store.initialize();
  const id=store.getView().activeTaskId;
  const draft={text:'현재 초안',images:[],queued:'대기 요청',queuedPaused:true,recovered:legacy};
  await store.saveDraft(id,draft);
  const reopened=new TaskWorkspaceStore(root,'capacity');
  assert.deepEqual(reopened.getDraft(),draft,'above-cap legacy items survive exact disk reopen');
  assert.equal(canReserveRecovery(reopened.getDraft().recovered,next),false);
  await reopened.saveDraft(id,{...draft,recovered:legacy.slice(1)});
  assert.deepEqual(new TaskWorkspaceStore(root,'capacity').getDraft().recovered,legacy.slice(1),'explicit removal changes only the selected item');
});

const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {runSdkCoach,SdkUnavailableError} from './src/sdkCoach'; export {BrowserControl} from './src/browserControl';", resolveDir: extension, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent', plugins: [{ name: 'scripted-provider-runtime', setup(b) {
  b.onResolve({ filter: /^\.\/sdkCoach$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'sdk', namespace: 'runtime' } : undefined);
  b.onResolve({ filter: /^\.\/proxyClient$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'proxy', namespace: 'runtime' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({ loader: 'ts', resolveDir: extension, contents: args.path === 'sdk'
    ? `export * from ${JSON.stringify(path.join(extension, 'src/sdkCoach.ts'))}; export const runSdkCoach=(args)=>globalThis.runtime.sdk(args);`
    : `export * from ${JSON.stringify(path.join(extension, 'src/proxyClient.ts'))}; export const proxyChat=(args)=>globalThis.runtime.proxy(args);` }));
} }] });

function fixture(t, { runtimeMode = 'agent-sdk', resolvedProfile = copy(profile), local = false, instructor = false, choice } = {}) {
  const root = temporary(t), posts = [], history = [], calls = { sdk: [], proxy: [], observation: 0, network: 0 };
  const runtime = { sdk: async args => { calls.sdk.push(args); args.onDelta('모델 답변'); return { kind: 'success' }; }, proxy: async args => { calls.proxy.push(args); args.onDelta('자동 모드 답변'); return { text: '자동 모드 답변', toolUses: [] }; } };
  const values = { coachRuntime: runtimeMode, proxyUrl: 'http://127.0.0.1:1/v1' };
  const vscode = { env: { appName: local ? 'HypeProof Studio Dev' : 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) }, window: { createOutputChannel: () => ({ appendLine() {} }) }, Uri: { file: fsPath => ({ fsPath }) } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), runtime, console,
    process: { ...process, env: { PATH: process.env.PATH, APPDATA: root, ...(local ? { HPS_DEV_RUNTIME: '1', HPS_DEV_PROVIDER: 'codex', HPS_DEV_EXECUTABLE: '/fixture/codex', HPS_DEV_MODEL: 'fixture' } : {}) } },
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout,
    fetch: async () => { calls.network++; throw new Error('Network is forbidden in this test'); },
  });
  const { ChatPanelProvider, runSdkCoach, SdkUnavailableError, BrowserControl } = module.exports;
  const h = Object.create(ChatPanelProvider.prototype), state = new Map();
  const context = { workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) }, secrets: { get: async () => 'synthetic-test-token' } };
  Object.assign(h, { context, nativeHistoryScope: 'task-a', pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: resolvedProfile,
    getHistory: () => history, appendHistory: async items => { for (const item of items) { const i = history.findIndex(previous => previous.id === item.id); if (i < 0) history.push(copy(item)); else history[i] = copy(item); } },
    post: async event => posts.push(copy(event)), postConfig: async () => {}, getCoach: () => ({ name: '코치', personality: '', configured: true }),
    ensureProfile: async () => resolvedProfile, loadAccess: async () => {}, accessState: choice ? { selected: choice.id, view: { choices: [choice] } } : undefined,
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => { calls.observation++; return null; }, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    // Object.create skips class fields; the funnel reporter (studio-funnel-events) is one of them.
    funnel: { emit() {}, setTarget() {}, active: false },
    publishReadGate: new PublishReadGate(),
  });
  return { h, posts, history, runtime, calls, runSdkCoach, SdkUnavailableError, BrowserControl, root, vscode };
}

// Completion is the UI's permission to submit its queued follow-up. Hold each
// real host persistence boundary to catch a reply that is displayed too early.
test('queued follow-up becomes ready only after history and observations settle', async t => {
  for (const runtimeMode of ['proxy', 'agent-sdk']) {
    const f = fixture(t, { runtimeMode, resolvedProfile: { ...copy(profile), coach_runtime: runtimeMode } });
    let releaseSave, enteredSave, releaseObservations;
    const saving = new Promise(resolve => { enteredSave = resolve; });
    const saved = new Promise(resolve => { releaseSave = resolve; });
    f.h.observationWrites = new Promise(resolve => { releaseObservations = resolve; });
    const appendHistory = f.h.appendHistory;
    f.h.appendHistory = async items => { enteredSave(); await saved; await appendHistory(items); };
    const post = f.h.post;
    f.h.post = async event => {
      if (event.type === 'streamEnd') assert.equal(f.h.hasActiveStream(), false, 'completion must allow the next request');
      return post(event);
    };
    const pending = f.h.handleMessage({ type: 'sendMessage', text: '일정을 정리해줘', history: [], toolMode: 'auto' });
    await saving;
    assert.equal(f.posts.some(event => event.type === 'streamEnd'), false, 'history write is still pending');
    releaseSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.posts.some(event => event.type === 'streamEnd'), false, 'observation write is still pending');
    releaseObservations();
    await pending;
    assert.equal(f.posts.filter(event => event.type === 'streamEnd').length, 1);
    assert.equal(f.posts.some(event => event.type === 'streamError'), false);
    assert.equal(f.h.hasActiveStream(), false);
    assert.equal(f.calls.network, 0);
  }
});

test('Stop during final persistence does not later announce a successful completion', async t => {
  const f = fixture(t);
  let releaseObservations, saved;
  f.h.observationWrites = new Promise(resolve => { releaseObservations = resolve; });
  const historySaved = new Promise(resolve => { saved = resolve; });
  const appendHistory = f.h.appendHistory;
  f.h.appendHistory = async items => { await appendHistory(items); saved(); };
  const pending = f.h.handleMessage({ type: 'sendMessage', text: '작업 정리', history: [], toolMode: 'auto' });
  await historySaved;
  await new Promise(resolve => setImmediate(resolve));
  for (const controller of f.h.activeStreams.values()) controller.abort();
  releaseObservations();
  await pending;
  assert.equal(f.posts.some(event => event.type === 'streamEnd'), false);
  assert.equal(f.h.hasActiveStream(), false);
});

const browserOnlyText = '웹브라우저를 열어줘봐 옆에';
const authoredPageText = '새 웹페이지를 만들어줘';
const generatedHtml = '<!doctype html><html><head><title>Fixture page</title></head><body><h1>Generated fixture</h1></body></html>';
const htmlFence = '```html\n' + generatedHtml + '\n```';

// Keep the actual revealBuilt/saveGameToWorkspace methods. Only VS Code I/O and
// native preview presentation are substituted; writes reach a real temporary file.
function workspacePreview(f) {
  const reveals = [], shown = [], written = [], index = path.join(f.root, 'index.html');
  fs.writeFileSync(index, 'PRESERVE EXISTING WORK');
  f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: f.root } }];
  f.vscode.workspace.fs = {
    readFile: uri => fs.promises.readFile(uri.fsPath),
    writeFile: async (uri, bytes) => { written.push(uri.fsPath); await fs.promises.writeFile(uri.fsPath, bytes); },
  };
  f.vscode.Uri.joinPath = (uri, name) => ({ fsPath: path.join(uri.fsPath, name) });
  f.h.resolveCoachCwd = () => f.root;
  f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: f.root } }];
  f.h.emitArtifactChanged = () => {};
  f.h.isLiveServerPreview = () => false;
  f.h.preview = { show: async html => { shown.push(html); } };
  const reveal = f.h.revealBuilt.bind(f.h);
  f.h.revealBuilt = (...args) => { const running = reveal(...args); reveals.push(running); return running; };
  return { reveals, shown, written, index };
}

test('browser-only streamed HTML cannot overwrite a page or save instructions; explicit authoring still reveals', async t => {
  for (const [text, browserOnly] of [[browserOnlyText, true], [authoredPageText, false]]) {
    const f = fixture(t), page = workspacePreview(f), agentSaves = [];
    delete f.h.buildBrowserMcpHost;
    f.h.siteCheckTabs = new Set();
    f.h.saveAgentMdIfPresent = async text => { agentSaves.push(text); };
    f.runtime.sdk = async args => {
      f.calls.sdk.push(args);
      assert.equal(args.browserHost.generalBrowserRequest, browserOnly, 'original user intent reaches the real per-turn host');
      args.onDelta(htmlFence + '\n```agent.md\nUnexpected instructions\n```');
      return { kind: 'success' };
    };
    await f.h.handleMessage({ type: 'sendMessage', text, history: [], toolMode: 'auto', userMessageId: 'html-turn' });
    await Promise.all(page.reveals);
    assert.equal(f.calls.sdk.length, 1);
    assert.equal(f.posts.some(event => event.type === 'streamError'), false);
    assert.equal(page.reveals.length, browserOnly ? 0 : 1, text);
    assert.equal(page.shown.length, browserOnly ? 0 : 1, text);
    assert.equal(page.written.length, browserOnly ? 0 : 1, text);
    assert.equal(fs.readFileSync(page.index, 'utf8'), browserOnly ? 'PRESERVE EXISTING WORK' : generatedHtml, text);
    assert.equal(agentSaves.length, browserOnly ? 0 : 1, 'browser-only turns cannot persist model-authored instructions');
    assert.equal(f.calls.network, 0);
  }
});

test('browser-only successful HTML Write events cannot trigger delayed preview; explicit authoring still does', async t => {
  for (const [text, browserOnly] of [[browserOnlyText, true], [authoredPageText, false]]) {
    const f = fixture(t), page = workspacePreview(f), authored = path.join(f.root, 'page.html');
    const delayedReveals = [], revealWritten = f.h.revealWrittenHtml.bind(f.h);
    f.h.revealWrittenHtml = (...args) => { const running = revealWritten(...args); delayedReveals.push(running); return running; };
    fs.writeFileSync(authored, generatedHtml);
    t.after(() => clearTimeout(f.h.revealTimer));
    f.runtime.sdk = async args => {
      f.calls.sdk.push(args);
      // An observed success event must not itself authorize another preview/write.
      args.onActivity({ kind: 'tool_use', id: 'html-write', name: 'Write', input: { file_path: authored, content: generatedHtml } });
      args.onActivity({ kind: 'tool_result', id: 'html-write', isError: false });
      return { kind: 'success' };
    };
    await f.h.handleMessage({ type: 'sendMessage', text, history: [], toolMode: 'auto', userMessageId: 'write-turn' });
    await new Promise(resolve => setTimeout(resolve, 1050));
    await Promise.all(delayedReveals);
    await Promise.all(page.reveals);
    assert.equal(f.calls.sdk.length, 1);
    assert.equal(f.posts.some(event => event.type === 'streamError'), false);
    assert.equal(delayedReveals.length, browserOnly ? 0 : 1, text);
    assert.equal(page.reveals.length, browserOnly ? 0 : 1, text);
    assert.equal(page.shown.length, browserOnly ? 0 : 1, text);
    assert.equal(page.written.length, browserOnly ? 0 : 1, text);
    assert.equal(fs.readFileSync(page.index, 'utf8'), browserOnly ? 'PRESERVE EXISTING WORK' : generatedHtml, text);
    assert.equal(f.calls.network, 0);
  }
});

test('browser-only proxy loop cannot reveal HTML, invent a destination, or retarget blank navigation', async t => {
  for (const [text, browserOnly] of [[browserOnlyText, true], [authoredPageText, false]]) {
    const f = fixture(t, { runtimeMode: 'proxy', resolvedProfile: { ...copy(profile), coach_runtime: 'proxy', browser_control: { enabled: true, max_iterations: 2 } } });
    const page = workspacePreview(f), executed = [], retargeted = [];
    // Exercise the real loop and its policy, with the native CDP action boundary scripted.
    f.BrowserControl.prototype.execute = async call => { executed.push(copy(call)); return { isError: false, content: [{ type: 'text', text: 'Fixture browser result' }] }; };
    f.h.liveServer.currentUrl = () => 'http://127.0.0.1:50123/';
    const retarget = f.h.retargetLoopbackNavigation.bind(f.h);
    f.h.retargetLoopbackNavigation = call => { retargeted.push(copy(call)); return retarget(call); };
    f.runtime.proxy = async args => {
      f.calls.proxy.push(args);
      if (f.calls.proxy.length === 1) return { text: htmlFence, toolUses: [
        { id: 'blank', name: 'browser_navigate', input: {} },
        { id: 'invented', name: 'browser_navigate', input: { url: 'http://localhost:3000/' } },
        { id: 'click', name: 'browser_click', input: { ref: 'e1' } },
      ] };
      args.onDelta('브라우저 요청을 처리했습니다.');
      return { text: '브라우저 요청을 처리했습니다.', toolUses: [] };
    };
    await f.h.handleMessage({ type: 'sendMessage', text, history: [], toolMode: 'auto', userMessageId: 'proxy-turn' });
    await Promise.all(page.reveals);
    assert.equal(f.calls.proxy.length, 2);
    assert.equal(f.posts.some(event => event.type === 'streamError'), false);
    assert.deepEqual(executed.map(call => call.id), browserOnly ? ['blank'] : ['blank', 'invented', 'click']);
    if (browserOnly) assert.equal(executed[0].input.url, 'about:blank');
    else assert.equal(executed.find(call => call.id === 'invented').input.url, 'http://127.0.0.1:50123/');
    assert.equal(retargeted.length, browserOnly ? 0 : 3);
    assert.equal(page.reveals.length, browserOnly ? 0 : 1);
    assert.equal(page.shown.length, browserOnly ? 0 : 1);
    assert.equal(fs.readFileSync(page.index, 'utf8'), browserOnly ? 'PRESERVE EXISTING WORK' : generatedHtml);
    const results = f.calls.proxy[1].toolTurns.at(-1).content;
    assert.deepEqual(copy(results.map(result => [result.tool_use_id, Boolean(result.is_error)])), [['blank', false], ['invented', browserOnly], ['click', browserOnly]]);
    assert.equal(f.calls.sdk.length + f.calls.network, 0);
  }
});

test('browser-only SDK turn denies file, shell, delegation and invented URLs before approval while preserving blank-browser gates', async t => {
  for (const browserOnly of [true, false]) {
    const f = fixture(t), approvals = [], decisions = [], target = path.join(f.root, 'index.html');
    fs.writeFileSync(target, 'PRESERVE EXISTING WORK');
    const attempts = [
      ['Write', { file_path: target, content: generatedHtml }],
      ['Bash', { command: 'printf fixture > index.html' }],
      ['Agent', { subagent_type: '리서처', prompt: 'Review the page' }],
      [MCP_LIVE_PREVIEW_START, {}],
      [MCP_BROWSER_OPEN, { url: 'https://invented.example/' }],
      [MCP_BROWSER_OPEN, {}],
    ];
    const sdk = {
      tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }),
      createSdkMcpServer: options => options,
      query: args => (async function* () {
        for (const [name, input] of attempts) {
          const result = await args.options.canUseTool(name, input, { toolUseID: `attempt-${decisions.length}` });
          decisions.push([name, result.behavior]);
          if (name === 'Write' && result.behavior === 'allow') fs.writeFileSync(target, input.content);
        }
        yield { type: 'result', subtype: 'success', is_error: false };
      })(),
    };
    const args = { sdk, zod: require('zod'), binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'test', model: 'fixture',
      profile: { ...copy(profile), sdk_tools: { ...profile.sdk_tools, shell: true } }, systemPrompt: '', history: [], cwd: f.root,
      userText: browserOnly ? browserOnlyText : authoredPageText, toolMode: 'auto', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta() {},
      requestApproval: async action => { approvals.push(action.toolName); return true; },
      browserHost: { generalBrowserRequest: browserOnly, livePreviewUrl: async () => undefined },
    };
    await f.runSdkCoach(args);
    if (browserOnly) {
      assert.deepEqual(decisions, attempts.map(([name], i) => [name, i === attempts.length - 1 ? 'allow' : 'deny']));
      assert.deepEqual(approvals, [MCP_BROWSER_OPEN], 'disallowed effects never reach an approval prompt');
      assert.equal(fs.readFileSync(target, 'utf8'), 'PRESERVE EXISTING WORK');
    } else {
      assert.equal(decisions[0][1], 'allow', 'explicit authoring retains granted writes');
      assert.equal(decisions[1][1], 'allow', 'explicit authoring retains granted shell approval');
      assert.equal(decisions[2][1], 'allow', 'explicit authoring retains granted delegation');
      assert.ok(approvals.includes('Write') && approvals.includes('Bash'));
      assert.equal(fs.readFileSync(target, 'utf8'), generatedHtml);
    }
    for (const [granted, approved] of [[false, true], [true, false]]) {
      let asked = 0, admission;
      await f.runSdkCoach({ ...args, profile: { ...args.profile, sdk_tools: { browser: granted } }, browserHost: { ...args.browserHost, generalBrowserRequest: true },
        requestApproval: async () => { asked++; return approved; },
        sdk: { ...sdk, query: options => (async function* () { admission = await options.options.canUseTool(MCP_BROWSER_OPEN, {}, { toolUseID: 'blank-control' }); yield { type: 'result', subtype: 'success', is_error: false }; })() },
      });
      assert.equal(admission.behavior, 'deny', 'a blank browser still needs both grant and approval');
      assert.equal(asked, granted ? 1 : 0);
    }
    assert.equal(f.calls.network, 0);
  }
});

test('actual provider refuses unavailable search before model, observation, or input context consumption', async t => {
  const cases = [
    { runtimeMode: 'proxy', resolvedProfile: { ...profile, coach_runtime: 'proxy' } },
    { resolvedProfile: { ...profile, tools: {} } },
    { choice: { id: 'budget', allowed: { features: ['read', 'browser'] } } },
    { local: true }, { instructor: true },
  ];
  for (const options of cases) {
    const f = fixture(t, options); f.h.pendingPageContext = 'Keep this unsent context';
    await f.h.handleMessage({ type: 'sendMessage', text: 'Find source', history: [], toolMode: 'web-search', userMessageId: 'user-1' });
    assert.equal(f.calls.sdk.length + f.calls.proxy.length + f.calls.network + f.calls.observation, 0);
    assert.equal(f.h.pendingPageContext, 'Keep this unsent context');
    assert.deepEqual(f.posts.find(event => event.type === 'inputRejected'), { type: 'inputRejected', text: 'Find source', toolMode: 'web-search' });
    assert.ok(f.posts.some(event => event.type === 'streamError' && /웹 검색/.test(event.error)));
    assert.equal(f.h.pendingSends, 0);
  }
  assert.equal(turnToolsAvailability({ profile, runtime: 'agent-sdk' }).webSearch.available, true);
});

test('actual provider snapshots mode and user ID, rejects duplicate dispatch, and retries original metadata', async t => {
  const f = fixture(t);
  await f.h.handleMessage({ type: 'sendMessage', text: 'Find source', history: [], toolMode: 'web-search', userMessageId: 'user-search' });
  assert.equal(f.calls.sdk.length, 1); assert.equal(f.calls.sdk[0].toolMode, 'web-search');
  assert.equal(f.history.find(item => item.id === 'user-search')?.toolMode, 'web-search');
  assert.ok(f.posts.some(event => event.type === 'toolLog' && /웹 검색을 실행하지 않았습니다/.test(event.label)), 'model text alone is not search evidence');
  await f.h.handleMessage({ type: 'sendMessage', text: 'Find source', history: [], toolMode: 'web-search', userMessageId: 'user-search' });
  assert.equal(f.calls.sdk.length, 1, 'same message ID cannot dispatch twice');
  await f.h.handleMessage({ type: 'retryMessage', prompt: 'Find source', history: [], sourceMessageId: 'user-search', userMessageId: 'retry-1' });
  assert.equal(f.calls.sdk.length, 2); assert.equal(f.calls.sdk[1].toolMode, 'web-search');
  await f.h.handleMessage({ type: 'retryMessage', prompt: 'Find source', history: [], sourceMessageId: 'user-search', toolMode: 'auto' });
  assert.equal(f.calls.sdk.length, 2, 'current draft mode cannot replace original retry mode');
  f.h.nativeHistoryScope = 'task-b'; f.history.length = 0;
  await f.h.handleMessage({ type: 'retryMessage', prompt: 'Find source', history: [], sourceMessageId: 'user-search' });
  assert.equal(f.calls.sdk.length, 2, 'old task pending snapshots cannot be borrowed');
});

test('missing SDK never falls back for explicit search; legacy auto still falls back once', async t => {
  for (const mode of ['web-search', 'auto']) {
    const f = fixture(t); f.runtime.sdk = async args => { f.calls.sdk.push(args); throw new f.SdkUnavailableError('synthetic missing SDK'); };
    await f.h.handleMessage({ type: 'sendMessage', text: 'Question', history: [], toolMode: mode, userMessageId: 'missing-sdk' });
    assert.equal(f.calls.sdk.length, 1);
    assert.equal(f.calls.proxy.length, mode === 'auto' ? 1 : 0);
    if (mode === 'web-search') assert.ok(f.history.some(m => m.tool?.label.startsWith('[앱 버전/환경]')), 'runtime refusal persists');
    if (mode === 'web-search') {
      assert.equal(f.posts.find(event => event.type === 'inputRejected')?.toolMode, 'web-search');
      assert.ok(f.posts.some(event => event.type === 'streamError' && /웹 검색 실행 환경/.test(event.error)));
      assert.equal(f.h.activeStreams.size, 0);
      f.runtime.sdk = async args => { f.calls.sdk.push(args); return { kind: 'success' }; };
      await f.h.handleMessage({ type: 'retryMessage', prompt: 'Question', history: [], sourceMessageId: 'missing-sdk', userMessageId: 'missing-sdk' });
      assert.equal(f.calls.sdk[1].toolMode, 'web-search', 'failed, unpersisted turn retains its original request');
    }
    assert.equal(f.calls.network, 0);
  }
});

test('actual provider treats instructor Stop as a stop in both modes, while an ordinary failure stays visible', async t => {
  for (const mode of ['auto', 'web-search']) for (const stopped of [false, true]) {
    const f = fixture(t); f.h.pendingApprovals = new Map();
    f.runtime.sdk = async args => {
      f.calls.sdk.push(args);
      if (stopped) f.h.opsRequestStop();
      // A stopped SDK may throw an ordinary error rather than AbortError.
      throw new Error('synthetic runtime failure');
    };
    await f.h.handleMessage({ type: 'sendMessage', text: 'Question', history: [], toolMode: mode, userMessageId: 'stop-control' });
    assert.equal(f.calls.sdk.length, 1);
    assert.equal(f.posts.some(event => event.type === 'streamStopped' && event.by === 'instructor'), stopped);
    assert.equal(f.posts.some(event => event.type === 'streamError'), !stopped);
    assert.equal(f.posts.some(event => event.type === 'inputRejected'), !stopped && mode === 'web-search');
    assert.equal(f.h.activeStreams.size, 0); assert.equal(f.h.pendingSends, 0);
    assert.equal(f.calls.proxy.length + f.calls.network, 0);
  }
});

test('real SDK request narrows tools and preserves approval; observed typed result reaches citations', async t => {
  const f = fixture(t), citations = [], approvals = [], captured = [];
  const events = [toolUse('web-1'), toolResult('web-1', searchOutput()), { type: 'result', subtype: 'success', is_error: false }];
  const sdk = { query: args => { captured.push(args); return (async function* () {
    assert.equal((await args.options.canUseTool('Write', { file_path: '/tmp/no-write', content: 'x' }, { toolUseID: 'write-1' })).behavior, 'deny');
    assert.equal((await args.options.canUseTool('WebSearch', { query: 'source question' }, { toolUseID: 'web-1' })).behavior, 'allow');
    for (const event of events) yield event;
  })(); } };
  const args = { sdk, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'test', model: 'fixture', profile: { ...copy(profile), game: { template_tier: 'website' } }, systemPrompt: '', history: [], userText: 'source question', toolMode: 'web-search', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta() {}, onCitations: values => citations.push(...values), requestApproval: async action => { approvals.push(action); return true; }, browserHost: {} };
  await f.runSdkCoach(args);
  assert.deepEqual(copy(captured[0].options.tools), ['WebSearch', 'WebFetch']);
  assert.deepEqual(copy(captured[0].options.allowedTools), []);
  assert.equal(captured[0].options.agents, undefined); assert.equal(captured[0].options.mcpServers, undefined);
  assert.match(captured[0].prompt, /이번 요청의 도구 선택: 웹 검색/);
  assert.equal(approvals.length, 1); assert.equal(approvals[0].toolName, 'WebSearch');
  assert.deepEqual(copy(citations), [{ url: 'https://example.test/reference', title: 'Observed search hit', domain: 'example.test', tier: 4, kind: 'web' }]);
  await assert.rejects(f.runSdkCoach({ ...args, profile: { ...profile, tools: {} } }), /웹 검색/);
  assert.equal(captured.length, 1, 'grant denial happens before SDK query');
  const control = [];
  await f.runSdkCoach({ ...args, toolMode: 'auto', profile: { ...profile, sdk_tools: { read: true } }, sdk: { query: value => { control.push(value); return (async function* () { yield { type: 'result', subtype: 'success', is_error: false }; })(); } } });
  assert.ok(control[0].options.tools.includes('Read')); assert.equal(control[0].prompt, 'source question');
});

test('typed citation extraction rejects prose, mismatched/error calls and unsafe URLs; fetch and dedupe work', () => {
  const positive = new SdkWebCitations(['WebSearch', 'WebFetch']);
  positive.observe(toolUse('a')); const searchCitations = positive.observe(toolResult('a', searchOutput())); assert.equal(searchCitations.length, 1); assert.equal(searchCitations[0].kind, 'web', 'matched WebSearch event supplies the kind');
  positive.observe(toolUse('b')); assert.deepEqual(positive.observe(toolResult('b', searchOutput())), []);
  const fetched = { bytes: 10, code: 200, codeText: 'OK', result: 'Read page', durationMs: 10, url: 'https://official.test/doc' };
  positive.observe(toolUse('f', 'WebFetch', { url: fetched.url, prompt: 'read' }));
  assert.deepEqual(positive.observe(toolResult('f', fetched)), [{ url: fetched.url, title: 'official.test', domain: 'official.test', tier: 4, kind: 'web' }]);
  for (const [name, prepare, result] of [
    ['unknown id', c => c.observe(toolUse('known')), toolResult('other', searchOutput())],
    ['error result', c => c.observe(toolUse('a')), toolResult('a', searchOutput(), true)],
    ['denied approval', c => { c.observe(toolUse('a')); c.deny('a'); }, toolResult('a', searchOutput())],
    ['model prose', c => c.observe(toolUse('a')), toolResult('a', 'https://invented.test/source')],
    ['credentials', c => c.observe(toolUse('a')), toolResult('a', searchOutput('https://user:pass@example.test/'))],
    ['wrong scheme', c => c.observe(toolUse('a')), toolResult('a', searchOutput('javascript:alert(1)'))],
    ['wrong query', c => c.observe(toolUse('a')), toolResult('a', { ...searchOutput(), query: 'another query' })],
    ['fetch failure', c => c.observe(toolUse('f', 'WebFetch', {})), toolResult('f', { ...fetched, code: 500 })],
  ]) { const c = new SdkWebCitations(['WebSearch', 'WebFetch']); prepare(c); assert.deepEqual(c.observe(result), [], name); }
  const noGrant = new SdkWebCitations([]); noGrant.observe(toolUse('a')); assert.deepEqual(noGrant.observe(toolResult('a', searchOutput())), []);
  const failed = new SdkWebCitations(['WebSearch']); failed.observe(toolUse('failed'));
  assert.deepEqual(failed.observe(toolResult('failed', searchOutput(), true)), []);
  assert.deepEqual(failed.observe(toolResult('failed', searchOutput())), [], 'a later replay cannot turn a failed operation into sources');
});

test('actual provider and SDK preserve typed citations and selected mode through the real disk store', async t => {
  const f = fixture(t), store = new TaskWorkspaceStore(f.root, 'typed-source-task'); await store.initialize();
  f.h.currentTaskStore = () => store;
  delete f.h.getHistory; delete f.h.appendHistory;
  f.h.resolveActionApproval = async () => true;
  const sdk = { query: args => (async function* () {
    yield toolUse('bound-source');
    assert.equal((await args.options.canUseTool('WebSearch', { query: 'source question' }, { toolUseID: 'bound-source' })).behavior, 'allow');
    yield toolResult('bound-source', searchOutput());
    yield { type: 'assistant', message: { content: [{ type: 'text', text: '출처를 확인했습니다.' }] } };
    yield { type: 'result', subtype: 'success', is_error: false };
  })() };
  f.runtime.sdk = args => f.runSdkCoach({ ...args, sdk, binaryResolution: { available: true, reasons: [] }, stallTimeoutMs: 0 });
  await f.h.handleMessage({ type: 'sendMessage', taskId: store.getView().activeTaskId, userMessageId: 'durable-search', text: 'source question', history: [], toolMode: 'web-search' });
  const reopened = new TaskWorkspaceStore(f.root, 'typed-source-task');
  assert.equal(reopened.getHistory().find(message => message.id === 'durable-search')?.toolMode, 'web-search');
  assert.deepEqual(reopened.getHistory().flatMap(message => message.citations ?? []), [{ url: 'https://example.test/reference', title: 'Observed search hit', domain: 'example.test', tier: 4, kind: 'web' }]);
  assert.ok(reopened.getHistory().some(message => message.role === 'tool' && message.tool.state === 'done'));
  assert.equal(f.posts.some(event => event.type === 'toolLog' && /확인된 웹 출처가 없습니다/.test(event.label)), false);
  assert.equal(f.calls.network, 0);
});

test('durable draft, paused queue and user mode survive restart without accepting invalid metadata', async t => {
  const root = temporary(t), store = new TaskWorkspaceStore(root, 'scope'); await store.initialize();
  const id = store.getView().activeTaskId, draft = { text: 'New draft', images: [], queued: 'Recovered search', toolMode: 'auto', queuedToolMode: 'web-search', queuedPaused: true };
  await store.saveDraft(id, draft);
  await store.append(id, [{ id: 'search-user', role: 'user', content: 'Search question', createdAt: 1, toolMode: 'web-search' }]);
  const reopened = new TaskWorkspaceStore(root, 'scope');
  assert.deepEqual(reopened.getDraft(), draft); assert.equal(reopened.getHistory()[0].toolMode, 'web-search');
  assert.equal(retryTurnToolMode(reopened.getHistory(), { sourceMessageId: 'search-user', prompt: 'Search question' }), 'web-search');
  const before = fs.readFileSync(store.filePath, 'utf8');
  await assert.rejects(reopened.saveDraft(id, { ...draft, toolMode: 'force-all-tools' }));
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), before);
  assert.equal(validActivityDraft({ text: '', images: [], queued: null }), true);
  assert.equal(validActivityDraft({ ...draft, queued: null }), false);
  assert.notDeepEqual(preservedDraftContent(draft), preservedDraftContent({ text: 'Recovered search\nNew draft', images: [], queued: null, toolMode: 'auto' }), 'merging differently selected requests loses intent');
  assert.deepEqual(preservedDraftContent({ ...draft, toolMode: 'web-search' }), preservedDraftContent({ text: 'Recovered search\nNew draft', images: [], queued: null, toolMode: 'web-search' }));
});

test('recovered requests retain their own text, tool mode and photos across disk reopen', async t => {
  const root=temporary(t),store=new TaskWorkspaceStore(root,'recovered');await store.initialize();
  const id=store.getView().activeTaskId;
  const recovered=[{text:'Failed search A',toolMode:'web-search',images:['data:image/png;base64,c3ludGhldGlj']}];
  const draft={text:'Next draft D',images:[],queued:'Queued C',queuedPaused:true,toolMode:'auto',queuedToolMode:'auto',recovered};
  await store.saveDraft(id,draft);
  const reopened=new TaskWorkspaceStore(root,'recovered');assert.deepEqual(reopened.getDraft(),draft);
  assert.notDeepEqual(preservedDraftContent(draft),preservedDraftContent({...draft,recovered:[]}), 'recovery text participates in preservation checks');
  const before=fs.readFileSync(store.filePath,'utf8');
  for(const bad of [{...recovered[0],toolMode:'force-all-tools'},{...recovered[0],images:['https://untrusted.test/photo']},{...recovered[0],text:42},{...recovered[0],credential:'forbidden'}]){
    await assert.rejects(reopened.saveDraft(id,{...draft,recovered:[bad]}));
    assert.equal(fs.readFileSync(store.filePath,'utf8'),before);
  }
});

test('actual events distinguish success, failure and no search without reading model claims', () => {
  const observed = new WebSearchActivity();
  assert.match(observed.completion(0).label, /실행하지 않았습니다/);
  observed.observe({ kind: 'tool_use', id: 'search', name: 'WebSearch' });
  observed.observe({ kind: 'approval', id: 'search', name: 'WebSearch', allowed: false });
  observed.observe({ kind: 'tool_result', id: 'search', isError: false });
  assert.equal(observed.completion(0).state, 'error');
  observed.observe({ kind: 'tool_use', id: 'fetch', name: 'WebFetch' });
  observed.observe({ kind: 'tool_result', id: 'fetch', isError: false });
  assert.match(observed.completion(0).label, /출처 링크를 받지 못했습니다/);
  assert.equal(observed.completion(1), null);
});

// CGP-AGENT-D-007 fix round 1: the provider turn itself must hand every runtime the refusal
// callback, and the callback must reach the webview as one `streamRefusal` for that turn's stream.
for (const [runtimeMode, key] of [['agent-sdk', 'sdk'], ['proxy', 'proxy']]) {
  test(`real ${runtimeMode} provider turn passes onRefusal and posts one streamRefusal for its stream`, async t => {
    const f = fixture(t, { runtimeMode, resolvedProfile: { ...copy(profile), coach_runtime: runtimeMode } });
    f.runtime[key] = async args => {
      f.calls[key].push(args);
      assert.equal(typeof args.onRefusal, 'function', `${key} call receives onRefusal`);
      args.onRefusal(); args.onRefusal();
      return key === 'sdk' ? { kind: 'success' } : { text: '', toolUses: [] };
    };
    await f.h.handleMessage({ type: 'sendMessage', text: '요청', history: [], toolMode: 'auto', userMessageId: `refusal-${key}` });
    assert.equal(f.calls[key].length, 1);
    const start = f.posts.find(p => p.type === 'streamStart');
    assert.ok(start?.streamId, 'the turn announced its stream');
    const refusals = f.posts.filter(p => p.type === 'streamRefusal');
    assert.equal(refusals.length, 1, 'a repeated runtime signal shows one banner');
    assert.equal(refusals[0].streamId, start.streamId, 'the banner belongs to this turn');
    assert.deepEqual(Object.keys(refusals[0]).sort(), ['streamId', 'type'], 'no model text rides along');
  });
}

test('provider refusal notice is dropped after Stop and after the turn settled', async t => {
  const f = fixture(t);
  let late;
  f.runtime.sdk = async args => { f.calls.sdk.push(args); late = args.onRefusal; return { kind: 'success' }; };
  await f.h.handleMessage({ type: 'sendMessage', text: '요청', history: [], toolMode: 'auto', userMessageId: 'refusal-late' });
  late();
  assert.equal(f.posts.filter(p => p.type === 'streamRefusal').length, 0, 'a settled turn never raises a banner');
  const g = fixture(t);
  g.runtime.sdk = async args => { g.calls.sdk.push(args); for (const c of g.h.activeStreams.values()) c.abort(); args.onRefusal(); return { kind: 'success' }; };
  await g.h.handleMessage({ type: 'sendMessage', text: '요청', history: [], toolMode: 'auto', userMessageId: 'refusal-stop' });
  assert.equal(g.posts.filter(p => p.type === 'streamRefusal').length, 0, 'a stopped turn never raises a banner');
});

// CGP-AGENT-D-006: real send path, not a rendering-only fixture.
test('denial rows survive summary mode, raw runtime errors, and a turn that fails without an answer', async t => {
  const { storedDenialNotice } = await import('../src/denialNotice.ts');
  for (const mode of ['summary', 'detailed']) for (const fails of [false, true]) {
    const f = fixture(t, { resolvedProfile: { ...copy(profile), tool_activity: mode } });
    f.runtime.sdk = async args => {
      args.onActivity({ kind: 'tool_use', id: 'denied-write', name: 'Write', input: { file_path: 'work.txt' } });
      args.onActivity({ kind: 'approval', id: 'denied-write', name: 'Write', input: {}, actor: 'policy', allowed: false, denialSource: 'safety' });
      args.onActivity({ kind: 'tool_result', id: 'denied-write', isError: true, reason: 'SECRET_TOKEN\nError: raw\n at /private/path:8' });
      args.onActivity({ kind: 'tool_result', id: 'legacy-local', isError: true, reason: '[폴더 권한] SECRET_TOKEN' });
      args.onActivity({ kind: 'tool_result', id: 'failed-runtime', isError: true, reason: 'Bearer PRIVATE_KEY\u202e<script>bad()</script>' });
      if (fails) throw new Error('synthetic transport failed');
      args.onDelta('다른 질문을 기다려요.');
      return { kind: 'success' };
    };
    await f.h.handleMessage({ type: 'sendMessage', text: '작업을 확인해줘', history: [], toolMode: 'auto', userMessageId: `denial-${mode}-${fails}` });
    const rows = f.history.filter(m => m.tool && storedDenialNotice(m.tool.label));
    assert.equal(rows.length, 3, `${mode}, failure=${fails}: persisted notices`);
    assert.equal(storedDenialNotice(rows.find(m => m.id === 'legacy-local').tool.label).source, 'folder');
    assert.equal(storedDenialNotice(rows.find(m => m.id === 'denied-write').tool.label).source, 'safety');
    assert.equal(storedDenialNotice(rows.find(m => m.id === 'failed-runtime').tool.label).source, 'unknown');
    for (const row of rows) assert.deepEqual(Object.keys(row.tool).sort(), ['icon', 'label', 'state'], 'old task file schema');
    const shown = JSON.stringify(f.posts.filter(m => m.type === 'toolLog'));
    assert.doesNotMatch(shown, /SECRET_TOKEN|PRIVATE_KEY|private\/path|<script>|Error: raw/);
    assert.equal(f.calls.network, 0);
  }
});

test('disabled notices persist to captured task, reopen, serialize concurrent notices, and stay off a newly selected task', async t => {
  const { storedDenialNotice } = await import('../src/denialNotice.ts');
  const f = fixture(t), store = new TaskWorkspaceStore(f.root, 'denial-activity');
  await store.initialize();
  const taskA = store.getView().activeTaskId;
  f.h.currentTaskStore = () => store;
  await Promise.all([f.h.postDenialNotice('lesson'), f.h.postDenialNotice('runtime')]);
  let reopened = new TaskWorkspaceStore(f.root, 'denial-activity');
  assert.equal(reopened.getHistory(taskA).filter(m => storedDenialNotice(m.tool?.label)).length, 2);
  let release, entered;
  const gate = new Promise(r => { release = r; }), saving = new Promise(r => { entered = r; });
  const append = store.appendDenial.bind(store);
  store.appendDenial = async (...args) => { entered(); await gate; return append(...args); };
  const pending = f.h.postDenialNotice('safety');
  await saving;
  const queued = f.h.postDenialNotice("folder");
  await store.create("B", { taskId: store.getView().activeTaskId, revision: store.getView().revision });
  const taskB = store.getView().activeTaskId;
  const before = f.posts.length;
  release(); await pending; await queued;
  assert.equal(f.posts.length, before, 'late notice must not render in task B');
  reopened = new TaskWorkspaceStore(f.root, 'denial-activity');
  assert.equal(reopened.getHistory(taskA).filter(m => storedDenialNotice(m.tool?.label)).length, 4);
  assert.equal(reopened.getHistory(taskB).length, 0);
  store.appendDenial = async () => { throw Error('token-in-storage-error'); };
  await f.h.postDenialNotice('folder');
  assert.match(f.posts.at(-1).error, /저장하지 못했어요/);
  assert.doesNotMatch(JSON.stringify(f.posts), /token-in-storage-error/);
});

test('denial store rejects arbitrary messages, deduplicates, and merges two windows without changing task selection', async t => {
  const { denialNotice, denialNoticeLabel } = await import('../src/denialNotice.ts');
  const root = temporary(t), a = new TaskWorkspaceStore(root, 'notice-lock'); await a.initialize();
  const b = new TaskWorkspaceStore(root, 'notice-lock'), taskId = a.getView().activeTaskId;
  const row = { id: 'n1', role: 'tool', content: '', createdAt: 1, tool: { icon: '🔒', state: 'error', label: denialNoticeLabel(denialNotice('safety')) } };
  for (const bad of [{ ...row, id: '' }, { ...row, role: 'assistant' }, { ...row, content: 'raw token' }, { ...row, tool: { ...row.tool, state: 'done' } }, { ...row, tool: { ...row.tool, label: '[안전 규칙] raw token' } }])
    await assert.rejects(a.appendDenial(taskId, bad), e => e.code === 'invalid');
  const concurrent = await Promise.allSettled([a.appendDenial(taskId, row), b.appendDenial(taskId, { ...row, id: 'n2' })]);
  for (const result of concurrent) if (result.status === 'rejected') assert.ok(['locked', 'stale'].includes(result.reason.code), 'existing lock/revision check fails closed');
  // Retry the same IDs after the lock is released; no overwrite or duplicate.
  await new TaskWorkspaceStore(root, 'notice-lock').appendDenial(taskId, row);
  await new TaskWorkspaceStore(root, 'notice-lock').appendDenial(taskId, { ...row, id: 'n2' });
  await new TaskWorkspaceStore(root, 'notice-lock').appendDenial(taskId, row);
  const reopened = new TaskWorkspaceStore(root, 'notice-lock');
  assert.equal(reopened.getHistory(taskId).length, 2);
  assert.equal(reopened.getView().activeTaskId, taskId);
});

test('local tool refusals before execution emit a classified activity instead of disappearing', async t => {
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const events = [], root = temporary(t);
  const tools = workspaceTools({ cwd: root, profile: { sdk_tools: { read: true } }, signal: new AbortController().signal, approve: async () => true, activity: e => events.push(e) });
  await assert.rejects(tools.call('Write', { file_path: 'not-written.txt', content: 'x' }), /수업 설정/);
  await assert.rejects(tools.call('Read', {}), /확인 안 됨/);
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.kind === 'tool_result' && e.isError));
  assert.match(events[0].reason, /^\[수업 설정\]/);
  assert.match(events[1].reason, /^\[확인 안 됨\]/);
  assert.equal(fs.existsSync(path.join(root, 'not-written.txt')), false);
});

test('real SDK denial gate emits observed policy source before a tool result exists', async t => {
  const f = fixture(t), activity = [];
  const schema = new Proxy(() => schema, { get: () => schema });
  const sdk = { createSdkMcpServer: o => o, tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }), query: args => (async function* () {
    await args.options.canUseTool('Bash', { command: 'echo safe' }, { toolUseID: 'lesson-deny' });
    await args.options.canUseTool('Write', { file_path: '/outside/work.txt', content: 'x' }, { toolUseID: 'safety-deny' });
    await args.options.canUseTool('FutureUnknownTool', {}, { toolUseID: 'runtime-deny' });
    await args.options.canUseTool('Write', { file_path: path.join(f.root, 'file.txt'), content: 'x' }, { toolUseID: 'host-deny' });
    await args.options.canUseTool(MCP_BROWSER_OPEN, { url: 'https://example.test' }, { toolUseID: 'browser-deny' });
    yield { type: 'result', subtype: 'success', is_error: false };
  })() };
  await f.runSdkCoach({ sdk, zod: schema, cwd: f.root, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'test', model: 'fixture', profile: { ...copy(profile), game: { template_tier: 'website' } }, systemPrompt: '', history: [], userText: 'check', toolMode: 'auto', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta() {}, onActivity: e => activity.push(e), requestApproval: async () => ({ approved: false, actor: 'policy', denialSource: 'folder' }), browserHost: { crEnabled: () => true, crScope: () => ({ ok: false, reason: 'outside preview' }) } });
  const denied = activity.filter(e => e.kind === 'approval' && !e.allowed);
  assert.deepEqual(denied.map(e => [e.id, e.denialSource]), [['lesson-deny', 'lesson'], ['safety-deny', 'safety'], ['runtime-deny', 'runtime'], ['host-deny', 'folder'], ['browser-deny', 'safety']]);
});

test('proxy browser refusal becomes a safe persisted notice', async t => {
  const { storedDenialNotice } = await import('../src/denialNotice.ts');
  const f = fixture(t, { runtimeMode: 'proxy', resolvedProfile: { ...copy(profile), coach_runtime: 'proxy', browser_control: { enabled: true } } });
  f.BrowserControl.prototype.execute = async () => ({ isError: true, content: [{ type: 'text', text: '[안전 규칙] Bearer PRIVATE_KEY\n at /private/file:1' }] });
  let calls = 0;
  f.runtime.proxy = async args => {
    if (++calls === 1) return { text: '', toolUses: [{ id: 'proxy-deny', name: 'browser_navigate', input: { url: 'https://example.test/' } }] };
    args.onDelta('확인했어요.'); return { text: '확인했어요.', toolUses: [] };
  };
  await f.h.handleMessage({ type: 'sendMessage', text: '사이트를 살펴봐줘', history: [], toolMode: 'auto', userMessageId: 'proxy-denied-turn' });
  const row = f.history.find(m => m.id === 'proxy-deny');
  assert.ok(row, 'proxy refusal saved');
  assert.equal(storedDenialNotice(row.tool.label)?.source, 'safety');
  assert.doesNotMatch(JSON.stringify(f.posts.filter(p => p.type === 'toolLog')), /PRIVATE_KEY|private\/file/);
});

test('legacy denial captures its history key and drops late display after principal scope changes', async t => {
  const f = fixture(t), oldKey = f.h.historyKey();
  let release, entered;
  const gate = new Promise(r => { release = r; }), writing = new Promise(r => { entered = r; });
  const update = f.h.context.workspaceState.update;
  f.h.context.workspaceState.update = async (...args) => { entered(); await gate; return update(...args); };
  const pending = f.h.postDenialNotice('lesson');
  await writing;
  const queued = f.h.postDenialNotice('safety');
  f.h.nativeHistoryScope = 'another-principal';
  release(); await pending; await queued;
  assert.equal(f.posts.length, 0);
  assert.equal(f.h.context.workspaceState.get(oldKey).length, 2);
  assert.equal(f.h.context.workspaceState.get(f.h.historyKey(), []).length, 0);
});

test('disabled feature handlers persist their lesson-source notice before returning the panel refusal', async t => {
  const { storedDenialNotice } = await import('../src/denialNotice.ts');
  for (const [method, type] of [['handlePublishMessage', 'publishOpen'], ['handleVerifyMessage', 'verifyOpen'], ['handleEvidenceMessage', 'evidenceOpen'], ['handleSkillsMessage', 'skillsOpen'], ['handleReviewMessage', 'reviewOpen'], ['handleMemoryMessage', 'memoryOpen']]) {
    const f = fixture(t);
    await f.h[method]({ type });
    const notice = f.posts.find(p => p.type === 'denialNotice');
    assert.ok(notice, method);
    assert.equal(storedDenialNotice(notice.label).source, 'lesson', method);
    assert.equal(f.h.context.workspaceState.get(f.h.historyKey()).length, 1, method);
    assert.equal(f.calls.sdk.length + f.calls.proxy.length + f.calls.network, 0);
  }
  const f = fixture(t);
  await f.h.publishTestVersion(); await f.h.denialWrites;
  assert.equal(f.posts.filter(p => p.type === 'denialNotice').length, 1, 'command route');
});

test('approval gates report authoritative source without changing the refusal or opening a modal', async t => {
  const f = fixture(t), observed = [];
  f.vscode.window.showInformationMessage = () => {};
  f.vscode.window.showWarningMessage = () => {};
  f.h.resolveCoachCwd = () => f.root;
  f.vscode.workspace.workspaceFolders = [{ uri: { fsPath: f.root } }];
  f.h.taskCommandAllowState = () => ({ key: 'task', refusal: 'read-only folder' });
  f.h.taskCommandAllows = { observe() {} };
  f.h.sitePublisher = () => ({ allowed: () => false });
  for (const [req, source] of [
    [{ kind: 'executeShell', payload: { command: 'echo x' } }, 'folder'],
    [{ kind: 'readFile', payload: { path: '/outside/file.txt' } }, 'safety'],
    [{ kind: 'writeFile', payload: { path: '/outside/file.txt' } }, 'safety'],
    [{ kind: 'publishSite', payload: {} }, 'unknown'],
  ]) {
    assert.equal(await f.h.resolveActionApprovalTracked({ requestId: 'r', ...req }, () => { throw Error('must not prompt'); }, s => observed.push(s)), false);
    assert.equal(observed.at(-1), source);
  }
  assert.equal(observed.length, 4);
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const activity = [];
  const tools = workspaceTools({ cwd: f.root, profile: copy(profile), signal: new AbortController().signal, approve: async () => ({ approved: false, actor: 'policy', denialSource: 'folder' }), activity: e => activity.push(e) });
  await assert.rejects(tools.call('Write', { file_path: 'declined.txt', content: 'x' }));
  assert.equal(activity.find(e => e.kind === 'approval').denialSource, 'folder');
  assert.equal(fs.existsSync(path.join(f.root, 'declined.txt')), false);
});

test('history reload waits for queued standalone denial persistence', async t => {
  const f = fixture(t);
  delete f.h.getHistory;
  f.h.postContextTrim = async () => {};
  f.h.postVerdicts = async () => {};
  let release, entered;
  const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  const update = f.h.context.workspaceState.update;
  f.h.context.workspaceState.update = async (...args) => { entered(); await gate; return update(...args); };
  const save = f.h.postDenialNotice('lesson');
  await started;
  const reload = f.h.postHistory();
  await new Promise(r => setImmediate(r));
  assert.equal(f.posts.filter(p => p.type === 'history').length, 0);
  release(); await save; await reload;
  assert.equal(f.posts.find(p => p.type === 'history').messages.length, 1);
});

// CGP-AGENT-D-006 fix round 1: the "lesson feature is off" refusals of the learning-wiki entry points
// each post a persisted notice. One call site each, so removing any single postDenialNotice fails here.
test('each learning-wiki entry point shows a lesson notice when the feature is off', async t => {
  const { storedDenialNotice } = await import('../src/denialNotice.ts');
  const cases = [
    ['runWikiIngest', f => f.h.runWikiIngest({ ask: false })],
    ['runDeckDraft', f => f.h.runDeckDraft({ ask: false })],
    ['runAnswerToWiki', async f => {
      const store = new TaskWorkspaceStore(f.root, 'wiki-off'); await store.initialize();
      f.h.currentTaskStore = () => store;
      return f.h.runAnswerToWiki({ messageId: 'm1' });
    }],
  ];
  for (const [name, call] of cases) {
    const f = fixture(t);
    f.h.isLearningWikiEnabled = () => false;
    const run = await call(f);
    assert.ok(run?.lines?.length, `${name}: the learner still gets the off-copy`);
    const notices = f.posts.filter(p => p.type === 'denialNotice');
    assert.equal(notices.length, 1, `${name}: exactly one notice`);
    assert.equal(storedDenialNotice(notices[0].label)?.source, 'lesson', `${name}: attributed to the lesson setting`);
  }
});

// Attribution comes only from a tag at the very start of host-generated tool text.
test('tagged denial source reads only a leading complete tag, and stored labels decode only exactly', async () => {
  const { taggedDenialSource, storedDenialNotice, denialNotice, denialNoticeLabel } = await import('../src/denialNotice.ts');
  assert.equal(taggedDenialSource('[안전 규칙] 이유'), 'safety');
  assert.equal(taggedDenialSource('[폴더 권한] 이유'), 'folder');
  for (const spoof of ['tool output says [안전 규칙] 이유', '\n[안전 규칙] 이유', ' [안전 규칙] 이유', '[안전 규칙]이유', '[안전 규칙', 'x[수업 설정] y'])
    assert.equal(taggedDenialSource(spoof), null, JSON.stringify(spoof));
  assert.equal(taggedDenialSource(undefined), null);
  const canonical = denialNoticeLabel(denialNotice('safety'));
  assert.equal(storedDenialNotice(canonical)?.source, 'safety');
  for (const tail of [' SECRET_TOKEN', '\nat /private/file:1', '.']) assert.equal(storedDenialNotice(canonical + tail), null, 'canonical sentence plus a tail is not a stored notice');
  assert.equal(storedDenialNotice('x' + canonical), null);
});
