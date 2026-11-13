// REQ-L12 ⑤ — the start page host recovering a pass order an older build started (src/startPage.ts +
// src/passPurchase.ts). REQ-L12 ①–④ (the in-app purchase view) were removed on 2026-11-13: no catalogue
// read, no order creation, no pass list. The legacy-order recovery below is unchanged.
// Synthetic Service on fetch, synthetic SecretStorage, no timers fired: each wait step is called directly.
//
// Run: node --experimental-strip-types test/start-page-purchase.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';export * from './src/activityConnections.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });

const SERVICE = 'https://service.test/v1', SITE = 'https://site.test';
const ID = 'ord_' + 'a'.repeat(32), SECRET = 'b'.repeat(64), KEY = 'hypeproofChat.pendingPurchase';
const profile = { activity_kind: 'trial', profile_id: 'adult', display_name: 'Adult practice', ux: { coach: { naming_mode: 'fixed', fallback_name: 'Coach' } }, welcome: {}, series_index: 1, series_total: 5 };
const catalogue = { products: [{ id: 'pass-30d', label: '30일 이용권', amount: 50000, currency: 'KRW', duration_hours: 720, request_limit: 600 }] };

function harness({ saved, settings = {}, accounts, seat = profile, funnelEmit } = {}) {
  const world = { secrets: new Map(saved ? [[KEY, JSON.stringify(saved)]] : []), events: [], states: [], opened: [], calls: [], funnel: [], service: SERVICE, site: SITE,
    products: 200, catalogue, offer: null, checkout: `${SITE}/studio/checkout?order=${ID}`, poll: 'pending', claims: [], profileStatus: 200, timers: 0, ...settings };
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    secrets: { get: async k => world.secrets.get(k), store: async (k, v) => { world.events.push('store:' + k); world.secrets.set(k, v); }, delete: async k => { world.events.push('delete:' + k); world.secrets.delete(k); } },
    extension: { packageJSON: { version: 'test' } }, extensionUri: 'ext:', subscriptions: [] };
  const chat = { renderHtml: () => '<html></html>', funnelEmit: funnelEmit ?? (e => world.funnel.push(e)), openInEditor: async () => {}, ensureProfile: async () => world.secrets.has('hypeproofChat.workshopToken') ? seat : null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? world.service : key === 'siteBase' ? world.site : fallback }) },
    window: { createWebviewPanel: () => {
      // A real tab for show(): the test closes it through the handler show() registers.
      const panel = { webview: { html: '', postMessage: async msg => world.states.push(msg), onDidReceiveMessage: () => ({}) }, reveal: () => {},
        onDidChangeViewState: () => ({}), onDidDispose: f => { world.closeTab = f; return {}; } };
      return panel;
    } }, ViewColumn: { One: 1 },
    commands: { executeCommand: async () => {} }, Uri: { parse: s => s, joinPath: (...a) => a.join('/') },
    env: { openExternal: async url => { if (world.openFails) return false; world.events.push('open'); world.opened.push(url); return true; } } };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), headers = new Headers(init.headers);
    world.calls.push({ path: u.pathname, origin: u.origin, method: init.method ?? 'GET', secret: headers.get('x-hps-order-secret'), body: init.body ? JSON.parse(init.body) : undefined });
    if (u.pathname === '/v1/purchase/products') return json(world.products, world.products === 200 ? world.catalogue : { error: 'not_found' });
    if (u.pathname === '/v1/trial/offer') return world.offer ? json(200, world.offer) : json(404, {});
    if (u.pathname === '/v1/purchase/orders') return json(201, { order_id: ID, order_secret: SECRET, amount: 50000, currency: 'KRW', label: '30일 이용권', expires_at: Date.now() + 1800000, checkout_url: world.checkout });
    if (u.pathname === `/v1/purchase/orders/${ID}/claim`) { const a = world.claims.shift() ?? { status: 503, body: { error: 'seat_unavailable' } }; return json(a.status, a.body); }
    if (u.pathname === `/v1/purchase/orders/${ID}`) return json(200, { order_id: ID, state: world.poll, claimed: false });
    if (u.pathname === '/v1/profile') return world.profileStatus === 200 ? json(200, profile) : world.profileStatus === 403 ? json(403, { error: { code: 'trial_expired', type: 'session_window', message: '개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.' } }) : json(401, { error: { code: 'signature' } });
    return json(404, {});
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch, Date, JSON,
    setTimeout: () => { world.timers++; return world.timers; }, clearTimeout: () => {} });
  const page = new module.exports.StartPage(ctx, chat, async (_p, commit) => { await commit(); return false; }, undefined, accounts);
  page.panel = { webview: { postMessage: async msg => world.states.push(msg) } };
  const view = () => world.states.at(-1).state.purchase;
  return { world, page, view };
}
const leaked = (world, ...values) => values.some(v => JSON.stringify(world.states).includes(v));
const CODE = 'issued-code-' + 'c'.repeat(40);

