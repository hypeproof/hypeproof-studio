// REQ-L12 — buying a pass from inside Studio (src/passPurchase.ts).
// The Service is a synthetic stand-in on globalThis.fetch; no network, no gateway.
//
// Run: node --experimental-strip-types test/pass-purchase.smoke.mjs
import assert from 'node:assert/strict';
const p = await import('../src/passPurchase.ts');

const SERVICE = 'https://service.test/v1';
const SITE = 'https://site.test';
const ID = 'ord_' + 'a'.repeat(32);
const SECRET = 'b'.repeat(64);
const created = { order_id: ID, order_secret: SECRET, amount: 50000, currency: 'KRW', label: '30일 이용권', expires_at: Date.now() + 1800000, checkout_url: `${SITE}/studio/checkout?order=${ID}` };

// ── Products: only the documented shape is shown to a buyer ───────────────────────────────
const catalogue = { products: [{ id: 'pass-30d', label: '30일 이용권', amount: 50000, currency: 'KRW', duration_hours: 720, request_limit: 600 }] };
assert.deepEqual(p.parseProducts(catalogue), [{ id: 'pass-30d', label: '30일 이용권', amount: 50000, durationDays: 30, requestLimit: 600 }]);
// The optional line and mark come through; the suggested pass is the one selected first.
const tiers = p.parseProducts({ products: [{ ...catalogue.products[0], id: 'pass-lite', request_limit: 300 }, { ...catalogue.products[0], id: 'pass-basic', tagline: '한 달 동안 내 일에 써 볼 때', recommended: true }] });
assert.equal(tiers[1].tagline, '한 달 동안 내 일에 써 볼 때'); assert.equal(tiers[1].recommended, true); assert.equal(tiers[0].recommended, undefined);
assert.equal(p.defaultProduct(tiers).id, 'pass-basic'); assert.equal(p.defaultProduct([tiers[0]]).id, 'pass-lite');
assert.equal(p.parseProducts({ products: [{ ...catalogue.products[0], tagline: 7 }] }), null);
for (const bad of [null, {}, { products: [] }, { products: [{ ...catalogue.products[0], amount: 0 }] }, { products: [{ ...catalogue.products[0], currency: 'USD' }] }, { products: [{ ...catalogue.products[0], request_limit: 1.5 }] }, { products: [{ ...catalogue.products[0], id: 'a b' }] }])
  assert.equal(p.parseProducts(bad), null, JSON.stringify(bad));

// ── The browser is only ever sent to the configured site ──────────────────────────────────
assert.equal(p.checkoutUrlAllowed(created.checkout_url, SITE), true);
assert.equal(p.checkoutUrlAllowed('http://localhost:3000/studio/checkout?order=x', 'http://localhost:3000'), true);
for (const bad of ['https://evil.test/studio/checkout', 'http://site.test/studio/checkout', 'javascript:alert(1)', 'not a url', undefined])
  assert.equal(p.checkoutUrlAllowed(bad, SITE), false, String(bad));
assert.equal(p.parseOrder({ ...created, checkout_url: 'https://evil.test/pay' }, 'pass-30d', SERVICE, SITE), 'bad_checkout');
for (const bad of [{ order_id: 'ord_1' }, { order_secret: 'short' }, { amount: -1 }, { label: '' }, { expires_at: 'soon' }])
  assert.equal(p.parseOrder({ ...created, ...bad }, 'pass-30d', SERVICE, SITE), null, JSON.stringify(bad));
const order = p.parseOrder(created, 'pass-30d', SERVICE, SITE);
assert.equal(order.id, ID); assert.equal(order.secret, SECRET); assert.equal(order.service, SERVICE);

// ── A saved order comes back only for the same Service, and keeps its claimed mark ────────
assert.deepEqual(p.restorePendingOrder(JSON.stringify(order), SERVICE, SITE), order);
assert.equal(p.restorePendingOrder(JSON.stringify(order), 'https://other.test/v1', SITE), null);
assert.equal(p.restorePendingOrder(JSON.stringify({ ...order, checkoutUrl: 'https://evil.test/x' }), SERVICE, SITE), null);
assert.equal(p.restorePendingOrder('{not json', SERVICE, SITE), null);
assert.equal(p.restorePendingOrder(undefined, SERVICE, SITE), null);
assert.equal(p.restorePendingOrder(JSON.stringify({ ...order, claimed: true }), SERVICE, SITE).claimed, true);

// ── What the wait does with each answer ───────────────────────────────────────────────────
const now = Date.now();
assert.equal(p.waitDecision('paid', order, now), 'claim');
assert.equal(p.waitDecision('failed', order, now), 'failed');
assert.equal(p.waitDecision('refunded', order, now), 'refunded');
assert.equal(p.waitDecision('expired', order, now), 'expired');
assert.equal(p.waitDecision('pending', order, now), 'wait');
assert.equal(p.waitDecision('confirming', order, now), 'wait');
// An unreadable Service is not a failed payment, and neither is a confirm still in flight: the
// order may be paid, so it is never given up on these (2026-10-14). Only an order the Service
// still calls unpaid runs out after the grace period.
assert.equal(p.waitDecision(null, order, order.expiresAt + p.SETTLE_GRACE_MS - 1), 'wait');
assert.equal(p.waitDecision(null, order, order.expiresAt + p.SETTLE_GRACE_MS + 1), 'wait');
assert.equal(p.waitDecision('confirming', order, order.expiresAt + p.SETTLE_GRACE_MS + 1), 'wait');
assert.equal(p.waitDecision('pending', order, order.expiresAt + p.SETTLE_GRACE_MS + 1), 'expired');
// A confirm already in flight at the deadline is still honoured.
assert.equal(p.waitDecision('paid', order, order.expiresAt + p.SETTLE_GRACE_MS + 1), 'claim');

