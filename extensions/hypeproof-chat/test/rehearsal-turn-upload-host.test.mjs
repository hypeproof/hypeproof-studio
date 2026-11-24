// #4501 — the real ChatPanelProvider (bundled with a scripted `vscode`) runs one subscription rehearsal turn upload and
// one report. Every host→webview message is captured through provider.post. A planted issuer token must appear in
// the upload's Authorization header only: zero times in the captured messages. Positive control first.
// Run: node --experimental-strip-types --test test/rehearsal-turn-upload-host.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider.ts';", resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
const vscode = new Proxy({
  window: { showWarningMessage: async () => undefined, createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }) },
  workspace: { getConfiguration: () => ({ get: (_k, fallback) => fallback }), workspaceFolders: [] },
  Uri: { joinPath: () => ({ fsPath: '/ext' }), file: p => ({ fsPath: p }) },
  ViewColumn: { One: 1 },
  env: { appName: 'HypeProof Studio', language: 'ko', machineId: 'test-machine' },
  version: '0.0.0-test',
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };

// Planted values. The token must never reach a webview message; the student and answer text never exist in this flow.
const PLANT_TOKEN = 'PLANT-ISSUER-TOKEN-8841';
const PLANT_STUDENT = 'PLANT-STUDENT-SENTENCE-8842';

const fetches = [];
const fakeFetch = async (url, init = {}) => {
  fetches.push({ url: String(url), init });
  if (String(url).includes('/admin/chalk/transcripts')) {
    // A body that names a "fail-" turn is refused, so the report keeps it unsent.
    if (String(init.body).includes('"turn_id":"fail-')) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ stored: true }), { status: 201 });
  }
  if (String(url).includes('/classroom/rehearsal/report')) return new Response(JSON.stringify({ verdict: 'pass', reasons: [] }), { status: 200 });
  return new Response('{}', { status: 404 });
};

const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process,
  setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, AbortSignal, AbortController,
  URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone, Response, Headers, Request,
  fetch: fakeFetch,
});
const { ChatPanelProvider } = mod.exports;

const ISSUER_KEY = 'hypeproofChat.issuerToken';
const TOKEN_KEY = 'hypeproofChat.workshopToken';
function makeProvider(secretsMap) {
  const memento = () => ({ get: () => undefined, update: async () => {}, keys: () => [] });
  const context = {
    subscriptions: [], extensionUri: { fsPath: '/ext' }, extensionPath: '/ext', extension: { packageJSON: { version: '0.0.0-test' } },
    globalState: memento(), workspaceState: memento(), globalStorageUri: { fsPath: '/tmp/hps-none' }, storageUri: { fsPath: '/tmp/hps-none' },
    secrets: { get: async k => secretsMap[k], store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
  };
  const provider = new ChatPanelProvider(context, {}, {});
  const posted = [];
  provider.post = async msg => { posted.push(msg); return true; };
  provider.cachedProfile = {
    rehearsal: { path: 'subscription', id: 'rh-1', course_id: 'course-1' },
    lesson: { sha256: 'b'.repeat(64), content: { steps: [{ id: 's1', title: '단계 1', help: { default: 'hint', allowed: ['hint'] } }] } },
  };
  return { provider, posted };
}
// Shape of RenderedStep (lessonFocus.ts rehearsalReport): what the panel drew for each step.
const steps = [{ id: 's1', visited: true, help_offered: ['hint'], help_default: 'hint', surface: 'text' }];
const every = (posted) => JSON.stringify(posted);

test('positive control: the capture detector finds a planted token placed in a message on purpose', () => {
  const { posted } = makeProvider({});
  const probe = { type: 'rehearsalState', state: 'sending', note: PLANT_TOKEN };
  posted.push(probe);
  assert.ok(every(posted).includes(PLANT_TOKEN), 'the detector must see a planted token');
});

test('one turn upload and one report: the token is only in the Authorization header, never in a webview message', async () => {
  fetches.length = 0;
  const { provider, posted } = makeProvider({ [ISSUER_KEY]: PLANT_TOKEN, [TOKEN_KEY]: 'student-token-not-planted' });
  await provider.uploadRehearsalTurnFor({
    turnId: 't-1', mode: 'auto', model: 'claude-sonnet-5-5', toolNames: ['read_file'], answered: true,
    step: 's1', helpMode: undefined, profile: provider.cachedProfile,
  });
  await provider.sendRehearsalReport(steps, undefined, undefined);

  const upload = fetches.find(f => f.url.includes('/admin/chalk/transcripts'));
  assert.ok(upload, 'the upload request was made');
  assert.equal(upload.init.headers.authorization, 'Bearer ' + PLANT_TOKEN);
  assert.ok(!upload.init.body.includes(PLANT_TOKEN), 'token not in the upload body');
  assert.ok(!upload.init.body.includes(PLANT_STUDENT));
  const report = fetches.find(f => f.url.includes('/classroom/rehearsal/report'));
  assert.ok(report, 'the report request was made');

  assert.ok(!every(posted).includes(PLANT_TOKEN), 'the planted token appears in no host→webview message');
  assert.ok(posted.some(m => m.type === 'rehearsalState' && m.state === 'sent'), 'the report ended as sent');
});

test('no issuer token: no upload, no report request, one Korean sentence in the webview', async () => {
  fetches.length = 0;
  const { provider, posted } = makeProvider({ [TOKEN_KEY]: 'student-token-not-planted' });
  await provider.uploadRehearsalTurnFor({
    turnId: 't-2', mode: 'auto', model: 'm', toolNames: [], answered: true, step: 's1', helpMode: undefined, profile: provider.cachedProfile,
  });
  assert.equal(fetches.filter(f => f.url.includes('/admin/chalk/transcripts')).length, 0, 'no upload request without issuer');
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/report')).length, 0, 'no report request without issuer');
  const msg = posted.find(m => m.type === 'rehearsalState' && m.state === 'error');
  assert.ok(msg && msg.message.includes('강사 연결 정보'), 'the issuer-missing sentence is shown');
});

test('unsent turns: the first report press holds with the count, the second press sends', async () => {
  fetches.length = 0;
  const { provider, posted } = makeProvider({ [ISSUER_KEY]: PLANT_TOKEN, [TOKEN_KEY]: 'student-token-not-planted' });
  // Force the upload to fail, then the report must hold once.
  provider.rehearsalUploadUnsent.set('fail-1', { turn_id: 'fail-1', text_omitted: true });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  const held = posted.filter(m => m.type === 'rehearsalState' && m.message && m.message.includes('올리지 못했습니다'));
  assert.equal(held.length, 1, 'the held sentence names the unsent count');
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/report')).length, 0, 'the first press sends nothing');
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/report')).length, 1, 'the second press sends the report');
  assert.ok(!every(posted).includes(PLANT_TOKEN));
});
