// REQ-L12 (13) / CU-13 / CU-14 — a free trial that ran out ends in a trial notice, not a crash.
//
// The error strings below are the exact texts a real Agent SDK run produced against the
// Service's trial refusals (2026-10-18 diagnosis, sdk-exhausted.json / sdk-expired.json,
// SDK 0.3.299). The SDK host sees only this text: the Service's code is not in it.
// The negative controls are classroom and pass refusals that must keep their own handling.
//
// Run: node --experimental-strip-types test/trial-end-notice.smoke.mjs
import assert from 'node:assert/strict';
const p = await import('../src/passPurchase.ts');
const { classifyProfileFailure } = await import('../src/proxyClientHelpers.ts');
const { errorBannerPresentation } = await import('../webview-ui/src/errorBannerPresentation.ts');

// ── Observed SDK texts (positive) ────────────────────────────────────────────────────────
const SDK_EXHAUSTED = 'Claude Code returned an error result: API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.';
const SDK_EXPIRED = 'Claude Code returned an error result: Failed to authenticate. API Error: 403 개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.';

// ── Refusals that are NOT a trial ending (negative) ─────────────────────────────────────
const CLASSROOM_429 = 'Claude Code returned an error result: API Error: Request rejected (429) · 실행 중인 작업이 있거나 이 수업의 요청 한도에 도달했습니다.';
const BUDGET_429 = 'Claude Code returned an error result: API Error: Request rejected (429) · 사용 가능한 예산 또는 동시 실행 한도에 도달했거나 설정이 변경되었습니다. 사용량을 확인해 주세요.';
const TRIAL_BUSY_429 = 'Claude Code returned an error result: API Error: Request rejected (429) · 이미 실행 중인 요청이 있습니다. 완료한 뒤 다시 시도해 주세요.';
const PASS_SPENT_429 = 'Claude Code returned an error result: API Error: Request rejected (429) · 이용권의 AI 요청 횟수를 모두 썼습니다. 만든 파일과 대화는 그대로 남아 있습니다.';
const PASS_EXPIRED_403 = 'Claude Code returned an error result: Failed to authenticate. API Error: 403 이용권 기간이 끝났습니다. 만든 파일과 대화는 그대로 남아 있습니다.';
const STALL_429 = '요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도하거나 강사에게 체험 한도를 확인해 주세요. (429)';

// Controls first: the matcher must see both observed texts and nothing else.
assert.equal(p.trialEnding(new Error(SDK_EXHAUSTED)), 'exhausted');
assert.equal(p.trialEnding(new Error(SDK_EXPIRED)), 'expired');
for (const text of [CLASSROOM_429, BUDGET_429, TRIAL_BUSY_429, PASS_SPENT_429, PASS_EXPIRED_403, STALL_429, 'API Error: 429 rate limited', ''])
  assert.equal(p.trialEnding(new Error(text)), null, text);
for (const notAnError of [null, undefined, 'plain string', { message: 7 }]) assert.equal(p.trialEnding(notAnError), null);
// A bare code (proxy path) is a trial ending only when the turn did not run on a bought pass.
assert.equal(p.trialEnding(new Error('429 trial_exhausted'), false), 'exhausted');
assert.equal(p.trialEnding(new Error('429 trial_exhausted'), true), null);
// The pass copy still reaches pass holders; the trial text never gets the pass copy.
assert.equal(p.passSpentNotice(new Error(PASS_SPENT_429)), p.PASS_SPENT_FRIENDLY);
assert.equal(p.passSpentNotice(new Error(SDK_EXHAUSTED)), null);

