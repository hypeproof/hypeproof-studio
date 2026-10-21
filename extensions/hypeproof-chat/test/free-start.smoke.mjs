// Free start (SPEC iteration 4 §2; TUX-SP-14/15/16, US-19) — pure parts: the offer fields, the claim
// client, and the free-seat copy. Every new judgment has a positive and a negative control
// (.claude/rules/verification.md §2): free sentences match, code-issued trial sentences stay byte-equal,
// and an unrelated 무료 sentence never matches.
//
// Run: node --experimental-strip-types test/free-start.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
async function load(entry) {
  const out = await build({ entryPoints: [root + entry], bundle: true, write: false, platform: 'node', format: 'esm', external: ['vscode'], loader: { '.css': 'empty' }, logLevel: 'error' });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
const offerMod = await load('src/trialOffer.ts');
const fs = await load('src/freeStart.ts');
const labels = await load('webview-ui/src/activityLabel.ts');
const banner = await load('webview-ui/src/errorBannerPresentation.ts');
const purchase = await load('src/passPurchase.ts');
const endCard = await load('src/trialEndCard.ts');
const carry = await load('src/trialCarryoverHelpers.ts');
const seat = await load('src/seatVocabulary.ts');
const image = await load('src/imageEditClient.ts');
const proxyHelpers = await load('src/proxyClientHelpers.ts');
const sdkReq = await load('src/sdkRequiredHelpers.ts');

const noTrialWord = (s, what) => assert.ok(typeof s === 'string' && !s.includes('체험'), `${what} must not say 체험: ${s}`);

// ── 1. Offer: new fields are additive; a bad value drops the field, never the entry ─────────────
{
  const { parseTrialOffer, freeStartAdvertised, FREE_CLAIM_PATH } = offerMod;
  const full = parseTrialOffer({ entry: 'open', duration_hours: 24, request_limit: 10, unit: 'turn', claim: '/v1/free/claim', min_app_version: '0.1.58', available: true });
  assert.deepEqual({ ...full }, { entry: 'open', durationHours: 24, requestLimit: 10, unit: 'turn', claim: FREE_CLAIM_PATH, minAppVersion: '0.1.58', available: true });
  assert.equal(freeStartAdvertised(full), true, 'positive: the full advertisement turns free start on');
  assert.equal(parseTrialOffer({ entry: 'open', min_app_version: '2026.1019.0' }).minAppVersion, '2026.1019.0', 'a calendar-version floor is kept');
  // Drained day.
  const drained = parseTrialOffer({ entry: 'open', claim: '/v1/free/claim', available: false, reason: 'daily_cap', resumes_at: '2026-10-19T15:00:00.000Z' });
  assert.equal(drained.reason, 'daily_cap'); assert.equal(drained.resumesAt, '2026-10-19T15:00:00.000Z'); assert.equal(freeStartAdvertised(drained), true);
  // Negative controls: each missing/odd piece keeps today's start page.
  assert.equal(freeStartAdvertised(parseTrialOffer({ entry: 'open', duration_hours: 1, request_limit: 40 })), false, 'old Service: open without claim');
  assert.equal(freeStartAdvertised(parseTrialOffer({ entry: 'code', claim: '/v1/free/claim', available: true })), false, 'code entry');
  assert.equal(freeStartAdvertised(parseTrialOffer({ entry: 'open', claim: '/v1/other', available: true })), false, 'unknown claim path');
  assert.equal(freeStartAdvertised(parseTrialOffer({ entry: 'open', claim: '/v1/free/claim' })), false, 'availability unknown');
  assert.equal(freeStartAdvertised(parseTrialOffer({ entry: 'open', claim: '/v1/free/claim', available: 'yes' })), false, 'availability not boolean');
  assert.equal(freeStartAdvertised(null), false);
  const bad = parseTrialOffer({ entry: 'open', unit: 'minute', claim: 'https://evil.test/v1/free/claim', min_app_version: '1.0', available: 1, reason: 'other', resumes_at: 'tomorrow' });
  assert.deepEqual({ ...bad }, { entry: 'open' }, 'every bad optional field is dropped, the entry stays');
  // The code-entry note is unchanged (negative control for the copy).
  assert.equal(offerMod.trialEntryNote(parseTrialOffer({ entry: 'code' })).code, '지금은 발급받은 체험 코드가 있어야 시작할 수 있습니다.');
}

// ── 2. Claim client ─────────────────────────────────────────────────────────────────────────
{
  assert.equal(fs.compareVersions('0.1.58', '0.1.58'), 0);
  assert.equal(fs.compareVersions('0.1.57', '0.1.58'), -1);
  assert.equal(fs.compareVersions('0.1.58-rc.1', '0.1.58'), -1, 'prerelease < release');
  assert.equal(fs.compareVersions('0.2.0', '0.1.99'), 1);
  assert.equal(fs.compareVersions('x', '0.1.0'), null);
  assert.equal(fs.belowFloor('0.1.57', '0.1.58'), true);
  assert.equal(fs.belowFloor('0.1.58', '0.1.58'), false);
  assert.equal(fs.belowFloor('0.1.57', undefined), false, 'no floor advertised → not below');
  assert.equal(fs.belowFloor('test', '0.1.58'), false, 'unreadable version → let the Service decide');
  // Shipped releases are calendar versions (tags v2026.MMDD.N[-rc.N]).
  assert.equal(fs.compareVersions('2026.1019.0', '2026.1019.0'), 0);
  assert.equal(fs.compareVersions('2026.1017.0', '2026.1019.0'), -1);
  assert.equal(fs.compareVersions('2026.1019.0-rc.1', '2026.1019.0'), -1, 'calendar prerelease < release');
  assert.equal(fs.compareVersions('2026.1019.0', '0.1.58'), 1, 'calendar > 0.x');
  assert.equal(fs.belowFloor('2026.1017.0', '2026.1019.0'), true);
  assert.equal(fs.belowFloor('2026.1019.0', '2026.1019.0'), false);
  assert.equal(fs.compareVersions('20261.1019.0', '0.1.0'), null, 'still bounded: 5-digit major');
  assert.equal(fs.freeClaimUrl('http://127.0.0.1:18851/v1/'), 'http://127.0.0.1:18851/v1/free/claim');
  assert.equal(fs.freeClaimUrl('https://api.hypeproof-ai.xyz/v1'), 'https://api.hypeproof-ai.xyz/v1/free/claim');
  assert.equal(fs.isInstallId('3f0c1d2e-6a4b-4c8d-9e1f-0a1b2c3d4e5f'), true);
  assert.equal(fs.isInstallId('3F0C1D2E-6A4B-4C8D-9E1F-0A1B2C3D4E5F'), false, 'upper case refused');
  assert.equal(fs.isInstallId('3f0c1d2e-6a4b-1c8d-9e1f-0a1b2c3d4e5f'), false, 'not v4');

  const svcMsg = '이 네트워크에서 오늘 시작할 수 있는 횟수를 모두 사용했습니다. 내일 다시 시도하거나, 참여 코드나 이용권으로 시작해 주세요.';
  assert.deepEqual(fs.parseClaimRefusal(429, { error: { code: 'network_limit', message: svcMsg } }), { code: 'network_limit', message: svcMsg });
  // A non-Korean message is never shown; the local copy for the code stands in.
  assert.equal(fs.parseClaimRefusal(503, { error: { code: 'daily_cap_reached', message: 'drained', resumes_at: '2026-10-19T15:00:00.000Z' } }).message, fs.FREE_CLAIM_REFUSALS.daily_cap_reached);
  assert.equal(fs.parseClaimRefusal(503, { error: { code: 'daily_cap_reached', message: 'x', resumes_at: '2026-10-19T15:00:00.000Z' } }).resumesAt, '2026-10-19T15:00:00.000Z');
  assert.equal(fs.parseClaimRefusal(404, { error: { message: 'not found', type: 'not_found' } }).code, 'free_start_unavailable', 'flag off → unavailable');
  assert.equal(fs.parseClaimRefusal(500, 'garbage').message, fs.FREE_CLAIM_REFUSALS.free_start_unavailable);
  for (const [code, message] of Object.entries(fs.FREE_CLAIM_REFUSALS)) noTrialWord(message, `refusal ${code}`);

  const calls = [];
  const stub = (status, body) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
  const id = '3f0c1d2e-6a4b-4c8d-9e1f-0a1b2c3d4e5f';
  const granted = await fs.claimFreeStart({ proxyUrl: 'http://svc.test/v1', installId: id, appVersion: '0.1.58', ageOk: true, fetchImpl: stub(200, { outcome: 'granted', code: 'p'.repeat(40), profile: 'studio-open-trial', expires_at: 1761350400000 }) });
  assert.deepEqual(granted, { ok: true, outcome: 'granted', code: 'p'.repeat(40), profile: 'studio-open-trial', expiresAt: 1761350400000 });
  assert.equal(calls[0].url, 'http://svc.test/v1/free/claim');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { install_id: id, app_version: '0.1.58', age_ok: true }, 'exact keys, nothing else');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), null, 'public route: no bearer token');
  const malformed = await fs.claimFreeStart({ proxyUrl: 'http://svc.test/v1', installId: id, appVersion: '0.1.58', ageOk: true, fetchImpl: stub(200, { outcome: 'granted', code: 'short' }) });
  assert.equal(malformed.ok, false, 'negative: a malformed 200 never yields a token');
  const refused = await fs.claimFreeStart({ proxyUrl: 'http://svc.test/v1', installId: id, appVersion: '0.1.58', ageOk: true, fetchImpl: stub(403, { error: { code: 'under_14', message: fs.FREE_CLAIM_REFUSALS.under_14 } }) });
  assert.deepEqual({ ...refused }, { ok: false, status: 403, code: 'under_14', message: fs.FREE_CLAIM_REFUSALS.under_14 });
  const offline = await fs.claimFreeStart({ proxyUrl: 'http://svc.test/v1', installId: id, appVersion: '0.1.58', ageOk: true, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual({ ...offline }, { ok: false, status: 0, code: 'network', message: '연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.' });
  // CONV-ENDCARD-R-008 (CONV-DEC-03): a free seat shows no allowance count before use, so no helper builds one.
  assert.equal(fs.freeAllowanceLine, undefined, 'no free allowance line helper is exported');
  assert.equal(fs.guardianUrl('https://hypeproof-ai.xyz/'), 'https://hypeproof-ai.xyz/studio#guardian');
  for (const [k, v] of Object.entries(fs.FREE_START_COPY)) { noTrialWord(v, `copy ${k}`); assert.ok(!v.includes('수업'), `copy ${k} must not push a class: ${v}`); }

  // CONV-FIRST10-R-004 / TUX-SP-16 — the calm first-run notice. An operator pause (offer or claim)
  // says the install stays and when to come back; it names no count, no time it cannot know, no retry.
  const svcPaused = fs.FREE_CLAIM_REFUSALS.paused;
  const offerPaused = fs.freeCalmNotice({ unavailable: 'paused' });
  const claimPaused = fs.freeCalmNotice({ refusal: { code: 'paused', message: svcPaused } });
  assert.deepEqual(offerPaused, { kind: 'paused', title: '나중에 시작할 수 있습니다', body: '지금은 무료 사용을 잠시 멈췄습니다. Studio는 그대로 두고, 나중에 다시 열면 바로 시작할 수 있습니다.' });
  assert.deepEqual(claimPaused, offerPaused, 'a paused claim refusal draws the same calm card as the paused offer');
  assert.notEqual(claimPaused.body, svcPaused, 'the Service retry sentence is not shown on the paused card');
  assert.match(offerPaused.body, /Studio는 그대로/, 'the install stays');
  assert.match(offerPaused.body, /나중에 다시 열면/, 'says when to come back');
  assert.doesNotMatch(offerPaused.title + offerPaused.body, /\d|오류|실패|다시 시도|체험|수업|죄송/, 'no count, no error words, no retry push');
  // Daily cap: unchanged (TUX-SP-16) — the offer uses the local sentence, a refusal the Service sentence as given.
  assert.deepEqual(fs.freeCalmNotice({ unavailable: 'daily_cap' }), { kind: 'daily_cap', title: '밤 12시 이후에 시작할 수 있습니다', body: fs.FREE_START_COPY.dailyCapStart });
  assert.equal(fs.freeCalmNotice({ refusal: { code: 'daily_cap_reached', message: '서비스 문장입니다.' } }).body, '서비스 문장입니다.');
  assert.equal(fs.freeCalmNotice({ unavailable: 'daily_cap', refusal: { code: 'paused', message: svcPaused } }).kind, 'paused', 'a calm refusal outranks the offer');
  // Negative controls: an ordinary card, another refusal, or no free start is not calm (it may be an error, or the age question).
  assert.equal(fs.freeCalmNotice(undefined), null);
  assert.equal(fs.freeCalmNotice({}), null);
  assert.equal(fs.freeCalmNotice({ refusal: { code: 'network_limit', message: '네트워크 한도' } }), null);
  assert.equal(fs.freeCalmNotice({ refusal: { code: 'free_start_unavailable', message: '쓸 수 없습니다' } }), null);
  assert.equal(fs.freeCalmNotice({ unavailable: 'paused', refusal: { code: 'network', message: '연결하지 못했습니다.' } }).kind, 'paused', 'a non-calm refusal does not hide a paused offer');
}

// ── 3. Seat copy: free vs code-issued trial vs pass ─────────────────────────────────────────
{
  const now = new Date(2026, 9, 19, 12, 0).getTime();
  const ends = new Date(2026, 9, 19, 15, 20).toISOString();
  const active = { state: 'active', ends_at: ends, request_limit: 10, requests_used: 3 };
  const notStarted = { state: 'not_started', ends_at: null, request_limit: 10, requests_used: 0 };
  const spent = { state: 'exhausted', ends_at: ends, request_limit: 10, requests_used: 10 };
  const expired = { state: 'expired', ends_at: new Date(now - 1000).toISOString(), request_limit: 10, requests_used: 4 };
  assert.equal(seat.isFreeSeat({ profile_id: 'studio-open-trial' }), true);
  assert.equal(seat.isFreeSeat({ id: 'studio-open-trial' }), true);
  assert.equal(seat.isFreeSeat({ profile_id: 'studio-open-trial', pass: { request_limit: 1 } }), false, 'a bought pass is never the free seat');
  assert.equal(seat.isFreeSeat({ profile_id: 'studio-native-trial' }), false, 'code-issued trial');
  assert.equal(seat.isFreeSeat(null), false);

  assert.equal(labels.activityLabel('trial', undefined, undefined, true), '무료 사용');
  assert.equal(labels.activityLabel('trial'), 'AI 체험', 'negative: code-issued trial label unchanged');
  assert.equal(labels.activityLabel('trial', { x: 1 }, undefined, true), '이용권', 'a pass wins over free');
  assert.equal(labels.trialAllowance(notStarted, now, true, 24), '무료 AI 요청 10번 · 첫 요청부터 24시간');
  assert.equal(labels.trialAllowance(notStarted, now, true), '무료 AI 요청 10번');
  assert.equal(labels.trialAllowance(active, now, true), '무료 AI 요청 10번 · 오후 3시 20분까지');
  assert.equal(labels.trialAllowance(active, now), 'AI 요청 10번 · 오후 3시 20분까지', 'negative: code trial unchanged');
  assert.equal(labels.trialSummary(active, now, true), '무료 AI 요청 7번 남음 · 오후 3시 20분까지');
  assert.equal(labels.trialSummary(active, now), 'AI 요청 7번 남음 · 오후 3시 20분까지');
  assert.equal(labels.trialHeaderLine(spent, now, true), '무료 AI 요청을 모두 사용함');
  assert.equal(labels.trialHeaderLine(expired, now, true), '무료 사용 시간 끝남');
  assert.equal(labels.trialHeaderLine(spent, now), '체험 요청을 모두 사용함', 'negative: code trial unchanged');
  assert.equal(labels.trialHeaderLine(expired, now), '체험 시간 끝남');
  assert.equal(labels.activityDetail({ trial: spent, free: true }, now), '무료 AI 요청을 모두 사용함');
  const fe = labels.trialEndedFacts(spent, now, true), fx = labels.trialEndedFacts(expired, now, true);
  assert.deepEqual(fe, { reason: 'exhausted', title: '무료 사용이 끝났습니다', description: '무료 AI 요청을 모두 사용했습니다. 만든 파일은 작업 폴더에 그대로 있습니다.', row: '무료 AI 요청 10번 모두 사용' });
  assert.equal(fx.title, '무료 사용이 끝났습니다'); assert.equal(fx.description, '무료 사용 시간이 끝났습니다. 만든 파일은 작업 폴더에 그대로 있습니다.');
  for (const v of [...Object.values(fe), ...Object.values(fx)]) noTrialWord(v, 'free ended facts');
  assert.equal(labels.trialEndedFacts(spent, now).title, '체험이 끝났습니다', 'negative: code trial unchanged');
}

// ── 4. Matchers: free sentences match; code-trial sentences still match; unrelated 무료 does not ──
{
  const freeSpent = new Error('Claude Code returned an error result: API Error: Request rejected (429) · 무료로 쓸 수 있는 AI 요청을 모두 썼습니다. 만든 파일과 대화는 그대로 남아 있습니다.');
  const freeOver = new Error('Failed to authenticate. API Error: 403 무료 사용 시간이 끝났습니다. 만든 파일과 대화는 그대로 남아 있습니다.');
  const oldSpent = new Error('API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.');
  const oldOver = new Error('API Error: 403 개인 체험 시간이 끝났습니다.');
  const unrelated = [new Error('무료 이미지 생성은 지원하지 않습니다.'), new Error('무료로 쓸 수 있는 도구를 확인해 주세요.'), new Error('무료 사용 안내를 확인하세요.')];
  for (const fn of [purchase.trialEnding, endCard.trialEndReason]) {
    assert.equal(fn(freeSpent, false), 'exhausted'); assert.equal(fn(freeOver, false), 'expired');
    assert.equal(fn(oldSpent, false), 'exhausted'); assert.equal(fn(oldOver, false), 'expired');
    for (const e of unrelated) assert.equal(fn(e, false), null, `negative: ${e.message}`);
  }
  const cap = new Error('API Error: 503 오늘 준비한 무료 사용량이 모두 소진되었습니다. 밤 12시(한국 시간) 이후에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다.');
  assert.equal(purchase.freeDailyCapReached(cap), true);
  assert.equal(purchase.freeDailyCapReached(new Error('cohort_paused reason open_trial_daily_cap:2026-10-19')), true);
  assert.equal(purchase.freeDailyCapReached(new Error('지금은 무료 사용을 잠시 멈췄습니다.')), false, 'operator pause is not the daily cap');
  assert.equal(purchase.freeDailyCapReached(freeSpent), false);
  noTrialWord(purchase.FREE_DAILY_CAP_NOTICE, 'daily cap notice');
  // Notices: free seat gets free copy; code trial keeps its sentence byte for byte.
  assert.equal(purchase.trialEndNotice('exhausted', false, true), '무료로 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.');
  assert.equal(purchase.trialEndNotice('expired', true, true), "무료 사용 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요. 계속하려면 시작 화면의 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.");
  assert.equal(purchase.trialEndNotice('exhausted', false), '체험에서 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.');
  assert.equal(purchase.withTrialPassPointer(purchase.FREE_EXPIRED_FRIENDLY, true), "무료 사용 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요. 계속하려면 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.");
  assert.equal(purchase.withTrialPassPointer(purchase.FREE_EXPIRED_FRIENDLY, false), purchase.FREE_EXPIRED_FRIENDLY);
  // Error banner.
  const b = banner.errorBannerPresentation;
  assert.deepEqual({ ...b(purchase.FREE_EXHAUSTED_FRIENDLY) }, { icon: '⏳', title: '무료 사용량을 모두 썼어요' });
  assert.deepEqual({ ...b(purchase.FREE_EXPIRED_FRIENDLY) }, { icon: '⏳', title: '무료 사용 시간이 끝났어요' });
  assert.deepEqual({ ...b(purchase.FREE_DAILY_CAP_NOTICE) }, { icon: '🌙', title: '오늘 무료 사용량이 모두 소진됐어요', tone: 'notice' }, 'positive: the cap notice is a calm notice, not a lost connection (D4)');
  for (const m of [purchase.FREE_EXHAUSTED_FRIENDLY, purchase.TRIAL_EXHAUSTED_FRIENDLY, ...unrelated.map((e) => e.message)]) assert.equal(b(m).tone, undefined, `negative: only the daily cap is a notice: ${m}`);
  assert.deepEqual({ ...b(purchase.TRIAL_EXHAUSTED_FRIENDLY) }, { icon: '⏳', title: '체험이 끝났어요' }, 'negative: code trial banner unchanged');
  for (const e of unrelated) assert.notEqual(b(e.message).icon, '⏳', `negative: ${e.message}`);
  assert.equal(b('무료 이미지 생성은 지원하지 않습니다.').title, '문제가 생겼어요');
}

// ── 5. End card titles, carry-over, image edit, SDK notice, profile failure ─────────────────
{
  assert.equal(endCard.TRIAL_END_CARD_COPY.title, '만든 작업을 그대로 이어서 할 수 있어요');
  assert.equal(endCard.TRIAL_END_CARD_COPY.endedExhausted, '무료로 쓸 수 있는 AI 요청은 모두 썼어요.');
  assert.equal(endCard.TRIAL_END_CARD_COPY.endedExpired, '무료 사용 시간은 끝났어요.');
  for (const v of Object.values(endCard.TRIAL_END_CARD_COPY)) noTrialWord(v, 'end card');
  const card = endCard.trialEndCardView({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial' }, err: new Error('API Error: 429 · 무료로 쓸 수 있는 AI 요청을 모두 썼습니다.'), products: [{ id: 'p', label: '라이트', amount: 30000, durationDays: 30, requestLimit: 200 }] });
  assert.ok(card, 'positive: the free sentence ends in the card'); noTrialWord(card.text, 'end card text');

  const history = [{ role: 'user', content: '홈페이지 만들어 줘' }, { role: 'assistant', content: '초안입니다.' }];
  const freeSummary = carry.carryoverSummary(history, { free: true });
  noTrialWord(freeSummary, 'free carry-over summary');
  assert.match(freeSummary, /무료 사용 중 요청한 것:/); assert.match(freeSummary, /무료 사용의 마지막 답변: 초안입니다\./);
  assert.match(carry.carryoverSummary(history), /^체험에서 하던 대화를 이어서 해요\./, 'negative: code-trial source unchanged');
  assert.deepEqual(carry.carryoverSourceOf({ id: 't', name: 'n', workspace: '/w', kind: 'trial', free: true }, 'p'), { id: 't', name: 'n', workspace: '/w', free: true });
  assert.deepEqual(carry.carryoverSourceOf({ id: 't', name: 'n', workspace: '/w', kind: 'trial' }, 'p'), { id: 't', name: 'n', workspace: '/w' });
  const offer = carry.newOffer('p', { id: 't', name: 'n', workspace: '/w', free: true });
  assert.deepEqual(carry.carryoverView({ advertised: true, offer, passHistory: [], trialHistory: history }), { status: 'offer', fromName: 'n', free: true });
  assert.equal(carry.validOffer({ ...offer, from: { ...offer.from, free: 'yes' } }, 'p'), null, 'negative: a forged flag is not trusted');

  assert.equal(image.imageEditFailureMessage('trial_busy_or_exhausted', true), '요청이 진행 중이거나 무료 사용량을 모두 썼어요.');
  assert.equal(image.imageEditFailureMessage('trial_busy_or_exhausted'), '체험 요청이 진행 중이거나 허용 횟수를 모두 사용했어요.', 'negative: code trial unchanged');

  // A free seat never reaches the classroom model-runtime sentence (no 강사, no 체험): it is an SDK-only seat.
  const out = sdkReq.sdkUnavailableOutcome({ profile: { activity_kind: 'trial', profile_id: 'studio-open-trial' }, webSearch: false, modelPicked: true });
  assert.equal(out.kind, 'fail'); assert.equal(out.error.message, sdkReq.SDK_MISSING_NOTICE);
  noTrialWord(out.error.message, 'SDK notice'); assert.ok(!out.error.message.includes('강사'));
  assert.equal(seat.rateLimitStallText(seat.profileAudience({ activity_kind: 'trial', profile_id: 'studio-open-trial' })), '요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요. (429)');
}

{
  // Profile read after a free grant expired: the free sentence gets the free copy; a code trial keeps its own.
  const free = proxyHelpers.classifyProfileFailure(403, JSON.stringify({ error: { code: 'trial_expired', message: '무료 사용 시간이 끝났습니다. 만든 파일과 대화는 그대로 남아 있습니다.' } }));
  assert.equal(free.friendly, purchase.FREE_EXPIRED_FRIENDLY);
  const old = proxyHelpers.classifyProfileFailure(403, JSON.stringify({ error: { code: 'trial_expired', message: '개인 체험 시간이 끝났습니다.' } }));
  assert.equal(old.friendly, purchase.TRIAL_EXPIRED_FRIENDLY, 'negative: code trial unchanged');
}
console.log('PASS free-start pure: offer fields, claim client, free copy (+ code-trial negatives), matchers');
