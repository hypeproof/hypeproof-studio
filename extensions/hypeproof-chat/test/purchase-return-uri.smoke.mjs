// CONV-PURCHASE-R-004 (REQ-L12 ⑤⑥) — the Lab done page's return link
// `<scheme>://hypeproof.hypeproof-chat/purchase-return?order=ord_<32 hex>` runs the purchase check once,
// only for the order this window already holds. Synthetic Service on fetch, synthetic SecretStorage,
// timers recorded and fired by hand so the number of checks is counted, not inferred.
//
// Run: node --experimental-strip-types test/purchase-return-uri.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';export * from './src/purchaseReturnHelpers.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });

const SERVICE = 'https://service.test/v1', SITE = 'https://site.test', SCHEME = 'hypeproof-studio';
const ID = 'ord_' + 'a'.repeat(32), OTHER = 'ord_' + 'd'.repeat(32), SECRET = 'b'.repeat(64), KEY = 'hypeproofChat.pendingPurchase';
const saved = { id: ID, secret: SECRET, productId: 'pass-30d', label: '30일 이용권', amount: 50000, checkoutUrl: `${SITE}/studio/checkout?order=${ID}`, expiresAt: Date.now() + 60000, service: SERVICE };

function harness({ order = saved, panelOpen = true, poll = 'pending' } = {}) {
  const world = { secrets: new Map(order ? [[KEY, JSON.stringify(order)]] : []), states: [], calls: [], timers: new Map(), nextTimer: 0, panels: 0, reveals: 0, poll };
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    secrets: { get: async k => world.secrets.get(k), store: async (k, v) => { world.secrets.set(k, v); }, delete: async k => { world.secrets.delete(k); } },
    extension: { packageJSON: { version: 'test' } }, extensionUri: 'ext:', subscriptions: [] };
  const chat = { renderHtml: () => '<html></html>', funnelEmit: () => {}, openInEditor: async () => {}, ensureProfile: async () => null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? SERVICE : key === 'siteBase' ? SITE : fallback }) },
    window: { createWebviewPanel: () => { world.panels++; return { webview: { html: '', postMessage: async msg => world.states.push(msg), onDidReceiveMessage: () => ({}) }, reveal: () => { world.reveals++; }, onDidChangeViewState: () => ({}), onDidDispose: () => ({}) }; } },
    ViewColumn: { One: 1 }, commands: { executeCommand: async () => {} }, Uri: { parse: s => s, joinPath: (...a) => a.join('/') },
    env: { openExternal: async () => true } };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    world.calls.push({ path: u.pathname, method: init.method ?? 'GET' });
    if (world.gate && u.pathname.includes('/orders/')) await world.gate;
    if (u.pathname === '/v1/purchase/products') return json(404, {});
    if (u.pathname === '/v1/trial/offer') return json(404, {});
    if (u.pathname === `/v1/purchase/orders/${ID}`) return json(200, { order_id: ID, state: world.poll, claimed: false });
    return json(404, {});
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, URLSearchParams, process, TextEncoder, fetch, Date, JSON,
    setTimeout: (f) => { const id = ++world.nextTimer; world.timers.set(id, f); return id; }, clearTimeout: id => { world.timers.delete(id); } });
  const page = new module.exports.StartPage(ctx, chat, async (_p, commit) => { await commit(); return false; }, undefined, undefined);
  if (panelOpen) page.panel = { webview: { postMessage: async msg => world.states.push(msg) }, reveal: () => { world.reveals++; } };
  // Fire every timer pending right now (not the ones they schedule), then let the async work settle.
  const fire = async () => { const due = [...world.timers.values()]; world.timers.clear(); for (const f of due) f(); for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  const polls = () => world.calls.filter(c => c.path === `/v1/purchase/orders/${ID}` || c.path.startsWith('/v1/purchase/orders/ord_')).length;
  const writes = () => world.calls.filter(c => c.method !== 'GET').length;
  return { world, page, fire, polls, writes, api: module.exports };
}

const { purchaseReturnOrder, isPurchaseReturnOrderId } = harness().api;
const uri = (o = {}) => ({ scheme: SCHEME, authority: 'hypeproof.hypeproof-chat', path: '/purchase-return', query: `order=${ID}`, fragment: '', ...o });

