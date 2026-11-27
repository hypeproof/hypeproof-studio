// #4535 — with instructorRuntime "chalk-extension", postConfig resets the instructor decision (Studio must not run
// instructor turns there) and isInstructor reads null. The learner-only surfaces and learner record writes must still
// stay closed for an instructor seat. They read `instructorSeat`, set by the real postConfig from the instructor
// decision. This test never writes that field: every seat is built through postConfig from secrets and a profile.
//
// The instructor seat is the reachable state found in the design review: the cached learner profile is kept after the
// learner token passes its `exp`, so decideMode returns "instructor" while the profile still offers learner tools.
//
// Seats:
//   chalk      instructor (issuer verified) + chalk-extension → closed (the fix)
//   legacy     the same seat with the legacy runtime           → closed (unchanged behaviour)
//   learner    a live learner token, no issuer token            → open
//   rehearsal  the rehearsal window after enter, and after a restart that keeps it (rehearsalSeat.ts enterRehearsal then
//              resumeOnActivation): issuer removed, return key kept, the seat record (phase inside, this window's
//              folder), a live learner token → open, on the real rehearsal postConfig path (config.rehearsalSeat)
//   rehearsalExpired  the same rehearsal window after the learner token passed exp → open (no issuer: no instructor)
//   both       not a rehearsal state (finishInterrupted clears it first): a combination check of the decision —
//              an issuer token and a live learner token → open (the learner slot wins)
// Run: node --experimental-strip-types test/chalk-instructor-seat-gates.smoke.mjs
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
    "export { StartPage } from './src/startPage';",
    "export { ISSUER_TOKEN_KEY } from './src/mintStudentTokenHelpers';",
    "export { REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY } from './src/rehearsalSeat';",
    "export { ACTIVITY_TOKEN_KEY as TOKEN_KEY } from './src/activityConnections';",
    "export { GOAL_REFUSAL_SENTENCES } from './src/studentGoal';",
  ].join('\n'), resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'chalk-instructor-seat-gates-')));
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
const home = path.join(tmp, 'home'); fs.mkdirSync(home);
const toUri = p => ({ fsPath: p, path: p, scheme: 'file' });
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
let runtime = 'chalk-extension';
const commands = [];
const vscode = new Proxy({
  env: { appName: 'HypeProof Studio' },
  window: { showWarningMessage: async () => { throw new Error('native modal must not open'); }, showInformationMessage: async () => undefined },
  workspace: { getConfiguration: () => ({ get: (k, fallback) => (k === 'instructorRuntime' ? runtime : fallback) }), workspaceFolders: [{ uri: toUri(work), name: 'w' }], textDocuments: [] },
  Uri: { joinPath: () => toUri('/ext'), file: toUri },
  ViewColumn: { One: 1 },
  commands: { executeCommand: async (...a) => { commands.push(a); return undefined; }, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, setImmediate, AbortSignal, AbortController, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone });
const FC = await import('../src/folderConsent.ts');
const { ChatPanelProvider, StartPage, ISSUER_TOKEN_KEY, REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY, TOKEN_KEY, GOAL_REFUSAL_SENTENCES } = mod.exports;
assert.ok(ChatPanelProvider && StartPage && ISSUER_TOKEN_KEY && REHEARSAL_RETURN_KEY && TOKEN_KEY, 'bundle exports');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const identity = { u: 'learner-1', c: 'cohort-1', p: 'profile-1' };
const learnerToken = exp => `${b64({ ...identity, exp })}.sig`;
const LIVE = learnerToken(Math.floor(Date.now() / 1000) + 3600);
const EXPIRED = learnerToken(Math.floor(Date.now() / 1000) - 60);
const personal = { profile_id: 'p', activity_id: 'a'.repeat(64), activity_kind: 'personal', minor_cohort: false, sdk_tools: { read: true, write: true, shell: true }, tools: {}, learning_wiki: { enabled: true } };
const classroom = { ...personal, activity_id: 'c'.repeat(64), activity_kind: 'classroom', lesson: { course_id: 'course', version: 'v1', sha256: 'f'.repeat(64) } };
const classConnection = { student: identity, run: { starts_at: Date.now() - 1000, ends_at: Date.now() + 3600000 }, class_run_id: 'run-1' };

/** The instructor decision as InstructorModeManager keeps it: a verdict per issuer token, cleared by reset(). */
function instructorMode(verdict) {
  return {
    _v: null, pending: null,
    get isInstructor() { return this._v; },
    get verifiedServerUrl() { return undefined; },
    async checkInstructorMode(issuer) {
      if (!issuer) { this._v = false; return false; }
      const v = this.pending ? await this.pending : verdict;
      this._v = v; return v;
    },
    reset() { this._v = null; },
    handleAutoReadResult() { return null; },
    async fetchInstructorBrief() { return undefined; },
  };
}

/** A provider with the real prototype; secrets and the cached profile describe the seat. */
function seat({ secrets, profile, verdict = true, run = 'chalk-extension' }) {
  const store = new Map(Object.entries(secrets));
  const global = new Map();
  const posts = [], denials = [], reviewBars = [], askAbout = [], unobserved = [];
  const context = {
    subscriptions: [], extensionUri: toUri('/ext'), extensionPath: '/ext', extension: { packageJSON: {} },
    globalState: { get: k => global.get(k), update: async (k, v) => { global.set(k, v); }, keys: () => [...global.keys()] },
    workspaceState: { get: (_k, f) => f, update: async () => {} },
    globalStorageUri: toUri(tmp), storageUri: toUri(tmp),
    secrets: { get: async k => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); }, onDidChange: () => ({ dispose() {} }) },
  };
  const h = Object.create(ChatPanelProvider.prototype);
  const taskStore = { scope: 's', getView: () => ({ activeTaskId: 't1' }), isTemporary: () => false, getDraft: () => ({}) };
  Object.assign(h, {
    context, cachedProfile: profile, lastProfileFailure: null, profileGeneration: 0,
    loadAccess: async () => {}, refreshCrDirectorContext: async () => {},
    _instructorMode: instructorMode(verdict), prepareTaskWorkspace: async () => {}, currentTaskStore: () => taskStore,
    getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }), servedWorkspaceRoot: work,
    preview: { setAskAboutFileEnabled: v => askAbout.push(v), setReviewBar: v => reviewBars.push(v) },
    classWindowSource: () => classConnection,
    syncChalkContract() {}, endChalkSessionForRuntime: async () => {},
    post: async m => { posts.push(JSON.parse(JSON.stringify(m))); return true; },
    postDenialNotice: async source => { denials.push(source); },
    resolveCoachCwd: () => work,
    provenanceRecorder: () => ({ unobserved: root => unobserved.push(root) }),
  });
  const config = async () => {
    runtime = run; commands.length = 0;
    await h.postConfig();
    const c = posts.filter(m => m.type === 'config').at(-1)?.config;
    assert.ok(c, 'postConfig posted a config');
    return c;
  };
  return { h, store, global, posts, denials, reviewBars, askAbout, unobserved, config };
}

