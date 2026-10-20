// Free start (SPEC iteration 4 §2.3/§2.5/§2.9; TUX-SP-14/15/16, US-19) — the start-page host
// (src/startPage.ts) against a stub Service over real HTTP on 127.0.0.1 (port range 18800–18899).
// Controls: offer `code`, 404 and the local "off" setting must give today's start page (negative);
// a full advertisement must give the free card and a claim (positive).
//
// Run: node --experimental-strip-types test/free-start-host.smoke.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';export * from './src/activityConnections.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });

const TOKEN_FREE = 'free-seat-token-' + 'f'.repeat(40);
const freeProfile = { activity_kind: 'trial', profile_id: 'studio-open-trial', display_name: '무료 작업', workspace_root: '~/HypeProofTrial', ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } }, welcome: {}, series_index: 1, series_total: 1, trial: { state: 'not_started', ends_at: null, request_limit: 10, requests_used: 0 } };
const OFFER_FREE = { entry: 'open', duration_hours: 24, request_limit: 10, unit: 'turn', claim: '/v1/free/claim', min_app_version: '0.1.58', available: true };
const catalogue = { products: [{ id: 'pass-30d', label: '30일 이용권', amount: 50000, currency: 'KRW', duration_hours: 720, request_limit: 600 }] };

// ── Stub Service ───────────────────────────────────────────────────────────────────────────
const svc = { offer: { status: 200, body: OFFER_FREE }, claims: [], requests: [], profile: freeProfile, orderReply: null };
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    svc.requests.push({ method: req.method, path: req.url, body, auth: req.headers.authorization ?? null, free: req.headers['x-hps-free-credential'] ?? null });
    const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (req.url === '/v1/trial/offer') return send(svc.offer.status, svc.offer.body);
    if (req.url === '/v1/purchase/products') return send(200, catalogue);
    if (req.url === '/v1/purchase/orders' && svc.orderReply) return send(svc.orderReply.status, svc.orderReply.body);
    if (req.url === '/v1/purchase/orders') return send(201, { order_id: 'ord_' + 'a'.repeat(32), order_secret: 'b'.repeat(64), amount: 50000, currency: 'KRW', label: '30일 이용권', expires_at: Date.now() + 1800000, checkout_url: `${SITE}/studio/checkout?order=ord_${'a'.repeat(32)}` });
    if (req.url === '/v1/free/claim') { const next = svc.claims.shift() ?? { status: 200, body: { outcome: 'granted', code: TOKEN_FREE, profile: 'studio-open-trial', expires_at: Date.now() + 720 * 3600e3 } }; return send(next.status, next.body); }
    if (req.url === '/v1/profile') return req.headers.authorization === `Bearer ${TOKEN_FREE}` ? send(200, svc.profile) : send(401, { error: { code: 'signature' } });
    send(404, { error: { message: 'not found', type: 'not_found' } });
  });
});
let port = 18851;
for (;; port++) { try { await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); }); break; } catch (e) { if (port >= 18899) throw e; } }
const SERVICE = `http://127.0.0.1:${port}/v1`, SITE = 'https://site.test';

/**
 * The account runtime as the start page uses it (src/accountSession.ts AccountSession): view, matches,
 * accessToken, refreshView, start, cancel. `start` stands for the browser sign-in finishing.
 */
