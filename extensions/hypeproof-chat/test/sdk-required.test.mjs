// REQ-M45 — an SDK-only seat (native trial, paid pass) with no resolvable `claude`
// binary. Actual provider and proxy-client code with scripted runtime boundaries;
// no network, CLI, paid call or VS Code window.
//
// Matrix: SdkUnavailableError x {no selection, model picked, pass picked, web search}
// on a trial seat (must fail with the install notice, never fall back), and the same
// matrix on a classroom seat (negative control: existing copy and the REQ-M7 fallback).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import {
  SDK_MISSING_NOTICE, SdkRequiredError, trialRequiresSdkMessage, sdkUnavailableOutcome,
  profileRequiresSdk, isSoloSeat, CLASSROOM_MODEL_SDK_MISSING, CLASSROOM_WEB_SEARCH_SDK_MISSING,
} from '../src/sdkRequiredHelpers.ts';
import { proxyChat } from '../src/proxyClient.ts';
import { coachDegradedNotice } from '../src/coachIdentity.ts';
import { COACH_DEGRADED_NOTICE } from '../src/chatPanelHelpers.ts';
import { errorBannerPresentation } from '../webview-ui/src/errorBannerPresentation.ts';

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL('..', import.meta.url));
const copy = value => JSON.parse(JSON.stringify(value));

// The exact body svc worker/src/middleware/native-trial-budget.ts:76 sends (hypeproof-service a08cf7a).
const SERVICE_409_BODY = JSON.stringify({ error: { code: 'trial_requires_sdk', message: '이 체험은 최신 Studio에서 실행해 주세요.' } });
const STAFF = /스태프|강사|운영 담당자/;
const ENGLISH_SDK_ERROR = /SdkUnavailableError|Falling back|seed-sdk-binary|claude binary|proxy runtime/i;

function assertInstallNotice(text, label) {
  assert.ok(text.includes('설치되어 있지 않아'), `${label}: names the cause`);
  assert.ok(text.includes('hypeproof-ai.xyz/studio/install'), `${label}: names where to install`);
  assert.ok(text.includes('다시 열어'), `${label}: names the next step`);
  assert.doesNotMatch(text, STAFF, `${label}: no staff on a solo seat`);
  assert.doesNotMatch(text, ENGLISH_SDK_ERROR, `${label}: no English runtime error`);
  assert.doesNotMatch(text, /다시 (보내|시도)/, `${label}: does not suggest resending`);
}

// ── Pure copy and routing ────────────────────────────────────────────────────

test('install notice names cause and remedy, without staff, English or a retry', () => {
  assertInstallNotice(SDK_MISSING_NOTICE, 'notice');
  assert.equal(new SdkRequiredError().retry, false);
  assert.equal(new SdkRequiredError().message, SDK_MISSING_NOTICE);
});

test('exact Service 409 body keeps the Service sentence and adds the cause and remedy', () => {
  const text = trialRequiresSdkMessage(409, SERVICE_409_BODY);
  assert.ok(text.startsWith('이 체험은 최신 Studio에서 실행해 주세요. '), text);
  assertInstallNotice(text, '409');
  // Negative controls: other statuses and codes are left to the existing classification.
  assert.equal(trialRequiresSdkMessage(409, JSON.stringify({ error: { code: 'other' } })), null);
  assert.equal(trialRequiresSdkMessage(429, SERVICE_409_BODY), null);
  assert.equal(trialRequiresSdkMessage(409, 'not json'), null);
  assert.equal(trialRequiresSdkMessage(409, JSON.stringify({ error: { code: 'trial_requires_sdk' } })), SDK_MISSING_NOTICE);
});

test('seat classification: trial and pass need the SDK; personal is solo; classroom is neither', () => {
  assert.equal(profileRequiresSdk({ activity_kind: 'trial' }), true);
  assert.equal(profileRequiresSdk({ activity_kind: 'classroom', pass: { request_limit: 1 } }), true);
  assert.equal(profileRequiresSdk({ activity_kind: 'personal' }), false);
  assert.equal(profileRequiresSdk({ activity_kind: 'classroom' }), false);
  assert.equal(profileRequiresSdk(null), false);
  assert.equal(isSoloSeat({ activity_kind: 'personal' }), true);
  assert.equal(isSoloSeat({ activity_kind: 'classroom' }), false);
  assert.equal(isSoloSeat({}), false);
});

