// Release app: a learner-condition subscription rehearsal turn has a local runner only inside a rehearsal seat.
// Plan: _worklog/chalk/engineer/split-restart/plan-release-rehearsal-subscription-tests.md (N1–N6, B1–B6, M1–M6).
// Seats reuse the names of chalk-instructor-seat-gates.smoke.mjs (#4535). The release build condition is
// appName "HypeProof Studio" with no HPS_DEV_RUNTIME. A fake `claude` on PATH stands in for the CLI: `auth status`
// exits 0, a turn writes a run line and a stream-json result. Run: node --experimental-strip-types test/rehearsal-subscription-release.smoke.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: { contents: [
    "export { ChatPanelProvider } from './src/chatPanelProvider';",
    "export { ISSUER_TOKEN_KEY } from './src/mintStudentTokenHelpers';",
    "export { REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY } from './src/rehearsalSeat';",
    "export * as Seat from './src/rehearsalSeat';",
    "export { ACTIVITY_TOKEN_KEY as TOKEN_KEY } from './src/activityConnections';",
    "export { NO_LOCAL_RUNTIME_MESSAGE } from './src/chalkContract';",
    "export { STORE_RUN_NEEDS_SERVICE } from './src/skillStore';",
    "export * as Release from './src/localRuntime/releaseInstructorRuntime';",
  ].join('\n'), resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-subscription-release-')));
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
const home = path.join(tmp, 'home'); fs.mkdirSync(home);
const binDir = path.join(tmp, 'bin'); fs.mkdirSync(binDir);
const runLog = path.join(tmp, 'run.log');
const envLog = path.join(tmp, 'env.log');
const argLog = path.join(tmp, 'argv.log');
// Fake CLI: `auth status` succeeds; a turn records one run line, its argv and the child env, then answers with a success result.
fs.writeFileSync(path.join(binDir, 'claude'), [
  '#!/bin/sh',
  `if [ "$1" = "auth" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0; fi`,
  `echo run >> "${runLog}"`,
  `printf '%s\\n' "$*" >> "${argLog}"`,
  `env >> "${envLog}"`,
  `printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{}}'`,
  '',
].join('\n'), { mode: 0o755 });
const savedPath = process.env.PATH;
process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
const CLI_PATH = path.join(binDir, 'claude');

const toUri = p => ({ fsPath: p, path: p, scheme: 'file' });
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
let runtime = 'chalk-extension';
// The coach runtime setting a turn reads (F2 runs one turn on the agent-sdk runtime); the upload status a turn gets back.
let coachRuntimeSetting = 'proxy';
let uploadStatus = 201;
const commands = [];
const ui = { modal: [], answer: undefined, onModal: undefined };
const modal = async (message, _opts, ...items) => { ui.modal.push({ message, items }); await ui.onModal?.(); return ui.answer; };
const ws = { folder: work };
const vscode = new Proxy({
  env: { appName: 'HypeProof Studio' },
  window: { showWarningMessage: modal, showInformationMessage: modal, withProgress: async (_o, task) => task({ report() {} }), createOutputChannel: () => ({ appendLine() {} }) },
  ProgressLocation: { Window: 10, Notification: 15 },
  workspace: { getConfiguration: () => ({ get: (k, fallback) => (k === 'instructorRuntime' ? runtime : k === 'coachRuntime' ? coachRuntimeSetting : fallback) }), get workspaceFolders() { return [{ uri: toUri(ws.folder), name: 'w' }]; }, textDocuments: [] },
  Uri: { joinPath: () => toUri('/ext'), file: toUri },
  ViewColumn: { One: 1 },
  commands: { executeCommand: async (...a) => { commands.push(a); return undefined; }, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
// The upload path calls the global fetch: the sandbox gets a recording stub, never the network.
const fetchCalls = [];
const fakeFetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), init });
  const status = String(url).includes('/classroom/rehearsal/turns') ? uploadStatus : 201;
  return new Response(JSON.stringify({ ok: status < 300 }), { status, headers: { 'content-type': 'application/json' } });
};
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, fetch: fakeFetch, crypto: globalThis.crypto, Response, URL, AbortController, AbortSignal, setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval,
  __filename: path.join(ext, 'src/extension.ts'), __dirname: ext, TextEncoder, TextDecoder, structuredClone, queueMicrotask, performance, URLSearchParams, Headers, Request });
