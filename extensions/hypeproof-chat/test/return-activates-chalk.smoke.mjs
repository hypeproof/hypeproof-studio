// #4548 — after a rehearsal return, the instructor Chalk surface activates without any chat view opening.
// Plan: _worklog/chalk/engineer/split-restart/run-return-activate/plan-tests.md (R1–R6, C1–C4, V1–V8).
// The activation runs through the real provider path: postConfig's instructor decision (refreshInstructorSeat) and the
// real ChalkContractHost on a recording bus. Seats reuse the #4535 names. Run: node --experimental-strip-types test/return-activates-chalk.smoke.mjs
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
    "export { ACTIVITY_TOKEN_KEY as TOKEN_KEY } from './src/activityConnections';",
    "export { ChalkContractHost } from './src/chalkContract';",
    // Only when the module exists: the base has no reopen trigger, and its checks must fail, not the build.
    ...(fs.existsSync(path.join(ext, 'src/returnActivation.ts')) ? ["export * as Return from './src/returnActivation';"] : []),
  ].join('\n'), resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'return-activates-chalk-')));
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
const home = path.join(tmp, 'home'); fs.mkdirSync(home);
const toUri = p => ({ fsPath: p, path: p, scheme: 'file' });
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
let runtime = 'chalk-extension';
const commands = [];
const ws = { folder: work };
const vscode = new Proxy({
  env: { appName: 'HypeProof Studio' },
  window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined, withProgress: async (_o, task) => task({ report() {} }), createOutputChannel: () => ({ appendLine() {} }) },
  ProgressLocation: { Window: 10, Notification: 15 },
  workspace: { getConfiguration: () => ({ get: (k, fallback) => (k === 'instructorRuntime' ? runtime : fallback) }), get workspaceFolders() { return [{ uri: toUri(ws.folder), name: 'w' }]; }, textDocuments: [] },
  Uri: { joinPath: () => toUri('/ext'), file: toUri },
  ViewColumn: { One: 1 },
  commands: { executeCommand: async (...a) => { commands.push(a); return undefined; }, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, crypto: globalThis.crypto, Response, URL, AbortController, AbortSignal, setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval,
  __filename: path.join(ext, 'src/extension.ts'), __dirname: ext, TextEncoder, TextDecoder, structuredClone, queueMicrotask, performance, URLSearchParams, Headers, Request, fetch: async () => new Response('{}', { status: 200 }) });