test('routing matrix: every SDK-only branch fails with one notice; classroom keeps its copy and fallback', () => {
  for (const webSearch of [false, true]) for (const modelPicked of [false, true]) {
    for (const [profile, fundingSource] of [[{ activity_kind: 'trial' }, undefined], [{ activity_kind: 'classroom' }, 'pass-1'], [{ activity_kind: 'trial', pass: {} }, 'pass-1']]) {
      const out = sdkUnavailableOutcome({ profile, fundingSource, webSearch, modelPicked });
      assert.equal(out.kind, 'fail'); assert.equal(out.error.message, SDK_MISSING_NOTICE); assert.equal(out.requiredSdk, true);
    }
  }
  const classroom = { activity_kind: 'classroom' };
  assert.deepEqual(sdkUnavailableOutcome({ profile: classroom, webSearch: false, modelPicked: false }), { kind: 'fallback' });
  assert.equal(sdkUnavailableOutcome({ profile: classroom, webSearch: true, modelPicked: false }).error.message, CLASSROOM_WEB_SEARCH_SDK_MISSING);
  assert.equal(sdkUnavailableOutcome({ profile: classroom, webSearch: false, modelPicked: true }).error.message, CLASSROOM_MODEL_SDK_MISSING);
  assert.deepEqual(sdkUnavailableOutcome({ profile: null, webSearch: false, modelPicked: false }), { kind: 'fallback' });
});

test('degraded notice: classroom wording unchanged; solo wording points at the installer, not staff', () => {
  assert.equal(coachDegradedNotice('코치'), COACH_DEGRADED_NOTICE);
  assert.ok(COACH_DEGRADED_NOTICE.includes('스태프'), 'classroom control keeps its staff step');
  const solo = coachDegradedNotice('코치', { solo: true });
  assert.doesNotMatch(solo, STAFF);
  assert.ok(solo.includes('hypeproof-ai.xyz/studio/install'), solo);
  assert.ok(solo.includes('파일 저장') && solo.includes('미리보기'), 'still says what is lost and what works');
});

test('error banner frames the install notice as an install step, not a lock or a fault', () => {
  assert.equal(errorBannerPresentation(SDK_MISSING_NOTICE).title, '설치를 마무리해야 해요');
  assert.equal(errorBannerPresentation(trialRequiresSdkMessage(409, SERVICE_409_BODY)).title, '설치를 마무리해야 해요');
  // Control: the classroom copy (mentions 강사) keeps its existing frame.
  assert.equal(errorBannerPresentation(CLASSROOM_MODEL_SDK_MISSING).title, '잠시 멈춰요');
});

// ── Actual proxy client fed the exact 409 body ──────────────────────────────

test('actual proxyChat turns the exact 409 body into a non-retryable install error', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(SERVICE_409_BODY, { status: 409, headers: { 'content-type': 'application/json', 'x-request-id': 'req-409' } });
  const err = await proxyChat({ proxyUrl: 'http://127.0.0.1:1/v1', model: 'm', token: 't', history: [], userText: 'hi', onDelta() {} }).then(() => null, e => e);
  assert.ok(err, 'must reject');
  assert.equal(err.name, 'SdkRequiredError');
  assert.equal(err.retry, false);
  assert.equal(err.requestId, 'req-409');
  assert.ok(err.message.startsWith('이 체험은 최신 Studio에서 실행해 주세요.'));
  assertInstallNotice(err.message, 'proxyChat 409');
});

// ── Actual provider, scripted runtime ───────────────────────────────────────

const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {SdkUnavailableError} from './src/sdkCoach'; export {SdkRequiredError} from './src/sdkRequiredHelpers';", resolveDir: extension, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent', plugins: [{ name: 'scripted-provider-runtime', setup(b) {
  b.onResolve({ filter: /^\.\/sdkCoach$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'sdk', namespace: 'runtime' } : undefined);
  b.onResolve({ filter: /^\.\/proxyClient$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'proxy', namespace: 'runtime' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({ loader: 'ts', resolveDir: extension, contents: args.path === 'sdk'
    ? `export * from ${JSON.stringify(path.join(extension, 'src/sdkCoach.ts'))}; export const runSdkCoach=(args)=>globalThis.runtime.sdk(args);`
    : `export * from ${JSON.stringify(path.join(extension, 'src/proxyClient.ts'))}; export const proxyChat=(args)=>globalThis.runtime.proxy(args);` }));
} }] });