// ── Requests: the secret goes only to the Service the order was made on ───────────────────
const calls = [];
let claimAnswers = [];
let pollAnswer = { status: 200, body: { order_id: ID, state: 'paid', claimed: false } };
const original = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ url: String(url), method: init.method ?? 'GET', secret: new Headers(init.headers).get('x-hps-order-secret'), body: init.body ? JSON.parse(init.body) : undefined });
  assert.equal(u.origin, 'https://service.test', 'request left the Service: ' + url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/v1/purchase/products') return json(200, catalogue);
  if (u.pathname === '/v1/purchase/orders' && init.method === 'POST') return json(201, created);
  if (u.pathname === `/v1/purchase/orders/${ID}/claim`) { const a = claimAnswers.shift(); return json(a.status, a.body); }
  if (u.pathname === `/v1/purchase/orders/${ID}`) return json(pollAnswer.status, pollAnswer.body);
  return json(404, { error: 'not_found' });
};
try {
  assert.equal((await p.fetchProducts(SERVICE + '/')).length, 1);
  const made = await p.createOrder(SERVICE, 'pass-30d', SITE);
  assert.equal(made.id, ID);
  assert.deepEqual(calls.at(-1), { url: `${SERVICE}/purchase/orders`, method: 'POST', secret: null, body: { product_id: 'pass-30d' } });

  assert.equal(await p.pollOrder(order), 'paid');
  assert.equal(calls.at(-1).secret, SECRET);
  pollAnswer = { status: 200, body: { state: 'surprise' } };
  assert.equal(await p.pollOrder(order), null);
  pollAnswer = { status: 503, body: {} };
  assert.equal(await p.pollOrder(order), null);

  const CODE = 'c'.repeat(40);
  claimAnswers = [{ status: 200, body: { code: CODE } }];
  assert.deepEqual(await p.claimWithRecovery(order), { ok: true, code: CODE });
  assert.deepEqual(calls.at(-1).body, {});

  // The first answer was lost: the Service says the seat was handed over, so ask once for a replacement.
  claimAnswers = [{ status: 409, body: { error: 'already_claimed' } }, { status: 200, body: { code: CODE } }];
  const before = calls.length;
  assert.deepEqual(await p.claimWithRecovery(order), { ok: true, code: CODE });
  assert.equal(calls.length, before + 2);
  assert.deepEqual(calls.at(-1).body, { reissue: true });

  // A record already marked claimed goes straight to the replacement.
  claimAnswers = [{ status: 200, body: { code: CODE } }];
  assert.deepEqual(await p.claimWithRecovery({ ...order, claimed: true }), { ok: true, code: CODE });
  assert.deepEqual(calls.at(-1).body, { reissue: true });

  // Not paid, or a Service that cannot hand the seat over, is reported and never retried blindly.
  claimAnswers = [{ status: 409, body: { error: 'not_paid' } }];
  assert.deepEqual(await p.claimWithRecovery(order), { ok: false, reason: 'not_paid' });
  claimAnswers = [{ status: 503, body: { error: 'seat_unavailable' } }];
  assert.deepEqual(await p.claimWithRecovery(order), { ok: false, reason: 'unavailable' });
  claimAnswers = [{ status: 200, body: { code: 'x' } }];
  assert.deepEqual(await p.claimWithRecovery(order), { ok: false, reason: 'unavailable' });

  // A network failure reads as "could not tell", not as a decision.
  globalThis.fetch = async () => { throw new TypeError('synthetic network failure'); };
  assert.equal(await p.fetchProducts(SERVICE), null);
  assert.equal(await p.createOrder(SERVICE, 'pass-30d', SITE), null);
  assert.equal(await p.pollOrder(order), null);
  assert.deepEqual(await p.claimSeat(order, false), { ok: false, reason: 'unavailable' });
} finally { globalThis.fetch = original; }

// ── Copy: only a confirmed payment says so, and every stop explains what happened to the money ─
for (const [key, text] of Object.entries(p.PURCHASE_COPY)) assert.ok(text.length > 10, key);
assert.match(p.PURCHASE_COPY.failed, /돈이 나가지 않았어요/);
assert.match(p.PURCHASE_COPY.claimFailed, /결제 내역은 그대로 있어요/);
for (const key of ['waiting', 'failed', 'expired', 'cancelled', 'unavailable']) assert.doesNotMatch(p.PURCHASE_COPY[key], /결제를 확인했어요/, key);
// 해요체 only on the purchase surface: no 합니다체 ending slipped back in.
for (const [key, text] of Object.entries(p.PURCHASE_COPY)) assert.doesNotMatch(text, /(습니다|됩니다|합니다)[.]/, key);

console.log('PASS pass purchase: product and order shapes, checkout origin, saved-order restore, wait decisions, secret-bound requests, lost-answer recovery, copy');
