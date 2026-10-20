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

// ── The card view (CONV-ENDCARD-R-002: continuity first, then the recommended pass) ─────────
const card = c.trialEndCardView({ profile: trialProfile(), err: EXHAUSTED, products: catalogue });
assert.ok(card, 'open-trial seat + trial ending + catalogue → card');
assert.equal(card.ending, 'exhausted');
// The title and the first line speak about continuing the work just made, not about the limit.
assert.equal(card.title, '만든 작업을 그대로 이어서 할 수 있어요');
assert.equal(card.primary, '이용권 살펴보기');
assert.equal(card.escape, '오늘은 여기까지');
assert.deepEqual(card.facts, [
  '만든 파일은 작업 폴더에, 대화는 이 채팅에 그대로 있어요. 이용권이 있으면 이 작업을 이어서 할 수 있어요.',
  // The pass the Service recommends, by name, period and price, from the catalogue.
  '기본 이용권은 30일 동안 쓸 수 있고 55,000원이에요. AI 요청 350번이 들어 있어요.',
  '한 번만 결제하고, 자동으로 다시 결제되지 않아요.',
  // Why free use stopped comes last, with no count.
  '무료로 쓸 수 있는 AI 요청은 모두 썼어요.',
]);
assert.equal(card.productId, 'pass-basic');
// The text the banner fallback carries is the same facts, never a raw SDK sentence.
assert.ok(!/API Error|Claude Code|429|403/.test(card.text));
assert.ok(card.text.startsWith(card.title));

// The cost ceiling ends the trial with the same card, never the generic error banner.
const costCard = c.trialEndCardView({ profile: trialProfile(), err: COST, products: catalogue });
assert.ok(costCard, 'cost-ceiling refusal → card');
assert.equal(costCard.ending, 'exhausted');
assert.equal(costCard.primary, '이용권 살펴보기');
assert.equal(c.trialEndCardView({ profile: trialProfile({ activity_kind: 'classroom' }), err: COST, products: catalogue }), null);

// Without a suggested pass the card names the catalogue's first, as the purchase list selects first.
const plain = catalogue.map(({ recommended, ...rest }) => rest);
assert.equal(c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: plain }).facts[1],
  '라이트 이용권은 30일 동안 쓸 수 있고 30,000원이에요. AI 요청 200번이 들어 있어요.');
// The recommended pass is named first even when the catalogue lists it last.
assert.equal(c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: catalogue }).productId, p.defaultProduct(catalogue).id);
assert.match(c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: [...catalogue].reverse() }).facts[1], /^기본 이용권은/);
const expired = c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: catalogue });
assert.equal(expired.title, card.title, 'both endings lead with the same continuity title');
assert.equal(expired.facts.at(-1), '무료 사용 시간은 끝났어요.');
assert.deepEqual(expired.facts.slice(0, 3), card.facts.slice(0, 3));

// ── CONV-ENDCARD-R-002 checker: no count, no countdown, no pressure words (CONV-DEC-03, CU-13/14) ──
const basic = p.defaultProduct(catalogue);
// Positive controls: the shipped cards pass, for both endings and both catalogues.
assert.deepEqual(c.endCardCopyProblems(card, basic), []);
assert.deepEqual(c.endCardCopyProblems(expired, basic), []);
assert.deepEqual(c.endCardCopyProblems(c.trialEndCardView({ profile: trialProfile(), err: EXPIRED, products: plain }), plain[0]), []);
// A free seat that carried its own allowance block still shows none of its numbers.
const counted = c.trialEndCardView({ profile: trialProfile({ trial: { state: 'exhausted', request_limit: 10, requests_used: 10 } }), err: EXHAUSTED, products: catalogue });
assert.deepEqual(c.endCardCopyProblems(counted, basic), []);
assert.doesNotMatch([counted.title, ...counted.facts.filter(f => f !== c.passOfferLine(basic))].join(' '), /\d/);
// Negative controls: each planted defect is caught.
const planted = (patch) => ({ ...card, ...patch });
for (const [name, view] of [
  ['remaining count', planted({ facts: [...card.facts.slice(0, 3), 'AI 요청 0번 남았어요.'] })],
  ['used count', planted({ facts: [...card.facts.slice(0, 3), '무료 AI 요청 10번을 다 썼어요.'] })],
  ['countdown', planted({ title: '10분 후 대화가 닫혀요' })],
  ['지금 바로', planted({ primary: '지금 바로 이용권 사기' })],
  ['지금만', planted({ facts: [card.facts[0], `${card.facts[1]} 지금만 이 가격이에요.`, ...card.facts.slice(2)] })],
  ['마감', planted({ facts: [...card.facts, '오늘 밤 마감이에요.'] })],
  ['놓치', planted({ facts: [...card.facts, '이 기회를 놓치지 마세요.'] })],
  ['loss', planted({ facts: ['결제하지 않으면 작업이 사라져요.', ...card.facts.slice(1)] })],
  ['limit-first title', planted({ title: '무료 사용량을 모두 썼습니다' })],
  ['pass-first title', planted({ title: '기본 이용권으로 이어서 하세요' })],
  ['pass before continuity', planted({ facts: [card.facts[1], card.facts[0], ...card.facts.slice(2)] })],
  ['another pass named', planted({ facts: [card.facts[0], c.passOfferLine(catalogue[0]), ...card.facts.slice(2)] })],
]) assert.ok(c.endCardCopyProblems(view, basic).length > 0, `negative control: ${name}`);
// The pressure pattern itself: phrases, not single syllables, so plain copy is not flagged.
for (const ok of [card.title, ...card.facts, expired.facts.at(-1), '오늘은 여기까지', '한 번만 결제하고', '만든 파일은 사라지지 않아요', '작업을 잃어버리지 않아요'])
  assert.doesNotMatch(ok, c.END_CARD_PRESSURE, ok);
for (const bad of ['지금 바로', '지금만', '오늘만', '오늘까지만', '마감', '마감 임박', '마지막 기회', '놓치지 마세요', '놓쳐요', '서둘러', '한정', '남은 횟수', '3번 남음',
  '사라져요', '사라질 수 있어요', '잃는 거예요', '잃어요', '할인', '5분 뒤', '두 시간 뒤 닫혀요', '세 번 남았어요', '열 번을 다 썼어요', '한 번 남음'])
  assert.match(bad, c.END_CARD_PRESSURE, bad);

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
