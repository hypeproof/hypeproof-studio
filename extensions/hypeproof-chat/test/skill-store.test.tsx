// REQ-STORE-LIST / REQ-STORE-BUY / REQ-STORE-REFUND / REQ-STORE-SETTLEMENT / REQ-STORE-MINOR (Epic #3418).
//   node scripts/run-tsx-tests.mjs skill-store
// Real SkillStoreView and the copy it shares with the host (src/skillStore.ts). The Service decides
// every rule; these checks pin what the buyer and seller see for the states the Service reports.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { SkillStoreView } from '../webview-ui/src/SkillStore';
import type { StoreRequest, StoreState } from '../src/skillStoreProtocol';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (window as any)[name];
(globalThis as any).HTMLElement ??= (window as any).Element;

const STEPS = [
  { step_id: 'read-notes', title: '메모 읽기', description: '회의 메모를 읽어요.', connections: [] },
  { step_id: 'send-summary', title: '요약 보내기', description: '참석자에게 요약을 보내요.', connections: [{ id: 'google.gmail.send', why: '요약 메일을 보내요' }] },
];
const PAID = { id: 'ski_' + 'a'.repeat(32), title: '회의록 정리 스킬', summary: '회의 메모를 표로 정리해요.', price_krw: 10000, version: 1, tools: ['read', 'write'], outputs: ['chat_answer'], steps: STEPS, connections: ['google.gmail.send'], seller_name: 'seller', refund_window_days: 7 };
const FREE = { ...PAID, id: 'ski_' + 'b'.repeat(32), title: '무료 스킬', price_krw: 0 };
const base = (patch: Partial<StoreState> = {}): StoreState => ({ access: 'ready', tab: 'browse', items: [PAID, FREE], ageGroup: 'adult', installs: [], testPayments: true, ...patch });
const html = (state: StoreState) => renderToStaticMarkup(<SkillStoreView state={state} send={() => {}} />);
const buttons = (host: any, text: string) => host.querySelectorAll('button').filter((b: any) => b.textContent === text);

async function mounted(state: StoreState) {
  const sent: StoreRequest[] = [];
  const host = mountPoint(), root = createRoot(host);
  await act(() => root.render(<SkillStoreView state={state} send={m => sent.push(m)} />));
  return { host, root, sent };
}