const { ChatPanelProvider, ISSUER_TOKEN_KEY, REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY, TOKEN_KEY, NO_LOCAL_RUNTIME_MESSAGE, STORE_RUN_NEEDS_SERVICE, Seat, Release } = mod.exports;
assert.ok(ChatPanelProvider && ISSUER_TOKEN_KEY && REHEARSAL_RETURN_KEY && TOKEN_KEY && Seat && Release, 'bundle exports');
// A name missing from the build (the base has no learner gate) is a failed check, not a crashed run.
const learnerRehearsalRuntime = async (...a) => (Release.learnerRehearsalRuntime ? Release.learnerRehearsalRuntime(...a) : { ok: false, reason: 'not_in_build' });
const releaseInstructorRuntime = (...a) => Release.releaseInstructorRuntime(...a);
const rehearsalInsideFor = async (...a) => (Seat.rehearsalInsideFor ? Seat.rehearsalInsideFor(...a) : false);

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const identity = { u: 'learner-1', c: 'cohort-1', p: 'profile-1' };
const learnerToken = exp => `${b64({ ...identity, exp })}.sig`;
const LIVE = learnerToken(Math.floor(Date.now() / 1000) + 3600);
const EXPIRED = learnerToken(Math.floor(Date.now() / 1000) - 60);
// A sentinel stands in for the instructor credential: it must never reach a request, an env or a log line.
const ISSUER_SENTINEL = 'ISSUER-SENTINEL-7f3a91';
const personal = { profile_id: 'p', activity_id: 'a'.repeat(64), activity_kind: 'personal', minor_cohort: false, sdk_tools: { read: true, write: true, shell: true }, tools: {}, learning_wiki: { enabled: true } };
const rehearsalProfile = { ...personal, ux: { coach: {} }, rehearsal: { id: 'rehearsal-1', path: 'subscription' }, lesson: { course_id: 'course', version: 'v1', content: { steps: [{ id: 'step-1', help: { default: 'help text' } }] } } };
const HISTORY = [{ id: 'u0', role: 'user', content: '첫 질문', createdAt: 1000 }, { id: 'a0', role: 'assistant', content: '답', createdAt: 1000 }];

