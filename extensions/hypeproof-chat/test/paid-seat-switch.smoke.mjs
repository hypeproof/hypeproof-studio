// CONV-PURCHASE-R-005 / REQ-L12 (5)(6)(12)(15) — a free seat becomes a pass seat in place once the
// Service answers `paid`. Real StartPage + ActivityConnections + ensureWorkspace on a temp folder;
// a synthetic Service answers on fetch. No timers fire: each poll step is called directly.
//
// Asserted chain: paid poll -> claim -> pass entered without the preview press -> same folder as
// the free seat (also a numbered free folder that is not the pass home) -> the order record is
// retired -> the chat config is pushed again with the new activity (the webview reducer drops the
// end card on a new activity id) -> the token the next send reads is the pass token.
// Negative controls: carry-over offer absent unless advertised; a pending/confirming poll changes
// nothing; a failed credential store leaves the free seat running and the preview as today; a
// seat that is not free keeps today's preview press.
//
// Run: node --experimental-strip-types test/paid-seat-switch.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = new URL('..', import.meta.url).pathname;
const bundle = await build({ stdin: { contents: "export {StartPage} from './src/startPage.ts';export {ActivityConnections} from './src/activityConnections.ts';export {ensureWorkspace} from './src/extension.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });

const SERVICE = 'https://service.test/v1', SITE = 'https://site.test';
const ID = 'ord_' + 'a'.repeat(32), SECRET = 'b'.repeat(64), ORDER_KEY = 'hypeproofChat.pendingPurchase', TOKEN_KEY = 'hypeproofChat.workshopToken';
const FREE_TOKEN = 'free-seat-token-' + 'f'.repeat(32), PASS_CODE = 'pass-code-' + 'c'.repeat(40);
const ux = { coach: { naming_mode: 'fixed', fallback_name: 'Coach' } };

let world;
const vscode = {
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (k, d) => k === 'proxyUrl' ? SERVICE : k === 'siteBase' ? SITE : d }) },
  window: { showOpenDialog: async () => undefined, showInformationMessage() {} },
  Uri: { file: fsPath => ({ fsPath }), parse: s => s, joinPath: (...a) => a.join('/') },
  commands: { executeCommand: async (cmd, uri) => { if (cmd === 'vscode.openFolder') world.reloads.push(uri.fsPath); } },
  env: { openExternal: async () => true },
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetch = async (url, init = {}) => {
  const u = new URL(url), auth = new Headers(init.headers).get('authorization') ?? '';
  const who = auth.endsWith(PASS_CODE) ? world.pass : auth.endsWith(FREE_TOKEN) ? world.free : null;
  world.calls.push(u.pathname);
  if (u.pathname === '/v1/purchase/products') return json(200, { products: [{ id: 'pass-30d', label: '30일 이용권', amount: 50000, currency: 'KRW', duration_hours: 720, request_limit: 600 }] });
  if (u.pathname === `/v1/purchase/orders/${ID}/claim`) return json(200, { code: PASS_CODE });
  if (u.pathname === `/v1/purchase/orders/${ID}`) return json(200, { order_id: ID, state: world.poll, claimed: false });
  if (u.pathname === '/v1/profile') return who ? json(200, who) : json(401, { error: { code: 'signature' } });
  if (u.pathname === '/v1/activity') return who ? json(200, { activity_id: who.activity_id }) : json(401, {});
  return json(404, {});
};
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), process, console, Buffer, URL, AbortSignal, TextEncoder, TextDecoder, Response, Headers, fetch, Date, JSON, setTimeout: () => 0, clearTimeout: () => {} });
const { ActivityConnections, StartPage, ensureWorkspace } = mod.exports;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-paid-seat-'));
const plain = v => v === undefined ? v : JSON.parse(JSON.stringify(v));

/**
 * One window running a seat in `folder`. `seat: 'free'` is the free allowance (studio-open-trial);
 * `seat: 'code'` is a code-issued trial. The bought pass names `home` as its workspace_root.
 */
