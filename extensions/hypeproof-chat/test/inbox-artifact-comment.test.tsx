// CGP-ART-R-005 / CGP-ART-D-005: instructor comments in the learner inbox, with real React events.
// Designed behavior: comments are drawn apart from notices, grouped 열린 의견 / 확인한 의견; the instructor's text is
// drawn as the characters typed (no markup, no live link); the pin sits where the anchor says and the place is also said
// in words; "이전 판에 남긴 의견" shows when the page changed; the unread state is announced in a polite live region;
// only 답글 보내기 / 확인했어요 / 다시 열기 send, and only inboxAnswer/inboxOpen ever leave this component.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { InstructorInbox } from '../webview-ui/src/InstructorInbox';
import type { InboxCard, InboxView } from '../src/classroomInbox';

const act = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const fire = (target: any, type: string, extra: any = {}) => { const e = { type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }; target.dispatchEvent(e); return e; };
const SHA = 'a'.repeat(64);
const comment: InboxCard = { object_id: 'c-0000000001', kind: 'comment', title: '강사 의견', body: '<b>제목</b> 색이 좋아요. https://example.com 참고', links: [], revision: 1, received_at: 0, is_new: true, withdrawn: false, unreadable: false, content_hash: 'e'.repeat(64), anchor: { artifact_sha256: SHA, rect: { x: 0, y: 0, w: 333, h: 333 } }, version: 'current', answer: { sent: null } };
const notice: InboxCard = { object_id: 'n-0000000001', kind: 'notice', title: '공지', body: '쉬는 시간', links: [], revision: 1, received_at: 0, is_new: false, withdrawn: false, unreadable: false, content_hash: 'f'.repeat(64) };
const view = (cards: InboxCard[], unread = 0): InboxView => ({ run: 'run', student: 'kim', generation: 7, ended: false, offline: false, cards, unread });
const button = (host: any, label: string) => host.findAll((e: any) => e.tagName === 'BUTTON' && e.textContent === label)[0];
const attr = (host: any, name: string) => host.findAll((e: any) => e.hasAttribute?.(name));