const baseProfile = { profile_id: 'adult-test', tools: { web_search: true }, coach_runtime: 'agent-sdk', sdk_tools: { read: true, write: true, browser: true }, ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } } };
const lessonModels = { revision: 'hps-model-selection/1', runtime: 'agent-sdk', provider: 'anthropic', default: 'sonnet', source: 'lesson', choices: [{ id: 'claude-sonnet-test', alias: 'sonnet', label: 'Sonnet' }] };
const passChoice = { id: 'pass-1', allowed: { features: ['read', 'write', 'browser'] } };

function fixture(t, { resolvedProfile, choice } = {}) {
  const posts = [], history = [], calls = { sdk: [], proxy: [], network: 0 }, logLines = [];
  const SdkErr = () => new module.exports.SdkUnavailableError('no usable claude binary: setting unset, HPS_SDK_BINARY unset, seed missing, node_modules absent. Falling back to the proxy runtime');
  const runtime = {
    sdk: async args => { calls.sdk.push(args); throw SdkErr(); },
    proxy: async args => { calls.proxy.push(args); args.onDelta('프록시 답변'); return { text: '프록시 답변', toolUses: [] }; },
  };
  const values = { coachRuntime: 'agent-sdk', proxyUrl: 'http://127.0.0.1:1/v1' };
  const vscode = { env: { appName: 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) }, window: { createOutputChannel: () => ({ appendLine: line => logLines.push(line) }) }, Uri: { file: fsPath => ({ fsPath }) } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), runtime, console,
    process: { ...process, env: { PATH: process.env.PATH } },
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout,
    fetch: async () => { calls.network++; throw new Error('Network is forbidden in this test'); },
  });
  const { ChatPanelProvider } = module.exports;
  const h = Object.create(ChatPanelProvider.prototype), state = new Map();
  const context = { workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) }, secrets: { get: async () => 'synthetic-test-token' } };
  Object.assign(h, { context, nativeHistoryScope: 'task-a', pendingSends: 0, activeStreams: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: false, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: resolvedProfile,
    getHistory: () => history, appendHistory: async items => { for (const item of items) history.push(copy(item)); },
    post: async event => posts.push(copy(event)), postConfig: async () => {}, getCoach: () => ({ name: '코치', personality: '', configured: true }),
    ensureProfile: async () => resolvedProfile, loadAccess: async () => {}, accessState: choice ? { selected: choice.id, view: { choices: [choice] } } : undefined,
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
  });
  return { h, posts, history, calls, logLines, module, runtime };
}

const branches = {
  'no selection': { profile: {} },
  'model picked': { profile: { model_selection: lessonModels } },
  'pass picked': { profile: { pass: { request_limit: 8, requests_used: 0, expires_at: 2_000_000_000 } }, choice: passChoice },
};

let sendSeq = 0;
async function send(f, toolMode = 'auto') {
  await f.h.handleMessage({ type: 'sendMessage', text: '페이지 만들어 줘', history: [], toolMode, userMessageId: `u-${++sendSeq}` });
}

test('trial seat x {no selection, model picked, pass picked, web search}: no proxy fallback, one install notice, no retry', async t => {
  const cases = [...Object.entries(branches).map(([name, b]) => [name, b, 'auto']), ['web search', branches['no selection'], 'web-search']];
  for (const [name, b, mode] of cases) {
    const f = fixture(t, { resolvedProfile: { ...copy(baseProfile), activity_kind: 'trial', ...copy(b.profile) }, choice: b.choice });
    await send(f, mode);
    assert.equal(f.calls.sdk.length, 1, `${name}: SDK attempted`);
    assert.equal(f.calls.proxy.length, 0, `${name}: no proxy fallback`);
    assert.equal(f.calls.network, 0, `${name}: no network`);
    const errors = f.posts.filter(e => e.type === 'streamError');
    assert.equal(errors.length, 1, `${name}: one error`);
    assert.equal(errors[0].error, SDK_MISSING_NOTICE, `${name}: the same notice on every branch`);
    assert.equal(errors[0].retry, false, `${name}: no retry offered`);
    assertInstallNotice(errors[0].error, name);
    assert.equal(f.posts.some(e => e.type === 'toolLog' && STAFF.test(e.label ?? '')), false, `${name}: no staff line in the timeline`);
    assert.equal(f.posts.some(e => ENGLISH_SDK_ERROR.test(JSON.stringify(e))), false, `${name}: no English SDK text anywhere in the panel`);
    assert.equal(f.h.activeStreams.size, 0); assert.equal(f.h.pendingSends, 0);
    assert.ok(f.logLines.some(line => line.includes('seed missing')), `${name}: developer log keeps the raw reason`);
  }
});

