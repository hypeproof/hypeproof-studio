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
// mini-dom models no <select>.options, which React reads to mark the chosen option.
Object.defineProperty((window as any).Element.prototype, 'options', { configurable: true, get() { return String(this.tagName).toLowerCase() === 'select' ? this.findAll((e: any) => String(e.tagName).toLowerCase() === 'option') : undefined; } });

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

const CONSENT_V = 'store-referral-2026-11-12';
const DECIDED = { decided: true, partner: null, instructor: null, source: 'seller' as const, seller_editable: false, consent_version: CONSENT_V, consent_given: null as string | null };
const NOT_DUE = { state: 'not_due' as const, prompt_at_krw: 10000, holder: 'self' as const, linked_adult_required: false };
const SELLER = { tier: 'new' as const, cap_krw: 100000, identity_verified: true, attribution: DECIDED, items: [] as { id: string; title: string; price_krw: number; status: string; report_count: number }[], sales: [] as any[], totals: { refund_window: 0, payout_hold: 0, payable: 0, refunded: 0, pending: 0, rolls_over: true, payout_min_krw: 10000 }, payout_account: NOT_DUE as any, payout: 'not_started' as const, policy_version: 'v2' };

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
  const seller = { ...SELLER, attribution: { ...DECIDED, partner: { name: '세바시' }, instructor: { name: '김강사' } }, sales: [sale], totals: { ...SELLER.totals, refund_window: 7728, pending: 7728 } };
  const adult = html(base({ tab: 'sell', seller }));
  for (const cell of ['<td>10,000원</td><td>340원</td><td>7,728원</td><td>1,932원</td><td>483원</td><td>483원</td><td>환불 가능 기간</td><td>v1</td>', '정산은 기록만 되고 있어요.', '<th>결제 수수료(예상)</th>', '결제 수수료는 예상 금액이에요. 실제 요율은 결제사 계약이 끝난 뒤 정해져요.', '<li>환불 가능 기간 7,728원</li><li>지급 보류 0원</li><li>정산 대상 0원</li>', '등록한 코드: 파트너 세바시 · 강사 김강사. 바꾸려면 운영팀에 문의해 주세요.'])
    assert.ok(adult.includes(cell), cell);
  // Earnings first: no account form while the payable balance is under the prompt amount.
  assert.ok(adult.includes('정산 대상 금액이 10,000원 이상이 되면 받을 계좌를 여쭤볼게요.'));
  assert.equal(adult.includes('계좌번호'), false);
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
  const seller = { ...SELLER, items: [{ id: PAID.id, title: '서류 제출 요청', price_krw: 5000, status: 'listed', report_count: 0 }] };
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

