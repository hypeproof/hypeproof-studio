// #19 (decision 2026-11-26) — the coach system prompt of a subscription rehearsal is downloaded with the learner rehearsal
// code: one field, `system` (the Service's lesson-seat prompt, block 0 of the server path). The real ChatPanelProvider is
// bundled with a scripted `vscode`; the download method is called directly (a whole model turn is not run here).
// Planted system text and planted code are checked against every captured output: the webview messages, the output
// channel, and the module's files (none). Positive control first.
// Run: node --experimental-strip-types --test test/rehearsal-coach-host.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider.ts';", resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
const { mustStayLocal } = await import('../src/rehearsalRoute.ts');
const { REHEARSAL_COACH_UNAVAILABLE, REHEARSAL_COACH_CODE_MISSING } = await import('../src/rehearsalCoach.ts');

// The two approved student sentences (chalk-po 2026-11-26), exact.
assert.equal(REHEARSAL_COACH_UNAVAILABLE, '이 리허설의 강사 지시를 받지 못해 답을 만들지 않았습니다. 강사에게 알려 주세요.');
assert.equal(REHEARSAL_COACH_CODE_MISSING, '이 창에 리허설 코드가 없어 답을 만들지 않았습니다. 리허설 코드로 다시 들어오세요.');

// Planted values: the system text must reach the turn only (never a message or a log); the code reaches the header only.
const PLANT_SYSTEM = 'PLANT-SYSTEM-LESSON-SEAT-7319';
const PLANT_CODE = 'PLANT-REHEARSAL-CODE-7321';
const REHEARSAL_ID = 'rh-coach-19';

const logs = [];
const vscode = new Proxy({
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    createOutputChannel: () => ({ appendLine: (l) => { logs.push(String(l)); }, show() {}, dispose() {} }),
  },
  workspace: { getConfiguration: () => ({ get: (_k, fallback) => fallback }), workspaceFolders: [] },
  Uri: { joinPath: () => ({ fsPath: '/ext' }), file: p => ({ fsPath: p }) },
  ViewColumn: { One: 1 },
  env: { appName: 'HypeProof Studio', language: 'ko', machineId: 'test-machine' },
  version: '0.0.0-test',
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, { get: () => undefined, apply: () => undefined })) });

// The coach route answer for the current case. `mode` selects the answer; 'ok' returns the subscription contract body.
const coach = { mode: 'ok', calls: [] };
const coachBody = (over = {}) => ({ rehearsal_id: REHEARSAL_ID, lesson_sha256: 'b'.repeat(64), help: 'hint', system: PLANT_SYSTEM, ...over });
const fakeFetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes('/classroom/rehearsal/coach')) return new Response('{}', { status: 404 });
  coach.calls.push({ url: u, auth: init.headers?.authorization });
  if (coach.mode === 'network') throw new Error('offline');
  if (coach.mode === 'ok') return new Response(JSON.stringify(coachBody()), { status: 200 });
  // A server-path answer (text only, no system) sent for a subscription rehearsal: a contract violation.
  if (coach.mode === 'server-shape') return new Response(JSON.stringify({ rehearsal_id: REHEARSAL_ID, lesson_sha256: 'b'.repeat(64), help: 'hint', text: PLANT_SYSTEM }), { status: 200 });
  if (coach.mode === 'system-not-string') return new Response(JSON.stringify(coachBody({ system: 42 })), { status: 200 });
  if (coach.mode === 'system-empty') return new Response(JSON.stringify(coachBody({ system: '' })), { status: 200 });
  if (coach.mode === 'bad-id') return new Response(JSON.stringify(coachBody({ rehearsal_id: 'rh-other' })), { status: 200 });
  if (coach.mode === 'unknown-key') return new Response(JSON.stringify(coachBody({ future_field: 'x' })), { status: 200 });
  const reason = { 403: 'not_in_roster', 404: 'rehearsal_unknown', 409: 'already_judged', 410: 'rehearsal_expired' }[coach.mode];
  return new Response(JSON.stringify({ error: 'english service text', reason }), { status: Number(coach.mode) });
};

const mod = { exports: {} };
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process,
  setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, AbortSignal, AbortController,
  URL, URLSearchParams, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone, Response, Headers, Request,
  fetch: fakeFetch,
});
const { ChatPanelProvider } = mod.exports;

