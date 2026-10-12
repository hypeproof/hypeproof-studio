// REQ-L12 — the start page host driving a pass purchase (src/startPage.ts + src/passPurchase.ts).
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

function harness({ saved, settings = {} } = {}) {
  const world = { secrets: new Map(saved ? [[KEY, JSON.stringify(saved)]] : []), events: [], states: [], opened: [], calls: [], service: SERVICE, site: SITE,
    products: 200, checkout: `${SITE}/studio/checkout?order=${ID}`, poll: 'pending', claims: [], profileStatus: 200, timers: 0, ...settings };
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    secrets: { get: async k => world.secrets.get(k), store: async (k, v) => { world.events.push('store:' + k); world.secrets.set(k, v); }, delete: async k => { world.events.push('delete:' + k); world.secrets.delete(k); } },
    extension: { packageJSON: { version: 'test' } }, subscriptions: [] };
  const chat = { openInEditor: async () => {}, ensureProfile: async () => world.secrets.has('hypeproofChat.workshopToken') ? profile : null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? world.service : key === 'siteBase' ? world.site : fallback }) },
    window: {}, commands: { executeCommand: async () => {} }, Uri: { parse: s => s }, env: { openExternal: async url => { world.events.push('open'); world.opened.push(url); return true; } } };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), headers = new Headers(init.headers);
    world.calls.push({ path: u.pathname, origin: u.origin, method: init.method ?? 'GET', secret: headers.get('x-hps-order-secret'), body: init.body ? JSON.parse(init.body) : undefined });
    if (u.pathname === '/v1/purchase/products') return json(world.products, world.products === 200 ? catalogue : { error: 'not_found' });
    if (u.pathname === '/v1/purchase/orders') return json(201, { order_id: ID, order_secret: SECRET, amount: 50000, currency: 'KRW', label: '30일 이용권', expires_at: Date.now() + 1800000, checkout_url: world.checkout });
    if (u.pathname === `/v1/purchase/orders/${ID}/claim`) { const a = world.claims.shift() ?? { status: 503, body: { error: 'seat_unavailable' } }; return json(a.status, a.body); }
    if (u.pathname === `/v1/purchase/orders/${ID}`) return json(200, { order_id: ID, state: world.poll, claimed: false });
    if (u.pathname === '/v1/profile') return world.profileStatus === 200 ? json(200, profile) : json(401, { error: { code: 'signature' } });
    return json(404, {});
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch, Date, JSON,
    setTimeout: () => { world.timers++; return world.timers; }, clearTimeout: () => {} });
  const page = new module.exports.StartPage(ctx, chat, async (_p, commit) => { await commit(); return false; });
  page.panel = { webview: { postMessage: async msg => world.states.push(msg) } };
  const view = () => world.states.at(-1).state.purchase;
  return { world, page, view };
}
const leaked = (world, ...values) => values.some(v => JSON.stringify(world.states).includes(v));
const CODE = 'issued-code-' + 'c'.repeat(40);

// ── The entry exists only when the Service sells passes ──────────────────────────────────
{
  const { world, page, view } = harness();
  await page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  assert.equal(view().available, true);
  assert.equal(view().products[0].requestLimit, 600);
  const closed = harness({ settings: { products: 404 } });
  await closed.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  assert.equal(closed.view().available, false);
  await closed.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(closed.world.opened.length, 0, 'no order without a catalogue');
  assert.equal(world.opened.length, 0);
  console.log('PASS purchase entry: drawn only when the Service lists products');
}