function instructorMode(verdict) {
  const base = {
    _v: null, pending: null,
    get isInstructor() { return this._v; },
    get verifiedServerUrl() { return undefined; },
    async checkInstructorMode(issuer) {
      if (!issuer) { this._v = false; return false; }
      const v = this.pending ? await this.pending : verdict;
      this._v = v; return v;
    },
    reset() { this._v = null; },
    async revertModelOnTurnError() {},
    handleAutoReadResult() { return null; },
    async fetchInstructorBrief() { return undefined; },
  };
  // Other decision hooks the turn reports to: no-op (the verdict above is the only input this test varies).
  return new Proxy(base, { get: (t, k) => (k in t ? Reflect.get(t, k, t) : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
}

/** A provider with the real prototype and the seat's secrets. `reads` records every secret key read. */
function seat({ secrets, profile, verdict = true, run = 'chalk-extension' }) {
  const store = new Map(Object.entries(secrets));
  const reads = [];
  let hook;
  const global = new Map();
  const posts = [];
  const context = {
    subscriptions: [], extensionUri: toUri('/ext'), extensionPath: '/ext', extension: { packageJSON: {} },
    globalState: { get: k => global.get(k), update: async (k, v) => { global.set(k, v); }, keys: () => [...global.keys()] },
    workspaceState: { get: (_k, f) => f, update: async () => {} },
    globalStorageUri: toUri(tmp), storageUri: toUri(tmp),
    secrets: { get: async k => { reads.push(k); const v = store.get(k); if (hook) { const over = await hook(k, v); if (over !== undefined) return over; } return v; }, store: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); }, onDidChange: () => ({ dispose() {} }) },
  };
  const h = Object.create(ChatPanelProvider.prototype);
  const taskStore = new Proxy({ scope: 's', getView: () => ({ activeTaskId: 't1' }), isTemporary: () => false, getDraft: () => ({}), getHistory: () => HISTORY, append: async () => {} }, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  Object.assign(h, {
    context, cachedProfile: profile, lastProfileFailure: null, profileGeneration: 0,
    loadAccess: async () => {}, refreshCrDirectorContext: async () => {},
    _instructorMode: instructorMode(verdict), prepareTaskWorkspace: async () => {}, currentTaskStore: () => taskStore,
    getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }), servedWorkspaceRoot: work,
    preview: { setAskAboutFileEnabled: () => {}, setReviewBar: () => {} },
    classWindowSource: () => null,
    syncChalkContract() {}, endChalkSessionForRuntime: async () => {},
    post: async m => { posts.push(JSON.parse(JSON.stringify(m))); return true; },
    postDenialNotice: async () => {},
    resolveCoachCwd: () => work,
    provenanceRecorder: () => ({ unobserved: () => {} }),
  });
  const config = async () => {
    runtime = run; commands.length = 0;
    await h.postConfig();
    return posts.filter(m => m.type === 'config').at(-1)?.config;
  };
  return { h, store, reads, posts, config, setHook: fn => { hook = fn; } };
}

const rehearsalRecord = (phase, folder = work) => JSON.stringify({ phase, rehearsalId: 'rehearsal-1', expiresAt: Date.now() + 3600000, homeFolder: home, rehearsalFolder: folder, stucks: [] });
// The rehearsal seats hold the instructor credential under the return key only (enterRehearsal deletes ISSUER_TOKEN_KEY).
const SPEC = {
  chalk: { secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL, [TOKEN_KEY]: EXPIRED } },
  legacy: { secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL, [TOKEN_KEY]: EXPIRED }, run: 'legacy' },
  learner: { secrets: { [TOKEN_KEY]: LIVE } },
  rehearsal: { secrets: { [REHEARSAL_RETURN_KEY]: ISSUER_SENTINEL, [REHEARSAL_SEAT_KEY]: rehearsalRecord('inside'), [TOKEN_KEY]: LIVE } },
  rehearsalExpired: { secrets: { [REHEARSAL_RETURN_KEY]: ISSUER_SENTINEL, [REHEARSAL_SEAT_KEY]: rehearsalRecord('inside'), [TOKEN_KEY]: EXPIRED } },
  both: { secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL, [TOKEN_KEY]: LIVE } },
  // An instructor decision (issuer verified, legacy runtime, expired learner token so the learner slot does not win)
  // with the rehearsal return and inside record also present. The learner gate must stay closed (N6, M4).
  instructorInside: { secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL, [REHEARSAL_RETURN_KEY]: ISSUER_SENTINEL, [REHEARSAL_SEAT_KEY]: rehearsalRecord('inside'), [TOKEN_KEY]: EXPIRED }, run: 'legacy' },
};
const SEATS = Object.keys(SPEC);
const OPEN = ['rehearsal', 'rehearsalExpired'];
const CLOSED = SEATS.filter(s => !OPEN.includes(s));
const realCli = { locate: p => (p === 'claude' ? CLI_PATH : null), loginOk: async () => true };
let passed = 0;
const failures = [];
const ok = (id, name) => { passed++; console.log(`✓ ${id} ${name}`); };
const bad = (id, name, why) => { failures.push(`${id} ${name}: ${why}`); console.log(`✗ ${id} ${name}: ${why}`); };
const check = (id, name, cond, why) => (cond ? ok(id, name) : bad(id, name, why));

