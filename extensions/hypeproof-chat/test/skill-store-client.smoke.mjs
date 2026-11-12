// REQ-STORE-BUY / REQ-STORE-RUN (Epic #3418) — the store client (src/skillStore.ts).
// The Service is a synthetic stand-in on a fetch stub; no network, no gateway.
//
// Run: node --experimental-strip-types test/skill-store-client.smoke.mjs
import assert from 'node:assert/strict';
const s = await import('../src/skillStore.ts');

const SERVICE = 'https://service.test/v1';
const ORDER = 'sto_' + 'a'.repeat(32);
function stub(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect });
    const [status, body] = routes(url, init) ?? [404, { error: 'not_found' }];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
const client = (routes, token = 'acct-token') => {
  // `null` stands for a signed-out device (the account session returns no bearer).
  const f = stub(routes);
  return { c: new s.StoreClient({ proxyUrl: SERVICE, token: async () => token ?? undefined, device: 'dev-1', fetchImpl: f.fetchImpl }), calls: f.calls };
};

// The public list needs no account and carries no credential.
{
  const { c, calls } = client(() => [200, { items: [{ id: 'ski_x', title: 't' }] }], null);
  assert.equal((await c.items()).length, 1);
  assert.equal(calls[0].url, 'https://service.test/v1/store/items');
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].redirect, 'error');
}

// Signed in, the list carries the account: a rollout to listed accounts answers only them,
// and its 404 to anyone else reads as no store at all.
{
  const { c, calls } = client(() => [200, { items: [] }]);
  await c.items();
  assert.equal(calls[0].headers.authorization, 'Bearer acct-token');
  const off = client(() => [404, { error: 'not_found' }]);
  await assert.rejects(off.c.items(), (e) => e.code === 'store_off');
}

// An order sends the account bearer and the device id, and only the Service's own checkout page is accepted.
{
  const good = { order_id: ORDER, amount: 10000, title: 't', policy_version: 'v1', checkout_url: `https://service.test/v1/store/checkout?order=${ORDER}` };
  const { c, calls } = client(() => [201, good]);
  assert.equal((await c.createOrder('ski_x')).order_id, ORDER);
  assert.equal(calls[0].headers.authorization, 'Bearer acct-token');
  assert.equal(calls[0].headers['x-hps-device'], 'dev-1');
  assert.deepEqual(calls[0].body, { item_id: 'ski_x' });
  for (const checkout_url of [undefined, 'not a url', 'https://evil.test/v1/store/checkout?order=x', 'https://service.test/v1/purchase/checkout', 'http://service.test/v1/store/checkout']) {
    const bad = client(() => [201, { ...good, checkout_url }]);
    await assert.rejects(bad.c.createOrder('ski_x'), (e) => e.code === 'invalid_response', checkout_url);
  }
}

// Signed out: nothing account-scoped is sent at all.
{
  const { c, calls } = client(() => [200, {}], null);
  await assert.rejects(c.createOrder('ski_x'), (e) => e.code === 'account_required');
  assert.equal(calls.length, 0);
}

// The Service's refusal codes reach the learner as the Service's reason, in Korean.
{
  const { c } = client(() => [403, { error: 'minor_paid_purchase_blocked' }]);
  const error = await c.createOrder('ski_x').catch((e) => e);
  assert.equal(s.storeErrorMessage(error), '만 19세 미만은 무료 스킬만 설치할 수 있어요.');
  const cap = client(() => [422, { error: 'over_tier_cap', tier: 'new', cap_krw: 100000 }]);
  assert.equal(s.storeErrorMessage(await cap.c.publish({ title: 'a', summary: 'b', body: 'c', tools: [], price_krw: 200000 }).catch((e) => e)), '판매자 등급의 가격 한도(100,000원)를 넘었어요.');
  const checks = client(() => [422, { error: 'checks_failed', checks: ['credential_found'], messages: ['키, 토큰…'] }]);
  const failed = await checks.c.publish({ title: 'a', summary: 'b', body: 'c', tools: [], price_krw: 0 }).catch((e) => e);
  assert.deepEqual(failed.detail.messages, ['키, 토큰…']);
  // An unknown code is never shown raw.
  assert.equal(s.storeErrorMessage(new s.StoreClientError('weird_internal_code')), s.STORE_COPY.unavailable);
}

