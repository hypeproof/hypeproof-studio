// E5 (#3776): a question card in the learner inbox, with real React events.
// Designed behavior: the question is drawn as text; choosing or typing sends nothing; 제출 sends the chosen answer once,
// 건너뛰기 is always there; "답변을 보냈습니다" appears only when the host says the Service recorded it, with 답 바꾸기.
import { click, mountPoint, document } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { InstructorInbox } from '../webview-ui/src/InstructorInbox';
import type { InboxCard, InboxView } from '../src/classroomInbox';

const act = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
// mini-dom has no `type` property; React reads it to route a radio's click to onChange.
const proto = Object.getPrototypeOf(mountPoint());
if (!('type' in proto)) Object.defineProperty(proto, 'type', { get() { return this.getAttribute('type') ?? 'text'; }, set(v) { this.setAttribute('type', v); } });
const fire = (target: any, type: string, extra: any = {}) => { const e = { type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }; target.dispatchEvent(e); return e; };
const base: InboxCard = { object_id: 'q-0000000001', kind: 'question', title: '확인 질문', body: '<b>지금</b> 잘 되나요?', links: [], revision: 1, received_at: 0, is_new: false, withdrawn: false, unreadable: false, content_hash: 'a'.repeat(64) };
const view = (card: Partial<InboxCard>): InboxView => ({ run: 'run', student: 'kim', generation: 4, ended: false, offline: false, cards: [{ ...base, ...card }], unread: 0 });
const button = (host: any, label: string) => host.findAll((e: any) => e.tagName === 'BUTTON' && e.textContent === label)[0];

async function main() {
  const host = mountPoint() as any, root = createRoot(host), posted: any[] = [];
  const render = (card: Partial<InboxCard>) => act(async () => root.render(<InstructorInbox inbox={view(card)} post={(m) => posted.push(m)} />));

  // choice
  await render({ question: { type: 'choice', options: ['잘 된다', '막혔다'] }, answer: { sent: null } });
  assert.ok(host.textContent.includes('<b>지금</b> 잘 되나요?'), 'the question is drawn as the characters typed');
  assert.equal(host.findAll((e: any) => e.localName === 'b').length, 0);
  const radios = host.findAll((e: any) => e.localName === 'input' && e.getAttribute('type') === 'radio');
  assert.equal(radios.length, 2);
  assert.ok(button(host, '제출').hasAttribute('disabled'), 'nothing chosen, nothing to submit');
  assert.ok(button(host, '건너뛰기') && !button(host, '건너뛰기').hasAttribute('disabled'), 'skipping is always offered');
  await act(async () => { radios[1].checked = true; click(radios[1]); });
  assert.equal(posted.length, 0, 'choosing sends nothing');
  assert.ok(!button(host, '제출').hasAttribute('disabled'));
  await act(async () => { click(button(host, '제출')); });
  assert.deepEqual(posted, [{ type: 'inboxAnswer', objectId: base.object_id, revision: 1, generation: 4, answer: { choice: 1 } }]);
  assert.ok(!host.textContent.includes('답변을 보냈습니다'), 'pressing is not the Service recording it');

  await render({ question: { type: 'choice', options: ['잘 된다', '막혔다'] }, answer: { sent: null }, answer_busy: true });
  assert.ok(button(host, '제출').hasAttribute('disabled') && button(host, '건너뛰기').hasAttribute('disabled'), 'no second press while one is in flight');

  await render({ question: { type: 'choice', options: ['잘 된다', '막혔다'] }, answer: { sent: null }, answer_note: '동의하지 않아 답을 보내지 않았습니다.' });
  assert.ok(host.textContent.includes('동의하지 않아 답을 보내지 않았습니다.') && !host.textContent.includes('답변을 보냈습니다'));

  await render({ question: { type: 'choice', options: ['잘 된다', '막혔다'] }, answer: { sent: { choice: 1 } } });
  assert.ok(host.textContent.includes('답변을 보냈습니다') && host.textContent.includes('막혔다'));
  assert.equal(button(host, '제출'), undefined, 'the form is closed after a confirmed answer');
  await act(async () => { click(button(host, '답 바꾸기')); });
  assert.ok(button(host, '제출'), '답 바꾸기 opens the form again');
  assert.equal(posted.length, 1, 'opening it sends nothing');
  await act(async () => { click(button(host, '건너뛰기')); });
  assert.deepEqual(posted.at(-1).answer, { skipped: true });

  // text
  await render({ object_id: 'q-0000000002', question: { type: 'text' }, answer: { sent: null } });
  const area = () => host.findAll((e: any) => e.localName === 'textarea')[0];
  assert.equal(area().getAttribute('maxLength') ?? area().getAttribute('maxlength'), '500');
  await act(async () => { area().value = '   '; fire(area(), 'input', { data: ' ' }); });
  assert.ok(button(host, '제출').hasAttribute('disabled'), 'blank is not an answer');
  await act(async () => { area().value = '변수 이름이 헷갈려요'; fire(area(), 'input', { data: '요' }); });
  assert.equal(posted.length, 2, 'typing sends nothing');
  await act(async () => { click(button(host, '제출')); });
  assert.deepEqual(posted.at(-1), { type: 'inboxAnswer', objectId: 'q-0000000002', revision: 1, generation: 4, answer: { text: '변수 이름이 헷갈려요' } });

  // withdrawn: the card says so and offers nothing to answer
  await render({ withdrawn: true, question: undefined, answer: undefined });
  assert.equal(button(host, '제출'), undefined); assert.ok(host.textContent.includes('강사가 회수한 자료입니다'));

  await act(async () => root.unmount()); document.body.removeChild(host);
  console.log('PASS inbox question card: text as text, no send on choose/type, submit/skip once, sent only when confirmed, change, withdrawn');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
