// REQ-STUDIO-FREE-DAILY-REFILL (Jay 2026-10-29; TUX-SP-18) — pure parts of the per-install daily
// refill: when the saved free seat claims again, how the claim and the refusal carry `refills_at`, and
// the end-card copy while the refill is ahead. Every judgment has a positive and a negative control
// (.claude/rules/verification.md §2). The older-Service cases (no `refills_at`) must read as today.
//
// Run: node --experimental-strip-types test/free-daily-refill.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
async function load(entry) {
  const out = await build({ entryPoints: [root + entry], bundle: true, write: false, platform: 'node', format: 'esm', external: ['vscode'], loader: { '.css': 'empty' }, logLevel: 'error' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
const fs = await load('src/freeStart.ts');
const purchase = await load('src/passPurchase.ts');
const labels = await load('webview-ui/src/activityLabel.ts');
const endCard = await load('src/trialEndCard.ts');
const proxyHelpers = await load('src/proxyClientHelpers.ts');

const now = Date.UTC(2026, 9, 29, 3, 0); // 12:00 KST
const past = now - 60_000, ahead = now + 3600_000;
const JAY = '오늘 무료 사용량을 다 썼어요. 밤 12시(한국 시간)에 다시 채워져요.';
const FREE_EXPIRED = '무료 사용 시간이 끝났습니다. 만든 파일과 대화는 그대로 남아 있습니다.';
const CODE_EXPIRED = '개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.';
const seat = (over = {}) => ({ state: 'active', ends_at: null, request_limit: 30, requests_used: 3, ...over });

// ── 1. The copy is Jay's sentence, verbatim, and names no 24-hour window ───────────────────────
assert.equal(purchase.FREE_REFILL_WAITING, JAY);
assert.equal(purchase.FREE_REFILL_ENDED, `${JAY} 만든 파일은 작업 폴더에 그대로 있어요.`);
assert.ok(!/24\s*시간|체험/.test(purchase.FREE_REFILL_ENDED));

// ── 2. freeSeatRefill: when the saved free seat claims again ───────────────────────────────────
const r = (input) => fs.freeSeatRefill(input, now);
// Positive: spent or expired, refills_at now or past → due.
assert.deepEqual(r({ seat: seat({ state: 'exhausted', requests_used: 30, refills_at: past }) }), { state: 'due', refillsAt: past });
assert.deepEqual(r({ seat: seat({ state: 'expired', refills_at: now }) }), { state: 'due', refillsAt: now }, 'refills_at == now is due');
assert.deepEqual(r({ seat: seat({ requests_used: 30, refills_at: past }) }), { state: 'due', refillsAt: past }, 'count reached without a state');
assert.deepEqual(r({ seat: seat({ ends_at: new Date(past).toISOString(), refills_at: past }) }), { state: 'due', refillsAt: past }, 'window over without a state');
// Spent with the refill ahead → waiting (the end card says when).
assert.deepEqual(r({ seat: seat({ state: 'exhausted', refills_at: ahead }) }), { state: 'waiting', refillsAt: ahead });
// Negatives: in use (even with a past refills_at), and an older Service without refills_at.
assert.equal(r({ seat: seat({ refills_at: past }) }), null, 'a seat still in use is never re-claimed');
assert.equal(r({ seat: seat({ state: 'not_started', refills_at: past }) }), null);
assert.equal(r({ seat: seat({ state: 'exhausted', requests_used: 30 }) }), null, 'older Service: no refills_at → today');
assert.equal(r({ seat: seat({ state: 'exhausted', refills_at: 'tomorrow' }) }), null, 'a malformed refills_at is ignored');
assert.equal(r({ seat: seat({ state: 'exhausted', refills_at: Number.NaN }) }), null);
assert.equal(r({ seat: undefined }), null);
// Refused profile: the free trial_expired refusal with refills_at.
const freeFail = at => proxyHelpers.classifyProfileFailure(403, JSON.stringify({ error: { code: 'trial_expired', type: 'session_window', message: FREE_EXPIRED, ...(at !== undefined ? { refills_at: at } : {}) } }));
assert.equal(freeFail(past).refillsAt, past, 'the classifier keeps refills_at');
assert.equal(freeFail(undefined).refillsAt, undefined, 'older Service: no refillsAt');
assert.equal(freeFail('x').refillsAt, undefined, 'a non-number refills_at is dropped');
assert.deepEqual(r({ failure: freeFail(past) }), { state: 'due', refillsAt: past });
assert.deepEqual(r({ failure: freeFail(ahead) }), { state: 'waiting', refillsAt: ahead });
assert.equal(r({ failure: freeFail(undefined) }), null, 'older Service: a bare free trial_expired never re-claims (it would get the same seat back)');
const codeFail = proxyHelpers.classifyProfileFailure(403, JSON.stringify({ error: { code: 'trial_expired', message: CODE_EXPIRED, refills_at: past } }));
assert.equal(r({ failure: codeFail }), null, 'a code-issued trial is never a free seat');
assert.equal(r({ failure: proxyHelpers.classifyProfileFailure(401, JSON.stringify({ error: { code: 'signature', refills_at: past } })) }), null, 'another refusal is not an ended free seat');
assert.equal(r({ failure: null }), null);

// ── 3. Claim response: refilled and refills_at are additive ─────────────────────────────────────
const code = 'free-' + 'c'.repeat(40);
const newer = fs.parseClaimSuccess({ outcome: 'granted', refilled: true, code, profile: 'studio-open-trial', expires_at: ahead, refills_at: ahead, allowance: { refills: 'daily_kst_midnight' } });
assert.deepEqual(newer, { ok: true, outcome: 'granted', code, profile: 'studio-open-trial', expiresAt: ahead, refilled: true, refillsAt: ahead });
const older = fs.parseClaimSuccess({ outcome: 'reused', code, profile: 'studio-open-trial', expires_at: ahead });
assert.deepEqual(older, { ok: true, outcome: 'reused', code, profile: 'studio-open-trial', expiresAt: ahead }, 'older Service: byte-equal result');
const odd = fs.parseClaimSuccess({ outcome: 'granted', refilled: 'yes', code, profile: 'studio-open-trial', refills_at: '2026-10-30' });
assert.equal(odd.refilled, undefined); assert.equal(odd.refillsAt, undefined);

// ── 4. Start page ended card (refused profile path) ────────────────────────────────────────────
assert.equal(fs.freeEndedBody(ahead, now), purchase.FREE_REFILL_ENDED);
assert.equal(fs.freeEndedBody(past, now), fs.FREE_START_COPY.endedExpired, 'refill already open: no promise of a time that passed');
assert.equal(fs.freeEndedBody(undefined, now), fs.FREE_START_COPY.endedExpired, 'older Service: today');

// ── 5. Start page connected card → ended facts (served profile path) ───────────────────────────
const spentAhead = seat({ state: 'exhausted', requests_used: 30, refills_at: ahead });
const factsAhead = labels.trialEndedFacts(spentAhead, now, true);
assert.equal(factsAhead.description, purchase.FREE_REFILL_ENDED); assert.equal(factsAhead.title, '무료 사용이 끝났습니다');
const factsOld = labels.trialEndedFacts(seat({ state: 'exhausted', requests_used: 30 }), now, true);
assert.equal(factsOld.description, '무료 AI 요청을 모두 사용했습니다. 만든 파일은 작업 폴더에 그대로 있습니다.', 'older Service: today');
assert.equal(labels.trialEndedFacts(spentAhead, now, false).title, '체험이 끝났습니다', 'a code-issued trial keeps its card');
assert.equal(labels.trialEndedFacts(seat({ refills_at: ahead }), now, true), null, 'a seat in use has no ended card');

// ── 6. Allowance window: "오늘 밤 12시까지", never a 24-hour window, on a refilling free seat ─────────
assert.equal(labels.trialAllowance(seat({ refills_at: ahead }), now, true, 24), '무료 AI 요청 30번 · 오늘 밤 12시까지');
assert.equal(labels.trialAllowance(seat(), now, true, 24), '무료 AI 요청 30번 · 첫 요청부터 24시간', 'older Service: unchanged');
assert.equal(labels.trialAllowance(seat({ refills_at: ahead }), now, false, 24), 'AI 요청 30번', 'a code-issued trial is unchanged');

// ── 7. Chat: composer note, banner notice and the end card ─────────────────────────────────────
assert.equal(labels.freeSeatEndedNote('exhausted', ahead, now), `${JAY} 만든 파일과 대화는 그대로 있어요.`);
assert.equal(labels.freeSeatEndedNote('exhausted', undefined, now), '무료로 쓸 수 있는 AI 요청을 모두 써서 지금은 AI가 답하지 않아요. 만든 파일과 대화는 그대로 있어요.');
assert.equal(labels.freeSeatEndedNote('expired', past, now), '무료 사용 시간이 끝나서 지금은 AI가 답하지 않아요. 만든 파일과 대화는 그대로 있어요.');
assert.equal(purchase.freeRefillPending(ahead, now), true); assert.equal(purchase.freeRefillPending(past, now), false);
assert.equal(purchase.freeRefillPending(undefined, now), false); assert.equal(purchase.freeRefillPending(Infinity, now), false);
assert.equal(purchase.trialEndNotice('exhausted', true, true, true), `${JAY} 만든 파일과 대화는 그대로 있어요. ${purchase.TRIAL_PASS_POINTER_CHAT}`, 'the pass pointer stays');
assert.equal(purchase.trialEndNotice('exhausted', false, true, false), purchase.FREE_EXHAUSTED_FRIENDLY, 'no refill ahead: today');
assert.equal(purchase.trialEndNotice('expired', false, false, true), purchase.TRIAL_EXPIRED_FRIENDLY, 'a code-issued trial never says refill');

const product = { id: 'pass-30d', label: '30일 이용권', amount: 50000, currency: 'KRW', durationDays: 30, requestLimit: 600 };
const openTrial = trial => ({ activity_kind: 'trial', profile_id: 'studio-open-trial', ...(trial ? { trial } : {}) });
const SPENT = { message: '무료로 쓸 수 있는 AI 요청을 모두 썼습니다.' };
const card = endCard.trialEndCardView({ profile: openTrial(spentAhead), err: SPENT, products: [product], now });
assert.equal(card.facts.at(-1), JAY, 'the ending line is the refill time');
assert.equal(card.facts[1], endCard.passOfferLine(product), 'the existing pass offer stays');
assert.equal(card.primary, '이용권 살펴보기');
assert.deepEqual(endCard.endCardCopyProblems(card, product), [], 'the refill line passes the pressure and count checks');
const cardOld = endCard.trialEndCardView({ profile: openTrial(seat({ state: 'exhausted', requests_used: 30 })), err: SPENT, products: [product], now });
assert.equal(cardOld.facts.at(-1), endCard.TRIAL_END_CARD_COPY.endedExhausted, 'older Service: today');
const cardPast = endCard.trialEndCardView({ profile: openTrial(seat({ state: 'exhausted', requests_used: 30, refills_at: past })), err: SPENT, products: [product], now });
assert.equal(cardPast.facts.at(-1), endCard.TRIAL_END_CARD_COPY.endedExhausted, 'refill already open: no stale time');
const minimal = endCard.trialEndCardView({ profile: openTrial(spentAhead), err: SPENT, products: 'unreadable', now });
assert.equal(minimal.facts.at(-1), JAY, 'the minimal card says it too');
// Negative control for the checker: only the exact refill line may hold digits besides the pass line.
assert.ok(endCard.endCardCopyProblems({ ...card, facts: [...card.facts.slice(0, -1), '무료 AI 요청 12번을 모두 썼어요.'] }, product).length > 0, 'a count line is still rejected');

console.log('PASS free-daily-refill pure: refill decision (due/waiting/null, older Service, code trial), claim/refusal fields, start-page and chat copy, end card');
