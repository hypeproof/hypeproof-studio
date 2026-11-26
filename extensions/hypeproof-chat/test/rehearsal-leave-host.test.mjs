// #4514 — the band button ("rehearsalSeatEnd") asks the after-report question only after a 200 from the report route in
// this seat. The real ChatPanelProvider is bundled with a scripted `vscode`; the seat host is set through the same
// setRehearsalSeatHost that activate() uses (rehearsalSeatHost.ts). Every question shown by showInformationMessage is
// recorded. Positive control first: the report's own question must appear, or the detector is blind.
// Run: node --experimental-strip-types --test test/rehearsal-leave-host.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({
  stdin: {
    contents: "export { ChatPanelProvider } from './src/chatPanelProvider.ts'; export { setRehearsalSeatHost } from './src/rehearsalSeatHost.ts';",
    resolveDir: ext, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});

// The question texts and the report route, as the seat code defines them.
const LEAVE_WITHOUT = '리허설 보고를 보내지 않았습니다. 그래도 강사로 돌아갈까요?';
const LEAVE_AFTER = '리허설 보고를 보냈습니다. 강사로 돌아갈까요?';

// Scripted vscode: showInformationMessage records each question and answers with `vs.choice`.
const vs = { asks: [], choice: undefined };
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
const vscode = new Proxy({
  window: {
    showInformationMessage: async (message, ...buttons) => { vs.asks.push({ message, buttons }); return vs.choice; },
    showWarningMessage: async () => undefined,
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
  },
  workspace: { getConfiguration: () => ({ get: (_k, fallback) => fallback }), workspaceFolders: [] },
  Uri: { joinPath: () => ({ fsPath: '/ext' }), file: p => ({ fsPath: p }) },
  ViewColumn: { One: 1 },
  env: { appName: 'HypeProof Studio', language: 'ko', machineId: 'test-machine' },
  version: '0.0.0-test',
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };

// The report route behaviour for each case. 'ok' → 200; 'refused' → 409 already_judged; 'throw' → network failure.
const fetchMode = { report: 'ok' };
const fetches = [];
const fakeFetch = async (url, init = {}) => {
  fetches.push({ url: String(url), init });
  const u = String(url);
  if (u.includes('/classroom/rehearsal/report')) {
    if (fetchMode.report === 'throw') throw new Error('offline');
    if (fetchMode.report === 'refused') return new Response(JSON.stringify({ reason: 'already_judged' }), { status: 409 });
    return new Response(JSON.stringify({ verdict: 'pass', reasons: [] }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process,
  setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, AbortSignal, AbortController,
  URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone, Response, Headers, Request,
  fetch: fakeFetch,
});
const { ChatPanelProvider, setRehearsalSeatHost } = mod.exports;

// Keys as the seat code stores them (rehearsalSeat.ts / extension.ts TOKEN_KEY).
const CODE_KEY = 'hypeproofChat.workshopToken';
const RETURN_KEY = 'chalk.rehearsal.returnIssuer';
const SEAT_KEY = 'chalk.rehearsal.seat';
const SENT_KEY = 'chalk.rehearsal.reportSent';
const REHEARSAL_ID = 'rh-leave-4514';
const HOME = '/work/instructor-home';
const FOLDER = `/global/rehearsal-seat/${REHEARSAL_ID}`;
const ISSUER = 'synthetic-issuer-4514-aaaa';
const CODE = 'synthetic-rehearsal-code-4514';

// One window: a seat host over one secrets Map, the rehearsal folder as the current root, and a provider over the same Map.
function window_({ withSeat }) {
  const store = new Map([[CODE_KEY, CODE]]);
  if (withSeat) {
    store.set(RETURN_KEY, ISSUER);
    store.set(SEAT_KEY, JSON.stringify({ phase: 'inside', rehearsalId: REHEARSAL_ID, expiresAt: 4_000_000_000_000, homeFolder: HOME, rehearsalFolder: FOLDER }));
  }
  const secrets = {
    get: async k => store.get(k),
    store: async (k, v) => { store.set(k, v); },
    delete: async k => { store.delete(k); },
  };
  // SeatHost for the leave questions. Only the questions and the mark are exercised; a return is never chosen here.
  const host = {
    secrets,
    currentRoot: () => FOLDER,
    rehearsalFolderFor: () => FOLDER,
    makeFolder() {},
    openFolder: async () => { throw new Error('not used in this test'); },
    bindStudentToken: async () => {},
    releaseStudentBinding: async () => {},
    askResume: async () => undefined,
    notify() {},
    now: () => 1_000_000,
  };
  const context = {
    subscriptions: [], extensionUri: { fsPath: '/ext' }, extensionPath: '/ext', extension: { packageJSON: { version: '0.0.0-test' } },
    globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
    workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
    globalStorageUri: { fsPath: '/tmp/hps-none' }, storageUri: { fsPath: '/tmp/hps-none' },
    secrets,
  };
  const provider = new ChatPanelProvider(context, {}, {});
  provider.post = async () => true;
  provider.cachedProfile = {
    rehearsal: { path: 'subscription', id: 'rh-1', course_id: 'course-1' },
    lesson: { sha256: 'b'.repeat(64), content: { steps: [{ id: 's1', title: '단계 1', help: { default: 'hint', allowed: ['hint'] } }] } },
  };
  setRehearsalSeatHost(host);
  return { store, provider };
}
const steps = [{ id: 's1', visited: true, help_offered: ['hint'], help_default: 'hint', surface: 'text' }];
const reset = () => { vs.asks.length = 0; fetches.length = 0; };
const questions = () => vs.asks.map(a => a.message);

test('positive control: a 200 report asks the after-report question, and the band button then asks the same question', async () => {
  reset(); fetchMode.report = 'ok'; vs.choice = '계속하기';
  const { store, provider } = window_({ withSeat: true });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(questions().filter(q => q === LEAVE_AFTER).length, 1, 'the report itself asks the after-report question once');
  assert.equal(store.get(SENT_KEY), REHEARSAL_ID, 'the sent mark is stored for this seat');
  reset();
  await provider.handleMessage({ type: 'rehearsalSeatEnd' });
  assert.equal(questions().filter(q => q === LEAVE_AFTER).length, 1, '(a) the band button asks the after-report text once');
  assert.equal(questions().filter(q => q === LEAVE_WITHOUT).length, 0, '(a) the without-report text is not asked');
});

test('(b) no report: the band button asks the without-report text', async () => {
  reset(); fetchMode.report = 'ok'; vs.choice = '취소';
  const { store, provider } = window_({ withSeat: true });
  await provider.handleMessage({ type: 'rehearsalSeatEnd' });
  assert.deepEqual(questions(), [LEAVE_WITHOUT], '(b) one without-report question');
  assert.equal(store.get(SENT_KEY), undefined, 'no mark without a report');
});

test('(c) report refused (409): the band button asks the without-report text', async () => {
  reset(); fetchMode.report = 'refused'; vs.choice = '취소';
  const { store, provider } = window_({ withSeat: true });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(store.get(SENT_KEY), undefined, 'a refused report writes no mark');
  reset();
  await provider.handleMessage({ type: 'rehearsalSeatEnd' });
  assert.deepEqual(questions(), [LEAVE_WITHOUT], '(c-409) without-report text');
});

test('(c) report fetch throws: the band button asks the without-report text', async () => {
  reset(); fetchMode.report = 'throw'; vs.choice = '취소';
  const { store, provider } = window_({ withSeat: true });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(store.get(SENT_KEY), undefined, 'a failed report writes no mark');
  reset();
  await provider.handleMessage({ type: 'rehearsalSeatEnd' });
  assert.deepEqual(questions(), [LEAVE_WITHOUT], '(c-throw) without-report text');
});

test('no seat: the band button asks nothing', async () => {
  reset(); fetchMode.report = 'ok';
  const { provider } = window_({ withSeat: false });
  await provider.handleMessage({ type: 'rehearsalSeatEnd' });
  assert.deepEqual(questions(), [], 'outside a seat no question');
});
