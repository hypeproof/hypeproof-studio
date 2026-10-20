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

function harness({ saved, settings = {}, accounts } = {}) {
  const world = { secrets: new Map(saved ? [[KEY, JSON.stringify(saved)]] : []), events: [], states: [], opened: [], calls: [], service: SERVICE, site: SITE,
    products: 200, catalogue, offer: null, checkout: `${SITE}/studio/checkout?order=${ID}`, poll: 'pending', claims: [], profileStatus: 200, timers: 0, ...settings };
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
  // Leaving for the other ways to start hides the view but keeps the order on offer (2026-10-14:
  // after 그만두기 the screen could not be left for up to 40 minutes).
  await page.handle({ type: 'purchaseHide' });
  assert.equal(view().stage, undefined);
  assert.equal(view().order.label, '30일 이용권');
  assert.equal(world.secrets.has(KEY), true);
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

// ── REQ-L12 (13): after a free trial expired, the start page points to passes, never opens them ──
{
  const TRIAL_ENDED = '체험 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요.';
  const POINTER = "계속하려면 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.";
  // The same code entered again: the Service answers 403 trial_expired (observed 2026-10-18).
  const again = harness({ settings: { profileStatus: 403 } });
  await again.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  await again.page.handle({ type: 'connectCourse', token: CODE });
  const state = again.world.states.at(-1).state;
  assert.equal(state.error, `${TRIAL_ENDED} ${POINTER}`);
  assert.doesNotMatch(state.error, /코드 발급 담당자/);
  assert.equal(state.purchase.available, true, 'the entry it names is drawn');
  assert.equal(state.purchase.stage, undefined, 'the purchase screen is not opened for the person');
  assert.equal(again.world.opened.length, 0);
  assert.equal(again.world.calls.filter(c => c.path.startsWith('/v1/purchase/orders')).length, 0, 'no order is created');
  // No passes on sale: the same ending, no pointer to an entry that is not drawn.
  const closed = harness({ settings: { profileStatus: 403, products: 404 } });
  await closed.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  await closed.page.handle({ type: 'connectCourse', token: CODE });
  assert.equal(closed.world.states.at(-1).state.error, TRIAL_ENDED);
  // Other start-page errors are left as they are.
  const other = harness({ settings: { profileStatus: 401 } });
  await other.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  await other.page.handle({ type: 'connectCourse', token: CODE });
  assert.doesNotMatch(other.world.states.at(-1).state.error, /이용권으로 시작하기/);
  console.log('PASS trial expiry on the start page: kept files, the pass entry named only while sold, nothing opened');
}

// ── TUX-COND-07: the chat card's "이용권 살펴보기" opens the pass list, once, and nothing else ──
{
  const { world, page, view } = harness();
  page.panel.reveal = () => {};
  // Control: an ordinary visit never carries the focus mark, so the list never opens by itself.
  await page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  assert.equal(view().focus, undefined);
  await page.showPurchase();
  assert.equal(view().stage, 'choosing');
  assert.equal(typeof view().focus, 'number');
  assert.equal(world.opened.length, 0, 'showing the list creates no order and opens no browser');
  assert.equal(world.calls.filter(c => c.path === '/v1/purchase/orders').length, 0);
  // Leaving the list clears the mark: a later refresh does not reopen it.
  await page.handle({ type: 'purchaseCancel' });
  assert.equal(view().focus, undefined);
  console.log('PASS end-of-trial card: the pass list opens only on the press, without an order');
}

// ── CONV-PURCHASE-R-002: back from the purchase-time Google sign-in, the chosen pass is still chosen ──
// Login at purchase (REQ-L12 ⑭) for a newcomer under free start. The account runtime is a stub of
// src/accountSession.ts: `start` opens the browser and waits; `finish` stands for the approval
// arriving later and the runtime's change event (extension.ts wires it to accountChanged).
{
  const OFFER = { entry: 'open', duration_hours: 24, request_limit: 10, unit: 'turn', claim: '/v1/free/claim', min_app_version: '0.0.1', available: true };
  const two = { products: [
    { id: 'pass-30d', label: '30일 이용권', amount: 50000, currency: 'KRW', duration_hours: 720, request_limit: 600, recommended: true },
    { id: 'pass-90d', label: '90일 이용권', amount: 120000, currency: 'KRW', duration_hours: 2160, request_limit: 1800 },
  ] };
  function accountStub() {
    const a = { status: 'signedOut', message: undefined, starts: 0, onChange: () => {},
      view: () => ({ status: a.status, ...(a.message ? { message: a.message } : {}), ...(a.status === 'signedIn' ? { account: { id: 'acc_1', email: 'learner@example.test', display_name: '학습자' }, passes: [] } : {}) }),
      matches: () => true, accessToken: async () => a.status === 'signedIn' ? 'account-bearer-' + 'd'.repeat(40) : undefined,
      refreshView: async () => {}, start: async () => { a.starts++; a.status = 'waiting'; a.message = undefined; },
      finish: () => { a.status = 'signedIn'; a.message = undefined; a.onChange(); },
      cancel(notify = true) { if (notify) { a.status = 'signedOut'; a.message = '로그인을 취소했어요.'; a.onChange(); } },
      reopen: async () => {}, openAccount: async () => {}, signOut: async () => { a.status = 'signedOut'; a.onChange(); } };
    return a;
  }
  const newcomer = () => {
    const accounts = accountStub();
    const h = harness({ settings: { catalogue: two, offer: OFFER }, accounts });
    accounts.onChange = () => h.page.accountChanged();
    return { ...h, accounts };
  };
  const settle = () => new Promise(r => setImmediate(r));
  const orders = world => world.calls.filter(c => c.path === '/v1/purchase/orders');
  const list = v => JSON.stringify({ stage: v.stage, products: v.products });

  // Positive: choose the non-default pass, sign in, and the list comes back with it and the pay Primary.
  {
    const { world, page, view, accounts } = newcomer();
    await page.handle({ type: 'startReady' }); await settle();
    await page.handle({ type: 'purchaseOpen' });
    assert.equal(view().stage, 'choosing');
    assert.equal(view().login, 'signIn', 'newcomer under free start: the Google sign-in is the Primary');
    assert.equal(view().selected, undefined, 'nothing is selected by the host before a sign-in');
    const before = list(view());
    await page.handle({ type: 'accountSignIn', productId: 'pass-90d' });
    assert.equal(accounts.starts, 1);
    assert.equal(view().selected, 'pass-90d', 'the chosen pass is kept while the browser sign-in runs');
    accounts.finish(); await settle();
    // No further message from the webview: the account appearing alone brings the list back.
    const back = view();
    assert.equal(list(back), before, 'the same pass list');
    assert.equal(back.stage, 'choosing');
    assert.equal(back.selected, 'pass-90d', 'the pass the person had chosen is still selected');
    assert.equal(back.login, undefined, 'signed in: the pay Primary (`{금액} 결제하러 가기`) is drawn, not the sign-in');
    assert.equal(back.message, undefined);
    assert.equal(orders(world).length, 0, 'returning creates no order by itself');
    assert.equal(world.opened.length, 0, 'and opens no browser');
    // The id is host memory only: not in SecretStorage, not in any URL.
    assert.equal([...world.secrets.values()].some(v => String(v).includes('pass-90d')), false);
    assert.equal(world.calls.some(c => c.path.includes('pass-90d') || c.origin.includes('pass-90d')), false);
    // The pay Primary orders that pass.
    await page.handle({ type: 'purchaseStart', productId: 'pass-90d' });
    assert.equal(orders(world).length, 1);
    assert.equal(orders(world)[0].body.product_id, 'pass-90d', 'the order is for the chosen pass');
    assert.equal(view().stage, 'waiting');
    assert.equal(view().selected, undefined, 'past the list, no selection is sent');
  }

  // The pay press spends the remembered pick: a newer choice whose order fails is not overwritten
  // by the older pass when the person comes back to the list (verifier finding, 2026-10-20).
  {
    const { world, page, view, accounts } = newcomer();
    await page.handle({ type: 'startReady' }); await settle();
    await page.handle({ type: 'purchaseOpen' });
    await page.handle({ type: 'accountSignIn', productId: 'pass-90d' }); accounts.finish(); await settle();
    assert.equal(view().selected, 'pass-90d');
    world.checkout = 'https://evil.test/pay';
    await page.handle({ type: 'purchaseStart', productId: 'pass-30d' });
    assert.equal(view().stage, 'stopped');
    await page.handle({ type: 'purchaseRetry' });
    assert.equal(view().stage, 'choosing');
    assert.equal(view().selected, undefined, 'the older pass does not come back over the newer choice');
  }

  // The pay press from a stale signed-out view also keeps the choice (REQ-L12 ⑭: sign in first).
  {
    const { page, view, accounts } = newcomer();
    await page.handle({ type: 'startReady' }); await settle();
    await page.handle({ type: 'purchaseOpen' });
    await page.handle({ type: 'purchaseStart', productId: 'pass-90d' });
    assert.equal(view().stage, 'choosing');
    assert.equal(view().selected, 'pass-90d');
    await page.handle({ type: 'accountSignIn' }); accounts.finish(); await settle();
    assert.equal(view().selected, 'pass-90d'); assert.equal(view().login, undefined);
  }

  // Negative control: the sign-in is cancelled. The list is unchanged, the choice is kept, the
  // sign-in stays the Primary with the retry copy, and nothing is ordered.
  {
    const { world, page, view, accounts } = newcomer();
    await page.handle({ type: 'startReady' }); await settle();
    await page.handle({ type: 'purchaseOpen' });
    const before = list(view());
    await page.handle({ type: 'accountSignIn', productId: 'pass-90d' });
    await page.handle({ type: 'accountCancel' }); await settle();
    const after = world.states.at(-1).state;
    assert.equal(list(after.purchase), before, 'the same list');
    assert.equal(after.purchase.login, 'signIn', 'the sign-in is still the Primary');
    assert.equal(after.purchase.selected, 'pass-90d', 'the choice is kept');
    assert.equal(after.account.status, 'signedOut');
    assert.equal(after.account.message, '로그인을 취소했어요.', 'the retry copy');
    assert.equal(orders(world).length, 0);
    // An unknown product id is never remembered.
    await page.handle({ type: 'accountSignIn', productId: 'pass-forged' });
    assert.equal(view().selected, 'pass-90d');
  }

  // Negative control: the account appears while the stage is not `choosing`. No selection is restored.
  {
    // (a) The list was left during the sign-in: back on the list later, the host default stands.
    const { page, view, accounts } = newcomer();
    await page.handle({ type: 'startReady' }); await settle();
    await page.handle({ type: 'purchaseOpen' });
    await page.handle({ type: 'accountSignIn', productId: 'pass-90d' });
    await page.handle({ type: 'purchaseCancel' });
    assert.equal(view().stage, undefined);
    assert.equal(view().selected, undefined, 'list closed: no selection');
    accounts.finish(); await settle();
    assert.equal(view().selected, undefined, 'signed in off the list: nothing restored');
    await page.handle({ type: 'purchaseOpen' });
    assert.equal(view().stage, 'choosing');
    assert.equal(view().selected, undefined, 'reopening the list later restores nothing');
    // (b) A sign-in started outside the list (free card / start choices) carries no pass.
    const other = newcomer();
    await other.page.handle({ type: 'startReady' }); await settle();
    await other.page.handle({ type: 'accountSignIn', productId: 'pass-90d' });
    other.accounts.finish(); await settle();
    await other.page.handle({ type: 'purchaseOpen' });
    assert.equal(other.view().selected, undefined, 'a pick sent while the stage was not choosing is ignored');
  }
  console.log('PASS CONV-PURCHASE-R-002: sign-in at purchase returns to the same list with the chosen pass and the pay Primary; cancel keeps the list; off the list nothing is restored');
}