// Custody (design v1 D1): publishing sends the creator's text once as a single sealed step, and the
// client has no call that fetches a skill's text back.
{
  const { c, calls } = client(() => [201, { id: 'ski_x', status: 'listed', tier: 'new', cap_krw: 100000 }]);
  await c.publish({ title: '정리', summary: '요약', body: '비공개 지침', tools: ['read'], price_krw: 0 });
  assert.deepEqual(calls[0].body.steps, [{ step_id: 'main', title: '정리', description: '요약', private: { prompt: '비공개 지침' } }]);
  assert.deepEqual(calls[0].body.outputs, ['chat_answer']);
  await c.publish({ title: '정리', summary: '요약', body: '비공개 지침', tools: ['read', 'write'], price_krw: 0 });
  assert.deepEqual(calls[1].body.outputs, ['chat_answer', 'workspace_file'], 'file writes are a declared output');
  assert.equal('body' in calls[0].body, false);
  assert.equal(typeof c.run, 'undefined');
  assert.equal(typeof s.storeSkillBlock, 'undefined');
}
console.log('skill-store-client smoke: list, order headers, checkout origin, signed-out, refusal copy, sealed publish PASS');

// #3477: a free install promises no refund, and neither notice depends on the title's last letter for its particle.
{
  assert.equal(s.STORE_COPY.installedFree('회의록 요약 정리'), '「회의록 요약 정리」 스킬을 설치했어요.');
  assert.ok(!s.STORE_COPY.installedFree('x').includes('환불'));
  assert.equal(s.STORE_COPY.paid('서류 제출 요청'), '「서류 제출 요청」 스킬을 설치했어요. 처음 실행하기 전까지는 환불할 수 있어요.');
  const panel = (await import('node:fs')).readFileSync(new URL('../src/skillStorePanel.ts', import.meta.url), 'utf8');
  const free = panel.slice(panel.indexOf('case "storeInstallFree":'), panel.indexOf('case "storeRefund":'));
  assert.ok(free.includes('STORE_COPY.installedFree(') && !free.includes('STORE_COPY.paid('), 'the free-install path uses the free notice');
  console.log('PASS free-install notice');
}


// Policy v2 (#3761): code lookup sends only the typed codes; registration and the payout account go to their own routes.
{
  const { c, calls } = client((url) => [200, url.endsWith('/payout-account') ? { masked: '국민은행 ****9012' } : { partner: null, instructor: { name: '김강사', partner_name: null } }]);
  await c.resolveCodes('  ', ' I-ABCDE-FGHJK ');
  assert.deepEqual([calls[0].url, calls[0].method, calls[0].body], ['https://service.test/v1/store/attribution/resolve', 'POST', { instructor_code: 'I-ABCDE-FGHJK' }]);
  await c.registerAttribution({ none: true });
  assert.deepEqual([calls[1].url, calls[1].body], ['https://service.test/v1/store/attribution', { none: true }]);
  await c.savePayoutAccount({ bank_code: '004', account_number: '123456789012', holder_name: '홍길동' });
  assert.deepEqual([calls[2].url, calls[2].method, calls[2].headers.authorization], ['https://service.test/v1/store/seller/payout-account', 'PUT', 'Bearer acct-token']);
  // The Service's refusals read as the seller's next step.
  for (const [code, text] of [['unknown_instructor_code', '강사 코드를 찾을 수 없어요.'], ['attribution_already_set', '운영팀에 문의해 주세요.'], ['payout_account_not_due', '아직 계좌가 필요하지 않아요.'], ['holder_mismatch', '예금주와 계좌가 맞지 않아요.']])
    assert.ok(s.storeErrorMessage(new s.StoreClientError(code)).includes(text), code);
  console.log('PASS attribution and payout-account calls');
}

// #3770: identity verification opens only the Service's own verification page for that session.
{
  const ID = 'idv_' + 'b'.repeat(32);
  const good = { session_id: ID, verify_url: `https://service.test/v1/store/identity/verify?session=${ID}`, sandbox: true };
  const { c, calls } = client(() => [201, good]);
  assert.equal((await c.startIdentity()).session_id, ID);
  assert.deepEqual([calls[0].url, calls[0].method], ['https://service.test/v1/store/identity/start', 'POST']);
  // Extra parameters or a fragment never reach the browser: the opened URL is rebuilt from the session.
  const extra = client(() => [201, { ...good, verify_url: good.verify_url + '&next=https://evil.test/#x' }]);
  assert.equal((await extra.c.startIdentity()).verify_url, `https://service.test/v1/store/identity/verify?session=${ID}`);
  for (const verify_url of ['https://evil.test/v1/store/identity/verify?session=' + ID, 'https://service.test/v1/store/checkout?session=' + ID, `https://service.test/v1/store/identity/verify?session=idv_${'c'.repeat(32)}`, 'nope']) {
    const bad = client(() => [201, { ...good, verify_url }]);
    await assert.rejects(bad.c.startIdentity(), (e) => e.code === 'invalid_response', verify_url);
  }
  assert.ok(s.storeErrorMessage(new s.StoreClientError('identity_in_use')).includes('한 사람은 한 계정에서만'));
  console.log('PASS identity start opens only the Service verification page');
}
