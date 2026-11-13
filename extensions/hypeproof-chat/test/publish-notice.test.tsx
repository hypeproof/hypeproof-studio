// CGP-ART-D-012: the notice sheet in the real PublishPanel. The host enforces the gate
// (test/publish-notice.smoke.mjs); this checks what the learner sees and what the panel sends.
import { mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { PublishPanel } from '../webview-ui/src/PublishPanel';
import { PUBLISH_NOTICE_LINES, PUBLISH_NOTICE_VERSION } from '../src/publishNotice';
import type { PublishForm, PublishView } from '../src/publishView';

const act = (React as any).act;
globalThis.setInterval = (() => 0) as any;
globalThis.clearInterval = (() => {}) as any;
const exp = { id: 'e1', product_version_id: 'v1', links: [], week: 1, question: '내 페이지', method: 'task_test', hypothesis: null, success_criteria: ['c'], status: 'running', current_version: true, sessions: null };
const base: PublishView = { available: true, reason: null, project: { id: 'p', title: '내 페이지' }, version: { id: 'v1', files: [], manifest_added: [], refusal: null, refusal_lines: [] }, verification: { state: 'not_verified', open: [] }, experiments: [exp], hypotheses: [], timing: null, notice: null };
const host = mountPoint() as any;
Object.defineProperty(Object.getPrototypeOf(host), "options", { configurable: true, get() { return this.querySelectorAll("option"); } });
const root = createRoot(host);
let submits: PublishForm[] = [], links: unknown[][] = [];
let view: PublishView = base;
const render = () => act(() => root.render(<PublishPanel view={view} error={null} errorLines={[]} shareUrl={null} busy={false} onManifest={() => {}} onSubmit={f => submits.push(f)} onLink={(...a) => links.push(a)} onRevoke={() => {}} onClose={() => {}} />));
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`);
// React routes input/radio events by `el.type`, which mini-dom leaves unset.
const fire = async (el: any, type: string, extra: Record<string, unknown> = {}) => act(() => { if (el.localName === 'input') el.type ??= el.getAttribute('type') ?? 'text'; el.dispatchEvent({ type, bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {}, ...extra }); });
const type = async (el: any, value: string) => { el.value = value; await fire(el, 'input'); await fire(el, 'change'); };
// mini-dom splits selectors on spaces, so a label with a space is matched here.
const labelled = (tag: string, label: string) => host.querySelectorAll(tag).find((e: any) => e.getAttribute('aria-label') === label);
const fill = async () => {
  await type(labelled('textarea', '가설'), '혼자 주문할 수 있다');
  await type(labelled('input', '질문'), '주문을 마치나?');
  await type(labelled('textarea', '성공 기준'), '3명 중 2명');
  await fire(q('publish-expiry-3'), 'click');
};

(async () => {
  // Not acknowledged: pressing publish opens the sheet and sends nothing.
  view = { ...base, publish_notice: { version: PUBLISH_NOTICE_VERSION, acknowledged: false } };
  await render(); await fill();
  assert.equal(q('publish-notice'), null, 'closed until the learner presses publish');
  assert.equal(q('publish-submit').hasAttribute('disabled'), false, 'form complete');
  await fire(q('publish-submit'), 'click');
  assert.ok(q('publish-notice'), 'the sheet opens');
  assert.deepEqual(submits, [], 'nothing sent before 알겠어요');
  assert.deepEqual(host.querySelectorAll('[data-testid="publish-notice-line"]').map((li: any) => li.textContent), [...PUBLISH_NOTICE_LINES]);
  assert.equal(q('publish-notice-ack').textContent, '알겠어요');
  assert.equal(q('publish-notice').getAttribute('role'), 'group');
  assert.ok(q('publish-notice').getAttribute('aria-labelledby'), 'named by its title');

  assert.ok(document.activeElement === q('publish-notice-ack'), 'focus moves to 알겠어요');

  // 취소 sends nothing, closes, and gives focus back to the publish button.
  await fire(q('publish-notice-cancel'), 'click');
  assert.equal(q('publish-notice'), null);
  assert.deepEqual(submits, []);
  assert.ok(document.activeElement === q('publish-submit'), 'focus returns to the opener');

  // Escape is 취소, but not while a Korean IME is composing.
  await fire(q('publish-submit'), 'click');
  await fire(q('publish-notice-ack'), 'keydown', { key: 'Escape', isComposing: true, keyCode: 229 });
  assert.ok(q('publish-notice'), 'Escape during composition keeps the sheet');
  await fire(q('publish-notice-ack'), 'keydown', { key: 'Escape' });
  assert.equal(q('publish-notice'), null, 'Escape closes');
  assert.deepEqual(submits, []);

  // 알겠어요 sends the form with the notice version, once.
  await fire(q('publish-submit'), 'click');
  await fire(q('publish-notice-ack'), 'click');
  assert.equal(submits.length, 1);
  assert.equal(submits[0].notice_version, PUBLISH_NOTICE_VERSION);
  assert.equal(submits[0].question, '주문을 마치나?');
  assert.equal(q('publish-notice'), null, 'the sheet closes');

  // Another link of a running experiment waits for the notice too.
  const more = host.querySelector('.hps-publish-more');
  await fire(more.querySelector('input[type="radio"]'), 'click');
  await fire(more.querySelector('button'), 'click');
  assert.deepEqual(links, [], 'nothing sent before 알겠어요');
  assert.ok(more.querySelector('[data-testid="publish-notice"]'), 'drawn beside the link button');
  await fire(q('publish-notice-ack'), 'click');
  assert.deepEqual(links, [['e1', '', 1, PUBLISH_NOTICE_VERSION]]);

  // Acknowledged: publish goes straight through, without a notice version.
  submits = []; links = [];
  view = { ...base, publish_notice: { version: PUBLISH_NOTICE_VERSION, acknowledged: true } };
  await render();
  await fire(q('publish-submit'), 'click');
  assert.equal(q('publish-notice'), null);
  assert.equal(submits.length, 1);
  assert.equal(submits[0].notice_version, undefined);

  // No notice state (not signed in): the panel sends and the host answers with its reason.
  submits = [];
  view = { ...base };
  await render();
  await fire(q('publish-submit'), 'click');
  assert.equal(q('publish-notice'), null);
  assert.equal(submits.length, 1);
  console.log('PASS publish-notice render: sheet, 취소, 알겠어요 (submit and another link), acknowledged, no notice state');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