const rehearsalRecord = JSON.stringify({ phase: 'inside', rehearsalId: 'rehearsal-1', expiresAt: Date.now() + 3600000, homeFolder: home, rehearsalFolder: work, stucks: [] });
const SEATS = {
  chalk: () => seat({ secrets: { [ISSUER_TOKEN_KEY]: 'issuer', [TOKEN_KEY]: EXPIRED }, profile: personal }),
  legacy: () => seat({ secrets: { [ISSUER_TOKEN_KEY]: 'issuer', [TOKEN_KEY]: EXPIRED }, profile: personal, run: 'legacy' }),
  learner: () => seat({ secrets: { [TOKEN_KEY]: LIVE }, profile: personal, verdict: false }),
  rehearsal: () => seat({ secrets: { [REHEARSAL_RETURN_KEY]: 'issuer', [REHEARSAL_SEAT_KEY]: rehearsalRecord, [TOKEN_KEY]: LIVE }, profile: personal }),
  rehearsalExpired: () => seat({ secrets: { [REHEARSAL_RETURN_KEY]: 'issuer', [REHEARSAL_SEAT_KEY]: rehearsalRecord, [TOKEN_KEY]: EXPIRED }, profile: personal }),
  both: () => seat({ secrets: { [ISSUER_TOKEN_KEY]: 'issuer', [TOKEN_KEY]: LIVE }, profile: personal }),
};
const CLOSED = ['chalk', 'legacy'], OPEN = ['learner', 'rehearsal', 'rehearsalExpired', 'both'];
let passed = 0;
const failures = [];
/** One gate: `probe(seat)` returns true when the learner surface is open. Closed seats must say false, open seats true. */
async function gate(id, name, probe, { profile, setup } = {}) {
  for (const which of [...CLOSED, ...OPEN]) {
    const s = SEATS[which]();
    if (profile) s.h.cachedProfile = profile;
    setup?.(s);
    let open;
    try { await s.config(); open = await probe(s); } catch (e) { failures.push(`${id} ${which}: threw ${e?.stack ?? e}`); continue; }
    const want = OPEN.includes(which);
    if (open !== want) failures.push(`${id} ${name}: ${which} seat is ${open ? 'open' : 'closed'}, expected ${want ? 'open' : 'closed'}`);
  }
  passed++;
  console.log(`${failures.some(f => f.startsWith(id + ' ')) ? '✗' : '✓'} ${id} ${name}`);
}