async function main() {
  const host = mountPoint() as any, root = createRoot(host), posted: any[] = [];
  const render = (cards: InboxCard[]) => act(async () => root.render(<InstructorInbox inbox={view(cards)} post={(m) => posted.push(m)} />));

  await render([comment, notice]);
  // Drawn apart from the notice list, and the notice list no longer counts the comment.
  assert.equal(attr(host, 'data-comments').length, 1);
  assert.ok(host.textContent.includes('강사가 보낸 공지·자료 1개'), host.textContent);
  assert.ok(host.textContent.includes('결과물에 남긴 강사 의견 1개'));
  // Text is text: the tag and the address stay characters; nothing is a link or bold.
  assert.ok(host.textContent.includes('<b>제목</b> 색이 좋아요. https://example.com 참고'));
  assert.equal(host.findAll((e: any) => e.localName === 'a' || e.localName === 'b').length, 0, 'no live link, no markup');
  // Actors apart (REQ-F8): the instructor's words are labelled 강사; no reply yet, so no 나.
  assert.ok(host.findAll((e: any) => e.getAttribute?.('class') === 'hp-comment-author' && e.textContent === '강사').length === 1);
  assert.equal(attr(host, 'data-comment-mine').length, 0);
  // Pin where the anchor says (centre of the top-left third), the place in words, the approved fingerprint.
  const pin = host.findAll((e: any) => e.getAttribute?.('class') === 'hp-comment-pin')[0];
  assert.ok(pin, 'a pin is drawn for a rectangle anchor');
  assert.deepEqual([pin.style.insetInlineStart, pin.style.insetBlockStart], ['17%', '17%'], 'logical inset, from the permille rectangle');
  assert.ok(host.textContent.includes('강사 의견 · 페이지 위쪽 왼쪽') && host.textContent.includes('승인한 판 지문 aaaaaaaa'));
  assert.equal(attr(host, 'data-comment-previous').length, 0, 'current version: no 이전 판 badge');
  // Unread: a word and a polite live region, not colour alone.
  const live = attr(host, 'data-comment-live')[0];
  assert.equal(live.getAttribute('aria-live'), 'polite'); assert.equal(live.getAttribute('role'), 'status');
  assert.ok(live.textContent.includes('새 의견 1개'));
  // Grouped: open 1, handled 0.
  const groups = attr(host, 'data-comment-group');
  assert.deepEqual(groups.map((g: any) => [g.getAttribute('data-comment-group'), g.getAttribute('aria-label')]), [['open', '열린 의견 1개'], ['handled', '확인한 의견 0개']]);
  assert.equal(posted.length, 0, 'drawing sends nothing');

  // Opening the list marks it seen (inboxOpen only).
  const details = attr(host, 'data-comments')[0];
  await act(async () => { details.setAttribute('open', ''); details.open = true; fire(details, 'toggle', { bubbles: false }); });
  assert.deepEqual(posted, [{ type: 'inboxOpen', objectId: comment.object_id, generation: 7 }]);
  posted.length = 0;

  // Typing sends nothing; 답글 보내기 sends {handled:false, reply}; empty reply cannot be sent.
  assert.ok(button(host, '답글 보내기').hasAttribute('disabled'));
  const area = host.findAll((e: any) => e.localName === 'textarea')[0];
  assert.equal(area.getAttribute('maxLength') ?? area.getAttribute('maxlength'), '500');
  await act(async () => { area.value = '버튼 색도 바꿔 볼게요'; fire(area, 'input', { data: '요' }); });
  assert.equal(posted.length, 0, 'typing sends nothing');
  await act(async () => { click(button(host, '답글 보내기')); });
  assert.deepEqual(posted, [{ type: 'inboxAnswer', objectId: comment.object_id, revision: 1, generation: 7, answer: { handled: false, reply: '버튼 색도 바꿔 볼게요' } }]);
  assert.ok(!host.textContent.includes('답글을 강사에게 보냈습니다'), 'a press is not the Service recording it');
  posted.length = 0;

  // Confirmed reply + handled: moves to 확인한 의견, shows 나 and 다시 열기, keeps the reply when reopening.
  await render([{ ...comment, is_new: false, answer: { sent: { handled: true, reply: '버튼 색도 바꿨어요' } } }]);
  assert.deepEqual(attr(host, 'data-comment-group').map((g: any) => g.getAttribute('aria-label')), ['열린 의견 0개', '확인한 의견 1개']);
  assert.ok(host.textContent.includes('나 (내가 보낸 답글)') && host.textContent.includes('버튼 색도 바꿨어요') && host.textContent.includes('확인했다고 강사에게 보냈습니다.'));
  assert.equal(attr(host, 'data-comment-live')[0].textContent, '', 'nothing new to announce');
  await act(async () => { click(button(host, '다시 열기')); });
  assert.deepEqual(posted, [{ type: 'inboxAnswer', objectId: comment.object_id, revision: 1, generation: 7, answer: { handled: false, reply: '버튼 색도 바꿨어요' } }]);
  posted.length = 0;

  // Previous version: badge in words. Element anchor: no pin, place in words.
  await render([{ ...comment, version: 'previous', anchor: { artifact_sha256: SHA, element: '첫 번째 제목' } }]);
  assert.equal(attr(host, 'data-comment-previous')[0].textContent, '이전 판에 남긴 의견');
  assert.equal(host.findAll((e: any) => e.getAttribute?.('class') === 'hp-comment-pin').length, 0);
  assert.ok(host.textContent.includes('‘첫 번째 제목’ 부분'));
  await act(async () => { click(button(host, '확인했어요')); });
  assert.deepEqual(posted.map((m) => m.answer), [{ handled: true }]);

  // A comment the host did not place (no version) is never drawn; a refusal note is shown as said.
  await render([{ ...comment, version: undefined }, notice]);
  assert.equal(attr(host, 'data-comments').length, 0);
  await render([{ ...comment, answer_note: '동의하지 않아 보내지 않았습니다.' }]);
  assert.ok(host.textContent.includes('동의하지 않아 보내지 않았습니다.'));
  assert.ok(posted.every((m) => m.type === 'inboxAnswer' || m.type === 'inboxOpen'), 'nothing but the two inbox messages ever leaves (no coach path)');
  await act(async () => root.unmount());
  console.log('PASS inbox artifact comment: apart from notices, text as text, pin + words, previous badge, polite unread, grouped, press-only sends');
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