const CODE_KEY = 'hypeproofChat.workshopToken';
function makeProvider({ code = PLANT_CODE } = {}) {
  const store = new Map(code === null ? [] : [[CODE_KEY, code]]);
  const secrets = { get: async k => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); } };
  const memento = () => ({ get: () => undefined, update: async () => {}, keys: () => [] });
  const context = {
    subscriptions: [], extensionUri: { fsPath: '/ext' }, extensionPath: '/ext', extension: { packageJSON: { version: '0.0.0-test' } },
    globalState: memento(), workspaceState: memento(), globalStorageUri: { fsPath: '/tmp/hps-none' }, storageUri: { fsPath: '/tmp/hps-none' },
    secrets,
  };
  const provider = new ChatPanelProvider(context, {}, {});
  const posted = [];
  provider.post = async msg => { posted.push(msg); return true; };
  const profile = { rehearsal: { id: REHEARSAL_ID, course_id: 'course-19', version: 'v1', expires_at: 4_000_000_000_000, judged: false, path: 'subscription' } };
  return { provider, posted, profile };
}
const every = (x) => JSON.stringify(x);
const reset = () => { coach.mode = 'ok'; coach.calls.length = 0; logs.length = 0; vs.asks.length = 0; };
const vs = { asks: [] };

test('positive control: the download returns the planted system text, and the detector sees it placed on purpose', async () => {
  reset();
  const { provider, posted, profile } = makeProvider();
  const system = await provider.rehearsalCoachPrompt(profile, 'criteria', 'hint');
  assert.equal(system, PLANT_SYSTEM, 'the download is the system field, nothing added');
  posted.push({ type: 'probe', note: PLANT_SYSTEM });
  assert.ok(every(posted).includes(PLANT_SYSTEM), 'the detector finds a planted string in a message');
});

test('the learner code goes in the Authorization header only, with step and help as query parameters', async () => {
  reset();
  const { provider, profile } = makeProvider();
  await provider.rehearsalCoachPrompt(profile, 'criteria', 'hint');
  assert.equal(coach.calls.length, 1);
  assert.equal(coach.calls[0].auth, 'Bearer ' + PLANT_CODE);
  assert.ok(coach.calls[0].url.endsWith('/v1/classroom/rehearsal/coach?step=criteria&help=hint'), coach.calls[0].url);
  assert.ok(!coach.calls[0].url.includes(PLANT_CODE), 'the code is not in the URL');
});

test('memory: the same (rehearsal, step, help) downloads once; another step or help downloads again', async () => {
  reset();
  const { provider, profile } = makeProvider();
  await provider.rehearsalCoachPrompt(profile, 'criteria', 'hint');
  await provider.rehearsalCoachPrompt(profile, 'criteria', 'hint');
  assert.equal(coach.calls.length, 1, 'the same combination is kept');
  await provider.rehearsalCoachPrompt(profile, 'look', 'hint');
  await provider.rehearsalCoachPrompt(profile, 'look', 'independent');
  assert.equal(coach.calls.length, 3, 'a changed step or help asks again');
});

test('nothing downloaded is written to a message or a log: the planted system text and the code appear 0 times', async () => {
  reset();
  const { provider, posted, profile } = makeProvider();
  await provider.rehearsalCoachPrompt(profile, 'criteria', 'hint');
  assert.equal(every(posted).includes(PLANT_SYSTEM), false, 'no message carries the system text');
  assert.equal(every(posted).includes(PLANT_CODE), false, 'no message carries the code');
  assert.equal(logs.join('\n').includes(PLANT_SYSTEM), false, 'no log line carries the system text');
  assert.equal(logs.join('\n').includes(PLANT_CODE), false, 'no log line carries the code');
  assert.ok(logs.some(l => l === '[rehearsal-coach] status=200'), 'the status line is logged (facts only)');
});

const refusals = [
  ['403', 'not_in_roster'], ['404', 'rehearsal_unknown'], ['409', 'already_judged'], ['410', 'rehearsal_expired'],
];
for (const [mode, reason] of refusals) {
  test(`a refused download (${mode} ${reason}) shows the approved sentence and runs no turn; the status is logged, not shown`, async () => {
    reset(); coach.mode = mode;
    const { provider, posted, profile } = makeProvider();
    await assert.rejects(provider.rehearsalCoachPrompt(profile, 'criteria', 'hint'), (err) => err.message === REHEARSAL_COACH_UNAVAILABLE);
    assert.equal(every(posted).includes(mode), false, 'no status number in a message');
    assert.ok(logs.some(l => l === `[rehearsal-coach] status=${mode}`), 'the status is in the log');
    assert.equal(every(posted).includes(reason), false, 'the Service reason code is not shown');
  });
}