async function windowWith({ seat = 'free', numbered = false, carry, failStore = false, accountOwned = false, profileFails = false } = {}) {
  const base = fs.mkdtempSync(path.join(tmp, 'case-')), home = path.join(base, 'HypeProofTrial');
  const folder = numbered ? home + '-2' : home;
  fs.mkdirSync(folder, { recursive: true });
  const secrets = new Map(), state = new Map(), global = new Map();
  const raw = { globalStorageUri: { fsPath: path.join(base, 'storage') }, extension: { packageJSON: { version: 'test' } }, extensionUri: 'ext:',
    workspaceState: { keys: () => [...state.keys()], get: (k, d) => state.has(k) ? state.get(k) : d, update: async (k, v) => state.set(k, v) },
    globalState: { get: (k, d) => global.has(k) ? global.get(k) : d, update: async (k, v) => global.set(k, v) },
    secrets: { keys: async () => [...secrets.keys()], get: async k => secrets.get(k),
      store: async (k, v) => { if (world.failStore && k.startsWith('hps.activity.credential.')) throw new Error('keychain refused'); secrets.set(k, v); },
      delete: async k => secrets.delete(k), onDidChange: () => ({ dispose() {} }) } };
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: folder }, name: path.basename(folder) }];
  const free = { activity_id: 'a'.repeat(64), activity_kind: 'trial', profile_id: seat === 'free' ? 'studio-open-trial' : 'adult', display_name: seat === 'free' ? '무료 사용' : '체험', ux, welcome: {}, workspace_root: home, workspace_start: 'empty' };
  const pass = { activity_id: 'b'.repeat(64), activity_kind: 'trial', profile_id: 'pass-30d', display_name: '30일 이용권', ux, welcome: {}, workspace_root: home, workspace_start: 'empty',
    pass: { request_limit: 600, requests_used: 0 }, ...(carry === undefined ? {} : { conversation_carryover: { available: carry } }) };
  world = { free, pass, poll: 'pending', calls: [], reloads: [], configs: [], failStore: false };
  const store = new ActivityConnections(raw, () => SERVICE, () => vscode.workspace.workspaceFolders[0].uri.fsPath, async () => free);
  await store.commit(FREE_TOKEN, free, folder);
  const freeRecord = plain(store.current);
  assert.equal(!!freeRecord.free, seat === 'free', 'fixture: the free seat record carries free');
  const scoped = store.wrap();
  // The chat host: its profile follows the window's active record, and it reads the send token
  // the way chatPanelProvider does (secrets TOKEN_KEY through the scoped context).
  const chat = { renderHtml: () => '', funnelEmit() {}, openInEditor: async () => { world.chatOpened = true; },
    ensureProfile: async () => store.current?.serverId === pass.activity_id ? (profileFails ? null : pass) : store.current?.serverId === free.activity_id ? free : null,
    profileFailure: () => null, invalidateProfile() {}, refreshConfig: () => { world.configs.push(plain(store.current?.id)); },
    hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
  const accounts = accountOwned ? { view: () => ({ status: 'signedIn' }), refreshView: async () => {}, matches: () => true, cancel() {},
    activate: async passId => ({ token: PASS_CODE, binding: { sessionId: 's1', passId } }), resolvePass: async () => PASS_CODE, accessToken: async () => 'acct' } : undefined;
  if (accounts) store.accountToken = async () => PASS_CODE;
  const page = new StartPage(scoped, chat, (p, commit, selected) => ensureWorkspace(p, scoped, false, commit, selected), undefined, accounts);
  const states = [];
  page.panel = { webview: { postMessage: async m => states.push(m) } };
  // A paid order saved by an earlier purchase step (the end card's 이용권 살펴보기 → pay).
  secrets.set(ORDER_KEY, JSON.stringify({ id: ID, secret: SECRET, productId: 'pass-30d', label: '30일 이용권', amount: 50000, checkoutUrl: `${SITE}/studio/checkout?order=${ID}`, expiresAt: Date.now() + 1800000, service: SERVICE, ...(accountOwned ? { accountOwned: true } : {}) }));
  await page.refresh();
  await page.resumePurchase();
  world.failStore = failStore;
  return { store, scoped, page, secrets, global, folder, home, freeRecord, free, pass, states, view: () => states.at(-1)?.state };
}
const offers = w => [...w.global.keys()].filter(k => k.startsWith('hps.carryover.offer.'));