// Seat facts first: the chalk seat really is the reset state the fix is about.
{
  const s = SEATS.chalk(); await s.config();
  assert.equal(s.h.isInstructor, null, 'chalk-extension leaves isInstructor null (reset kept)');
  const l = SEATS.legacy(); await l.config();
  assert.equal(l.h.isInstructor, true, 'legacy keeps the instructor decision');
  const r = SEATS.rehearsal(); const rc = await r.config();
  assert.equal(rc.rehearsalSeat, true, 'rehearsal seat runs the real rehearsal postConfig path (seat band, rehearsal panel)');
  const re = SEATS.rehearsalExpired(); const rec = await re.config();
  assert.equal(rec.rehearsalSeat, true, 'expired rehearsal seat is still the rehearsal window');
  assert.equal(await re.store.get(ISSUER_TOKEN_KEY), undefined, 'expired rehearsal seat has no issuer token: the instructor check can only say no');
  assert.equal(await r.store.get(ISSUER_TOKEN_KEY), undefined, 'rehearsal seat has no issuer token');
  assert.equal(r.h.isInstructor, null, 'rehearsal seat: the learner slot decided (reset), no instructor verdict');
  console.log('✓ seat facts: chalk resets the decision, legacy keeps it, rehearsal windows run the rehearsal path with no issuer');
}

// G1–G6 — the config postConfig sends to the webview.
await gate('G1', 'config fileAttach and materials', async s => { const c = await s.config(); assert.equal(!!c.fileAttach, !!c.materials); return c.fileAttach === true; });
await gate('G2', 'config fileMentions', async s => (await s.config()).fileMentions === true);
await gate('G3', 'config turnTools is the learner set', async s => {
  const c = await s.config();
  return JSON.stringify(c.turnTools) === JSON.stringify((await SEATS.learner().config()).turnTools);
});
await gate('G4a', 'config classWindow', async s => !!(await s.config()).classWindow, { profile: classroom });
await gate('G4b', 'config lessonCapabilityEntry', async s => !!(await s.config()).lessonCapabilityEntry, { profile: classroom });
await gate('G5a', '"이 파일에 대해 묻기" context key', async s => { await s.config(); await new Promise(r => setImmediate(r)); return commands.filter(c => c[0] === 'setContext' && c[1] === 'hypeproof-chat.askAboutFileEnabled').at(-1)?.[2] === true; });
await gate('G5b', 'preview "이 파일에 대해 묻기"', async s => { await s.config(); return s.askAbout.at(-1) === true; });

await gate('G6', 'config folderRestricted for a stored read', async s => (await s.config()).folderRestricted === true, { setup: s => {
  s.h.servedWorkspaceRoot = home;
  s.global.set(FC.FOLDER_CONSENT_KEY, FC.writeFolderConsent(undefined, personal.activity_id, FC.canonicalFolder(work), 'read'));
} });

await gate('G7', 'a pending file attachment survives postConfig', async s => {
  // Added during implementation (pending-attachment cleanup, same gate as G1).
  s.h.pendingFileAttachment = { root: work, preview: { name: 'a.txt' } };
  await s.config();
  return s.h.pendingFileAttachment !== null;
});