// G — the gate itself (release build inputs; no provider).
{
  const got = await learnerRehearsalRuntime({ rehearsal: true, inside: true }, realCli);
  check('G1', 'inside a rehearsal seat, the learner runner opens on the local CLI path', got.ok === true && got.config?.provider === 'claude' && path.isAbsolute(got.config.executable), `got ${JSON.stringify(got)}`);
  const outside = await learnerRehearsalRuntime({ rehearsal: true, inside: false }, realCli);
  check('G2', 'a rehearsal profile outside an inside seat stays closed', outside.ok === false && outside.reason === 'not_inside', JSON.stringify(outside));
  const notRehearsal = await learnerRehearsalRuntime({ rehearsal: false, inside: true }, realCli);
  check('G3', 'a non-rehearsal profile stays closed even inside a seat', notRehearsal.ok === false && notRehearsal.reason === 'not_rehearsal', JSON.stringify(notRehearsal));
  const noCli = await learnerRehearsalRuntime({ rehearsal: true, inside: true }, { locate: () => null, loginOk: async () => true });
  check('G4', 'no CLI keeps the learner runner closed with the CLI reason', noCli.ok === false && noCli.reason === 'no_cli', JSON.stringify(noCli));
  const instructor = await releaseInstructorRuntime({ isInstructor: true, panelMode: 'instructor', rehearsal: true, setting: true }, realCli);
  check('G5', 'the instructor release gate still refuses a rehearsal profile (#3608)', instructor.ok === false && instructor.reason === 'rehearsal', JSON.stringify(instructor));
}

// G6 — the seat check reads only the return key and the seat record, never the issuer (N1 at the helper).
{
  const s = seat({ secrets: SPEC.rehearsal.secrets, profile: rehearsalProfile });
  const inside = await rehearsalInsideFor(s.h.context.secrets, work);
  check('G6a', 'rehearsalInsideFor is true for an inside seat with the return held', inside === true, 'false');
  check('G6b', 'rehearsalInsideFor reads no issuer key (N1)', !s.reads.includes(ISSUER_TOKEN_KEY), `reads ${JSON.stringify(s.reads)}`);
  const entering = seat({ secrets: { ...SPEC.rehearsal.secrets, [REHEARSAL_SEAT_KEY]: rehearsalRecord('entering') }, profile: rehearsalProfile });
  check('G6c', 'an entering seat is not inside', (await rehearsalInsideFor(entering.h.context.secrets, work)) === false, 'true');
  const noReturn = seat({ secrets: { [REHEARSAL_SEAT_KEY]: rehearsalRecord('inside') }, profile: rehearsalProfile });
  check('G6d', 'no held return is not inside', (await rehearsalInsideFor(noReturn.h.context.secrets, work)) === false, 'true');
}

