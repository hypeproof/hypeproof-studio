// REQ-L12 ⑫ exception (ot-conversation-carryover) — user-confirmed trial conversation carry-over
// on first pass entry. Behind the Service offer `conversation_carryover.available` (default off).
//
// Controls (verification.md rule 2):
//   positive — advertised pass over a trial folder records an offer; confirm shows the trial
//              read-only and appends exactly one visible summary; decline appends nothing.
//   negative — flag off, a class (not a trial) before the pass, a learner who already talked,
//              an already-decided offer: no offer, no seed, nothing mixed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {
  applyCarryoverDecision, carryoverAdvertised, carryoverOfferKey, carryoverSourceOf, carryoverState,
  carryoverSummary, carryoverView, newOffer, readableTranscript,
} from '../src/trialCarryoverHelpers.ts';
import {carryoverStoresFor, taskWorkspaceRoot, taskWorkspaceScope} from '../src/trialCarryoverSource.ts';
import {TaskWorkspaceStore} from '../src/taskWorkspaceStore.ts';
import {rendererStatus, renderComponent, visibleText} from './sx-render.mjs';

const require = createRequire(import.meta.url);
const PASS = 'p'.repeat(64), TRIAL = 't'.repeat(64), HOME = '/synthetic/home';
const TRIAL_SOURCE = {id: TRIAL, name: '무료 체험', workspace: HOME};
const trialHistory = [
  {id: '1', role: 'user', content: '우리 치과 홈페이지 첫 화면을 만들어 줘', createdAt: 1},
  {id: '2', role: 'tool', content: '🔧 Write(index.html) ✓', createdAt: 2},
  {id: '3', role: 'assistant', content: 'index.html 에 첫 화면을 만들었어요.', createdAt: 3},
  {id: '4', role: 'user', content: '진료 시간 표를 넣어 줘', createdAt: 4},
  {id: '5', role: 'assistant', content: '진료 시간 표를 추가했어요.', createdAt: 5},
];
const passProfile = (on) => ({pass: {request_limit: 200, requests_used: 0}, ...(on === undefined ? {} : {conversation_carryover: {available: on}})});

// ---- pure judgments -------------------------------------------------------------------------
assert.equal(carryoverAdvertised(passProfile(true)), true);
assert.equal(carryoverAdvertised(passProfile(undefined)), false, 'absent offer = off');
assert.equal(carryoverAdvertised(passProfile(false)), false);
assert.equal(carryoverAdvertised({conversation_carryover: {available: true}}), false, 'only a pass profile');
assert.equal(carryoverAdvertised(null), false);
console.log('PASS carry-over is off unless the Service advertises it on a pass');

assert.deepEqual(carryoverSourceOf({id: TRIAL, name: '무료 체험', workspace: HOME, kind: 'trial'}, PASS), {id: TRIAL, name: '무료 체험', workspace: HOME});
assert.equal(carryoverSourceOf({id: TRIAL, name: '무료 체험', kind: 'trial'}, PASS), null, 'no home folder → no task store to read');
assert.equal(carryoverSourceOf({id: TRIAL, name: '수업', workspace: HOME, kind: 'classroom'}, PASS), null, 'a class is not a trial');
assert.equal(carryoverSourceOf({id: TRIAL, name: '이용권', workspace: HOME, kind: 'trial', pass: true}, PASS), null, 'an earlier pass is not a trial');
assert.equal(carryoverSourceOf({id: PASS, name: '같은 활동', workspace: HOME, kind: 'trial'}, PASS), null, 'the pass itself');
assert.equal(carryoverSourceOf(undefined, PASS), null);
console.log('PASS only a trial that held the folder can be the carry-over source');