// ── The validator accepts exactly one shape ──────────────────────────────────────────────
{
  assert.equal(purchaseReturnOrder(uri(), SCHEME), ID);
  const refused = {
    'foreign scheme': uri({ scheme: 'https' }),
    'dev build scheme': uri({ scheme: 'hypeproof-studio-dev' }),
    'upper-case scheme': uri({ scheme: 'HYPEPROOF-STUDIO' }),
    'other authority': uri({ authority: 'hypeproof.other' }),
    'authority with port': uri({ authority: 'hypeproof.hypeproof-chat:1' }),
    'other path': uri({ path: '/account-return' }),
    'trailing slash': uri({ path: '/purchase-return/' }),
    'dot segment': uri({ path: '/./purchase-return' }),
    'fragment': uri({ fragment: 'x' }),
    'extra key': uri({ query: `order=${ID}&state=x` }),
    'key before order': uri({ query: `windowId=1&order=${ID}` }),
    'duplicate order': uri({ query: `order=${ID}&order=${ID}` }),
    'empty': uri({ query: '' }),
    'no value': uri({ query: 'order=' }),
    'upper-case hex': uri({ query: `order=ord_${'A'.repeat(32)}` }),
    'short id': uri({ query: `order=ord_${'a'.repeat(31)}` }),
    'long id': uri({ query: `order=ord_${'a'.repeat(33)}` }),
    'other prefix': uri({ query: `order=ordr${'a'.repeat(32)}` }),
    'encoded key': uri({ query: `%6frder=${ID}` }),
    'trailing ampersand': uri({ query: `order=${ID}&` }),
    'over-long query': uri({ query: `order=${ID}${'&'.repeat(80)}` }),
  };
  for (const [name, u] of Object.entries(refused)) assert.equal(purchaseReturnOrder(u, SCHEME), undefined, name);
  assert.equal(purchaseReturnOrder(uri(), ''), undefined, 'no scheme known: nothing passes');
  assert.equal(isPurchaseReturnOrderId(ID), true);
  assert.equal(isPurchaseReturnOrderId(ID + ' '), false);
  assert.equal(isPurchaseReturnOrderId(undefined), false);
  console.log('PASS validator: exact scheme/authority/path, one `order` key, ord_<32 lowercase hex>, nothing else');
}

// ── Matching held order: exactly one check, and a paid answer takes the ordinary claim path ──
{
  const h = harness();
  assert.equal(await h.page.purchaseReturned(ID), true);
  assert.equal(h.world.timers.size, 1, 'one pending check');
  await h.fire();
  assert.equal(h.polls(), 1, 'exactly one check of the order');
  assert.equal(h.world.states.at(-1).state.purchase.stage, 'waiting');
  // Opening the link three times leaves one pending check, not three.
  const r = harness();
  await r.page.purchaseReturned(ID); await r.page.purchaseReturned(ID); await r.page.purchaseReturned(ID);
  assert.equal(r.world.timers.size, 1, 'repeated opens: no duplicate timers');
  await r.fire();
  assert.equal(r.polls(), 1);
  console.log('PASS matching order: one check per link, repeated links do not stack timers');
}

// ── Matching saved order with no start page open: the page opens and still one check ─────
{
  const h = harness({ panelOpen: false });
  assert.equal(await h.page.purchaseReturned(ID), true);
  assert.equal(h.world.panels, 1, 'the start page is brought up');
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  // resumePurchase (from show) may schedule its own check; only one may be pending.
  assert.equal(h.world.timers.size, 1);
  await h.fire();
  assert.equal(h.polls(), 1);
  console.log('PASS matching order, fresh page: page opened, one check');
}

// ── A check already on the wire: a link arriving meanwhile does not start a second one ──
{
  const h = harness();
  h.page.order = JSON.parse(JSON.stringify({ ...saved })); h.page.purchaseStage = 'waiting';
  h.page.schedulePurchasePoll(0);
  // Fire the timer but stop before the answer: the tick is in flight.
  const due = [...h.world.timers.values()]; h.world.timers.clear();
  const tick = due[0]();
  assert.equal(h.page.purchaseTickRunning, true, 'the check is on the wire');
  await h.page.purchaseReturned(ID);
  assert.equal(h.world.timers.size, 0, 'no second check while one is on the wire');
  await tick; for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(h.polls(), 1);
  assert.equal(h.world.timers.size, 1, 'the in-flight check schedules the next one itself');
  console.log('PASS in flight: a link during a running check adds no check');
}