function accountStub(status = 'signedOut') {
  const a = { status, starts: 0, refreshes: 0,
    view: () => ({ status: a.status, ...(a.status === 'signedIn' ? { account: { id: 'acc_1', email: 'learner@example.test', display_name: '학습자' }, passes: [] } : {}) }),
    matches: () => true, accessToken: async () => a.status === 'signedIn' ? 'account-bearer-' + 'd'.repeat(40) : undefined,
    refreshView: async () => { a.refreshes++; }, start: async () => { a.starts++; a.status = 'signedIn'; }, cancel() {}, reopen: async () => {}, openAccount: async () => {}, signOut: async () => { a.status = 'signedOut'; } };
  return a;
}
function harness({ freeStart = 'service', version = '0.1.58', secretsThrow = false, current = null, globals, failure = null, accounts } = {}) {
  const world = { secrets: new Map(), global: globals ?? new Map(), states: [], opened: [], commands: [], begun: [], claimNotes: [], current, failure };
  const ctx = {
    workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    globalState: { get: (k, d) => world.global.has(k) ? world.global.get(k) : d, update: async (k, v) => { world.global.set(k, v); } },
    secrets: {
      get: async k => { if (secretsThrow && k === 'hypeproofChat.installId.v1') throw Error('keychain locked'); return world.secrets.get(k); },
      store: async (k, v) => { if (secretsThrow && k === 'hypeproofChat.installId.v1') throw Error('keychain locked'); world.secrets.set(k, v); },
      delete: async k => { world.secrets.delete(k); },
    },
    extension: { packageJSON: { version } }, subscriptions: [],
  };
  const chat = {
    openInEditor: async () => { world.begun.push('chat'); }, ensureProfile: async () => world.current ?? (world.secrets.get('hypeproofChat.workshopToken') === TOKEN_FREE ? svc.profile : null), profileFailure: () => world.failure, invalidateProfile() {}, refreshConfig() {},
    hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => '코치', coachNameIsChosen: () => true,
    noteFreeClaim: (token, outcome) => world.claimNotes.push({ token, outcome }), funnelEmit() {},
  };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? SERVICE : key === 'siteBase' ? SITE : key === 'freeStart' ? freeStart : fallback }) },
    window: {}, commands: { executeCommand: async id => { world.commands.push(id); } }, Uri: { parse: s => s }, env: { openExternal: async url => { world.opened.push(url); return true; } } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch, Response, Headers, Date, JSON,
    // Only the claim_busy retry (3 s) fires, on the next turn of the loop, and only in its own case. The
    // first-paint bound never fires (the stub always answers the offer) and no purchase poll loop runs.
    setTimeout: (f, ms) => { if (ms === 3000 && fireRetry) setImmediate(f); return 0; }, clearTimeout: () => {} });
  const page = new module.exports.StartPage(ctx, chat, async (profile, commit) => { world.begun.push(profile.workspace_root); await commit('/tmp/hps-free-start-test'); return false; }, undefined, accounts);
  page.panel = { webview: { postMessage: async msg => world.states.push(msg) } };
  const state = () => world.states.at(-1).state;
  const settle = () => new Promise(r => setTimeout(r, 30));
  return { world, page, state, settle };
}
const claims = () => svc.requests.filter(r => r.path === '/v1/free/claim');
const reset = () => { svc.requests.length = 0; svc.claims.length = 0; svc.offer = { status: 200, body: OFFER_FREE }; svc.orderReply = null; };
const orders = () => svc.requests.filter(r => r.path === '/v1/purchase/orders');
let fireRetry = false;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

