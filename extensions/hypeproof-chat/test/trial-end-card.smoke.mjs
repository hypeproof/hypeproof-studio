// TUX-COND-07 / REQ-L12 ①② — the inline end-of-trial card (src/trialEndCard.ts).
// Pure judgment only: when the card is drawn, what it says, and that it never draws itself
// mid-work, on a pass, or on any seat that is not the Service's open-trial profile. No network, no VS Code.
//
// Run: node --experimental-strip-types test/trial-end-card.smoke.mjs
import assert from 'node:assert/strict';
const c = await import('../src/trialEndCard.ts');
const p = await import('../src/passPurchase.ts');

// Observed SDK texts (2026-10-18 trial diagnosis, SDK 0.3.299). The Service's trial sentences carry no code.
const EXHAUSTED = new Error('Claude Code returned an error result: API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.');
const EXPIRED = new Error('Failed to authenticate. API Error: 403 개인 체험 시간이 끝났습니다. 작업 파일은 그대로 남아 있습니다.');
const PROXY_CODE = new Error('trial_exhausted');
// The trial's AI cost ceiling: real local-Worker 429 (trial_cost_exhausted) as the SDK surfaces it, 2026-10-19.
const COST = new Error('Claude Code returned an error result: API Error: Request rejected (429) · 체험에서 쓸 수 있는 AI 사용량을 모두 썼습니다. 만든 파일과 대화는 그대로 남아 있습니다.');
const COST_CODE = new Error('trial_cost_exhausted');
const CLASS_429 = new Error('API Error: Request rejected (429) · 이 수업의 요청 한도에 도달했습니다.');
const BUSY = new Error('API Error: Request rejected (429) · trial_busy');
const NETWORK = new Error('fetch failed');

const catalogue = [
  { id: 'pass-lite', label: '라이트', amount: 30000, durationDays: 30, requestLimit: 200 },
  { id: 'pass-basic', label: '기본 이용권', amount: 55000, durationDays: 30, requestLimit: 350, recommended: true },
];
// The open-trial seat as /v1/profile serves it (Service ot-open-profile, behind HPS_OPEN_TRIAL).
const trialProfile = (extra = {}) => ({ activity_kind: 'trial', profile_id: 'studio-open-trial', ...extra });

// ── Which seats get the card (the default-off flag is the Service's HPS_OPEN_TRIAL) ─────────
assert.equal(c.OPEN_TRIAL_PROFILE_ID, 'studio-open-trial');
// Positive control: the open-trial free tier.
assert.equal(c.endCardAdvertised(trialProfile()), true);
// Negative controls: a code-issued trial, a bought pass on either profile, a classroom or
// personal seat, a missing kind, and no profile at all.
for (const [name, profile] of [
  ['code-issued trial', { activity_kind: 'trial', profile_id: 'studio-native-trial' }],
  ['bought pass', { activity_kind: 'trial', profile_id: 'studio-native-trial', pass: { request_limit: 200, requests_used: 0 } }],
  ['pass on open-trial id', trialProfile({ pass: { request_limit: 200, requests_used: 0 } })],
  ['classroom', trialProfile({ activity_kind: 'classroom' })],
  ['personal', trialProfile({ activity_kind: 'personal' })],
  ['no kind', { profile_id: 'studio-open-trial' }],
  ['look-alike id', trialProfile({ profile_id: 'studio-open-trial-2' })],
  ['null', null], ['undefined', undefined],
]) assert.equal(c.endCardAdvertised(profile), false, name);

// ── Which turn endings are the end of a free trial ──────────────────────────────────────────
// Positive controls: both observed sentences, and the bare code on a non-pass seat.
assert.equal(c.trialEndReason(EXHAUSTED, false), 'exhausted');
assert.equal(c.trialEndReason(EXPIRED, false), 'expired');
assert.equal(c.trialEndReason(PROXY_CODE, false), 'exhausted');
assert.equal(c.trialEndReason(COST, false), 'exhausted');
assert.equal(c.trialEndReason(COST_CODE, false), 'exhausted');
// Negative controls: the same code on a bought pass, classroom/budget/busy limits, ordinary failures.
assert.equal(c.trialEndReason(PROXY_CODE, true), null);
assert.equal(c.trialEndReason(COST_CODE, true), null);
for (const err of [CLASS_429, BUSY, NETWORK, null, undefined, 'string error', { message: 7 }])
  assert.equal(c.trialEndReason(err, false), null, String(err?.message ?? err));