// P — the provider's turn guard and runner for each seat (real postConfig, real handleSend up to the runner).
const turnRows = {};
async function turnFor(which, opts = {}) {
  coachRuntimeSetting = opts.runtime ?? 'proxy';
  uploadStatus = opts.uploadStatus ?? 201;
  const s = seat({ ...SPEC[which], profile: rehearsalProfile, run: SPEC[which].run });
  await s.config();
  s.h.cachedProfile = rehearsalProfile;
  // A store-run task: the send carries a store skill run (the Service composes it; no local runner may take it).
  if (opts.storeRun) s.h.storeRunFor = () => `ski_${'a'.repeat(32)}@1`;
  // F1: the instructor tool builder is called only by the instructor branch; a learner turn must never call it.
  let browserToolCalls = 0;
  s.h.instructorBrowserTools = () => { browserToolCalls++; return undefined; };
  // F3: every read of the issuer key during the turn, with the value it returned (the turn-end postConfig reads it).
  const issuerValues = [];
  s.setHook(async (k, v) => { if (k === ISSUER_TOKEN_KEY) issuerValues.push(v); return undefined; });
  const argvBefore = fs.existsSync(argLog) ? fs.readFileSync(argLog, 'utf8').split('\n').filter(Boolean).length : 0;
  s.h.ensureProfile = async () => rehearsalProfile;
  s.h.rehearsalCoachPrompt = async () => 'coach-prompt';
  s.h.takeMaterials = async () => undefined;
  // Verify-session hooks the send calls at its edges; the learner turn reads none of their results, so no-op hooks.
  s.h.verifySession = new Proxy({ running: false, takeCoachContext: () => null }, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  // Per-turn host maps the send writes to (the seat test in #4535 sets activeStreams the same way).
  s.h.activeStreams = new Map(); s.h.taskMemoryStreams = new Map(); s.h.turnTimelines = new Map(); s.h.delegationControls = new Map();
  s.h.crSdkResults = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  s.h.rehearsalUploadUnsent = new Map();
  s.h.learnerNicknameKey = () => 'nick';
  s.h.fileTurnIds = new Set();
  s.h.restoreStyleTweakPreview = () => {}; s.h.elementQueue = { take: () => null, queued: null };
  const runsBefore = fs.existsSync(runLog) ? fs.readFileSync(runLog, 'utf8').split('\n').filter(Boolean).length : 0;
  const fetchBefore = fetchCalls.length;
  const readsBefore = s.reads.length;
  let error;
  await s.h.handleSend('안녕', [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, true).catch(e => { error = e; });
  // The upload is fire-and-forget after the turn. Wait for it to settle (up to 2 s); the counts below are exact either way.
  const settleUntil = Date.now() + 2000;
  while (Date.now() < settleUntil && !fetchCalls.slice(fetchBefore).some(c => c.url.includes('/classroom/rehearsal/turns'))) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 50));
  if (process.env.REHEARSAL_TEST_DEBUG) console.log(`[debug ${which}] error=${error?.message ?? 'none'} posts=${JSON.stringify(s.posts.map(m => [m.type, m.error ?? m.message ?? '']))}`);
  const runs = (fs.existsSync(runLog) ? fs.readFileSync(runLog, 'utf8').split('\n').filter(Boolean).length : 0) - runsBefore;
  const uploads = fetchCalls.slice(fetchBefore).filter(c => c.url.includes('/classroom/rehearsal/turns'));
  const issuerReads = s.reads.slice(readsBefore).filter(k => k === ISSUER_TOKEN_KEY).length;
  const argv = (fs.existsSync(argLog) ? fs.readFileSync(argLog, 'utf8').split('\n').filter(Boolean) : []).slice(argvBefore);
  return { s, error, runs, uploads, issuerReads, issuerValues, browserToolCalls, argv, noLocal: error?.message === NO_LOCAL_RUNTIME_MESSAGE };
}
for (const which of SEATS) turnRows[which] = await turnFor(which);
console.log(`  info: isInstructor after the turn: ${SEATS.map(w => `${w}=${turnRows[w].s.h._instructorMode.isInstructor}`).join(' ')}`);