// ── Paying, then entering the purchased activity ─────────────────────────────────────────
{
  const { world, page, view } = harness();
  await page.handle({ type: 'purchaseOpen' });
  assert.equal(view().stage, 'choosing');
  await page.handle({ type: 'purchaseStart', productId: 'unknown' });
  assert.equal(world.opened.length, 0);
  await page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  // The secret is on disk before the browser opens: a buyer who can pay can always come back.
  assert.deepEqual(world.events.filter(e => e === 'open' || e.startsWith('store:')), ['store:' + KEY, 'open']);
  assert.deepEqual(world.opened, [`${SITE}/studio/checkout?order=${ID}`]);
  assert.equal(view().stage, 'waiting');
  // Compared as JSON: the view object comes from another realm (vm), where deepEqual sees a different prototype.
  assert.equal(JSON.stringify(view().order), JSON.stringify({ label: '30일 이용권', amount: 50000 }));
  // A second start while an order is open does nothing.
  await page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(world.opened.length, 1);

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

  await page.handle({ type: 'beginCourse' });
  assert.equal(world.secrets.has(KEY), false, 'entering the activity retires the order record');
  assert.equal(world.secrets.get('hypeproofChat.workshopToken'), CODE);
  console.log('PASS purchase: secret saved before the browser opens, claim only after paid, code enters as a participation code, record retired on entry');
}

// ── Paid, but the code could not be turned into an activity: nothing is lost ─────────────
{
  const { world, page, view } = harness();
  await page.handle({ type: 'purchaseOpen' });
  await page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  world.poll = 'paid'; world.claims = [{ status: 200, body: { code: CODE } }]; world.profileStatus = 401;
  await page.purchaseTick();
  assert.equal(page.candidate, undefined);
  assert.equal(view().stage, 'stopped');
  assert.match(view().message, /결제 내역은 그대로 있어요/);
  assert.equal(JSON.parse(world.secrets.get(KEY)).claimed, true);
  // "다시 연결" asks for a replacement code instead of a second payment.
  world.profileStatus = 200; world.claims = [{ status: 200, body: { code: CODE + '2' } }];
  const orders = world.calls.filter(c => c.path === '/v1/purchase/orders').length;
  await page.handle({ type: 'purchaseRetry' });
  assert.deepEqual(world.calls.filter(c => c.path.endsWith('/claim')).at(-1).body, { reissue: true });
  assert.equal(world.calls.filter(c => c.path === '/v1/purchase/orders').length, orders, 'no second order');
  assert.equal(page.candidate.token, CODE + '2');

  // The Service could not hand the seat over at all: the order is kept for another try.
  const down = harness();
  await down.page.handle({ type: 'purchaseOpen' });
  await down.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  down.world.poll = 'paid';
  await down.page.purchaseTick();
  assert.equal(down.view().stage, 'stopped');
  assert.equal(down.world.secrets.has(KEY), true);
  assert.equal(down.view().order.amount, 50000);
  console.log('PASS purchase recovery: a paid order survives a failed connection and a failed hand-over');
}

// ── Stopping, failing, and a checkout address this build does not know ───────────────────
{
  const { world, page, view } = harness();
  await page.handle({ type: 'purchaseOpen' });
  await page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  await page.handle({ type: 'purchaseCancel' });
  assert.equal(view().stage, 'stopped');
  assert.equal(world.secrets.has(KEY), true, 'stopping the wait never throws a possibly paid order away');
  await page.handle({ type: 'purchaseRetry' });
  assert.equal(view().stage, 'waiting');
  world.poll = 'failed'; await page.purchaseTick();
  assert.match(view().message, /돈이 나가지 않았어요/);
  assert.equal(world.secrets.has(KEY), false);
  assert.equal(view().order, undefined);

  const forged = harness({ settings: { checkout: 'https://evil.test/pay' } });
  await forged.page.handle({ type: 'purchaseOpen' });
  await forged.page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
  assert.equal(forged.world.opened.length, 0);
  assert.equal(forged.world.secrets.has(KEY), false);
  assert.match(forged.view().message, /주소가 이상해서 열지 않았어요/);
  console.log('PASS purchase stops: cancel keeps the order, a failed payment ends it, an unknown checkout address is never opened');
}

// ── Coming back after a restart ───────────────────────────────────────────────────────────
{
  const saved = { id: ID, secret: SECRET, productId: 'pass-30d', label: '30일 이용권', amount: 50000, checkoutUrl: `${SITE}/studio/checkout?order=${ID}`, expiresAt: Date.now() + 60000, service: SERVICE };
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
  console.log('PASS purchase resume: an open order resumes, a claimed one waits for the buyer, another Service gets nothing');
}