try {
  // ── Paid poll → the free seat becomes the pass seat in place ─────────────────────────────
  for (const numbered of [false, true]) {
    const w = await windowWith({ numbered, carry: true });
    const label = numbered ? 'numbered free folder' : 'free home folder';
    world.poll = 'paid';
    await w.page.purchaseTick();
    assert.equal(w.page.candidate, undefined, `${label}: no preview press — the pass is entered`);
    assert.equal(w.store.current.serverId, world.pass.activity_id, `${label}: the window runs the pass`);
    assert.equal(w.store.current.workspace, w.freeRecord.workspace, `${label}: same folder as the free seat`);
    assert.equal(w.store.current.pass, true);
    assert.deepEqual(world.reloads, [], `${label}: no window switch`);
    assert.equal(await w.scoped.secrets.get(TOKEN_KEY), PASS_CODE, `${label}: the next send reads the pass token`);
    assert.equal(w.secrets.has(ORDER_KEY), false, `${label}: the order record is retired on entry`);
    assert.equal(world.chatOpened, true, `${label}: the chat is shown`);
    assert.equal(world.configs.at(-1), w.store.current.id, `${label}: the chat config is pushed with the pass activity`);
    assert.notEqual(world.configs.at(-1), w.freeRecord.id, `${label}: a new activity id (the webview drops the end card on it)`);
    // REQ-L12 ⑫ — advertised: one pending carry-over offer from the free seat, nothing mixed yet.
    const key = offers(w);
    assert.equal(key.length, 1, `${label}: one carry-over offer`);
    assert.deepEqual(plain(w.global.get(key[0])), { version: 1, passId: w.store.current.id, from: { id: w.freeRecord.id, name: '무료 사용', workspace: w.freeRecord.workspace, free: true }, status: 'pending' });
    // The free seat's files stay where they were.
    assert.equal(fs.existsSync(w.folder), true);
    console.log(`PASS paid poll → pass seat in place (${label}): same folder, no reload, pass token for the next send, order retired, config pushed, carry-over offered`);
  }

  // ── Account-owned order (login at purchase) takes the same in-place switch ─────────────────
  {
    const w = await windowWith({ accountOwned: true, carry: true });
    world.poll = 'paid';
    await w.page.purchaseTick();
    assert.equal(w.page.candidate, undefined);
    assert.equal(w.store.current.serverId, world.pass.activity_id);
    assert.equal(w.store.current.workspace, w.freeRecord.workspace);
    assert.equal(plain(w.store.current.accountPass)?.passId, ID);
    assert.equal(await w.scoped.secrets.get(TOKEN_KEY), PASS_CODE);
    assert.equal(w.secrets.has(ORDER_KEY), false);
    console.log('PASS account-owned paid order: the same in-place switch');
  }

  // ── Negative control: carry-over offer only when the Service advertises it ─────────────────
  for (const carry of [undefined, false]) {
    const w = await windowWith({ numbered: true, carry });
    world.poll = 'paid';
    await w.page.purchaseTick();
    assert.equal(w.store.current.serverId, world.pass.activity_id, 'the switch itself still happens');
    assert.deepEqual(offers(w), [], `no offer when conversation_carryover is ${carry === undefined ? 'absent' : 'false'}`);
    console.log(`PASS no carry-over offer (negative control): flag ${carry === undefined ? 'absent' : 'false'}`);
  }

  // ── Negative control: unpaid / confirming / unreadable poll changes nothing ────────────────
  for (const state of ['pending', 'confirming', 'nonsense']) {
    const w = await windowWith({ carry: true });
    world.poll = state;
    await w.page.purchaseTick();
    assert.equal(w.store.current.id, w.freeRecord.id, `${state}: the free seat still runs`);
    assert.equal(await w.scoped.secrets.get(TOKEN_KEY), FREE_TOKEN, `${state}: the next send still uses the free token`);
    assert.equal(world.calls.some(p => p.endsWith('/claim')), false, `${state}: nothing claimed`);
    assert.equal(w.page.candidate, undefined);
    assert.equal(w.secrets.has(ORDER_KEY), true, `${state}: the order is kept`);
    assert.deepEqual(offers(w), []);
    assert.equal(world.chatOpened, undefined);
    console.log(`PASS poll "${state}" changes nothing (negative control)`);
  }

  // ── Negative control: the credential store fails → the free seat runs as before ────────────
  {
    const w = await windowWith({ numbered: true, carry: true, failStore: true });
    world.poll = 'paid';
    await w.page.purchaseTick();
    assert.equal(w.store.current.id, w.freeRecord.id, 'the free seat still runs');
    assert.equal(await w.scoped.secrets.get(TOKEN_KEY), FREE_TOKEN, 'the next send still uses the free token');
    const binding = fs.readdirSync(path.join(path.dirname(w.folder), 'storage', 'activity-bindings')).map(f => JSON.parse(fs.readFileSync(path.join(path.dirname(w.folder), 'storage', 'activity-bindings', f), 'utf8')));
    assert.ok(binding.some(b => b.id === w.freeRecord.id && b.free === true), 'the folder binding is the free seat again');
    assert.equal(w.page.candidate?.token, PASS_CODE, 'today\'s preview stays, so 이 활동 시작하기 can try again');
    assert.equal(w.page.candidate.workspace, undefined, 'the retry takes the ordinary entry path, not the in-place folder');
    assert.equal(w.view().error, undefined, 'no red error');
    assert.equal(JSON.parse(w.secrets.get(ORDER_KEY)).claimed, true, 'the paid order is kept for 다시 연결');
    assert.deepEqual(offers(w), []);
    assert.equal(world.chatOpened, undefined);
    console.log('PASS failed credential store: free seat untouched, preview kept, no error, order kept (negative control)');
  }

  // ── Negative control: the entry fails after the binding was written → the paid order survives ─
  {
    const w = await windowWith({ numbered: true, profileFails: true });
    world.poll = 'paid';
    await w.page.purchaseTick();
    assert.equal(w.store.current.id, w.freeRecord.id, 'rolled back to the free seat');
    assert.equal(await w.scoped.secrets.get(TOKEN_KEY), FREE_TOKEN);
    assert.equal(w.secrets.has(ORDER_KEY), true, 'the order record is kept until the entry is verified (다시 연결 stays possible)');
    assert.equal(JSON.parse(w.secrets.get(ORDER_KEY)).claimed, true);
    assert.equal(w.view().error, undefined, 'no red error');
    assert.equal(w.page.candidate?.token, PASS_CODE, 'preview kept');
    console.log('PASS entry fails after the binding: free seat restored, paid order kept, no error (negative control)');
  }

  // ── Negative control: replacesFree takes over only that free seat's binding ────────────────
  {
    const w = await windowWith({ numbered: true });
    await assert.rejects(() => w.store.commit(PASS_CODE, w.pass, w.folder, undefined, { replacesFree: 'c'.repeat(64) }), /다른 활동에 연결/, 'another id: still held');
    assert.equal(w.store.current.id, w.freeRecord.id);
    // A class (not free) holding the folder under the same id shape stays held as well.
    const cls = await windowWith({ seat: 'code', numbered: true });
    await assert.rejects(() => cls.store.commit(PASS_CODE, cls.pass, cls.folder, undefined, { replacesFree: cls.freeRecord.id }), /다른 활동에 연결/, 'a non-free binding: still held');
    // Positive control: the free seat's own id is taken over.
    await w.store.commit(PASS_CODE, w.pass, w.folder, undefined, { replacesFree: w.freeRecord.id });
    assert.equal(w.store.current.serverId, w.pass.activity_id);
    console.log('PASS replacesFree: only the named free seat binding is taken over (positive + 2 negative controls)');
  }

  // ── Negative control: a seat that is not free keeps today's preview press ──────────────────
  {
    const w = await windowWith({ seat: 'code', carry: true });
    world.poll = 'paid';
    await w.page.purchaseTick();
    assert.equal(w.page.candidate?.token, PASS_CODE, 'preview, as REQ-L12 ⑥');
    assert.equal(w.store.current.id, w.freeRecord.id, 'nothing entered without the press');
    assert.equal(world.chatOpened, undefined);
    console.log('PASS a code-trial seat keeps the preview press (negative control)');
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