test('classroom seat (negative control): default falls back once; model picked and web search keep existing copy', async t => {
  const classroom = { ...copy(baseProfile), activity_kind: 'classroom' };
  const fallback = fixture(t, { resolvedProfile: classroom });
  await send(fallback);
  assert.equal(fallback.calls.proxy.length, 1, 'REQ-M7 fallback unchanged');
  assert.equal(fallback.posts.some(e => e.type === 'streamError'), false);
  assert.ok(fallback.posts.some(e => e.type === 'toolLog' && e.label === COACH_DEGRADED_NOTICE), 'classroom notice keeps its staff step');

  const picked = fixture(t, { resolvedProfile: { ...classroom, model_selection: lessonModels } });
  await send(picked);
  assert.equal(picked.calls.proxy.length, 0);
  const pickedError = picked.posts.find(e => e.type === 'streamError');
  assert.equal(pickedError.error, CLASSROOM_MODEL_SDK_MISSING);
  assert.notEqual(pickedError.retry, false, 'classroom retry affordance unchanged');

  const search = fixture(t, { resolvedProfile: classroom });
  await send(search, 'web-search');
  assert.equal(search.posts.find(e => e.type === 'streamError').error, CLASSROOM_WEB_SEARCH_SDK_MISSING);
});

test('personal (account) seat that still falls back sees the solo notice, not staff', async t => {
  const f = fixture(t, { resolvedProfile: { ...copy(baseProfile), activity_kind: 'personal' } });
  await send(f);
  assert.equal(f.calls.proxy.length, 1, 'personal seats are not refused on the proxy route by the Service');
  const line = f.posts.find(e => e.type === 'toolLog' && e.state === 'error');
  assert.ok(line, 'fallback is still visible');
  assert.doesNotMatch(line.label, STAFF);
  assert.ok(line.label.includes('hypeproof-ai.xyz/studio/install'));
});

test('a 409 trial_requires_sdk that reaches the provider is shown without a retry', async t => {
  // A classroom default still falls back; the scripted proxy throws what the actual
  // proxyChat raises for the exact Service body (asserted above).
  const f = fixture(t, { resolvedProfile: { ...copy(baseProfile), activity_kind: 'classroom' } });
  const message = trialRequiresSdkMessage(409, SERVICE_409_BODY);
  f.runtime.proxy = async args => { f.calls.proxy.push(args); throw new f.module.exports.SdkRequiredError(message, 'req-409'); };
  await send(f);
  assert.equal(f.calls.proxy.length, 1);
  const error = f.posts.find(e => e.type === 'streamError');
  assert.equal(error.error, message);
  assert.equal(error.retry, false);
  assert.equal(error.requestId, 'req-409');
});

// ── Webview: the banner hides "다시 보내기" only for a non-retryable error ──────

test('panel reducer: retry:false hides the resend button; an ordinary error keeps it', async () => {
  const web = await build({ entryPoints: [path.join(extension, 'webview-ui/src/App.tsx')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    nodePaths: [path.join(extension, 'webview-ui/node_modules')], loader: { '.css': 'empty', '.svg': 'empty' }, jsx: 'automatic', external: ['vscode'],
    banner: { js: 'globalThis.window = globalThis.window ?? { acquireVsCodeApi: undefined };' } });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', web.outputFiles[0].text)(m, m.exports, require);
  const { chatPanelReducer: reduce, chatPanelInitialState: init } = m.exports;
  const missing = reduce(init, { type: 'streamError', error: SDK_MISSING_NOTICE, retry: false });
  assert.equal(missing.error, SDK_MISSING_NOTICE); assert.equal(missing.errorRetry, false);
  const ordinary = reduce(missing, { type: 'streamError', error: '연결이 끊겼어요' });
  assert.equal(ordinary.errorRetry, true, 'a later ordinary error offers resend again');
});