async function main() {
// Browse: the refund rule and the buyer-pays-model-usage note are on the item before purchase.
{
  const page = html(base());
  assert.ok(page.includes('구매 후 7일 안에, 한 번도 실행하지 않았다면 전액 환불돼요. 처음 실행한 뒤에는 환불할 수 없어요.'));
  assert.ok(page.includes('실행할 때 드는 AI 사용량은 내 이용권에서 차감돼요.'));
  assert.ok(page.includes('지금은 테스트 결제만 돼요.'), 'test-key payments say so');
  // Scene 2: the card lists the included steps and the connection each needs, from the public layer.
  assert.ok(page.includes('요약 보내기: 참석자에게 요약을 보내요. (필요한 연결: Gmail 보내기, 요약 메일을 보내요)'));
  const { host, root, sent } = await mounted(base());
  await act(() => click(buttons(host, '10,000원 카드 결제')[0]));
  await act(() => click(buttons(host, '무료로 설치')[0]));
  assert.deepEqual(sent, [{ type: 'storeBuy', itemId: PAID.id }, { type: 'storeInstallFree', itemId: FREE.id }]);
  await act(() => root.unmount());
}

// Minor (14-18): free install stays, paid purchase is not offered (negative control for the button above).
{
  const { host, root } = await mounted(base({ ageGroup: 'minor' }));
  assert.equal(buttons(host, '10,000원 카드 결제').length, 0);
  assert.equal(buttons(host, '무료로 설치').length, 1);
  assert.ok(host.textContent.includes('만 19세 미만은 무료 스킬만 설치할 수 있어요.'));
  await act(() => root.unmount());
}

// Signed out: the list is readable, nothing can be bought.
{
  const { host, root } = await mounted(base({ access: 'signedOut' }));
  assert.equal(host.querySelectorAll('article').length, 2);
  assert.equal(buttons(host, '10,000원 카드 결제').length + buttons(host, '무료로 설치').length, 0);
  assert.equal(buttons(host, 'Google로 로그인').length, 1);
  await act(() => root.unmount());
}

// Mine: refund before the first run; after the run the refund button is gone and the reason is shown.
// Custody (design v1 D1): the App has no run button that fetches a skill; a run is composed by the Service.
{
  const install = { item_id: PAID.id, title: PAID.title, summary: PAID.summary, price_krw: 10000, version: 1, public: { steps: STEPS, outputs: ['chat_answer'] }, update_available: false, runnable: true, warning: null, order_id: 'sto_' + 'c'.repeat(32), first_run_at: null, refundable: true, refund_until: Date.UTC(2026, 10, 10) };
  const before = await mounted(base({ tab: 'mine', installs: [install] }));
  await act(() => click(buttons(before.host, '환불')[0]));
  assert.equal(buttons(before.host, '실행').length, 0);
  assert.ok(before.host.textContent.includes('메모 읽기'));
  assert.deepEqual(before.sent, [{ type: 'storeRefund', orderId: install.order_id }]);
  await act(() => before.root.unmount());
  const after = await mounted(base({ tab: 'mine', installs: [{ ...install, first_run_at: Date.now(), refundable: false }] }));
  assert.equal(buttons(after.host, '환불').length, 0);
  assert.ok(after.host.textContent.includes('실행한 뒤라 환불할 수 없어요.'));
  await act(() => after.root.unmount());
}

// Sell: the settlement row shows the PG fee, the 80% share, the 20% commission and its referral parts, and the policy version.
{
  const sale = { order_id: 'sto_' + 'd'.repeat(32), title: PAID.title, gross: 10000, pg_fee: 340, seller: 7728, commission: 1932, partner: 483, instructor: 483, hypeproof: 966, seller_net: 7728, policy_version: 'v1', paid_at: 1, status: 'refund_window' as const, payout_hold_ends: 2 };
  const seller = { tier: 'new' as const, cap_krw: 100000, identity_verified: true, origin: { lecture_id: 'lec', partner: true, instructor: true }, items: [], sales: [sale], totals: { payable: 0, pending: 7728, rolls_over: true, payout_min_krw: 10000 }, payout: 'not_started' as const, policy_version: 'v1' };
  const adult = html(base({ tab: 'sell', seller }));
  for (const cell of ['<td>10,000원</td><td>340원</td><td>7,728원</td><td>1,932원</td><td>483원</td><td>483원</td><td>환불 가능 기간</td><td>v1</td>', '정산은 기록만 되고 있어요.'])
    assert.ok(adult.includes(cell), cell);
  const minor = html(base({ tab: 'sell', ageGroup: 'minor', seller: { ...seller, tier: 'minor', payout: 'linked_adult_required' } }));
  assert.ok(minor.includes('보호자 연결이 필요해요.'), 'a minor seller sees the ledger and the linked-adult payout rule');
  assert.ok(minor.includes('<td>7,728원</td>'));
}

// The age question appears before buying or selling when the Service does not know the age.
assert.ok(html(base({ tab: 'mine', ageGroup: 'unknown' })).includes('태어난 해를 한 번만 알려 주세요.'));
assert.ok(html(base({ tab: 'browse', ageGroup: 'unknown' })).includes('태어난 해를 한 번만 알려 주세요.'), 'asked where the buy button is');
assert.equal(html(base({ tab: 'browse', ageGroup: 'unknown', access: 'signedOut' })).includes('태어난 해를 한 번만'), false);
assert.equal(html(base({ tab: 'mine', ageGroup: 'adult' })).includes('태어난 해를 한 번만'), false);
}
main().then(() => { console.log('skill-store render checks passed'); process.exit(0); }, e => { console.error(e); process.exit(1); });