const pending = newOffer(PASS, TRIAL_SOURCE);
assert.deepEqual(carryoverView({advertised: true, offer: pending, passHistory: [], trialHistory}), {status: 'offer', fromName: '무료 체험'});
assert.equal(carryoverView({advertised: false, offer: pending, passHistory: [], trialHistory}), null, 'flag off hides a stored offer');
assert.equal(carryoverView({advertised: true, offer: pending, passHistory: [{role: 'user', content: '안녕'}], trialHistory}), null, 'learner already talked: withdrawn');
assert.equal(carryoverView({advertised: true, offer: pending, passHistory: [], trialHistory: [{role: 'tool', content: 'x'}]}), null, 'nothing readable to carry');
assert.equal(carryoverView({advertised: true, offer: {...pending, status: 'declined'}, passHistory: [], trialHistory}), null);
assert.deepEqual(readableTranscript(trialHistory).map((m) => m.role), ['user', 'assistant', 'user', 'assistant'], 'tool lines are not transcript');
console.log('PASS the offer shows only while pending, advertised, unanswered and with something to read');

const summary = carryoverSummary(trialHistory);
assert.match(summary, /체험에서 하던 대화를 이어서 해요/);
assert.match(summary, /- 우리 치과 홈페이지 첫 화면을 만들어 줘/);
assert.match(summary, /- 진료 시간 표를 넣어 줘/);
assert.match(summary, /체험의 마지막 답변: 진료 시간 표를 추가했어요\./);
assert.doesNotMatch(summary, /Write\(index\.html\)/, 'tool lines never reach the seed');
const long = carryoverSummary([{role: 'user', content: '가'.repeat(500)}]);
assert.ok(long.split('\n').every((line) => line.length <= 400), 'requests are clipped');
console.log('PASS the seed summary is deterministic, readable and clipped');

// ---- confirm / decline through the host decision path ---------------------------------------
function stores({offer = pending, pass = [], trial = trialHistory} = {}) {
  const offers = new Map(offer ? [[carryoverOfferKey(PASS), offer]] : []);
  const trialStore = new Map([[TRIAL, structuredClone(trial)]]);
  const passHistory = structuredClone(pass);
  const seeds = [];
  return {
    offers, trialStore, passHistory, seeds,
    stores: {offers: {get: (k) => offers.get(k), update: async (k, v) => { offers.set(k, v); }}, trialHistory: (source) => trialStore.get(source.id) ?? [], passHistory: () => passHistory},
    appendSeed: async (text) => { seeds.push(text); passHistory.push({role: 'assistant', content: text}); },
  };
}
{
  const s = stores(), trialBefore = JSON.stringify(s.trialStore.get(TRIAL));
  const out = await applyCarryoverDecision({passId: PASS, advertised: true, decision: 'confirm', stores: s.stores, appendSeed: s.appendSeed, now: 10});
  assert.equal(out.status, 'accepted');
  assert.equal(s.offers.get(carryoverOfferKey(PASS)).status, 'accepted');
  assert.equal(s.seeds.length, 1, 'exactly one visible summary');
  assert.equal(s.seeds[0], summary);
  assert.equal(JSON.stringify(s.trialStore.get(TRIAL)), trialBefore, 'trial transcript untouched');
  assert.equal(s.passHistory.length, 1, 'trial messages are not copied into the pass history');
  assert.equal(s.passHistory[0].role, 'assistant');
  const view = carryoverState(PASS, true, s.stores).view;
  assert.equal(view.status, 'accepted');
  assert.deepEqual(view.transcript, readableTranscript(trialHistory), 'trial shown read-only after confirm');
  const again = await applyCarryoverDecision({passId: PASS, advertised: true, decision: 'confirm', stores: s.stores, appendSeed: s.appendSeed, now: 11});
  assert.equal(again, null); assert.equal(s.seeds.length, 1, 'a second confirm seeds nothing');
  console.log('PASS confirm: offer accepted, trial read-only, one visible seed, nothing mixed');
}
{
  const s = stores();
  const out = await applyCarryoverDecision({passId: PASS, advertised: true, decision: 'decline', stores: s.stores, appendSeed: s.appendSeed, now: 10});
  assert.equal(out.status, 'declined');
  assert.equal(s.seeds.length, 0); assert.equal(s.passHistory.length, 0);
  assert.equal(carryoverState(PASS, true, s.stores).view, null, 'declined: nothing shown');
  const late = await applyCarryoverDecision({passId: PASS, advertised: true, decision: 'confirm', stores: s.stores, appendSeed: s.appendSeed, now: 11});
  assert.equal(late, null); assert.equal(s.seeds.length, 0, 'a decline is final');
  console.log('PASS decline: new conversation, no seed, trial not shown');
}
for (const [label, opts, advertised] of [
  ['flag off', {}, false],
  ['learner already talked', {pass: [{role: 'user', content: '안녕'}]}, true],
  ['no offer stored', {offer: null}, true],
  ['offer for another pass', {offer: newOffer('q'.repeat(64), TRIAL_SOURCE)}, true],
]) {
  const s = stores(opts);
  const out = await applyCarryoverDecision({passId: PASS, advertised, decision: 'confirm', stores: s.stores, appendSeed: s.appendSeed, now: 10});
  assert.equal(out, null, label); assert.equal(s.seeds.length, 0, label);
  console.log('PASS confirm ignored (negative control): ' + label);
}