try {
  // ── Negative controls: today's start page ──────────────────────────────────────────────────
  for (const [name, offer, setting] of [['offer code', { status: 200, body: { entry: 'code', duration_hours: 1, request_limit: 40 } }, 'service'], ['offer 404', { status: 404, body: { error: { message: 'not found' } } }, 'service'], ['old Service: open without claim', { status: 200, body: { entry: 'open', duration_hours: 1, request_limit: 40 } }, 'service'], ['setting off', { status: 200, body: OFFER_FREE }, 'off']]) {
    reset(); svc.offer = offer;
    const h = harness({ freeStart: setting });
    await h.page.handle({ type: 'startReady' }); await h.settle();
    assert.equal(h.state().freeStart, undefined, `${name}: no free card`);
    assert.equal(h.page.freeStartSignal(), false, `${name}: no public-update signal (REQ-I15)`);
    await h.page.handle({ type: 'freeStartAge', answer: '14+' }); await h.page.handle({ type: 'freeStartClaim' });
    assert.equal(claims().length, 0, `${name}: no claim is ever sent`);
    assert.equal(h.world.global.size, 0, `${name}: nothing saved`);
  }

  // ── Positive: first open → age → claim → chat, no profile read before the claim ──────────────
  reset();
  const shared = new Map();
  let h = harness({ globals: shared });
  assert.equal(h.page.freeStartSignal(), false, 'no offer read yet: no public-update signal (REQ-I15)');
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.page.freeStartSignal(), true, 'advertised free start turns the public-update signal on (REQ-I15)');
  // Jay 2026-10-19: no allowance before use; the end card speaks when it is spent.
  assert.deepEqual({ ...h.state().freeStart }, {}, 'the one question is asked: no age yet, and no allowance line');
  assert.equal(svc.requests.some(r => r.path === '/v1/profile'), false, 'nothing reads /v1/profile before the claim');
  await h.page.handle({ type: 'freeStartAge', answer: '14+' });
  assert.equal(shared.get('hypeproofChat.freeStart.age.v1'), '14+');
  assert.equal(claims().length, 1);
  const first = claims()[0];
  assert.equal(first.method, 'POST'); assert.equal(first.auth, null, 'no bearer on the public claim');
  assert.deepEqual(Object.keys(first.body).sort(), ['age_ok', 'app_version', 'install_id']);
  assert.equal(first.body.age_ok, true); assert.equal(first.body.app_version, '0.1.58'); assert.match(first.body.install_id, UUID4);
  const profileIdx = svc.requests.findIndex(r => r.path === '/v1/profile'), claimIdx = svc.requests.findIndex(r => r.path === '/v1/free/claim');
  assert.ok(profileIdx > claimIdx, 'the profile is read with the issued token, after the claim');
  assert.equal(svc.requests[profileIdx].auth, `Bearer ${TOKEN_FREE}`);
  assert.deepEqual(h.world.begun, ['~/HypeProofTrial', 'chat'], 'entered straight into the served workspace and the chat: no preview, no folder choice');
  assert.equal(h.world.secrets.get('hypeproofChat.workshopToken'), TOKEN_FREE, 'the issued token takes the ordinary credential path');
  assert.deepEqual(h.world.claimNotes, [{ token: TOKEN_FREE, outcome: 'granted' }], 'trial_entry gets the claim outcome');
  const installId = first.body.install_id;
  assert.equal(h.world.secrets.get('hypeproofChat.installId.v1'), installId, 'install id kept in SecretStorage');
  const shown = JSON.stringify(h.world.states);
  assert.ok(!shown.includes(installId), 'the install id never reaches the webview');
  assert.ok(!shown.includes(TOKEN_FREE), 'the issued token never reaches the webview');

  // Same install, second claim ("바로 시작하기" after the age is saved): same install id, reused outcome.
  svc.claims.push({ status: 200, body: { outcome: 'reused', code: TOKEN_FREE, profile: 'studio-open-trial', expires_at: Date.now() + 3600e3 } });
  const h2 = harness({ globals: shared });
  h2.world.secrets.set('hypeproofChat.installId.v1', installId);
  await h2.page.handle({ type: 'startReady' }); await h2.settle();
  assert.equal(h2.state().freeStart.age, '14+', 'the question is not asked twice');
  await h2.page.handle({ type: 'freeStartClaim' });
  assert.equal(claims().at(-1).body.install_id, installId, 'same install id across claims');
  assert.deepEqual(h2.world.claimNotes, [{ token: TOKEN_FREE, outcome: 'reused' }]);

  // SecretStorage unavailable → globalState fallback, still one stable id.
  reset();
  const fb = new Map([['hypeproofChat.freeStart.age.v1', '14+']]);
  h = harness({ secretsThrow: true, globals: fb });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  await h.page.handle({ type: 'freeStartClaim' });
  const fbId = fb.get('hypeproofChat.installId.v1');
  assert.match(fbId, UUID4); assert.equal(claims()[0].body.install_id, fbId);

  // ── Refusals: each code shows the Service's sentence as given; no entry happens ─────────────
  const refusals = {
    network_limit: [429, '이 네트워크에서 오늘 시작할 수 있는 횟수를 모두 사용했습니다. 내일 다시 시도하거나, 참여 코드나 이용권으로 시작해 주세요.'],
    daily_cap_reached: [503, '오늘 준비한 무료 사용량이 모두 소진되었습니다. 밤 12시(한국 시간) 이후에 다시 시작할 수 있습니다. 참여 코드나 이용권이 있다면 지금 바로 시작할 수 있습니다.'],
    paused: [503, '지금은 무료 사용을 잠시 멈췄습니다. 잠시 뒤 다시 시도해 주세요.'],
    allowance_revoked: [403, '이 컴퓨터의 무료 사용량은 더 이상 쓸 수 없습니다. 이어서 쓰려면 이용권을 확인해 주세요.'],
    app_too_old: [426, '이 Studio는 바로 시작하기를 지원하지 않는 버전입니다. 최신 Studio로 업데이트한 뒤 다시 열어 주세요.'],
    rate_limited: [429, '요청이 많아 잠시 기다려야 합니다. 1분 뒤 다시 시도해 주세요.'],
    free_start_unavailable: [503, '지금은 바로 시작하기를 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요.'],
    invalid_body: [400, '요청을 처리하지 못했습니다. Studio를 다시 열어 주세요.'],
  };
  for (const [code, [status, message]] of Object.entries(refusals)) {
    reset();
    svc.claims.push({ status, body: { error: { code, message, ...(code === 'daily_cap_reached' ? { resumes_at: '2026-10-19T15:00:00.000Z' } : {}) } } });
    h = harness({ globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]) });
    await h.page.handle({ type: 'startReady' }); await h.settle();
    await h.page.handle({ type: 'freeStartClaim' });
    assert.equal(h.state().freeStart.refusal.code, code); assert.equal(h.state().freeStart.refusal.message, message);
    assert.equal(svc.requests.some(r => r.path === '/v1/profile'), false, `${code}: no entry after a refusal`);
    assert.deepEqual(h.world.begun, []);
    if (code === 'app_too_old') assert.equal(h.state().freeStart.tooOld, true);
  }
  // claim_busy: one automatic retry.
  reset();
  svc.claims.push({ status: 409, body: { error: { code: 'claim_busy', message: '이전 요청을 마무리하고 있습니다. 잠시 뒤 다시 시도해 주세요.' } } });
  h = harness({ globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  fireRetry = true; await h.page.handle({ type: 'freeStartClaim' }); fireRetry = false;
  assert.equal(claims().length, 2, 'claim_busy is retried exactly once'); assert.deepEqual(h.world.begun, ['~/HypeProofTrial', 'chat']);
  // Offline: the network sentence, the Primary stays (no refusal code from the Service).
  reset();
  h = harness({ globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  server.close(); server.closeAllConnections?.();
  await h.page.handle({ type: 'freeStartClaim' });
  assert.deepEqual({ ...h.state().freeStart.refusal }, { code: 'network', message: '연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.' });
  await new Promise(ok => server.listen(port, '127.0.0.1', ok));

  // App below the advertised floor: no claim at all, the update path is offered.
  reset();
  h = harness({ version: '0.1.57', globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().freeStart.tooOld, true);
  await h.page.handle({ type: 'freeStartClaim' });
  assert.equal(claims().length, 0, 'below the floor: nothing is claimed');
  await h.page.handle({ type: 'freeStartUpdate' });
  assert.deepEqual(h.world.commands, ['hypeproof-chat.checkForUpdates']);

  // Calendar-version releases (ST-VER-01): Studio ships 2026.MMDD.N, so the Service floor is one too.
  // Below a calendar floor → update path, no claim. At the floor → the claim carries the real version.
  reset(); svc.offer = { status: 200, body: { ...OFFER_FREE, min_app_version: '2026.1019.0' } };
  h = harness({ version: '2026.1017.0', globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().freeStart.tooOld, true, '2026.1017.0 is below a 2026.1019.0 floor');
  await h.page.handle({ type: 'freeStartClaim' });
  assert.equal(claims().length, 0, 'below a calendar floor: nothing is claimed');
  reset(); svc.offer = { status: 200, body: { ...OFFER_FREE, min_app_version: '2026.1019.0' } };
  h = harness({ version: '2026.1019.0', globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().freeStart.tooOld, undefined, 'at the calendar floor: not too old');
  await h.page.handle({ type: 'freeStartClaim' }); await h.settle();
  assert.equal(claims().length, 1, 'at the calendar floor: one claim');
  assert.equal(claims()[0].body.app_version, '2026.1019.0');
  assert.equal(h.world.secrets.get('hypeproofChat.workshopToken'), TOKEN_FREE, 'the calendar-version claim is admitted');

  // Drained day advertised: the calm state, before any claim.
  reset(); svc.offer = { status: 200, body: { ...OFFER_FREE, available: false, reason: 'daily_cap', resumes_at: '2026-10-19T15:00:00.000Z' } };
  h = harness();
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().freeStart.unavailable, 'daily_cap');

  // ── Under 14: blocked locally; the claim is sent only to be counted (age_ok:false); no entry ─
  reset();
  const young = new Map();
  h = harness({ globals: young });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  svc.claims.push({ status: 403, body: { error: { code: 'under_14', message: '만 14세 미만은 보호자의 동의가 있어야 사용할 수 있습니다.' } } });
  await h.page.handle({ type: 'freeStartAge', answer: 'under14' });
  assert.equal(young.get('hypeproofChat.freeStart.age.v1'), 'under14');
  assert.equal(h.state().freeStart.age, 'under14');
  assert.equal(claims().length, 1); assert.equal(claims()[0].body.age_ok, false, 'never age_ok:true for under 14');
  assert.equal(svc.requests.some(r => r.path === '/v1/profile'), false); assert.deepEqual(h.world.begun, []);
  await h.page.handle({ type: 'freeStartClaim' });
  assert.equal(claims().length, 1, 'a saved under-14 answer never claims');
  await h.page.handle({ type: 'freeStartGuardian' });
  assert.deepEqual(h.world.opened, [`${SITE}/studio#guardian`]);

  // ── Login at purchase (Jay 2026-10-19): a free seat signs in with Google before checkout ─────
  // Negative control first: no account runtime (accounts not enabled on this build) → no anonymous
  // checkout from a free seat; the view gets the calm notice state and no order is ever sent.
  reset();
  h = harness({ current: freeProfile });
  h.world.secrets.set('hypeproofChat.workshopToken', TOKEN_FREE);
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().account, undefined, 'no account runtime');
  await h.page.handle({ type: 'purchaseOpen' });
  assert.equal(h.state().purchase.login, 'unavailable', 'free seat without accounts: login unavailable');
  await h.page.handle({ type: 'purchasePayer', adult: true });
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(orders().length, 0, 'no anonymous order from a free seat');
  assert.deepEqual(h.world.opened, [], 'no checkout page opened');
  assert.equal(h.state().purchase.stage, 'choosing');
  // The first screen never asks for a login: a newcomer under free start sees the free card and no
  // sign-in starts until the person opens the pass list and presses the Google button.
  reset();
  const newcomer = accountStub();
  h = harness({ accounts: newcomer });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.ok(h.state().freeStart, 'the free card is drawn');
  // The host reports the gate ahead of time (so a pay button never flashes); the view draws it only
  // on the pass list (e2e/trial-ux TUX-SP-17 checks the rendered first screen has no Google button).
  assert.equal(h.state().purchase.stage, undefined, 'the pass list is not open');
  assert.equal(newcomer.starts, 0, 'no sign-in started on first open');
  // A newcomer who opens the pass list from the free card: sign-in first, no order without it.
  await h.page.handle({ type: 'purchaseOpen' });
  assert.equal(h.state().purchase.login, 'signIn', 'newcomer under free start: Google sign-in before checkout');
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(orders().length, 0, 'signed out: no order');
  // Signing in lifts the gate; the order then carries the account bearer.
  await h.page.handle({ type: 'accountSignIn' }); h.page.accountChanged(); await h.settle();
  assert.equal(h.state().purchase.login, undefined, 'signed in: checkout offered');
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(orders().length, 1);
  assert.equal(orders()[0].auth, 'Bearer account-bearer-' + 'd'.repeat(40), 'the order carries the account bearer');
  assert.equal(orders()[0].free, null, 'no seat yet: no free credential');

  // ── Purchase from a free seat: credential header + payer question; never on another seat ────
  reset();
  const payer = new Map();
  const signedIn = accountStub('signedOut');
  h = harness({ current: freeProfile, globals: payer, accounts: signedIn });
  h.world.secrets.set('hypeproofChat.workshopToken', TOKEN_FREE);
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().profile.free, true, 'the connected card is labelled as the free seat');
  await h.page.handle({ type: 'purchaseOpen' });
  assert.equal(h.state().purchase.login, 'signIn', 'free seat, signed out: the Google sign-in is the Primary');
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d', guardian: true });
  assert.equal(orders().length, 0, 'free seat, signed out: no order');
  await h.page.handle({ type: 'accountSignIn' }); h.page.accountChanged(); await h.settle();
  assert.equal(h.state().purchase.login, undefined);
  assert.equal(h.state().purchase.freeSeat, true); assert.equal(h.state().purchase.payerAdult, undefined, 'the payer question is asked');
  await h.page.handle({ type: 'purchasePayer', adult: false });
  assert.equal(h.state().purchase.payerAdult, false);
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d', guardian: true });
  const order = svc.requests.find(r => r.path === '/v1/purchase/orders');
  assert.equal(order.free, TOKEN_FREE, 'the order carries the free credential');
  // CONV-FUNNEL-R-007: the sign-in from this free seat gets the same credential for its device polls.
  assert.equal(await h.page.freeSignInCredential(), TOKEN_FREE, 'a sign-in from a free seat links it with the grant token');
  assert.equal(order.auth, 'Bearer account-bearer-' + 'd'.repeat(40), 'and the account bearer');
  assert.deepEqual(h.world.opened, [], 'a guardian checkout opens no browser here');
  const g = h.state().purchase.guardian;
  assert.match(g.url, /\/studio\/checkout\?order=/); assert.match(g.qr, /^data:image\/svg\+xml;base64,/);
  assert.ok(!JSON.stringify(h.world.states).includes(TOKEN_FREE), 'the credential never reaches the webview');
  // Negative control: a code-issued trial seat sends no free credential and gets no payer question.
  reset();
  const coded = { ...freeProfile, profile_id: 'studio-native-trial' };
  h = harness({ current: coded });
  h.world.secrets.set('hypeproofChat.workshopToken', 'coded-seat-token-' + 'c'.repeat(40));
  await h.page.handle({ type: 'startReady' }); await h.settle();
  await h.page.handle({ type: 'purchaseOpen' });
  assert.equal(h.state().purchase.freeSeat, undefined);
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(svc.requests.find(r => r.path === '/v1/purchase/orders').free, null, 'no free credential from a code-issued seat');
  assert.equal(await h.page.freeSignInCredential(), undefined, 'CONV-FUNNEL-R-007: no sign-in link credential from a code-issued seat');
  // CONV-FUNNEL-R-007 negative controls: a paid (pass) seat on the free profile id, and no seat at all.
  {
    const paid = harness({ current: { ...freeProfile, pass: { id: 'ord_paid', status: 'active' } } });
    paid.world.secrets.set('hypeproofChat.workshopToken', 'paid-seat-token-' + 'p'.repeat(40));
    await paid.page.handle({ type: 'startReady' }); await paid.settle();
    assert.equal(await paid.page.freeSignInCredential(), undefined, 'CONV-FUNNEL-R-007: a paid seat sends no free credential');
    const none = harness({ accounts: accountStub() });
    await none.page.handle({ type: 'startReady' }); await none.settle();
    assert.equal(await none.page.freeSignInCredential(), undefined, 'CONV-FUNNEL-R-007: no seat, no free credential');
  }
  assert.equal(h.world.opened.length, 1, 'today: the browser opens');
  assert.equal(svc.requests.find(r => r.path === '/v1/purchase/orders').auth, null, 'today: a code-issued seat orders anonymously');
  // ...until the Service says `account_required`: then the same seat gets the gate, nothing is opened.
  reset();
  svc.orderReply = { status: 401, body: { error: 'account_required', message: '이용권을 사려면 Google로 로그인해 주세요.' } };
  h = harness({ current: coded });
  h.world.secrets.set('hypeproofChat.workshopToken', 'coded-seat-token-' + 'c'.repeat(40));
  await h.page.handle({ type: 'startReady' }); await h.settle();
  await h.page.handle({ type: 'purchaseOpen' });
  assert.equal(h.state().purchase.login, undefined, 'code seat: no gate before the Service asks');
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(orders().length, 1);
  assert.deepEqual(h.world.opened, [], 'account_required: no checkout page opened');
  assert.equal(h.state().purchase.stage, 'choosing', 'back to the pass list, not a failure');
  assert.equal(h.state().purchase.login, 'unavailable', 'no account runtime: the calm notice');
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(orders().length, 1, 'no anonymous retry after account_required');
  // With an account runtime the same answer turns into the sign-in Primary.
  reset();
  svc.orderReply = { status: 401, body: { error: 'account_required', message: '이용권을 사려면 Google로 로그인해 주세요.' } };
  const codedAccount = accountStub('signedIn');
  h = harness({ current: coded, accounts: codedAccount });
  h.world.secrets.set('hypeproofChat.workshopToken', 'coded-seat-token-' + 'c'.repeat(40));
  await h.page.handle({ type: 'startReady' }); await h.settle();
  await h.page.handle({ type: 'purchaseOpen' });
  await h.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(codedAccount.refreshes > 0, true, 'a refused bearer re-reads the account');
  codedAccount.status = 'signedOut'; h.page.accountChanged(); await h.settle();
  assert.equal(h.state().purchase.login, 'signIn', 'account_required + signed out: the sign-in Primary');
  assert.equal(h.state().purchase.message, '이용권을 사려면 Google로 로그인해 주세요.');
  // ── e2e D2: relaunch on an expired free seat whose profile the Service refuses ───────────────
  // The real classifier reads the real Service answer (403 trial_expired + the free sentence).
  const { classifyProfileFailure } = await import('../src/proxyClientHelpers.ts');
  const FREE_EXPIRED_BODY = JSON.stringify({ error: { code: 'trial_expired', type: 'session_window', message: '무료 사용 시간이 끝났습니다. 만든 파일과 대화는 그대로 남아 있습니다.' } });
  const CODE_EXPIRED_BODY = JSON.stringify({ error: { code: 'trial_expired', type: 'session_window', message: '개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.' } });
  reset();
  h = harness({ globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]), failure: classifyProfileFailure(403, FREE_EXPIRED_BODY) });
  h.world.secrets.set('hypeproofChat.workshopToken', 'expired-free-' + 'e'.repeat(40));
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().profile, undefined);
  assert.equal(h.state().freeStart.ended, 'expired', 'the free card is told the seat ended');
  assert.equal(h.state().error, undefined, 'the end is said once, by the card, not again as an error beside it');
  assert.equal(claims().length, 0, 'nothing is claimed on relaunch');
  // Negative control: a code-issued trial's expiry (its own sentence) keeps today's error and no ended flag.
  reset();
  h = harness({ globals: new Map([['hypeproofChat.freeStart.age.v1', '14+']]), failure: classifyProfileFailure(403, CODE_EXPIRED_BODY) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().freeStart.ended, undefined, 'a code-issued trial is not read as a free seat');
  assert.ok(h.state().error, 'its error stays as today');
  // Negative control: the Service served the ended profile (trial.state expired) → the profile card draws it.
  reset();
  h = harness({ current: { ...freeProfile, trial: { state: 'expired', ends_at: Date.now() - 1, request_limit: 10, requests_used: 3 } }, failure: classifyProfileFailure(403, FREE_EXPIRED_BODY) });
  await h.page.handle({ type: 'startReady' }); await h.settle();
  assert.equal(h.state().freeStart.ended, undefined, 'a served profile wins over a stale failure');
  assert.equal(h.state().profile.free, true);
  console.log(`PASS free-start host over HTTP :${port}: negatives (code/404/old/off), first open → age → claim → chat, reuse, fallback id, 9 refusals + busy retry + offline, floor, drained, under-14, login at purchase (no runtime → no order, newcomer + free seat sign in first, code seat on account_required), purchase header + guardian, expired free seat relaunch (D2)`);
} finally { server.close(); server.closeAllConnections?.(); }