for (const which of CLOSED) {
  const row = turnRows[which];
  check(`P-${which}`, `${which}: the turn is refused before any runner or upload (N4/N6)`, row.noLocal && row.runs === 0 && row.uploads.length === 0, `error=${row.error?.message ?? row.error} runs=${row.runs} uploads=${row.uploads.length}`);
}
for (const which of OPEN) {
  const row = turnRows[which];
  check(`B2-${which}`, `${which}: the turn is not refused with NO_LOCAL_RUNTIME_MESSAGE (B2)`, !row.noLocal, `refused: ${row.error?.message}`);
  check(`B1-${which}`, `${which}: the learner runner runs once (B1)`, row.runs === 1, `runs=${row.runs} error=${row.error?.message ?? row.error}`);
  check(`B3-${which}`, `${which}: one upload to the rehearsal turn route (B3)`, row.uploads.length === 1, `uploads=${row.uploads.length} error=${row.error?.message ?? row.error}`);
  const auth = row.uploads[0]?.init?.headers?.authorization ?? row.uploads[0]?.init?.headers?.Authorization;
  const code = SPEC[which].secrets[TOKEN_KEY];
  check(`B5-${which}`, `${which}: the upload authorization is this seat's rehearsal code, not the issuer (B5)`, typeof auth === 'string' && auth.includes(code) && !auth.includes(ISSUER_SENTINEL), `auth=${typeof auth === 'string' ? 'present' : auth}`);
}
const rehearsalRow = turnRows.rehearsal;
// N1 is about the new gate. The turn as a whole also runs postConfig at its end, which reads the issuer key itself
// (the same read as before this change); that count is printed for the base comparison, not asserted here.
{
  const s = seat({ secrets: SPEC.rehearsal.secrets, profile: rehearsalProfile });
  await s.config();
  const before = s.reads.length;
  const gate = typeof s.h.learnerRehearsalLocal === 'function' ? await s.h.learnerRehearsalLocal(true) : null;
  const gateIssuerReads = s.reads.slice(before).filter(k => k === ISSUER_TOKEN_KEY).length;
  check('N1-gate', 'the learner rehearsal gate reads no issuer token (N1)', gateIssuerReads === 0 && gate !== null, `issuer reads ${gateIssuerReads}, gate ${gate === null ? 'closed' : 'open'}`);
  console.log(`  info: issuer-key reads during the whole rehearsal turn = ${rehearsalRow.issuerReads} (turn-end postConfig included)`);
}
const allHeaders = JSON.stringify(fetchCalls.map(c => c.init));
const envText = fs.existsSync(envLog) ? fs.readFileSync(envLog, 'utf8') : '';
check('N2-headers', 'no instructor credential in any request header or body (N2)', !allHeaders.includes(ISSUER_SENTINEL), 'sentinel found in a request');
check('N2-env', 'no instructor credential in the runner environment (N2)', !envText.includes(ISSUER_SENTINEL), 'sentinel found in the child env');
// D8 — a store-run turn never reaches the learner rehearsal runner (behaviour, not the source anchor).
{
  const row = await turnFor('rehearsal', { storeRun: true });
  const refused = row.s.posts.some(m => m.type === 'streamError' && m.error === STORE_RUN_NEEDS_SERVICE);
  check('D8-store', 'a store-run turn in the learner rehearsal seat is refused before any local runner', refused && row.runs === 0 && row.uploads.length === 0, `refused=${refused} runs=${row.runs} uploads=${row.uploads.length} error=${row.error?.message ?? 'none'}`);
}
// N2 widened (F3-iii): the credential appears in no request body or header, no output, no argv and no env of the learner turn.
{
  const everything = JSON.stringify({ fetch: fetchCalls.map(c => c.init), posts: rehearsalRow.s.posts, argv: rehearsalRow.argv }) + envText;
  check('N2-all', 'the instructor credential is in no request, header, output, argv or env of the learner turn (N2, F3-iii)', !everything.includes(ISSUER_SENTINEL), 'sentinel found in a learner-turn output');
}
// F3 (ii): the issuer key is read once during the learner turn (the turn-end postConfig) and returns nothing.
check('N1-turn', 'the learner turn reads the issuer key only at turn end, and it returns nothing (F3-ii)', rehearsalRow.issuerValues.length === 1 && rehearsalRow.issuerValues.every(v => v === undefined), `reads=${rehearsalRow.issuerValues.length} values=${JSON.stringify(rehearsalRow.issuerValues)}`);
// F1 — the learner turn's tools: no instructor tool builder call, and the CLI is given only the studio tool server.
check('T-browser', 'the learner turn never calls the instructor tool builder (F1)', rehearsalRow.browserToolCalls === 0, `calls=${rehearsalRow.browserToolCalls}`);
check('T-argv', 'the learner CLI call names the studio tool server only and no chalk tool (F1)', rehearsalRow.argv.length === 1 && rehearsalRow.argv[0].includes('mcp__studio__*') && !/chalk/i.test(rehearsalRow.argv[0]), `argv=${JSON.stringify(rehearsalRow.argv).slice(0, 200)}`);
// B6 — the upload body says the turn was answered and names its step.
{
  const body = rehearsalRow.uploads[0] ? JSON.parse(rehearsalRow.uploads[0].init.body) : {};
  check('B6-answered', 'the upload says the turn was answered (B6)', body.answered === true, `answered=${body.answered}`);
  check('B6-step', 'the upload carries the step id of the turn (B6)', body.step_id === 'step-1', `step_id=${body.step_id}`);
}
// B4 — the report sends only what is still unsent.
{
  const turnUploads = () => fetchCalls.filter(c => c.url.includes('/classroom/rehearsal/turns')).length;
  const sent = turnUploads();
  await rehearsalRow.s.h.sendRehearsalReport([], undefined, undefined).catch(() => undefined);
  check('B4-sent', 'a report after an uploaded turn sends no second upload (B4)', turnUploads() - sent === 0, `extra=${turnUploads() - sent}`);
  const fresh = seat({ secrets: SPEC.rehearsal.secrets, profile: rehearsalProfile });
  await fresh.config(); fresh.h.cachedProfile = rehearsalProfile; fresh.h.rehearsalUploadUnsent = new Map();
  const none = turnUploads();
  await fresh.h.sendRehearsalReport([], undefined, undefined).catch(() => undefined);
  check('B4-none', 'a report without any turn uploads nothing (B4)', turnUploads() - none === 0, `extra=${turnUploads() - none}`);
  const failed = await turnFor('rehearsal', { uploadStatus: 500 });
  const unsentBefore = failed.s.h.rehearsalUploadUnsent.size;
  uploadStatus = 201;
  const retryFrom = turnUploads();
  await failed.s.h.sendRehearsalReport([], undefined, undefined).catch(() => undefined);
  const retried = fetchCalls.filter(c => c.url.includes('/classroom/rehearsal/turns')).slice(retryFrom);
  const sameTurn = retried.length === 1 && JSON.parse(retried[0].init.body).turn_id === JSON.parse(failed.uploads.at(-1).init.body).turn_id;
  check('B4-retry', 'a failed turn upload is retried once by the report, with the same turn id, then the queue is empty (B4)', unsentBefore === 1 && sameTurn && failed.s.h.rehearsalUploadUnsent.size === 0, `unsent before=${unsentBefore} retries=${retried.length} sameTurn=${sameTurn} queue=${failed.s.h.rehearsalUploadUnsent.size}`);
}
// F2 — a store-run turn on the agent-sdk runtime with a local runner is refused by the `local` term alone.
{
  const row = await turnFor('rehearsal', { storeRun: true, runtime: 'agent-sdk' });
  const refused = row.s.posts.some(m => m.type === 'streamError' && m.error === STORE_RUN_NEEDS_SERVICE);
  check('D8-sdk', 'a store-run turn on the agent-sdk runtime is refused before any local runner (F2)', refused && row.runs === 0 && row.uploads.length === 0, `refused=${refused} runs=${row.runs} uploads=${row.uploads.length} error=${row.error?.message ?? 'none'}`);
  coachRuntimeSetting = 'proxy';
}
check('N3-flags','isInstructor stays false in the rehearsal turn (N3)', rehearsalRow.s.h._instructorMode.isInstructor !== true, `isInstructor ${rehearsalRow.s.h._instructorMode.isInstructor}`);

process.env.PATH = savedPath;
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
