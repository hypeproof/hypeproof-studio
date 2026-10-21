// CGP-KNOW-D-006 — the in-panel outbound dialog: recipient, unchecked checklist with sizes, fixed exclusion box,
// 보내기 disabled until every item is checked, 취소 focused first, Escape/cancel/IME handling, focus return, one answer.
import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OutboundDialog } from '../webview-ui/src/OutboundDialog';
import { outboundPrompt } from '../src/outboundApproval';
for (const name of ['Node', 'Element']) (globalThis as any)[name] ??= (globalThis.window as any)[name];
(globalThis as any).HTMLElement ??= (globalThis.window as any).Element;
const act = (React as any).act;
const prompt = outboundPrompt('r1', { recipient: '갤러리 · site.invalid', public: true, items: [{ name: '내 페이지.html', bytes: 1200 }],
  also: [{ recipient: '활동 기록 서버 · service.invalid', items: [{ name: 'events\u202e.jsonl', bytes: 30 }, { name: 'AI 기억/메모.md', bytes: 7, memory: true }] }] })!;
const answers: any[] = [];
function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>열기</button>{open && <OutboundDialog prompt={prompt} onAnswer={(...a) => { answers.push(a); setOpen(false); }} />}</>; }
const host: any = mountPoint(), root = createRoot(host);
const fire = (el: any, type: string, extra = {}) => { const e: any = { type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; }, ...extra }; el.dispatchEvent(e); return e; };
const press = async (el: any) => { el.focus(); await act(async () => click(el)); };
const key = async (el: any, k: string, extra = {}) => { let e: any; await act(async () => { e = fire(el, 'keydown', { key: k, keyCode: k === 'Escape' ? 27 : k === 'Tab' ? 9 : 13, ...extra }); }); return e; };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 5)); });
// mini-dom omits the checkbox default action; supply it before the click.
async function toggle(el: any) { el.type = 'checkbox'; el.checked = !el.checked; await act(async () => click(el)); }
async function main() {
  await act(async () => root.render(<Harness />));
  const opener = host.querySelector('button');
  await press(opener); await settle();
  let modal = host.querySelector('dialog');
  assert.ok(modal.open);
  const text = modal.textContent;
  for (const needle of ['보내기 전 확인', '갤러리 · site.invalid', '누구나 볼 수 있어요', '활동 기록 서버 · service.invalid', '1,200 바이트', '30 바이트', '포함하지 않는 것', 'AI 기억', '개인 메모', '내가 직접 고름']) assert.ok(text.includes(needle), needle);
  assert.ok(text.includes('events\\ufffd.jsonl'), 'bidi shown visibly'); assert.ok(!text.includes('\u202e'));
  assert.ok(modal.querySelector('.hps-outbound-excluded'), 'fixed exclusion box');
  let inputs = modal.querySelectorAll('input'), buttons = modal.querySelector('.hps-outbound-actions').querySelectorAll('button');
  assert.equal(inputs.length, 3); assert.ok(inputs.every((x: any) => !x.checked), 'nothing preselected');
  // CGP-KNOW-D-033 / DES-KNOW-51: the memory item sits only in a collapsed, unchecked "기억 파일 (기본 제외)" group.
  let groups = modal.querySelectorAll('details');
  assert.equal(groups.length, 1, 'one memory group: the section without memory gets none');
  assert.ok(groups[0].hasAttribute('data-outbound-memory') && !groups[0].hasAttribute('open'), 'memory group starts collapsed');
  assert.equal(groups[0].querySelector('summary').textContent, '기억 파일 (기본 제외) · 1개');
  assert.deepEqual(groups[0].querySelectorAll('input'), [inputs[2]], 'exactly the memory item, once, inside the group');
  assert.ok(groups[0].textContent.includes('AI 기억/메모.md') && groups[0].textContent.includes('내가 직접 고름'));
  for (const input of [inputs[0], inputs[1]]) { let n = input; while (n && n !== modal) { assert.notEqual(n.tagName, 'DETAILS', 'ordinary items stay outside the group'); n = n.parentNode; } }
  assert.equal(modal.querySelectorAll('fieldset')[1].querySelector('details'), groups[0], 'group belongs to its own recipient');
  assert.match(modal.querySelector('#outbound-hint').textContent, /기억 파일도 펼쳐서 확인해 주세요/);
  assert.equal(buttons[0].textContent, '취소'); assert.equal(buttons[1].textContent, '보내기');
  assert.ok(buttons[1].hasAttribute('disabled')); assert.ok(doc.activeElement === buttons[0], 'cancel focused first');
  assert.equal((await key(inputs[0], 'Enter')).defaultPrevented, true, 'Enter on a checkbox never submits');
  await toggle(inputs[0]); await toggle(inputs[1]); assert.ok(buttons[1].hasAttribute('disabled'), 'partial selection cannot send');
  assert.match(modal.querySelector('#outbound-hint').textContent, /기억 파일도/, 'memory still unchecked');
  await toggle(inputs[2]); assert.ok(!buttons[1].hasAttribute('disabled'), 'all items enable send');
  await toggle(inputs[2]); assert.ok(buttons[1].hasAttribute('disabled'), 'unchecking disables again'); await toggle(inputs[2]);
  await act(async () => fire(inputs[1], 'compositionstart'));
  await key(inputs[1], 'Escape', { keyCode: 27 }); assert.ok(host.querySelector('dialog'), 'Escape during IME ignored');
  await act(async () => fire(inputs[1], 'compositionend'));
  await key(inputs[1], 'Escape', { isComposing: true, keyCode: 229 }); assert.ok(host.querySelector('dialog'));
  await press(buttons[1]); await settle();
  assert.deepEqual(answers, [['r1', ['0:0', '1:0', '1:1']]]); assert.ok(doc.activeElement === opener, 'focus returns to the opener');
  await press(opener); await settle(); modal = host.querySelector('dialog');
  assert.ok(modal.querySelectorAll('input').every((x: any) => !x.checked), 'consent is never remembered');
  assert.ok(!modal.querySelector('details').hasAttribute('open'), 'reopening collapses the memory group again');
  await key(modal, 'Escape'); await settle(); assert.deepEqual(answers[1], ['r1', null]); assert.ok(doc.activeElement === opener);
  await press(opener); await settle(); await press(host.querySelector('[data-outbound-cancel]')); await settle(); assert.deepEqual(answers[2], ['r1', null]);
  await act(async () => root.unmount());
  const onceHost: any = mountPoint(), onceRoot = createRoot(onceHost), once: any[] = [];
  await act(async () => onceRoot.render(<OutboundDialog textSize="xlarge" prompt={prompt} onAnswer={(...a) => once.push(a)} />));
  const onceDialog = onceHost.querySelector('dialog');
  assert.equal(onceDialog.style['--hp-font-caption'], 'calc(14px + 4px)');
  await act(async () => fire(onceDialog, 'compositionstart')); await act(async () => fire(onceDialog, 'cancel')); assert.equal(once.length, 0, 'native cancel ignored during IME');
  await act(async () => fire(onceDialog, 'compositionend')); await act(async () => fire(onceDialog, 'cancel')); assert.deepEqual(once, [['r1', null]]);
  await press(onceHost.querySelector('[data-outbound-cancel]')); assert.equal(once.length, 1, 'answers once');
  await act(async () => onceRoot.unmount());
  // DES-KNOW-51 empty state: no memory item → one collapsed group in the first section that says so, holding no checkbox.
  const plain = outboundPrompt('r2', { recipient: '도움 요청 · service.invalid', items: [{ name: '질문', bytes: 12 }], also: [{ recipient: '기록 · service.invalid', items: [{ name: 'turn.json', bytes: 3 }] }] })!;
  const plainHost: any = mountPoint(), plainRoot = createRoot(plainHost), plainAnswers: any[] = [];
  await act(async () => plainRoot.render(<OutboundDialog prompt={plain} onAnswer={(...a) => plainAnswers.push(a)} />));
  const plainDialog = plainHost.querySelector('dialog'), plainGroups = plainDialog.querySelectorAll('details');
  assert.equal(plainGroups.length, 1); assert.equal(plainDialog.querySelectorAll('fieldset')[0].querySelector('details'), plainGroups[0]);
  assert.ok(!plainGroups[0].hasAttribute('open')); assert.equal(plainGroups[0].querySelector('summary').textContent, '기억 파일 (기본 제외)');
  assert.ok(plainGroups[0].textContent.includes('이 전송에는 기억 파일이 없어요.')); assert.equal(plainGroups[0].querySelectorAll('input').length, 0);
  assert.ok(!plainDialog.querySelector('#outbound-hint').textContent.includes('기억 파일'), 'no memory hint without memory');
  for (const input of plainDialog.querySelectorAll('input')) await toggle(input);
  await press(plainDialog.querySelector('.hps-outbound-send')); assert.deepEqual(plainAnswers, [['r2', ['0:0', '1:0']]], 'the empty group adds nothing to the payload');
  await act(async () => plainRoot.unmount());
  // Two recipients with memory: each keeps its own group and count; send still needs every box.
  const two = outboundPrompt('r3', { recipient: 'A · a.invalid', items: [{ name: 'page.html', bytes: 1 }, { name: 'wiki/index.md', bytes: 2, memory: true }, { name: 'wiki/log.md', bytes: 3, memory: true }], also: [{ recipient: 'B · b.invalid', items: [{ name: 'notes/a.md', bytes: 4, memory: true }] }] })!;
  const twoHost: any = mountPoint(), twoRoot = createRoot(twoHost), twoAnswers: any[] = [];
  await act(async () => twoRoot.render(<OutboundDialog prompt={two} onAnswer={(...a) => twoAnswers.push(a)} />));
  const twoDialog = twoHost.querySelector('dialog'), twoGroups = twoDialog.querySelectorAll('details');
  assert.deepEqual(twoGroups.map((g: any) => g.querySelector('summary').textContent), ['기억 파일 (기본 제외) · 2개', '기억 파일 (기본 제외) · 1개']);
  assert.deepEqual(twoGroups.map((g: any) => g.querySelectorAll('input').length), [2, 1]);
  const twoInputs = twoDialog.querySelectorAll('input'); assert.equal(twoInputs.length, 4);
  await toggle(twoInputs[0]); await toggle(twoInputs[1]); await toggle(twoInputs[2]);
  assert.ok(twoDialog.querySelector('.hps-outbound-send').hasAttribute('disabled'), 'an unchecked memory item in another group blocks send');
  await toggle(twoInputs[3]); await press(twoDialog.querySelector('.hps-outbound-send'));
  assert.deepEqual(twoAnswers, [['r3', ['0:0', '0:1', '0:2', '1:0']]]);
  await act(async () => twoRoot.unmount());
  console.log('PASS outbound dialog memory group (DES-KNOW-51): collapsed, unchecked, per recipient, counted, empty state, full-set send');
  console.log('PASS outbound dialog: recipient, unchecked checklist, sizes, exclusion box, full-set gating, focus, Escape, IME, single answer');
}
void main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
