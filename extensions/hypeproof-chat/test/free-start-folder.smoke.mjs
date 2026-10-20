// REQ-L12 ⑭ / REQ-STUDIO-FREE-START — free start never stops on a folder (Jay 2026-10-20:
// "자동으로 돼야지"). The start-page host (src/startPage.ts) with a real ActivityConnections over one
// shared SecretStorage, against a stub Service over real HTTP on 127.0.0.1 (ports 18900–18949).
// The folders live under a temporary directory: the profile's workspace_root is absolute there,
// so nothing touches the real ~/HypeProofTrial.
//
// Positive: the home held by a code-issued trial is reused; the home held by a class moves to
//   <home>-2 with no error, no question and straight into the chat.
// Negative control for the checker: a code-issued (non-free) seat entering the class-held folder
//   does surface the folder-taken sentence, so "never appears on the free path" can fail.
//
// Run: node --experimental-strip-types test/free-start-folder.smoke.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';export * from './src/activityConnections.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-free-folder-'));
const ids = { free: 'f'.repeat(64), free2: 'e'.repeat(64), trial: '1'.repeat(64), klass: 'd'.repeat(64) };
const base = (activity_id, extra) => ({ activity_id, display_name: '무료 작업', ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } }, welcome: {}, series_index: 1, series_total: 1, ...extra });
const tokens = new Map(); // token → profile, filled per case
const OFFER_FREE = { entry: 'open', duration_hours: 24, request_limit: 10, unit: 'turn', claim: '/v1/free/claim', min_app_version: '0.1.58', available: true };
const svc = { claimToken: null };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (req.url === '/v1/trial/offer') return send(200, OFFER_FREE);
    if (req.url === '/v1/purchase/products') return send(200, { products: [] });
    if (req.url === '/v1/free/claim') return send(200, { outcome: 'granted', code: svc.claimToken, profile: 'studio-open-trial', expires_at: Date.now() + 3600e3 });
    if (req.url === '/v1/profile') return tokens.has(bearer) ? send(200, tokens.get(bearer)) : send(401, { error: { code: 'signature' } });
    if (req.url === '/v1/activity') return tokens.has(bearer) ? send(200, { activity_id: tokens.get(bearer).activity_id }) : send(401, { error: { code: 'signature' } });
    send(404, { error: { message: 'not found', type: 'not_found' } });
  });
});
let port = 18900;
for (;; port++) { try { await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); }); break; } catch (e) { if (port >= 18949) throw e; } }
const SERVICE = `http://127.0.0.1:${port}/v1`;

const module = { exports: {} };
const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? SERVICE : key === 'siteBase' ? 'https://site.test' : key === 'freeStart' ? 'service' : fallback }) },
  window: {}, commands: { executeCommand: async () => {} }, Uri: { parse: s => s }, env: { openExternal: async () => true } };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch, Response, Headers, Date, JSON, setTimeout, clearTimeout });
const { StartPage, ActivityConnections, FOLDER_TAKEN_MESSAGE } = module.exports;

// One machine: one SecretStorage and one global storage, as the OS keychain and the app's storage are.
const machineSecrets = new Map();
const secrets = { keys: async () => [...machineSecrets.keys()], get: async k => machineSecrets.get(k), store: async (k, v) => { machineSecrets.set(k, v); }, delete: async k => { machineSecrets.delete(k); }, onDidChange: () => ({ dispose() {} }) };
const raw = () => { const ws = new Map(), gs = new Map([['hypeproofChat.freeStart.age.v1', '14+']]);
  return { globalStorageUri: { fsPath: path.join(tmp, 'storage') }, workspaceState: { keys: () => [], get: (k, d) => ws.has(k) ? ws.get(k) : d, update: async (k, v) => { ws.set(k, v); } },
    globalState: { get: (k, d) => gs.has(k) ? gs.get(k) : d, update: async (k, v) => { gs.set(k, v); } }, secrets, extension: { packageJSON: { version: '0.1.58' } }, subscriptions: [] }; };