// H — handlers after postConfig built the seat.
await gate('H1', 'edit of the latest prompt', async s => {
  s.h.editableHistory = () => [{ id: 'u1', role: 'user', content: 'x', createdAt: 1 }, { id: 'a1', role: 'assistant', content: 'y', createdAt: 2 }];
  try { s.h.requireEditTarget('u1'); return true; } catch { return false; }
});
await gate('H4', 'plan-first handling', async s => {
  let reached = false; s.h.planTaskKey = () => { reached = true; throw new Error('stop'); };
  try { await s.h.handlePlanFirst({ type: 'planFirstRequest' }); } catch { /* reached the plan step */ }
  return reached;
});
await gate('H6', 'answer to the learning wiki', async s => {
  s.h.isLearningWikiEnabled = () => false; s.h.learningWikiPlan = () => ({}); s.h.getSeatAudience = () => 'personal';
  return (await s.h.runAnswerToWiki({ messageId: 'm1' })) !== undefined;
});
await gate('H8a', 'attach a work-folder file', async s => {
  fs.writeFileSync(path.join(work, 'a.txt'), 'hello');
  await s.h.attachWorkspaceFile(path.join(work, 'a.txt')).catch(() => undefined);
  return !s.denials.includes('lesson');
});
await gate('H8b', 'restore a removed file', async s => {
  const file = { root: work, preview: { name: 'a.txt' } };
  s.h.removedFileSlot = { take: () => file }; s.h.turnRequestScope = () => 'scope';
  await s.h.restoreRemovedFile('undo-1');
  return s.posts.some(m => m.type === 'fileAttachment' && m.attachment?.name === 'a.txt');
});
await gate('H9a', 'file mentions', async s => s.h.mentionAllowed());
await gate('H9b', 'materials', async s => s.h.materialsAllowed());
await gate('H10', 'store the learner nickname', async s => {
  s.h.learnerNicknameKey = () => 'nick'; s.h.postConfig = async () => {};
  await s.h.handleMessage({ type: 'setLearnerNickname', nickname: '별', taskId: 't1' });
  return s.global.get('nick') === '별';
});
await gate('H12', 'save the learning goal', async s => {
  await s.h.saveGoal({ activityId: null, status: 'set', text: '목표' });
  return !s.posts.some(m => m.type === 'goalState' && m.error === GOAL_REFUSAL_SENTENCES.other_lesson);
});
await gate('H13', 'dismiss the accuracy card', async s => {
  let stored = false;
  s.h.turnRequestScope = () => 'scope'; s.h.accuracyOwner = async () => 'owner'; s.h.postAccuracyEducation = async () => { stored = true; };
  s.h.accuracyStore = () => ({ get: () => undefined, update: async () => {} });
  await s.h.handleMessage({ type: 'accuracyEducationDismiss', messageId: 'm1', taskId: 't1' });
  return stored;
});
await gate('H14', 'record the turn before a coach turn', async s => {
  s.h.turnReview = null; s.h.pageCardScope = () => null; s.h.turnRestoreTaskKey = () => { throw new Error('learner path'); };
  await s.h.beginTurnRestore('stream-1');
  return s.unobserved.length === 0;
});
const reviewFor = s => { s.h.turnRestoreTaskKey = () => 'k'; s.h.turnReview = { taskKey: 'k', root: work, view: { turnId: 't1', state: 'kept', added: [{ path: 'a.txt' }], changed: [], deleted: [] } }; };
await gate('H15', 'preview review bar press', async s => {
  reviewFor(s); let re = false; s.h.postTurnReview = () => { re = true; };
  await s.h.handlePreviewReviewAction({ turnId: 't1', action: 'show' }).catch(() => undefined);
  return !re;
});
await gate('H17', 'preview review bar shown', async s => { reviewFor(s); s.h.postTurnReview(); return s.reviewBars.at(-1) !== null; });
await gate('H18', 'personal Claude continuation', async s => {
  s.h.cachedProfile = { ...personal, activity_kind: 'trial', profile_id: 'studio-open-trial' }; s.h.endCardOfferToken = 'offer';
  s.h.activeStreams = new Map(); s.h.getHistory = () => []; let reached = false;
  const secretsGet = s.h.context.secrets.get; s.h.context.secrets.get = async k => { if (k === TOKEN_KEY) reached = true; return secretsGet(k); };
  await s.h.openPersonalClaude('draft').catch(() => undefined);
  return reached;
});
await gate('H19', 'start page personal reflection entry', async s => {
  const page = Object.create(StartPage.prototype);
  let refused = false;
  Object.assign(page, { context: s.h.context, chat: s.h, busy: false, show: async () => {}, refresh: async () => {}, handle: async () => {}, accounts: undefined });
  s.h.hasActiveStream = () => false;
  await page.openPersonalReflectionEntry();
  refused = /개인 활동을 선택한 뒤/.test(page.error ?? '');
  return !refused;
});

