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
  assert.equal(buttons[0].textContent, '취소'); assert.equal(buttons[1].textContent, '보내기');
  assert.ok(buttons[1].hasAttribute('disabled')); assert.ok(doc.activeElement === buttons[0], 'cancel focused first');
  assert.equal((await key(inputs[0], 'Enter')).defaultPrevented, true, 'Enter on a checkbox never submits');
  await toggle(inputs[0]); await toggle(inputs[1]); assert.ok(buttons[1].hasAttribute('disabled'), 'partial selection cannot send');
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
  console.log('PASS outbound dialog: recipient, unchecked checklist, sizes, exclusion box, full-set gating, focus, Escape, IME, single answer');
}
void main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