// ── What the chat says ──────────────────────────────────────────────────────────────────
for (const [ending, said] of [['exhausted', /체험에서 쓸 수 있는 AI 요청을 모두 썼어요/], ['expired', /체험 시간이 끝났어요/]]) {
  const sold = p.trialEndNotice(ending, true);
  const notSold = p.trialEndNotice(ending, false);
  assert.match(sold, said); assert.match(notSold, said);
  // CU-14: the work is still there, in both variants.
  assert.match(sold, /만든 파일과 대화는 그대로 있어요/); assert.match(notSold, /만든 파일과 대화는 그대로 있어요/);
  // The way on is named only when the Service sells passes (REQ-L12 (1)).
  assert.match(sold, /'이용권으로 시작하기'/); assert.doesNotMatch(notSold, /이용권/);
  // Not the classroom or operator voice, not a retry invitation.
  for (const text of [sold, notSold]) assert.doesNotMatch(text, /코드 발급 담당자|강사|운영 담당자|다시 시도|API Error/);
  // The banner frames it as the trial ending, not a fault, a network drop or a spent pass.
  for (const text of [sold, notSold]) assert.deepEqual(errorBannerPresentation(text), { icon: '⏳', title: '체험이 끝났어요' });
}
// Banner controls: the existing pass and network banners are unchanged.
assert.equal(errorBannerPresentation(p.PASS_SPENT_FRIENDLY).title, '이용권을 더 쓸 수 없어요');
assert.equal(errorBannerPresentation('연결이 끊어졌습니다').title, '연결이 끊겼어요');

// ── The start page after expiry ─────────────────────────────────────────────────────────
const trialExpiredBody = JSON.stringify({ error: { code: 'trial_expired', type: 'session_window', message: '개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.' } });
const expired = classifyProfileFailure(403, trialExpiredBody);
assert.equal(expired.reason, 'expired');
assert.equal(expired.friendly, p.TRIAL_EXPIRED_FRIENDLY);
assert.doesNotMatch(expired.friendly, /코드 발급 담당자|새 체험을 요청/);
assert.equal(classifyProfileFailure(403, JSON.stringify({ error: { code: 'trial_expired' } })).friendly, p.TRIAL_EXPIRED_FRIENDLY);
// A bought pass past its window keeps the Service's own pass sentence.
assert.equal(classifyProfileFailure(403, JSON.stringify({ error: { code: 'trial_expired', message: '이용권 기간이 끝났습니다. 작업 파일은 그대로 보존됩니다.' } })).friendly, '이용권 기간이 끝났습니다. 작업 파일은 그대로 보존됩니다.');
// The start page adds the pointer only when passes are on sale, and only to the trial ending.
assert.equal(p.withTrialPassPointer(p.TRIAL_EXPIRED_FRIENDLY, true), `${p.TRIAL_EXPIRED_FRIENDLY} ${p.TRIAL_PASS_POINTER_START}`);
assert.match(p.withTrialPassPointer(p.TRIAL_EXPIRED_FRIENDLY, true), /'이용권으로 시작하기'/);
assert.equal(p.withTrialPassPointer(p.TRIAL_EXPIRED_FRIENDLY, false), p.TRIAL_EXPIRED_FRIENDLY);
assert.equal(p.withTrialPassPointer('인증에 실패했습니다.', true), '인증에 실패했습니다.');
assert.equal(p.withTrialPassPointer(undefined, true), undefined);

// ── Passes on sale: one unauthenticated catalogue read, bounded, never an order ──────────
const realFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), method: init?.method ?? 'GET' }); return new Response(JSON.stringify({ products: [{ id: 'pass-basic', label: '기본', amount: 55000, currency: 'KRW', duration_hours: 720, request_limit: 350 }] }), { status: 200 }); };
  assert.equal(await p.passesOnSale('https://service.test/v1/'), true);
  assert.deepEqual(calls, [{ url: 'https://service.test/v1/purchase/products', method: 'GET' }]);
  globalThis.fetch = async () => new Response('{"products":[]}', { status: 200 });
  assert.equal(await p.passesOnSale('https://service.test/v1'), false);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await p.passesOnSale('https://service.test/v1'), false);
  // A Service that never answers does not hold the notice back.
  globalThis.fetch = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  assert.equal(await p.passesOnSale('https://service.test/v1', 50), false);
  assert.ok(Date.now() - started < 1000);
} finally { globalThis.fetch = realFetch; }

console.log('trial-end-notice.smoke.mjs — trial exhausted/expired notices, pass pointer, negatives');
