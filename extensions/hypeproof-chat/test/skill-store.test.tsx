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
// mini-dom reflects no `type` property, which React reads to pick the change event of an input.
const typeInto = (el: any, value: string) => act(async () => { el.type ??= el.getAttribute('type') ?? 'text'; el.value = value; el.dispatchEvent({ type: 'input', bubbles: true }); });
const byLabel = (host: any, label: string) => host.findAll((e: any) => e.getAttribute?.('aria-label') === label)[0];
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
  assert.ok(page.includes('요약 보내기: 참석자에게 요약을 보내요.'));
  assert.ok(page.includes('Gmail 보내기 · 요약 메일을 보내요 · <strong>연결 필요</strong>'), 'no local connection known: needs connection');
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
// Custody (design v1 D1/D2): 실행 opens a chat run the Service composes; it fetches nothing from the store.
{
  const install = { item_id: PAID.id, title: PAID.title, summary: PAID.summary, price_krw: 10000, version: 1, public: { steps: STEPS, outputs: ['chat_answer'] }, update_available: false, runnable: true, warning: null, order_id: 'sto_' + 'c'.repeat(32), first_run_at: null, refundable: true, refund_until: Date.UTC(2026, 10, 10) };
  const before = await mounted(base({ tab: 'mine', installs: [install] }));
  await act(() => click(buttons(before.host, '환불')[0]));
  await act(() => click(buttons(before.host, '실행')[0]));
  assert.ok(before.host.textContent.includes('메모 읽기'));
  assert.deepEqual(before.sent, [{ type: 'storeRefund', orderId: install.order_id }, { type: 'storeRun', itemId: PAID.id }]);
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


// Store slice 2 (scenes 1–4). Search, "이미 연결됨", the completion-card prefill, adaptation and update consent.
{
  // Scene 2: a search sends the typed words; a step's connection this device already has reads "이미 연결됨".
  const { host, root, sent } = await mounted(base({ connections: { google: true, roster: false } }));
  const input = host.querySelector('input[type="search"]');
  await typeInto(input, '요약');
  await act(() => host.querySelector('form[role="search"]').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }));
  assert.deepEqual(sent.at(-1), { type: 'storeSearch', query: '요약' });
  assert.ok(host.textContent.includes('Gmail 보내기 · 요약 메일을 보내요 · 이미 연결됨'));
  await act(() => root.unmount());
  const roster = html(base({ items: [{ ...FREE, steps: [{ step_id: 'sheet', title: '명단 연결', description: '', connections: [{ id: 'roster.read', why: '내 명단에서만 골라요' }] }] }], connections: { google: true, roster: false } }));
  assert.ok(roster.includes('명단 · 내 명단에서만 골라요 · <strong>연결 필요</strong>'), 'negative control: a roster this device lacks is not shown as connected');
  assert.ok(html(base({ items: [], query: '요약' })).includes('「요약」에 맞는 스킬이 없어요.'));
}
{
  // Scene 1: the finished quest's name and description are prefilled; a price over the tier cap cannot be sent.
  const seller = { tier: 'new' as const, cap_krw: 100000, identity_verified: true, origin: null, items: [{ id: PAID.id, title: '서류 제출 요청', price_krw: 5000, status: 'listed', report_count: 0 }], sales: [], totals: { payable: 0, pending: 0, rolls_over: false, payout_min_krw: 10000 }, payout: 'not_started' as const, policy_version: 'v1' };
  const questDraft = { title: '서류 제출 요청', summary: '명단으로 안내 메일을 만들어요.', steps: [{ title: '내 Google 계정 연결', description: '보내는 계정을 연결해요.' }] };
  const { host, root, sent } = await mounted(base({ tab: 'sell', seller, questDraft }));
  const form = byLabel(host, '퀘스트 스토어에 등록');
  const inputs = form.querySelectorAll('input');
  assert.deepEqual([inputs[0].value, inputs[1].value], ['서류 제출 요청', '명단으로 안내 메일을 만들어요.']);
  assert.ok(host.textContent.includes('메일 문구와 지침은 HypeProof 서버에만 보관되고'));
  const price = inputs[2];
  await typeInto(price, '200000');
  assert.ok(buttons(form, '스토어에 등록')[0].hasAttribute('disabled'), 'over the 100,000 KRW cap');
  assert.ok(form.textContent.includes('판매자 등급의 가격 한도(100,000원)를 넘었어요.'));
  await typeInto(price, '5000');
  await act(() => click(buttons(form, '스토어에 등록')[0]));
  assert.deepEqual(sent.at(-1), { type: 'storePublishQuest', title: '서류 제출 요청', summary: '명단으로 안내 메일을 만들어요.', price_krw: 5000 });
  assert.ok(host.textContent.includes('서류 제출 요청 · 5,000원 · 판매 중'), '"판매 중" in 내 스토어');
  assert.equal(buttons(host, '내 스토어').length, 1);
  await act(() => root.unmount());
}
{
  // Scene 4: adaptation by conversation and by step, on the public steps and the buyer's own overlay only.
  const install = { item_id: PAID.id, title: PAID.title, summary: PAID.summary, price_krw: 0, version: 1, public: { steps: STEPS, outputs: ['chat_answer'] }, update_available: true, runnable: true, warning: null, order_id: null, first_run_at: null, refundable: false, refund_until: null };
  const overlay = { item_id: PAID.id, version: 1, steps: STEPS, overlay: { 'send-summary': { tone: '짧게' as const } }, needs_review: [] };
  const { host, root, sent } = await mounted(base({ tab: 'mine', installs: [install], overlay }));
  const talk = host.findAll((e: any) => e.getAttribute?.('placeholder') === '예: 세 줄로 짧게 요약해 주세요')[0];
  await typeInto(talk, '세 줄로 짧게 요약해 주세요');
  await act(() => talk.closest('form').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }));
  assert.deepEqual(sent.at(-1), { type: 'storeAdapt', itemId: PAID.id, text: '세 줄로 짧게 요약해 주세요' });
  // Turn the first step off, then save: the saved overlay keeps the earlier tone and adds the change.
  const box = byLabel(host, '단계별로 바꾸기').querySelectorAll('input[type="checkbox"]')[0];
  box.type = 'checkbox'; box.checked = false;
  await act(() => click(box));
  await act(() => click(buttons(host, '저장')[0]));
  assert.deepEqual(sent.at(-1), { type: 'storeOverlaySave', itemId: PAID.id, steps: { 'send-summary': { tone: '짧게' }, 'read-notes': { enabled: false } } });
  await act(() => click(buttons(host, '업데이트')[0]));
  assert.deepEqual(sent.at(-1), { type: 'storeUpdate', itemId: PAID.id });
  await act(() => root.unmount());
  // F5: an update that adds a connection shows what it adds and needs the buyer's confirmation.
  const consent = await mounted(base({ tab: 'mine', installs: [install], consent: { itemId: PAID.id, widened: ['connection:google.sheets.read'] } }));
  assert.ok(consent.host.textContent.includes('새 연결: 구글 시트 읽기'));
  await act(() => click(buttons(consent.host, '확인하고 업데이트')[0]));
  assert.deepEqual(consent.sent.at(-1), { type: 'storeUpdate', itemId: PAID.id, consent: true });
  await act(() => consent.root.unmount());
}

// The age question appears before buying or selling when the Service does not know the age.
assert.ok(html(base({ tab: 'mine', ageGroup: 'unknown' })).includes('태어난 해를 한 번만 알려 주세요.'));
assert.ok(html(base({ tab: 'browse', ageGroup: 'unknown' })).includes('태어난 해를 한 번만 알려 주세요.'), 'asked where the buy button is');
assert.equal(html(base({ tab: 'browse', ageGroup: 'unknown', access: 'signedOut' })).includes('태어난 해를 한 번만'), false);
assert.equal(html(base({ tab: 'mine', ageGroup: 'adult' })).includes('태어난 해를 한 번만'), false);
}
main().then(() => { console.log('skill-store render checks passed'); process.exit(0); }, e => { console.error(e); process.exit(1); });