// Policy v2 first publication: codes are optional, typed codes must be checked (names shown) before publishing,
// and the choice rides on the publish message once.
{
  const questDraft = { title: '서류 제출 요청', summary: '명단으로 안내 메일을 만들어요.', steps: [{ title: '내 Google 계정 연결', description: '' }] };
  const undecided = { ...SELLER, attribution: { ...DECIDED, decided: false, source: null } };
  const { host, root, sent } = await mounted(base({ tab: 'sell', seller: undecided, questDraft }));
  const codes = byLabel(host, '파트너·강사 코드');
  assert.ok(codes, 'the code step is shown before the first publication');
  assert.ok(codes.textContent.includes('처음 올릴 때 한 번만 정하고, 그 뒤에는 운영팀만 바꿀 수 있어요.'));
  const publish = () => buttons(byLabel(host, '퀘스트 스토어에 등록'), '스토어에 등록')[0];
  // No code typed: publishing registers "none".
  await act(() => click(publish()));
  assert.deepEqual(sent.at(-1), { type: 'storePublishQuest', title: '서류 제출 요청', summary: '명단으로 안내 메일을 만들어요.', price_krw: 0, attribution: { none: true } });
  // A typed code blocks publishing until it is checked.
  const [, instructorInput] = codes.querySelectorAll('input');
  await typeInto(instructorInput, 'I-ABCDE-FGHJK');
  assert.ok(publish().hasAttribute('disabled'), 'unchecked code');
  assert.ok(host.textContent.includes('코드를 확인한 뒤에 올릴 수 있어요.'));
  await act(() => click(buttons(codes, '코드 확인')[0]));
  assert.deepEqual(sent.at(-1), { type: 'storeResolveCodes', partnerCode: '', instructorCode: 'I-ABCDE-FGHJK' });
  await act(() => root.render(<SkillStoreView state={base({ tab: 'sell', seller: undecided, questDraft, attributionPreview: { partnerCode: '', instructorCode: 'I-ABCDE-FGHJK', partner: { name: '세바시' }, instructor: { name: '김강사', partner_name: '세바시' } } })} send={m => sent.push(m)} />));
  assert.ok(host.textContent.includes('확인했어요. 파트너: 세바시 (강사 소속으로 함께 등록돼요) · 강사: 김강사. 올리면 이대로 한 번만 등록돼요.'));
  // Checked names are not enough: sharing the sales record needs the consent.
  assert.ok(publish().hasAttribute('disabled'), 'checked but not consented');
  assert.ok(host.textContent.includes('정산을 위해 내 판매 실적(판매자 표시명, 판매 금액)이 입력한 코드의 파트너·강사에게 제공되는 것에 동의해요.'));
  const consentBox = byLabel(host, '파트너·강사 코드').querySelector('input[type="checkbox"]');
  consentBox.type = 'checkbox'; consentBox.checked = true;
  await act(() => click(consentBox));
  await act(() => click(publish()));
  assert.deepEqual(sent.at(-1).attribution, { instructor_code: 'I-ABCDE-FGHJK', consent: { version: CONSENT_V, granted: true } });
  // Changing the code after the check needs a new check and a new consent (negative control).
  await typeInto(byLabel(host, '파트너·강사 코드').querySelectorAll('input')[1], 'I-ZZZZZ-ZZZZZ');
  assert.ok(publish().hasAttribute('disabled'));
  assert.equal(byLabel(host, '파트너·강사 코드').querySelector('input[type="checkbox"]').checked, false, 'the consent is asked again for the new code');
  // Declining: 「코드 없이 진행」 clears the codes and the publish registers none.
  await act(() => click(buttons(byLabel(host, '파트너·강사 코드'), '코드 없이 진행')[0]));
  await act(() => click(publish()));
  assert.deepEqual(sent.at(-1).attribution, { none: true });
  // The single-step form waits for the same check and consent.
  await typeInto(byLabel(host, '파트너·강사 코드').querySelectorAll('input')[0], 'P-ABCDE-FGHJK');
  const form = byLabel(host, '스킬 올리기');
  const [title, summary] = form.querySelectorAll('input');
  await typeInto(title, '정리'); await typeInto(summary, '요약'); await typeInto(form.querySelector('textarea'), '지침');
  assert.ok(buttons(form, '스토어에 올리기')[0].hasAttribute('disabled'), 'single-step publish waits for the code check');
  await act(() => root.unmount());
  // Decided: no code step, and the publish carries no attribution.
  const done = await mounted(base({ tab: 'sell', seller: SELLER, questDraft }));
  assert.equal(byLabel(done.host, '파트너·강사 코드'), undefined);
  assert.ok(done.host.textContent.includes('등록한 파트너·강사 코드가 없어요. 바꾸려면 운영팀에 문의해 주세요.'));
  await act(() => click(buttons(byLabel(done.host, '퀘스트 스토어에 등록'), '스토어에 등록')[0]));
  assert.equal('attribution' in done.sent.at(-1), false);
  await act(() => done.root.unmount());
}
// Payout account: asked for only when due; a minor is asked for a linked adult's account; on file it is masked.
{
  const due = { ...SELLER, totals: { ...SELLER.totals, payable: 15456, rolls_over: false }, payout_account: { ...NOT_DUE, state: 'due' as const } };
  const { host, root, sent } = await mounted(base({ tab: 'sell', seller: due }));
  const form = byLabel(host, '지급 계좌');
  assert.ok(form.textContent.includes('정산금을 받을 계좌를 알려 주세요.'));
  const save = () => buttons(form, '계좌 저장')[0];
  assert.ok(save().hasAttribute('disabled'));
  const select = form.querySelector('select');
  await act(async () => { select.value = '004'; select.dispatchEvent({ type: 'change', bubbles: true }); });
  const [number, holder] = form.querySelectorAll('input');
  await typeInto(number, '123-456-789012');
  await typeInto(holder, '홍길동');
  await act(() => form.querySelector('form').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }));
  assert.deepEqual(sent.at(-1), { type: 'storeSavePayoutAccount', bankCode: '004', accountNumber: '123456789012', holderName: '홍길동' });
  assert.equal(number.value, '', 'the typed number is cleared after sending');
  await act(() => root.unmount());
  const minor = html(base({ tab: 'sell', ageGroup: 'minor', seller: { ...due, tier: 'minor', payout: 'linked_adult_required', payout_account: { ...due.payout_account, holder: 'linked_adult', linked_adult_required: true } } }));
  for (const t of ['만 19세 미만 판매자는 보호자 명의 계좌로만 받을 수 있어요.', '보호자 이름 (예금주)', '보호자 확인이 끝나야 지급돼요.']) assert.ok(minor.includes(t), t);
  const onFile = html(base({ tab: 'sell', seller: { ...due, payout_account: { state: 'on_file', prompt_at_krw: 10000, holder: 'self', linked_adult_required: false, masked: '국민은행 ****9012', holder_check: 'sandbox_matched' } } }));
  assert.ok(onFile.includes('지급 계좌: 국민은행 ****9012'));
  assert.ok(onFile.includes('예금주 확인: 테스트 확인만 했어요.'));
  assert.equal(onFile.includes('계좌번호'), false, 'no form until the seller asks to change it');
}