// Static: these reads sit inside handleSend, the learning-wiki modal re-check, a restore closure and a continuation
// closure, where a behaviour test would have to drive a model turn or a modal. Each line must read the seat gate.
{
  const src = fs.readFileSync(path.join(ext, 'src/chatPanelProvider.ts'), 'utf8').split('\n');
  const STATIC = [
    ['H2', 'reflectionBinding', "(activity.kind!=='personal'&&!mayBeAccountSeatRecord(activity))||"],
    ['H6b', 'learning wiki re-check after the modal', 'this.cachedProfile?.lesson || !this.isLearningWikiEnabled()) { await this.postDenialNotice("lesson");'],
    ['H11a', 'handleSend nicknameStored', 'const nicknameStored = nicknameSeat(profile, '],
    ['H11b', 'handleSend withFile', 'const withFile = fileContext && fileAttachAllowed(profile, '],
    ['H11c', 'handleSend materialContext', 'await this.takeMaterials(preparedMaterials, fileAttachAllowed(profile, '],
    ['H16', 'turn review restore current()', 'this.taskChanging || this.verifySession?.running || '],
    ['H18b', 'personal Claude current()', 'const current = () => scope() === bound && this.endCardOfferToken === token'],
  ];
  for (const [id, name, anchor] of STATIC) {
    const lines = src.filter(l => l.includes(anchor));
    if (lines.length !== 1) { failures.push(`${id} ${name}: anchor matched ${lines.length} lines`); continue; }
    if (!lines[0].includes('ChatPanelProvider.learnerClosed(this)')) failures.push(`${id} ${name}: the line does not read the seat gate (ChatPanelProvider.learnerClosed)`);
    console.log(`${failures.some(f => f.startsWith(id + ' ')) ? '✗' : '✓'} ${id} ${name} (static)`);
  }
}

// invalidateProfile (startPage delete/save/restore, extension forget): the decision is gone until the next postConfig.
{
  // mentionAllowed() reads cachedProfile, which invalidateProfile drops; the probe puts a profile back to see the seat.
  const s = SEATS.chalk(); await s.config();
  const before = s.h.mentionAllowed();
  s.h.invalidateProfile(); s.h.cachedProfile = personal;
  const after = s.h.mentionAllowed();
  if (before !== false || after !== true) failures.push(`INV invalidateProfile: mentions before ${before}, after ${after}; expected closed, then open until the next postConfig`);
  console.log(`${before === false && after === true ? '✓' : '✗'} INV invalidateProfile clears the seat together with the instructor decision`);
}

// Overlapping postConfig runs: an older instructor run that finishes last does not close a newer learner seat.
{
  const s = SEATS.chalk(); runtime = 'chalk-extension';
  let release; s.h._instructorMode.pending = new Promise(r => { release = r; });
  const older = s.h.postConfig();
  await new Promise(r => setTimeout(r, 20));
  await s.store.delete(ISSUER_TOKEN_KEY); await s.store.set(TOKEN_KEY, LIVE); s.h._instructorMode.pending = null;
  await s.h.postConfig();
  const newer = s.h.mentionAllowed();
  release(true); await older;
  const last = s.h.mentionAllowed();
  if (newer !== true || last !== true) failures.push(`RACE overlapping postConfig: mentions after the newer learner run ${newer}, after the older instructor run ${last}; expected open, open`);
  console.log(`${newer === true && last === true ? '✓' : '✗'} RACE overlapping postConfig: the newest run decides the seat`);
}

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`${passed} gates checked on ${CLOSED.length + OPEN.length} seats`);
process.exit(0);
