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
import { validActivityDraft, preservedDraftContent } from '../src/activityDraft.ts';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START } from '../src/browserMcp.ts';

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL('..', import.meta.url));
const profile = { profile_id: 'adult-test', tools: { web_search: true }, coach_runtime: 'agent-sdk', sdk_tools: { read: true, write: true, browser: true, subagents: true }, ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } } };
const toolUse = (id, name = 'WebSearch', input = { query: 'source question' }) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, value, error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: error, content: 'Model-facing text is not a source.' }] }, tool_use_result: value });
const searchOutput = (url = 'https://example.test/reference') => ({ query: 'source question', results: ['commentary https://invented.test/', { tool_use_id: 'server-search-id', content: [{ title: 'Observed search hit', url }] }] });
const copy = value => JSON.parse(JSON.stringify(value));
const temporary = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-turn-tools-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

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
  Object.assign(h, { context, nativeHistoryScope: 'task-a', pendingSends: 0, activeStreams: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: resolvedProfile,
    getHistory: () => history, appendHistory: async items => { for (const item of items) { const i = history.findIndex(previous => previous.id === item.id); if (i < 0) history.push(copy(item)); else history[i] = copy(item); } },
    post: async event => posts.push(copy(event)), postConfig: async () => {}, getCoach: () => ({ name: '코치', personality: '', configured: true }),
    ensureProfile: async () => resolvedProfile, loadAccess: async () => {}, accessState: choice ? { selected: choice.id, view: { choices: [choice] } } : undefined,
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => { calls.observation++; return null; }, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
  });
  return { h, posts, history, runtime, calls, runSdkCoach, SdkUnavailableError, BrowserControl, root, vscode };
}

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
  const args = { sdk, binaryResolution: { available: true, reasons: [] }, gatewayUrl: 'http://127.0.0.1:1/v1', token: 'test', model: 'fixture', profile: copy(profile), systemPrompt: '', history: [], userText: 'source question', toolMode: 'web-search', signal: new AbortController().signal, stallTimeoutMs: 0, onDelta() {}, onCitations: values => citations.push(...values), requestApproval: async action => { approvals.push(action); return true; }, browserHost: {} };
  await f.runSdkCoach(args);
  assert.deepEqual(copy(captured[0].options.tools), ['WebSearch', 'WebFetch']);
  assert.deepEqual(copy(captured[0].options.allowedTools), []);
  assert.equal(captured[0].options.agents, undefined); assert.equal(captured[0].options.mcpServers, undefined);
  assert.match(captured[0].prompt, /이번 요청의 도구 선택: 웹 검색/);
  assert.equal(approvals.length, 1); assert.equal(approvals[0].toolName, 'WebSearch');
  assert.deepEqual(copy(citations), [{ url: 'https://example.test/reference', title: 'Observed search hit', domain: 'example.test', tier: 4 }]);
  await assert.rejects(f.runSdkCoach({ ...args, profile: { ...profile, tools: {} } }), /웹 검색/);
  assert.equal(captured.length, 1, 'grant denial happens before SDK query');
  const control = [];
  await f.runSdkCoach({ ...args, toolMode: 'auto', profile: { ...profile, sdk_tools: { read: true } }, sdk: { query: value => { control.push(value); return (async function* () { yield { type: 'result', subtype: 'success', is_error: false }; })(); } } });
  assert.ok(control[0].options.tools.includes('Read')); assert.equal(control[0].prompt, 'source question');
});

test('typed citation extraction rejects prose, mismatched/error calls and unsafe URLs; fetch and dedupe work', () => {
  const positive = new SdkWebCitations(['WebSearch', 'WebFetch']);
  positive.observe(toolUse('a')); assert.equal(positive.observe(toolResult('a', searchOutput())).length, 1);
  positive.observe(toolUse('b')); assert.deepEqual(positive.observe(toolResult('b', searchOutput())), []);
  const fetched = { bytes: 10, code: 200, codeText: 'OK', result: 'Read page', durationMs: 10, url: 'https://official.test/doc' };
  positive.observe(toolUse('f', 'WebFetch', { url: fetched.url, prompt: 'read' }));
  assert.deepEqual(positive.observe(toolResult('f', fetched)), [{ url: fetched.url, title: 'official.test', domain: 'official.test', tier: 4 }]);
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
  assert.deepEqual(reopened.getHistory().flatMap(message => message.citations ?? []), [{ url: 'https://example.test/reference', title: 'Observed search hit', domain: 'example.test', tier: 4 }]);
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