/** An earlier activity on this machine, entered the ordinary way. */
async function earlier(token, profile, folder) {
  tokens.set(token, profile);
  await new ActivityConnections(raw(), () => SERVICE, () => folder, async () => profile).commit(token, profile, folder);
}
/** A start page whose `begin` does what extension.ts openWorkspaceFolder does: owners → prepare → commit. */
function harness() {
  const world = { states: [], entered: [], chat: 0 };
  const connections = new ActivityConnections(raw(), () => SERVICE, () => undefined, async t => tokens.get(t));
  const ctx = connections.wrap();
  const chat = { openInEditor: async () => { world.chat++; }, ensureProfile: async () => connections.current ? tokens.get(connections.current.token) ?? null : null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {},
    hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => '코치', coachNameIsChosen: () => true, noteFreeClaim() {}, funnelEmit() {} };
  const begin = async (profile, commit, selected) => {
    const dir = selected ?? profile.workspace_root;
    connections.prepare(dir, profile, () => fs.mkdirSync(dir, { recursive: true }), await connections.folderOwners(dir));
    await commit(dir);
    world.entered.push(dir);
    return false;
  };
  const page = new StartPage(ctx, chat, begin);
  page.panel = { webview: { postMessage: async msg => world.states.push(msg) } };
  return { world, page, connections, state: () => world.states.at(-1).state };
}
const sawTaken = states => JSON.stringify(states).includes(FOLDER_TAKEN_MESSAGE);
const freeSeat = (activity, home) => base(activity, { activity_kind: 'trial', profile_id: 'studio-open-trial', workspace_root: home });

try {
  // Checker controls (pure): the sentence is found when present, not when absent.
  assert.equal(sawTaken([{ state: { error: FOLDER_TAKEN_MESSAGE } }]), true);
  assert.equal(sawTaken([{ state: { error: '다른 문장' } }]), false);

  // ── Positive 1: a code-issued trial holds the home → the free seat reuses the home in place ──
  const trialHome = path.join(tmp, 'HypeProofTrial-a'); fs.mkdirSync(trialHome);
  await earlier('code-trial-token-synthetic', base(ids.trial, { activity_kind: 'trial', profile_id: 'studio-native-trial', display_name: 'HypeProofDentalSeminar', workspace_root: trialHome }), trialHome);
  fs.writeFileSync(path.join(trialHome, 'index.html'), '<h1>earlier work</h1>');
  svc.claimToken = 'free-token-1-synthetic-seat'; tokens.set('free-token-1-synthetic-seat', freeSeat(ids.free, trialHome));
  let h = harness();
  await h.page.handle({ type: 'startReady' });
  await h.page.handle({ type: 'freeStartClaim' });
  assert.deepEqual(h.world.entered, [trialHome], 'the home is reused in place');
  assert.equal(h.world.chat, 1, 'straight into the chat');
  assert.equal(h.state().error, undefined); assert.equal(sawTaken(h.world.states), false, 'the folder-taken sentence never appears on the free path');
  assert.equal(fs.readFileSync(path.join(trialHome, 'index.html'), 'utf8'), '<h1>earlier work</h1>', 'files stay');

  // ── Positive 2: a class holds the home → <home>-2, no error, no question, straight into the chat ──
  const classHome = path.join(tmp, 'HypeProofTrial-b'); fs.mkdirSync(classHome);
  await earlier('class-token-synthetic-seat', base(ids.klass, { activity_kind: 'classroom', profile_id: 'dental-seminar', workspace_root: classHome }), classHome);
  svc.claimToken = 'free-token-2-synthetic-seat'; tokens.set('free-token-2-synthetic-seat', freeSeat(ids.free2, classHome));
  h = harness();
  await h.page.handle({ type: 'startReady' });
  await h.page.handle({ type: 'freeStartClaim' });
  assert.deepEqual(h.world.entered, [classHome + '-2'], 'the next numbered folder is used');
  assert.equal(h.world.chat, 1, 'straight into the chat');
  assert.equal(h.state().error, undefined); assert.equal(h.state().freeStart?.refusal, undefined);
  assert.equal(sawTaken(h.world.states), false, 'the folder-taken sentence never appears on the free path');
  assert.equal(h.connections.current.workspace, fs.realpathSync(classHome + '-2'), 'the free seat is bound to <home>-2');

  // ── Negative control: a non-free seat entering the class-held folder does show the sentence ──
  tokens.set('code-trial-2-synthetic-seat', base(ids.trial, { activity_kind: 'trial', profile_id: 'studio-native-trial', workspace_root: classHome }));
  h = harness();
  await h.page.handle({ type: 'startReady' });
  await h.page.handle({ type: 'connectCourse', token: 'code-trial-2-synthetic-seat' });
  await h.page.handle({ type: 'beginCourse' });
  assert.equal(h.state().error, FOLDER_TAKEN_MESSAGE, 'control: the checker can fail — a code seat still gets the refusal');
  assert.deepEqual(h.world.entered, []);

  console.log('PASS free start folder: code trial home reused, class home → home-2 without an error, negative control');
} finally {
  server.close(); server.closeAllConnections?.();
  fs.rmSync(tmp, { recursive: true, force: true });
}