// Seller identity (#3770): an unverified seller gets the phone verification button; while it runs the panel waits.
{
  const none = { ...SELLER, tier: 'none' as const, cap_krw: 0 };
  const { host, root, sent } = await mounted(base({ tab: 'sell', seller: none }));
  assert.ok(host.textContent.includes('유료 스킬을 팔려면 휴대폰 본인인증이 필요해요. 한 번만 하면 돼요.'));
  await act(() => click(buttons(host, '휴대폰 본인인증')[0]));
  assert.deepEqual(sent.at(-1), { type: 'storeVerifyIdentity' });
  await act(() => root.render(<SkillStoreView state={base({ tab: 'sell', seller: none, identity: { sessionId: 'idv_' + 'a'.repeat(32), sandbox: true } })} send={m => sent.push(m)} />));
  assert.ok(host.textContent.includes('브라우저에서 본인인증을 마치면 여기에 자동으로 반영돼요.'));
  assert.ok(host.textContent.includes('지금은 테스트 본인인증이에요.'));
  assert.equal(buttons(host, '휴대폰 본인인증').length, 0, 'no second start while one runs');
  await act(() => click(buttons(host, '기다리지 않기')[0]));
  assert.deepEqual(sent.at(-1), { type: 'storeCancelIdentity' });
  await act(() => root.unmount());
  assert.ok(html(base({ tab: 'sell', seller: { ...SELLER, tier: 'minor' } })).includes('만 19세 미만 판매자는 한 개당 최대 10만 원까지 올릴 수 있고'));
  assert.equal(html(base({ tab: 'sell', seller: SELLER })).includes('휴대폰 본인인증'), false, 'a verified seller is not asked again');
}

// The age question appears before buying or selling when the Service does not know the age.
assert.ok(html(base({ tab: 'mine', ageGroup: 'unknown' })).includes('태어난 해를 한 번만 알려 주세요.'));
assert.ok(html(base({ tab: 'browse', ageGroup: 'unknown' })).includes('태어난 해를 한 번만 알려 주세요.'), 'asked where the buy button is');
assert.equal(html(base({ tab: 'browse', ageGroup: 'unknown', access: 'signedOut' })).includes('태어난 해를 한 번만'), false);
assert.equal(html(base({ tab: 'mine', ageGroup: 'adult' })).includes('태어난 해를 한 번만'), false);
}
main().then(() => { console.log('skill-store render checks passed'); process.exit(0); }, e => { console.error(e); process.exit(1); });
