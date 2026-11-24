// #4501 — the real ChatPanelProvider (bundled with a scripted `vscode`) runs one subscription rehearsal turn upload and
// one report in the real seat states. Every host→webview message is captured through provider.post. The learner
// rehearsal code is the upload credential: it must appear in the Authorization header only, never in a body or a
// webview message. The instructor return key is never read. Positive control first.
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

// Planted values. The code must never reach a webview message or a body; the return key must never be read.
const PLANT_CODE = 'PLANT-REHEARSAL-CODE-8841';
const PLANT_RETURN = 'PLANT-RETURN-ISSUER-8842';
const PLANT_STUDENT = 'PLANT-STUDENT-SENTENCE-8843';

const fetches = [];
const fakeFetch = async (url, init = {}) => {
  fetches.push({ url: String(url), init });
  const u = String(url);
  if (u.includes('/classroom/rehearsal/turns')) {
    // Bodies that name a "fail-" turn are refused (500, kept unsent); "judged-" is refused with the Service reason 409.
    if (String(init.body).includes('"turn_id":"fail-')) return new Response('{}', { status: 500 });
    if (String(init.body).includes('"turn_id":"judged-')) return new Response(JSON.stringify({ error: 'x', reason: 'already_judged' }), { status: 409 });
    return new Response(JSON.stringify({ stored: true }), { status: 201 });
  }
  if (u.includes('/classroom/rehearsal/report')) return new Response(JSON.stringify({ verdict: 'pass', reasons: [] }), { status: 200 });
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

// Keys as the extension stores them. CODE = extension.ts TOKEN_KEY (bindStudentToken); RETURN = rehearsalSeat.ts REHEARSAL_RETURN_KEY;
// ISSUER = mintStudentTokenHelpers.ts ISSUER_TOKEN_KEY (absent inside a seat by design, #4048).
const CODE_KEY = 'hypeproofChat.workshopToken';
const RETURN_KEY = 'chalk.rehearsal.returnIssuer';
const ISSUER_KEY = 'hypeproofChat.issuerToken';
const SEAT_KEY = 'chalk.rehearsal.seat';

function makeProvider(secretsMap) {
  const memento = () => ({ get: () => undefined, update: async () => {}, keys: () => [] });
  const reads = [];
  const context = {
    subscriptions: [], extensionUri: { fsPath: '/ext' }, extensionPath: '/ext', extension: { packageJSON: { version: '0.0.0-test' } },
    globalState: memento(), workspaceState: memento(), globalStorageUri: { fsPath: '/tmp/hps-none' }, storageUri: { fsPath: '/tmp/hps-none' },
    secrets: {
      get: async k => { reads.push(k); return secretsMap[k]; }, store: async () => {}, delete: async () => {},
      onDidChange: () => ({ dispose() {} }),
    },
  };
  const provider = new ChatPanelProvider(context, {}, {});
  const posted = [];
  provider.post = async msg => { posted.push(msg); return true; };
  provider.cachedProfile = {
    rehearsal: { path: 'subscription', id: 'rh-1', course_id: 'course-1' },
    lesson: { sha256: 'b'.repeat(64), content: { steps: [{ id: 's1', title: '단계 1', help: { default: 'hint', allowed: ['hint'] } }] } },
  };
  return { provider, posted, reads };
}
// Shape of RenderedStep (lessonFocus.ts rehearsalReport): what the panel drew for each step.
const steps = [{ id: 's1', visited: true, help_offered: ['hint'], help_default: 'hint', surface: 'text' }];
const every = (posted) => JSON.stringify(posted);

test('positive control: the capture detector finds a planted code placed in a message on purpose', () => {
  const { posted } = makeProvider({});
  posted.push({ type: 'rehearsalState', state: 'sending', note: PLANT_CODE });
  assert.ok(every(posted).includes(PLANT_CODE), 'the detector must see a planted code');
});

// Same-window seat: the instructor credential is moved to the return key, the issuer key is gone, the learner code is bound.
test('same-window seat (return key, no issuer, code present): one upload and one report; the code only in the header', async () => {
  fetches.length = 0;
  const { provider, posted, reads } = makeProvider({ [CODE_KEY]: PLANT_CODE, [RETURN_KEY]: PLANT_RETURN, [SEAT_KEY]: '{"phase":"inside"}' });
  await provider.uploadRehearsalTurnFor({
    turnId: 't-1', mode: 'auto', model: 'claude-sonnet-5-5', toolNames: ['read_file'], answered: true,
    step: 's1', helpMode: undefined, profile: provider.cachedProfile,
  });
  await provider.sendRehearsalReport(steps, undefined, undefined);

  const upload = fetches.find(f => f.url.includes('/classroom/rehearsal/turns'));
  assert.ok(upload, 'the upload request was made');
  assert.ok(upload.url.endsWith('/v1/classroom/rehearsal/turns'), upload.url);
  assert.equal(upload.init.headers.authorization, 'Bearer ' + PLANT_CODE);
  assert.ok(!upload.init.body.includes(PLANT_CODE), 'code not in the upload body');
  assert.ok(!upload.init.body.includes(PLANT_RETURN), 'return key value not in the upload body');
  assert.ok(!upload.init.body.includes(PLANT_STUDENT));
  assert.equal(reads.filter(k => k === RETURN_KEY).length, 0, 'the return key is never read');
  assert.equal(reads.filter(k => k === ISSUER_KEY).length, 0, 'the issuer key is never read');
  assert.ok(fetches.find(f => f.url.includes('/classroom/rehearsal/report')), 'the report request was made');

  assert.ok(!every(posted).includes(PLANT_CODE), 'the code appears in no host→webview message');
  assert.ok(!every(posted).includes(PLANT_RETURN), 'the return key value appears in no host→webview message');
  assert.ok(posted.some(m => m.type === 'rehearsalState' && m.state === 'sent'), 'the report ended as sent');
});

// Entry notice: a same-window seat has the code, so the seat-entry decision says no sentence (the decision is unit-tested in
// rehearsal-turn-upload.test.mjs; this test checks what the upload path sees in the same state).
test('same-window seat: the upload path sees the code and no issuer; no refusal sentence is posted', async () => {
  fetches.length = 0;
  const { provider, posted } = makeProvider({ [CODE_KEY]: PLANT_CODE, [RETURN_KEY]: PLANT_RETURN });
  await provider.uploadRehearsalTurnFor({
    turnId: 't-same', mode: 'auto', model: 'm', toolNames: [], answered: true, step: 's1', helpMode: undefined, profile: provider.cachedProfile,
  });
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/turns')).length, 1, 'one upload');
  assert.equal(posted.filter(m => m.type === 'rehearsalState').length, 0, 'no rehearsal state is posted by a successful upload');
});

// Another device: the learner entered the rehearsal code only. No seat keys, no instructor credential at all.
test('another device (code only): one upload and one report; the code only in the header', async () => {
  fetches.length = 0;
  const { provider, posted, reads } = makeProvider({ [CODE_KEY]: PLANT_CODE });
  await provider.uploadRehearsalTurnFor({
    turnId: 't-2', mode: 'auto', model: 'm', toolNames: [], answered: false, step: 's1', helpMode: undefined, profile: provider.cachedProfile,
  });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  const upload = fetches.find(f => f.url.includes('/classroom/rehearsal/turns'));
  assert.ok(upload, 'the upload request was made');
  assert.equal(upload.init.headers.authorization, 'Bearer ' + PLANT_CODE);
  assert.equal(reads.filter(k => k === RETURN_KEY || k === ISSUER_KEY).length, 0, 'no instructor credential is read');
  assert.ok(fetches.find(f => f.url.includes('/classroom/rehearsal/report')), 'the report request was made');
  assert.ok(!every(posted).includes(PLANT_CODE));
  assert.ok(posted.some(m => m.type === 'rehearsalState' && m.state === 'sent'));
});

test('no rehearsal code: no upload, no report request; the report asks for the code', async () => {
  fetches.length = 0;
  const { provider, posted, reads } = makeProvider({ [RETURN_KEY]: PLANT_RETURN });
  await provider.uploadRehearsalTurnFor({
    turnId: 't-3', mode: 'auto', model: 'm', toolNames: [], answered: true, step: 's1', helpMode: undefined, profile: provider.cachedProfile,
  });
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/turns')).length, 0, 'no upload without a code');
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/report')).length, 0, 'no report request without a code');
  assert.equal(reads.filter(k => k === RETURN_KEY).length, 0, 'the return key is never read');
  assert.ok(posted.some(m => m.type === 'rehearsalState' && m.state === 'error'), 'an error sentence is shown');
});

test('unsent turns: the first report press holds with the count, the second press sends', async () => {
  fetches.length = 0;
  const { provider, posted } = makeProvider({ [CODE_KEY]: PLANT_CODE, [RETURN_KEY]: PLANT_RETURN });
  // The upload fails (500) and stays unsent; the report press must hold once.
  provider.rehearsalUploadUnsent.set('fail-1', { turn_id: 'fail-1', text_omitted: true });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  const held = posted.filter(m => m.type === 'rehearsalState' && m.message && m.message.includes('올리지 못했습니다'));
  assert.equal(held.length, 1, 'the held sentence names the unsent count');
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/report')).length, 0, 'the first press sends nothing');
  await provider.sendRehearsalReport(steps, undefined, undefined);
  assert.equal(fetches.filter(f => f.url.includes('/classroom/rehearsal/report')).length, 1, 'the second press sends the report');
  assert.ok(!every(posted).includes(PLANT_CODE));
  assert.ok(!every(posted).includes(PLANT_RETURN));
});

test('a refused upload (Service reason 409 already_judged): the first press shows the W2 sentence, not the count', async () => {
  fetches.length = 0;
  const { provider, posted } = makeProvider({ [CODE_KEY]: PLANT_CODE, [RETURN_KEY]: PLANT_RETURN });
  provider.rehearsalUploadUnsent.set('judged-1', { turn_id: 'judged-1', text_omitted: true });
  await provider.sendRehearsalReport(steps, undefined, undefined);
  const held = posted.filter(m => m.type === 'rehearsalState' && m.message && m.message.includes('이미 결과를 보냈습니다'));
  assert.equal(held.length, 1, 'the already-judged sentence from the report reason function is shown');
  assert.equal(posted.filter(m => m.message && m.message.includes('올리지 못했습니다')).length, 0, 'the pending-count sentence is not used for a refusal');
  assert.ok(!every(posted).includes(PLANT_CODE));
});