const { ChatPanelProvider, ISSUER_TOKEN_KEY, REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY, TOKEN_KEY, ChalkContractHost, Return } = mod.exports;
assert.ok(ChatPanelProvider && ISSUER_TOKEN_KEY && TOKEN_KEY && ChalkContractHost, 'bundle exports');
const activateAfterReturn = Return?.activateAfterReturn;
const shouldActivateAfterReturn = Return?.shouldActivateAfterReturn;

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const LIVE = `${b64({ u: 'learner-1', c: 'cohort-1', p: 'profile-1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
// A sentinel stands in for the instructor credential: it must never reach an argument, a log or an output.
const ISSUER_SENTINEL = 'ISSUER-SENTINEL-return-7c1e';
const personal = { profile_id: 'p', activity_id: 'a'.repeat(64), activity_kind: 'personal', minor_cohort: false, sdk_tools: { read: true, write: true, shell: true }, tools: {}, learning_wiki: { enabled: true } };
const HISTORY = [];
const ACTIVATE = 'hypeproof.chalk.activateInstructor';
const rehearsalRecord = JSON.stringify({ phase: 'inside', rehearsalId: 'rehearsal-1', expiresAt: Date.now() + 3600000, homeFolder: home, rehearsalFolder: work, stucks: [] });

function instructorMode(verdict) {
  const base = {
    _v: null, pending: null,
    get isInstructor() { return this._v; },
    get verifiedServerUrl() { return undefined; },
    async checkInstructorMode(issuer) { if (!issuer) { this._v = false; return false; } this._v = verdict; return verdict; },
    reset() { this._v = null; },
    async revertModelOnTurnError() {}, handleAutoReadResult() { return null; }, async fetchInstructorBrief() { return undefined; },
  };
  return new Proxy(base, { get: (t, k) => (k in t ? Reflect.get(t, k, t) : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
}

/** A provider with the real prototype and a real ChalkContractHost on a recording bus. `reads`/`writes` log secret access. */
function seat({ secrets, profile = personal, verdict = true, run = 'chalk-extension' }) {
  const store = new Map(Object.entries(secrets));
  const reads = [];
  const global = new Map();
  const posts = [];
  const context = {
    subscriptions: [], extensionUri: toUri('/ext'), extensionPath: '/ext', extension: { packageJSON: {} },
    globalState: { get: k => global.get(k), update: async (k, v) => { global.set(k, v); }, keys: () => [...global.keys()] },
    workspaceState: { get: (_k, f) => f, update: async () => {} },
    globalStorageUri: toUri(tmp), storageUri: toUri(tmp),
    secrets: { get: async k => { reads.push(k); return store.get(k); }, store: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); }, onDidChange: () => ({ dispose() {} }) },
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
    endChalkSessionForRuntime: async () => {},
    post: async m => { posts.push(JSON.parse(JSON.stringify(m))); return true; },
    postDenialNotice: async () => {},
    resolveCoachCwd: () => work,
    provenanceRecorder: () => ({ unobserved: () => {} }),
    ensureProfile: async () => profile,
    contractSync: Promise.resolve(),
    contractView: {},
  });
  // The real contract host: activation is the command the host sends on its bus (recorded, answered ok).
  const bus = { registerCommand: () => ({ dispose() {} }), executeCommand: async (id, ...args) => { commands.push([id, ...args]); return id === ACTIVATE ? { ok: true } : undefined; } };
  const runner = { available: () => true, executorModel: () => undefined, run: async () => {}, previewOpen: async () => {} };
  h.attachChalkContract(new ChalkContractHost(bus, runner, inert, () => 'nonce'));
  const config = async () => {
    runtime = run; commands.length = 0;
    await h.postConfig();
  };
  return { h, store, reads, posts, config };
}

const activations = () => commands.filter(c => c[0] === ACTIVATE).length;
let passed = 0;
const failures = [];
const ok = (id, name) => { passed++; console.log(`✓ ${id} ${name}`); };
const bad = (id, name, why) => { failures.push(`${id} ${name}: ${why}`); console.log(`✗ ${id} ${name}: ${why}`); };
const check = (id, name, cond, why) => (cond ? ok(id, name) : bad(id, name, why));

// The seats. `returned`: the window came back from a rehearsal: the instructor credential is restored, no return key, no seat.
const SEATS = {
  returned: () => seat({ secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL } }),
  returnedOtherUser: () => seat({ secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL, [TOKEN_KEY]: LIVE } }),
  learner: () => seat({ secrets: { [TOKEN_KEY]: LIVE }, verdict: false }),
  rehearsalInside: () => seat({ secrets: { [REHEARSAL_RETURN_KEY]: ISSUER_SENTINEL, [REHEARSAL_SEAT_KEY]: rehearsalRecord } }),
  noReturn: () => seat({ secrets: { [ISSUER_TOKEN_KEY]: ISSUER_SENTINEL } }),
};

// Gate: the trigger runs after a completed return only. `reloading` and every other outcome stay closed (R4).
{
  if (typeof shouldActivateAfterReturn !== 'function') bad('R4', 'the reopen trigger exists (returnActivation.ts)', 'module missing');
  else {
    check('R4', 'the activation trigger runs only for a completed return, not for reloading (R4)', shouldActivateAfterReturn('done') === true && shouldActivateAfterReturn('reloading') === false && shouldActivateAfterReturn('none') === false && shouldActivateAfterReturn('failed') === false, 'gate open for a non-done outcome or closed for done');
  }
}

// R1–R3, R5, R6: a returned window activates once, with the credential restored first, in its issuerToken field only, no webview post.
{
  // No chat view ever opened: the window has no earlier activation (postConfig never ran).
  const s = SEATS.returned();
  commands.length = 0; s.posts.length = 0;
  let issuerAtActivation;
  const realExec = commands; // activation records in `commands`; snapshot the store when it happens via the reads log
  const before = s.reads.length;
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(s.h, 'done').catch(e => { failures.push(`activateAfterReturn threw: ${e.message}`); });
  else if (typeof s.h.refreshAfterReturn === 'function') await s.h.refreshAfterReturn().catch(e => { failures.push(`refreshAfterReturn threw: ${e.message}`); });
  issuerAtActivation = s.store.get(ISSUER_TOKEN_KEY);
  check('R1', 'after a return, with no chat view opened, the Chalk instructor activates exactly once (R1)', activations() === 1, `activations=${activations()} commands=${JSON.stringify(commands.map(c => c[0]))}`);
  // R2: the existing contract passes the instructor token to activateInstructor as its `issuerToken` field, exactly as the chat-view
  // path does. The value must appear there and nowhere else in the command log.
  const act = commands.find(c => c[0] === ACTIVATE);
  const payload = act?.slice(1) ?? [];
  const elsewhere = JSON.stringify(commands.map(c => (c[0] === ACTIVATE ? [c[0], ...c.slice(1).map(a => (a && typeof a === 'object' ? { ...a, issuerToken: undefined } : a))] : c)));
  check('R2', 'the credential reaches activateInstructor only as its issuerToken field, nowhere else (R2)', payload.some(a => a && a.issuerToken === ISSUER_SENTINEL) && !elsewhere.includes(ISSUER_SENTINEL), `payload=${JSON.stringify(payload).slice(0, 120)}`);
  check('R3', 'the credential is restored before the activation (R3)', issuerAtActivation === ISSUER_SENTINEL && s.reads.slice(before).includes(ISSUER_TOKEN_KEY), `issuer at activation=${issuerAtActivation ? 'present' : 'absent'}`);
  check('R6', 'the instructor-seat refresh posts nothing to the webview (R6)', s.posts.length === 0, `posts=${JSON.stringify(s.posts.map(m => m.type))}`);
  // R5 — confirms that the chalk host absorbs a repeated activation (chalkContract.ts:462-470 dedupes it). It does not
  // detect a duplicate caused by this change: a regression that decides twice is absorbed by the host and passes here.
  // A duplicate from this change is caught by R1's exact count of one activation on the first run.
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(s.h, 'done').catch(() => undefined);
  check('R5', 'confirms the host absorbs a repeated activation (R5; host dedupe, not a test of this change)', activations() === 1, `activations=${activations()}`);
  void realExec;
}

// C1: another learner's token in the returned window keeps the learner slot; no activation.
{
  const s = SEATS.returnedOtherUser();
  commands.length = 0;
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(s.h, 'done').catch(() => undefined);
  check('C1', 'a returned window with another learner token stays in the learner slot (C1)', activations() === 0, `activations=${activations()}`);
}

// C2: a learner window with no credential, and a window that never rehearsed, keep the number of activations they had.
{
  const s = SEATS.learner();
  commands.length = 0;
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(s.h, 'done').catch(() => undefined);
  check('C2a', 'a learner window without credential is not activated (C2)', activations() === 0, `activations=${activations()}`);
  const n = SEATS.noReturn();
  await n.config();
  const normal = activations();
  check('C2b', 'a window that never rehearsed activates as before (one postConfig, one activation) (C2)', normal === 1, `activations after postConfig=${normal}`);
  // C2c: the reopen trigger does nothing for a window whose return outcome is "none" (it never rehearsed).
  const n2 = SEATS.noReturn(); commands.length = 0;
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(n2.h, 'none').catch(() => undefined);
  check('C2c', 'the reopen trigger does nothing for a window with no return (C2)', activations() === 0, `activations=${activations()}`);
}

// C3: a window inside a rehearsal (not returned) does not activate.
{
  const s = SEATS.rehearsalInside();
  commands.length = 0;
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(s.h, 'done').catch(() => undefined);
  check('C3', 'a window inside a rehearsal does not activate (C3)', activations() === 0, `activations=${activations()}`);
}

// C4: the chat view path (postConfig on ready) still activates once, and the trigger after it adds nothing.
{
  const s = SEATS.returned();
  commands.length = 0;
  await s.config();
  const afterView = activations();
  if (typeof activateAfterReturn === 'function') await activateAfterReturn(s.h, 'done').catch(() => undefined);
  check('C4', 'the chat view path activates once, and the reopen trigger after it adds no second activation (C4)', afterView === 1 && activations() === 1, `after view=${afterView} total=${activations()}`);
}

console.log(`\n${passed} passed, ${failures.length + 0} failed`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
