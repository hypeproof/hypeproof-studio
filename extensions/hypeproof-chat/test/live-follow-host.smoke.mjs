// CGP-ART-R-017 — the provider half of 따라 보기: the real ChatPanelProvider tells the live
// server when a coach turn runs (turn start, normal end and a failed turn) and when CR-68
// automation acts (coach browser steps and AI Verify runs). Only VS Code APIs and the live
// server are fakes; the turn goes through the real handleSend and proxy runtime.
//   node --experimental-strip-types test/live-follow-host.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/chatPanelProvider.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
const vscode = { env: { appName: 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) } };
let outcome = 'ok', activeHost, duringTurn = null;
const calls = [];
const coach = () => calls.filter((c) => c[0] === 'coach').map((c) => c[1]);
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto, fetch: async () => {
  // The coach is answering: what has the live server been told by now?
  duringTurn = { streams: activeHost.activeStreams.size, coach: coach().at(-1) };
  if (outcome === 'error') throw Error('synthetic transport failure');
  return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'done' } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
} });
const proto = mod.exports.ChatPanelProvider.prototype;
const directory = mkdtempSync(join(tmpdir(), 'live-follow-host-'));
const token = 'x.' + Buffer.from(JSON.stringify({ c: 'synthetic', u: 'learner' })).toString('base64url') + '.x';
const live = {
  currentUrl: () => null, currentRoot: () => undefined,
  setCoachEditing: (on) => calls.push(['coach', on]),
  setAutomation: (source, on) => calls.push(['automation', source, on]),
};
function host() {
  const history = [];
  const h = Object.create(proto);
  const fields = {
    context: { globalStorageUri: { fsPath: directory }, secrets: { get: async () => token }, workspaceState: { get: () => undefined }, globalState: { get: () => undefined } },
    pendingSends: 0, activeStreams: new Map(), delegationControls: new Map(), turnTimelines: new Map(), turnRequests: new Map(), answerTurnIds: new Map(), observationWrites: Promise.resolve(),
    _instructorMode: { isInstructor: false, onTurnSuccess() {}, revertModelOnTurnError: async () => {} }, finishNotifier: { release() {}, turnEnded() {} },
    crSdkResults: { reset() {} }, elementQueue: { take: () => null }, verifySession: { takeCoachContext: () => null, endTurn() {} }, liveServer: live,
    publishSession: { publishedOrigins: () => [], publishedArtifactVersion: () => null },
    getHistory: () => history, appendHistory: async (items) => history.push(...items), post: async () => {},
    coachDisplayName: () => '코치', getCoach: () => ({ name: '코치', personality: '', configured: true }), ensureProfile: async () => null, loadAccess: async () => {}, postConfig: async () => {},
    dropPageAttachment() {}, isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => null, crBlobSinkFor: () => null, recordLearnerUploads() {}, resolveCoachCwd: () => undefined,
    beginTurnRestore: async () => null, endTurnRestore: async () => {}, saveAgentMdIfPresent: async () => {},
    proxyUsageRecorder: () => () => {}, handleSendError: async () => {},
  };
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(h, key, { value, writable: true, configurable: true });
  return h;
}
try {
  for (const o of ['ok', 'error']) {
    outcome = o; calls.length = 0; duringTurn = null;
    const h = host(); activeHost = h;
    await h.handleSend('질문', []);
    assert.deepEqual(duringTurn, { streams: 1, coach: true }, `${o}: the live server hears the turn start before the coach answers`);
    assert.equal(h.activeStreams.size, 0);
    assert.equal(coach().at(-1), false, `${o}: the live server hears the turn end`);
  }

  // CR-68: the coach's browser steps (executor hook) pause 따라 보기.
  calls.length = 0;
  const opts = host().crBrowserOptions();
  opts.onIndicator(true, 'browser_click');
  opts.onIndicator(false, 'browser_click');
  assert.deepEqual(calls, [['automation', 'browser', true], ['automation', 'browser', false]], 'browser steps reach the live server');
  console.log('PASS live-follow host: a real proxy turn (ok and failed) tells the live server it started and ended; CR-68 browser steps pause follow');
} finally {
  rmSync(directory, { recursive: true, force: true });
}

// AI Verify runs: the real provider's VerifySession ports (constructed provider, field initialisers run).
{
  const dir = await mkdtemp(join(tmpdir(), 'live-follow-verify-'));
  let p, f;
  try {
    f = await createTaskHarness(dir);
    const { ChatPanelProvider } = f.internals;
    f.h.context.subscriptions = [];
    f.h.context.globalState = { get: (_k, fallback) => fallback, update: async () => {} };
    const calls = [];
    const live = { currentUrl: () => undefined, currentRoot: () => undefined, onChange: () => ({ dispose() {} }), setCoachEditing() {}, setAutomation: (s, on) => calls.push([s, on]) };
    const record = ChatPanelProvider.prototype.provenanceRecorder;
    ChatPanelProvider.prototype.provenanceRecorder = () => undefined;
    try { p = new ChatPanelProvider(f.h.context, {}, live); } finally { ChatPanelProvider.prototype.provenanceRecorder = record; }
    p.postVerifyState = async () => {};
    p.verifySession.ports.onRun(true);
    p.verifySession.ports.onRun(false);
    assert.deepEqual(calls, [['verify', true], ['verify', false]], 'a verify run pauses follow while it acts');
    console.log('PASS live-follow host: AI Verify runs pause follow');
  } finally {
    for (const sub of f?.h.context.subscriptions ?? []) sub.dispose?.();
    await rm(dir, { recursive: true, force: true });
  }
}