// ── The card view ──────────────────────────────────────────────────────────────────────────
const card = c.trialEndCardView({ profile: trialProfile(), err: EXHAUSTED, products: catalogue });
assert.ok(card, 'open-trial seat + trial ending + catalogue → card');
assert.equal(card.ending, 'exhausted');
assert.equal(card.title, '무료 체험을 모두 사용했습니다');
assert.equal(card.primary, '이용권 살펴보기');
assert.equal(card.escape, '오늘은 여기까지');
// Facts first: files kept, then the Service's own numbers for the suggested pass, then the no-renewal promise.
assert.equal(card.facts[0], '만든 파일은 작업 폴더에 그대로 있습니다. 대화도 계속 볼 수 있습니다.');
assert.equal(card.facts[1], '이어서 작업하려면 이용권이 필요합니다. 기본 이용권은 30일 동안 AI 요청 350번이고 55,000원입니다.');
assert.equal(card.facts[2], '한 번만 결제하며 자동으로 다시 결제되지 않습니다.');
assert.equal(card.productId, 'pass-basic');
// The text the banner fallback carries is the same facts, never a raw SDK sentence.
assert.ok(!/API Error|Claude Code|429|403/.test(card.text));
assert.ok(card.text.startsWith(card.title));

// Without a suggested pass the card names the catalogue's first, as the purchase list selects first.
// The cost ceiling ends the trial with the same card, never the generic error banner.
const costCard = c.trialEndCardView({ profile: trialProfile(), err: COST, products: catalogue });
assert.ok(costCard, 'cost-ceiling refusal → card');
assert.equal(costCard.ending, 'exhausted');
assert.equal(costCard.primary, '이용권 살펴보기');
assert.equal(c.trialEndCardView({ profile: trialProfile({ activity_kind: 'classroom' }), err: COST, products: catalogue }), null);

const plain = catalogue.map(({ recommended, ...rest }) => rest);
assert.equal(c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: plain }).facts[1],
  '이어서 작업하려면 이용권이 필요합니다. 라이트 이용권은 30일 동안 AI 요청 200번이고 30,000원입니다.');
assert.equal(c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: catalogue }).productId, p.defaultProduct(catalogue).id);
const expired = c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: catalogue });
assert.equal(expired.title, '무료 체험 시간이 끝났습니다');

// No countdown, scarcity, guilt or loss copy anywhere on the card.
for (const v of [card, expired]) {
  const all = [v.title, ...v.facts, v.primary, v.escape].join(' ');
  assert.ok(!/남았|남음|남은|곧|마감|지금 바로|놓치|사라|잃|할인|한정/.test(all), all);
}

// ── Negative controls: the card is absent ───────────────────────────────────────────────────
// Mid-work: an ordinary failure on an open-trial seat.
for (const err of [NETWORK, CLASS_429, BUSY])
  assert.equal(c.trialEndCardView({ profile: trialProfile(), err, products: catalogue }), null, `mid-work: ${err.message}`);
// Flag off (no open-trial seat exists): a code-issued trial ends exactly as today.
assert.equal(c.trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-native-trial' }, err: EXHAUSTED, products: catalogue }), null);
assert.equal(c.trialEndCardView({ profile: { activity_kind: 'trial' }, err: EXHAUSTED, products: catalogue }), null);
// A bought pass is never read as a trial.
assert.equal(c.trialEndCardView({ profile: trialProfile({ pass: { request_limit: 200, requests_used: 200 } }), err: EXHAUSTED, products: catalogue }), null);
// A classroom seat never gets a purchase card.
assert.equal(c.trialEndCardView({ profile: trialProfile({ activity_kind: 'classroom' }), err: EXHAUSTED, products: catalogue }), null);
// No catalogue: no facts to show, so no card (and never a hardcoded price).
for (const products of [null, undefined, []])
  assert.equal(c.trialEndCardView({ profile: trialProfile(), err: EXHAUSTED, products }), null);
assert.equal(c.trialEndCardView({ profile: null, err: EXHAUSTED, products: catalogue }), null);

// ── Bounded catalogue read: a slow Service never holds back the turn ending ─────────────────
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ products: [{ id: 'pass-lite', label: '라이트', amount: 30000, currency: 'KRW', duration_hours: 720, request_limit: 200 }] }) });
  assert.deepEqual((await c.catalogueWithin('https://service.test/v1', 500)).map(x => x.id), ['pass-lite']);
  globalThis.fetch = () => new Promise(() => {});
  const t0 = Date.now();
  assert.equal(await c.catalogueWithin('https://service.test/v1', 50), null);
  assert.ok(Date.now() - t0 < 1000);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await c.catalogueWithin('https://service.test/v1', 50), null);
} finally { globalThis.fetch = realFetch; }

// passFacts lives with the other catalogue formatting and never doubles the noun.
assert.equal(p.passFacts({ id: 'x', label: '라이트', amount: 30000, durationDays: 30, requestLimit: 200 }), '라이트 이용권은 30일 동안 AI 요청 200번이고 30,000원입니다.');
assert.equal(p.passFacts({ id: 'x', label: '30일 이용권', amount: 50000, durationDays: 30, requestLimit: 600 }), '30일 이용권은 30일 동안 AI 요청 600번이고 50,000원입니다.');

console.log('trial-end-card.smoke: ok');