test('a network failure shows the approved sentence', async () => {
  reset(); coach.mode = 'network';
  const { provider, profile } = makeProvider();
  await assert.rejects(provider.rehearsalCoachPrompt(profile, 'criteria', 'hint'), (err) => err.message === REHEARSAL_COACH_UNAVAILABLE);
});

const contractBreaks = [
  ['server-path answer (text, no system) for a subscription rehearsal', 'server-shape'],
  ['system is not a string', 'system-not-string'],
  ['system is empty', 'system-empty'],
  ['another rehearsal id', 'bad-id'],
];
for (const [label, mode] of contractBreaks) {
  test(`a body that breaks the contract (${label}) is refused and runs no turn`, async () => {
    reset(); coach.mode = mode;
    const { provider, profile } = makeProvider();
    await assert.rejects(provider.rehearsalCoachPrompt(profile, 'criteria', 'hint'), (err) => err.message === REHEARSAL_COACH_UNAVAILABLE);
    assert.ok(logs.some(l => l === '[rehearsal-coach] status=200'), 'the 200 is logged as a broken answer');
  });
}

test('a body with unknown keys is accepted; the system field is used as it is', async () => {
  reset(); coach.mode = 'unknown-key';
  const { provider, profile } = makeProvider();
  assert.equal(await provider.rehearsalCoachPrompt(profile, 'criteria', 'hint'), PLANT_SYSTEM);
});

test('no rehearsal code in this window: no download, and the code-missing sentence', async () => {
  reset();
  const { provider, profile } = makeProvider({ code: null });
  await assert.rejects(provider.rehearsalCoachPrompt(profile, 'criteria', 'hint'), (err) => err.message === REHEARSAL_COACH_CODE_MISSING);
  assert.equal(coach.calls.length, 0, 'no request without a code');
});

test('the call site is limited to a subscription rehearsal turn (server path and ordinary seats keep the dev prompt)', () => {
  assert.equal(mustStayLocal({ path: 'subscription' }), true);
  assert.equal(mustStayLocal({ path: 'server' }), false, 'server path: no coach download');
  assert.equal(mustStayLocal(undefined), false, 'ordinary seat: no coach download');
  const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
  assert.match(src, /const coachPrompt = mustStayLocal\(profile\.rehearsal\) \? await this\.rehearsalCoachPrompt\(profile, turnFocus\.step, turnFocus\.helpMode\) : undefined;/);
  assert.match(src, /const result=await runLocalCoach\(\{config:local,profile,systemPrompt:coachPrompt,/);
  assert.equal((src.match(/rehearsalCoachPrompt\(/g) ?? []).length, 2, 'one definition and one call');
});

test('static: the system text is used in one place only, the runLocalCoach systemPrompt argument, never in a post, log, appendLine or file write', () => {
  const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
  const lines = src.split('\n').filter(l => /\bcoachPrompt\b/.test(l));
  assert.equal(lines.length, 2, 'the declaration line and the runLocalCoach line, nothing else');
  assert.equal(lines.filter(l => /systemPrompt:coachPrompt\b/.test(l)).length, 1, 'one systemPrompt argument');
  for (const l of lines) assert.doesNotMatch(l, /\bpost\(|appendLine|writeFile|appendFile|\blog\b|console\./, 'no sink on the coach line');
  const body = src.slice(src.indexOf('private async rehearsalCoachPrompt('), src.indexOf('private uploadRehearsalTurnFor('));
  assert.doesNotMatch(body, /\bpost\(|writeFile|appendFile/, 'the method posts and writes nothing');
});

test('static: the coach module writes nothing to disk and logs nothing but the status', () => {
  const src = readFileSync(new URL('../src/rehearsalCoach.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /node:fs|writeFile|appendFile|createWriteStream|globalState|workspaceState/);
  assert.doesNotMatch(src, /console\./);
  assert.equal((src.match(/log\?\.\(/g) ?? []).length, 2, 'two log calls, both status-only');
});