// No SDK session resume across credentials: the runtime has no resume option at all, so the pass
// starts a fresh SDK session on its own grant; the seed reaches the coach only as history text.
{
  const strip = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['../src/sdkCoach.ts', '../src/sdkCoachHelpers.ts']) assert.doesNotMatch(strip(f), /\b(resume|continue|forkSession|resumeSessionAt)\s*:/, f + ' must not resume an SDK session');
  assert.doesNotMatch(strip('../src/trialCarryoverHelpers.ts'), /token|credential|session_id|sessionId/i, 'carry-over never touches credentials or sessions');
  console.log('PASS no SDK session resume and no credential in the carry-over path');
}

// ---- first pass entry records the offer (real StartPage + ActivityConnections) ---------------
const bundle = await build({stdin: {contents: "export {StartPage} from './src/startPage.ts';export {ActivityConnections} from './src/activityConnections.ts';export {ensureWorkspace} from './src/extension.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false});
const service = 'https://synthetic.invalid/v1';
let responseProfile;
const vscode = {workspace: {workspaceFolders: [], getConfiguration: () => ({get: (k, d) => k === 'proxyUrl' ? service : d})}, window: {showOpenDialog: async () => undefined, showInformationMessage() {}}, Uri: {file: (fsPath) => ({fsPath})}, commands: {executeCommand: async () => {}}};
const mod = {exports: {}};
vm.runInNewContext(bundle.outputFiles[0].text, {module: mod, exports: mod.exports, require: (id) => id === 'vscode' ? vscode : require(id), process, console, Buffer, URL, AbortSignal, TextEncoder, setTimeout, clearTimeout, fetch: async (url) => new Response(JSON.stringify(url.endsWith('/activity') ? {activity_id: responseProfile.activity_id} : responseProfile), {status: 200})});
const {ActivityConnections, StartPage, ensureWorkspace} = mod.exports;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-carryover-'));
const profile = (id, home, {kind = 'trial', pass = false, carry} = {}) => ({activity_id: id.repeat(64), activity_kind: kind, profile_id: 'synthetic', display_name: pass ? '라이트 이용권' : '무료 체험', ux: {coach: {naming_mode: 'fixed'}}, welcome: {}, workspace_root: home, workspace_start: 'empty', ...(pass ? {pass: {request_limit: 200, requests_used: 0}} : {}), ...(carry === undefined ? {} : {conversation_carryover: {available: carry}})});
async function enterPass({previousKind, carry, trialTask}) {
  const base = fs.mkdtempSync(path.join(tmp, 'case-')), home = path.join(base, 'home'); fs.mkdirSync(home);
  const secrets = new Map(), state = new Map(), global = new Map();
  const raw = {globalStorageUri: {fsPath: path.join(base, 'storage')}, extension: {packageJSON: {version: 'test'}}, workspaceState: {keys: () => [...state.keys()], get: (k, d) => state.has(k) ? state.get(k) : d, update: async (k, v) => state.set(k, v)}, globalState: {get: (k, d) => global.has(k) ? global.get(k) : d, update: async (k, v) => global.set(k, v)}, secrets: {keys: async () => [...secrets.keys()], get: async (k) => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async (k) => secrets.delete(k), onDidChange: () => ({dispose() {}})}};
  vscode.workspace.workspaceFolders = [{uri: {fsPath: home}, name: 'home'}];
  const before = profile('a', home, {kind: previousKind});
  const store = new ActivityConnections(raw, () => service, () => vscode.workspace.workspaceFolders[0].uri.fsPath, async () => responseProfile);
  await store.commit('synthetic-trial', before, home);
  const trialId = store.current.id, trialRecord = JSON.parse(JSON.stringify(store.current));
  // The trial talks the way the host stores it: its own TaskWorkspaceStore under globalStorage,
  // keyed by the same helpers prepareTaskWorkspace uses. workspaceState is not involved.
  let trialStore;
  if (trialTask) {
    trialStore = new TaskWorkspaceStore(taskWorkspaceRoot(raw.globalStorageUri.fsPath), taskWorkspaceScope(trialRecord));
    await trialStore.initialize([], {text: '', images: [], queued: null});
    if (trialTask.length) await trialStore.append(trialStore.getView().activeTaskId, structuredClone(trialTask));
  }
  const scoped = store.wrap();
  const chat = {ensureProfile: async () => store.current?.serverId === before.activity_id ? before : responseProfile, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true, openInEditor: async () => {}};
  const page = new StartPage(scoped, chat, (p, commit, selected) => ensureWorkspace(p, scoped, false, commit, selected));
  page.panel = {webview: {postMessage: async () => {}}};
  responseProfile = profile('b', home, {pass: true, carry});
  await page.handle({type: 'connectCourse', token: 'synthetic-pass'});
  await page.handle({type: 'beginCourse'});
  assert.equal(store.current.serverId, responseProfile.activity_id, 'pass entered');
  return {global, passId: store.current.id, trialId, trialRecord, trialStore, storage: raw.globalStorageUri.fsPath};
}
try {
  {
    const r = await enterPass({previousKind: 'trial', carry: true});
    const offer = JSON.parse(JSON.stringify(r.global.get(carryoverOfferKey(r.passId)))); // vm realm → plain object
    assert.deepEqual(offer, {version: 1, passId: r.passId, from: {id: r.trialId, name: '무료 체험', workspace: r.trialRecord.workspace}, status: 'pending'});
    console.log('PASS advertised pass over a trial folder records one pending offer (no mixing yet)');
  }
  // The trial conversation written through the real task store reaches the offer (positive
  // control for the review finding: reading workspaceState gave [] here, so nothing was offered).
  const offersOf = (r) => ({get: (k) => r.global.has(k) ? JSON.parse(JSON.stringify(r.global.get(k))) : undefined, update: async (k, v) => { r.global.set(k, v); }});
  const staleLegacy = [{id: 'old', role: 'user', content: '이전 버전에서 하던 오래된 대화', createdAt: 0}, {id: 'old-a', role: 'assistant', content: '오래된 답변', createdAt: 0}];
  {
    const r = await enterPass({previousKind: 'trial', carry: true, trialTask: trialHistory});
    assert.ok(fs.existsSync(r.trialStore.filePath), 'trial conversation is on disk in the task store');
    const before = fs.readFileSync(r.trialStore.filePath, 'utf8');
    const passHistory = [];
    const stores = carryoverStoresFor({globalStoragePath: r.storage, offers: offersOf(r), legacyHistory: () => staleLegacy, passHistory: () => passHistory});
    assert.deepEqual(carryoverState(r.passId, true, stores).view, {status: 'offer', fromName: '무료 체험'}, 'offer drawn from the trial task store');
    const seeds = [];
    const out = await applyCarryoverDecision({passId: r.passId, advertised: true, decision: 'confirm', stores, appendSeed: async (t) => { seeds.push(t); passHistory.push({role: 'assistant', content: t}); }, now: 10});
    assert.equal(out.status, 'accepted');
    assert.deepEqual(seeds, [carryoverSummary(trialHistory)], 'seed summarises the task-store conversation');
    assert.doesNotMatch(seeds[0], /오래된/, 'leftover legacy history never reaches the seed');
    assert.deepEqual(carryoverState(r.passId, true, stores).view.transcript, readableTranscript(trialHistory), 'read-only view shows the task-store conversation');
    assert.equal(fs.readFileSync(r.trialStore.filePath, 'utf8'), before, 'trial task store untouched');
    console.log('PASS trial conversation in the real task store is offered, shown and summarised');
  }
  {
    // Negative control: the trial's store exists but its active task is empty; the leftover
    // pre-migration copy in workspaceState must not be offered in its place.
    const r = await enterPass({previousKind: 'trial', carry: true, trialTask: []});
    const stores = carryoverStoresFor({globalStoragePath: r.storage, offers: offersOf(r), legacyHistory: () => staleLegacy, passHistory: () => []});
    assert.equal(carryoverState(r.passId, true, stores).view, null, 'stale legacy history is not offered');
    console.log('PASS empty trial task store + leftover legacy history: no offer (negative control)');
  }
  {
    // A trial that never opened under the task store still has its legacy history as its only record.
    const r = await enterPass({previousKind: 'trial', carry: true});
    const stores = carryoverStoresFor({globalStoragePath: r.storage, offers: offersOf(r), legacyHistory: (id) => id === r.trialId ? trialHistory : [], passHistory: () => []});
    assert.deepEqual(carryoverState(r.passId, true, stores).view, {status: 'offer', fromName: '무료 체험'});
    assert.equal(fs.existsSync(path.join(taskWorkspaceRoot(r.storage), 'task-workspaces')) && fs.readdirSync(path.join(taskWorkspaceRoot(r.storage), 'task-workspaces')).length > 0, false, 'reading never creates a store');
    console.log('PASS trial without a task store falls back to its only (legacy) record, read-only');
  }
  {
    // The host keys the trial store with the same helpers the reader uses (no drift).
    const host = fs.readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
    assert.match(host, /new TaskWorkspaceStore\(taskWorkspaceRoot\(this\.context\.globalStorageUri\.fsPath\), taskWorkspaceScope\(activity\)\)/);
    assert.match(host, /carryoverStoresFor\(\{\s*globalStoragePath: this\.context\.globalStorageUri\.fsPath/);
    console.log('PASS host task store and carry-over reader share one key');
  }
  for (const [label, args] of [['flag absent', {previousKind: 'trial', carry: undefined}], ['flag false', {previousKind: 'trial', carry: false}], ['class before pass', {previousKind: 'classroom', carry: true}]]) {
    const r = await enterPass(args);
    assert.equal([...r.global.keys()].some((k) => k.startsWith('hps.carryover.offer.')), false, label);
    console.log('PASS no offer recorded (negative control): ' + label);
  }
} finally { fs.rmSync(tmp, {recursive: true, force: true}); }

// ---- the real component renders the offer and the read-only transcript ----------------------
const status = rendererStatus();
if (!status.available) console.log('NOT RUN TrialCarryover render: ' + status.reason);
else {
  const offerText = visibleText(await renderComponent('TrialCarryover', {view: {status: 'offer', fromName: '무료 체험'}, onDecide() {}}));
  assert.match(offerText, /체험에서 하던 대화 이어가기/);
  assert.match(offerText, /이어가기/); assert.match(offerText, /새 대화로 시작하기/);
  const acceptedHtml = await renderComponent('TrialCarryover', {view: {status: 'accepted', fromName: '무료 체험', transcript: readableTranscript(trialHistory)}, onDecide() {}});
  const acceptedText = visibleText(acceptedHtml);
  assert.match(acceptedText, /읽기 전용/); assert.match(acceptedText, /진료 시간 표를 넣어 줘/);
  assert.doesNotMatch(acceptedHtml, /<button|<textarea|<input/, 'read-only: no controls');
  assert.equal(visibleText(await renderComponent('TrialCarryover', {view: null, onDecide() {}})).trim(), '', 'no view → nothing drawn');
  console.log('PASS TrialCarryover renders offer, read-only transcript, and nothing when off');
}