// ── Cold start race: the page's own resume sets the order while the link still reads SecretStorage ──
{
  const h = harness();
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
  const realGet = h.page.context.secrets.get;
  let releaseRead; const slowRead = new Promise(r => { releaseRead = r; });
  const resume = h.page.resumePurchase();
  h.page.context.secrets.get = async k => { h.page.context.secrets.get = realGet; const v = await realGet(k); await slowRead; return v; };
  const link = h.page.purchaseReturned(ID);
  await resume; await settle();
  let releasePoll; h.world.gate = new Promise(r => { releasePoll = r; });
  const due = [...h.world.timers.values()]; h.world.timers.clear(); const tick = due[0]();
  await settle();
  assert.equal(h.page.purchaseTickRunning, true);
  releaseRead(); await link; await settle();
  releasePoll(); await tick; await settle();
  assert.equal(h.world.timers.size, 1, 'the wait keeps a next check (the held order object is not replaced)');
  assert.equal(h.polls(), 1);
  console.log('PASS cold start race: the wait never stops without a timer');
}

// ── Paid answer: the check `purchaseRetry` runs goes on into the claim path ─────────────
{
  const h = harness({ poll: 'paid' });
  await h.page.purchaseReturned(ID);
  await h.fire();
  assert.equal(h.polls(), 2, 'poll then claim (claim POST is under the same order path)');
  assert.ok(h.world.calls.some(c => c.path === `/v1/purchase/orders/${ID}/claim` && c.method === 'POST'), 'paid → the existing claim path');
  console.log('PASS paid: the link hands a paid answer to the existing claim path');
}

// ── Negative controls: nothing checked, created or claimed ───────────────────────────────
{
  const other = harness();
  assert.equal(await other.page.purchaseReturned(OTHER), false);
  await other.fire();
  assert.equal(other.polls(), 0, 'a different order id: no check');
  assert.equal(other.writes(), 0);
  assert.ok(other.world.reveals >= 1, 'the start page still comes forward');

  const none = harness({ order: null });
  assert.equal(await none.page.purchaseReturned(ID), false);
  await none.fire();
  assert.equal(none.polls(), 0, 'no held order: no check');
  assert.equal(none.writes(), 0);
  assert.equal(none.world.secrets.size, 0, 'nothing is saved for a link');

  const claimed = harness({ order: { ...saved, claimed: true } });
  assert.equal(await claimed.page.purchaseReturned(ID), false);
  await claimed.fire();
  assert.equal(claimed.world.calls.filter(c => c.path.endsWith('/claim')).length, 0, 'a claimed record is never reissued by a link');

  const bad = harness();
  assert.equal(await bad.page.purchaseReturned('ord_' + 'A'.repeat(32)), false);
  assert.equal(await bad.page.purchaseReturned(`${ID}&x=1`), false);
  await bad.fire();
  assert.equal(bad.polls(), 0, 'malformed id: no check');
  assert.equal(bad.world.reveals, 0, 'malformed id: nothing visible');

  // A claim already running: a link does not start a second claim (which would ask for a reissue).
  const busy = harness({ poll: 'paid' });
  busy.page.order = JSON.parse(JSON.stringify(saved)); busy.page.purchaseStage = 'connecting';
  assert.equal(await busy.page.purchaseReturned(ID), false);
  await busy.fire();
  assert.equal(busy.polls(), 0, 'claim in progress: no check, no second claim');

  // A different id with the start page closed: the page's own resume never names the link's id.
  const closed = harness({ panelOpen: false });
  assert.equal(await closed.page.purchaseReturned(OTHER), false);
  await closed.fire();
  assert.ok(!closed.world.calls.some(c => c.path.includes(OTHER)), 'no request for the link\'s id');
  assert.equal(closed.writes(), 0);

  // Stale view: no red error, no message drawn.
  for (const h of [other, none, claimed]) assert.ok(!JSON.stringify(h.world.states).includes('"error":"'), 'no error drawn');
  console.log('PASS negative controls: other id, no order, claimed record, malformed id → no check, no write');
}

// ── Wiring: extension.ts routes the link before the account check, /account-return unchanged ──
{
  const src = readFileSync(`${root}src/extension.ts`, 'utf8');
  const handler = src.slice(src.indexOf('registerUriHandler('), src.indexOf('registerUriHandler(') + 1600);
  const iReturn = handler.indexOf('purchaseReturnOrder(uri, vscode.env.uriScheme)');
  const iAccounts = handler.indexOf('if (!accounts) return;');
  assert.ok(iReturn > 0 && iReturn < iAccounts, 'purchase return is handled before (and without) the account runtime');
  assert.ok(handler.includes("uri.path !== '/account-return'"), '/account-return keeps its own exact check');
  assert.ok(handler.includes("[...query.keys()].some(key => key !== 'state' && key !== 'windowId')"), '/account-return query rule unchanged');
  assert.equal(purchaseReturnOrder(uri({ path: '/account-return', query: `state=${'a'.repeat(64)}` }), SCHEME), undefined, 'an account-return link falls through to its own handler');
  console.log('PASS wiring: purchase-return before the account check; /account-return untouched');
}