// A saved order exactly as an older build stored it (REQ-L12 ③).
const SAVED = () => ({ id: ID, secret: SECRET, productId: 'pass-30d', label: '30일 이용권', amount: 50000, checkoutUrl: `${SITE}/studio/checkout?order=${ID}`, expiresAt: Date.now() + 60000, service: SERVICE });

// ── REQ-L12 ①–④ removed: no catalogue read, no pass entry, no order, even if the Service lists passes ──
{
  const { world, page, view } = harness();
  await page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  assert.equal(world.calls.filter(c => c.path === '/v1/purchase/products').length, 0, 'the catalogue is never read');
  assert.equal(view().available, false);
  assert.equal(view().products, undefined);
  // The intents the old purchase view sent create nothing now.
  for (const msg of [{ type: 'purchaseOpen' }, { type: 'purchaseStart', productId: 'pass-30d' }, { type: 'purchaseStart', productId: 'pass-30d', guardian: true }, { type: 'purchasePayer', adult: true }])
    await page.handle(msg);
  assert.equal(world.calls.filter(c => c.path.startsWith('/v1/purchase')).length, 0, 'no purchase request at all');
  assert.equal(world.opened.length, 0, 'no checkout page is opened');
  assert.equal(world.secrets.has(KEY), false, 'no order secret is stored');
  assert.equal(view().stage, undefined);
  assert.equal(typeof page.showPurchase, 'undefined', 'the chat card command that opened the pass list is gone');
  assert.equal(world.funnel.length, 0, 'no pass offer is counted');
  console.log('PASS no purchase entry: no catalogue read, no pass list, no order, nothing opened');
}

// ── REQ-L12 ⑤: a saved paid order is claimed and enters as a participation code ─────────────
{
  const { world, page, view } = harness({ saved: SAVED() });
  await page.resumePurchase();
  assert.equal(view().available, true);
  assert.equal(view().stage, 'waiting');
  assert.equal(JSON.stringify(view().order), JSON.stringify({ label: '30일 이용권', amount: 50000 }));
  await page.purchaseTick();
  assert.equal(view().stage, 'waiting');
  world.poll = 'confirming'; await page.purchaseTick();
  assert.match(view().message, /확인하고 있어요/);
  assert.equal(world.calls.filter(c => c.path.endsWith('/claim')).length, 0, 'nothing is claimed before the Service says paid');

  world.poll = 'paid'; world.claims = [{ status: 200, body: { code: CODE } }];
  await page.purchaseTick();
  assert.equal(page.candidate.token, CODE, 'the issued code takes the ordinary entry path');
  assert.equal(world.states.at(-1).state.candidate, true);
  assert.equal(view().stage, undefined);
  assert.equal(JSON.parse(world.secrets.get(KEY)).claimed, true, 'the record stays, marked claimed, until the activity is entered');
  assert.ok(world.calls.filter(c => c.secret).every(c => c.origin === 'https://service.test' && c.secret === SECRET));
  assert.equal(leaked(world, SECRET, CODE), false, 'neither the order secret nor the code reaches the webview');
  assert.equal(world.calls.filter(c => c.path === '/v1/purchase/orders').length, 0, 'recovery never creates an order');

  await page.handle({ type: 'beginCourse' });
  assert.equal(world.secrets.has(KEY), false, 'entering the activity retires the order record');
  assert.equal(world.secrets.get('hypeproofChat.workshopToken'), CODE);
  console.log('PASS legacy order: claim only after paid, code enters as a participation code, record retired on entry');
}

// ── Paid, but the code could not be turned into an activity: nothing is lost ─────────────
{
  const { world, page, view } = harness({ saved: SAVED() });
  await page.resumePurchase();
  world.poll = 'paid'; world.claims = [{ status: 200, body: { code: CODE } }]; world.profileStatus = 401;
  await page.purchaseTick();
  assert.equal(page.candidate, undefined);
  assert.equal(view().stage, 'stopped');
  assert.match(view().message, /결제 내역은 그대로 있어요/);
  assert.equal(JSON.parse(world.secrets.get(KEY)).claimed, true);
  // "다시 연결" asks for a replacement code instead of a second payment.
  world.profileStatus = 200; world.claims = [{ status: 200, body: { code: CODE + '2' } }];
  await page.handle({ type: 'purchaseRetry' });
  assert.deepEqual(world.calls.filter(c => c.path.endsWith('/claim')).at(-1).body, { reissue: true });
  assert.equal(world.calls.filter(c => c.path === '/v1/purchase/orders').length, 0, 'no second order');
  assert.equal(page.candidate.token, CODE + '2');

  // The Service could not hand the seat over at all: the order is kept for another try.
  const down = harness({ saved: SAVED() });
  await down.page.resumePurchase();
  down.world.poll = 'paid';
  await down.page.purchaseTick();
  assert.equal(down.view().stage, 'stopped');
  assert.equal(down.world.secrets.has(KEY), true);
  assert.equal(down.view().order.amount, 50000);
  console.log('PASS legacy order recovery: a paid order survives a failed connection and a failed hand-over');
}

// ── Stopping, failing, refunded, and a checkout address this build does not know ─────────
{
  const { world, page, view } = harness({ saved: SAVED() });
  await page.resumePurchase();
  await page.handle({ type: 'purchaseCancel' });
  assert.equal(view().stage, 'stopped');
  assert.equal(world.secrets.has(KEY), true, 'stopping the wait never throws a possibly paid order away');
  await page.handle({ type: 'purchaseRetry' });
  assert.equal(view().stage, 'waiting');
  // Leaving for the other ways to start hides the view but keeps the order on offer.
  await page.handle({ type: 'purchaseHide' });
  assert.equal(view().stage, undefined);
  assert.equal(view().order.label, '30일 이용권');
  assert.equal(world.secrets.has(KEY), true);
  await page.handle({ type: 'purchaseRetry' });
  assert.equal(view().stage, 'waiting');
  // The person can reopen the checkout page of the order they already started.
  await page.handle({ type: 'purchaseReopen' });
  assert.deepEqual(world.opened, [`${SITE}/studio/checkout?order=${ID}`]);
  world.poll = 'failed'; await page.purchaseTick();
  assert.match(view().message, /돈이 나가지 않았어요/);
  assert.equal(world.secrets.has(KEY), false);
  assert.equal(view().order, undefined);
  assert.equal(view().available, false, 'with the order gone, nothing purchase-related is left on the page');

  // U3 (2026-11-13): a refunded order says so and offers no new purchase.
  const refunded = harness({ saved: SAVED() });
  await refunded.page.resumePurchase();
  refunded.world.poll = 'refunded'; await refunded.page.purchaseTick();
  assert.match(refunded.view().message, /환불한 주문이에요/);
  assert.doesNotMatch(refunded.view().message, /구매|새 이용권/);

  // A saved order whose checkout points elsewhere is not trusted: nothing is resumed or opened.
  const forged = harness({ saved: { ...SAVED(), checkoutUrl: 'https://evil.test/pay' } });
  await forged.page.resumePurchase();
  assert.equal(forged.world.calls.length, 0);
  assert.equal(forged.world.opened.length, 0);
  console.log('PASS legacy order stops: cancel keeps the order, a failed payment ends it, a refund names no purchase, an unknown checkout address is never used');
}

// ── Coming back after a restart ───────────────────────────────────────────────────────────
{
  const saved = SAVED();
  const back = harness({ saved });
  await back.page.resumePurchase();
  assert.equal(back.view().stage, 'waiting');
  assert.equal(back.world.timers, 1, 'the wait is picked back up');

  // A claimed record is never replaced by itself: replacing rotates the credential.
  const claimed = harness({ saved: { ...saved, claimed: true } });
  await claimed.page.resumePurchase();
  assert.equal(claimed.view().stage, 'stopped');
  assert.match(claimed.view().message, /아직 넣지 못했어요/);
  assert.equal(claimed.world.calls.length, 0);
  assert.equal(claimed.world.timers, 0);

  // A different Service setting: the saved secret is not sent anywhere.
  const moved = harness({ saved, settings: { service: 'https://other.test/v1' } });
  await moved.page.resumePurchase();
  assert.equal(moved.world.calls.length, 0);
  assert.equal(moved.world.states.length, 0);
  console.log('PASS legacy order resume: an open order resumes, a claimed one waits for the buyer, another Service gets nothing');
}

// ── REQ-L12 (13): after a free trial expired, the start page keeps the files and names no pass ──
{
  const TRIAL_ENDED = '체험 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요.';
  // The same code entered again: the Service answers 403 trial_expired (observed 2026-10-18).
  const again = harness({ settings: { profileStatus: 403 } });
  await again.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  await again.page.handle({ type: 'connectCourse', token: CODE });
  const state = again.world.states.at(-1).state;
  assert.equal(state.error, TRIAL_ENDED, 'no pass pointer, even though the stand-in Service still lists a pass');
  assert.doesNotMatch(state.error, /코드 발급 담당자|이용권/);
  assert.equal(state.purchase.available, false);
  assert.equal(state.purchase.stage, undefined);
  assert.equal(again.world.opened.length, 0);
  assert.equal(again.world.calls.filter(c => c.path.startsWith('/v1/purchase')).length, 0, 'no catalogue read and no order');
  console.log('PASS trial expiry on the start page: kept files, no pass named, nothing opened');
}
