// #4193 — trial mode is gone from what people see. The real StartPage is rendered (JSDOM) through
// every branch a current build can reach, and the rendered text plus every attribute a person or a
// screen reader gets (aria-label, title, placeholder, …) must not say 체험. A guard over rendered
// output, not a grep of source: copy assembled at run time (activityLabel, trialEndedFacts, row
// labels) is caught too.
//
// Positive control: a profile whose own name says 체험 is caught, so the checker can fail.
// Also pinned here: there is no trial-code choice, the chooser offers a free-start re-check when the
// host says free start could not be confirmed, and a code typed into the class form is posted exactly
// as before (no `joinClass`), whatever kind of code it is.
import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createRoot } from 'react-dom/client';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.invalid' });
const posted: any[] = [];
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
(window as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m), getState: () => undefined, setState: () => {} });

const ATTRS = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'data-hp-tooltip'];
/** Everything the page says: text, and the attributes read aloud or shown on hover. */
function said(): string {
  const parts = [document.body.textContent ?? ''];
  for (const el of document.body.querySelectorAll('*')) for (const a of ATTRS) { const v = el.getAttribute(a); if (v) parts.push(v); }
  return parts.join('\n');
}
const trialWords = (text: string) => text.split('\n').filter(l => l.includes('체험'));

async function main() {
  const { StartPage } = await import('../webview-ui/src/StartPage');
  const root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<StartPage />));
  const update = async (state: any) => act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'startState', state: { checking: false, version: 'test', ...state } } })); });
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.replace(/→/g, '').trim() === text);
  const clickText = async (text: string) => { const b = button(text); assert(b, `button ${text}`); await act(async () => b!.click()); };
  const checked: string[] = [];
  const guard = (what: string) => { const hits = trialWords(said()); assert.deepEqual(hits, [], `${what} must not say 체험`); checked.push(what); };

  const now = Date.now();
  const later = new Date(now + 3_600_000).toISOString();
  const fresh = { state: 'active', ends_at: later, request_limit: 40, requests_used: 0 };
  const near = { state: 'active', ends_at: later, request_limit: 40, requests_used: 37 };
  const spent = { state: 'exhausted', ends_at: later, request_limit: 40, requests_used: 40 };
  const over = { state: 'expired', ends_at: new Date(now - 60_000).toISOString(), request_limit: 40, requests_used: 4 };
  const seat = (extra: any = {}) => ({ id: 'studio-native-trial', name: '합성 활동', coach: '코치', series: '1 / 1', workspace: '~/Synthetic', kind: 'trial', ...extra });
  const saved = [
    { ref: 'r1', name: '코드로 받은 활동', kind: 'trial', workspace: '/tmp/a' },
    { ref: 'r2', name: '무료 활동', kind: 'trial', free: true, workspace: '/tmp/b' },
    { ref: 'r3', name: '수업 활동', kind: 'classroom', workspace: '/tmp/c' },
    { ref: 'r4', name: '계정 활동', kind: 'personal', workspace: '/tmp/d' },
  ];

  // ── Positive control: the checker catches a 체험 the page really shows ──────────────────────
  await update({ profile: seat({ name: '합성 체험' }) });
  assert.ok(trialWords(said()).length > 0, 'control: a profile named 체험 is caught');

  // ── The chooser without the free card: no trial-code choice, a re-check, class entry kept ─────
  for (const check of [undefined, 'checking', 'unavailable'] as const) {
    await update({ ...(check ? { freeStartCheck: check } : {}), activities: saved });
    assert.equal(button('AI 체험하기'), undefined, 'no trial-code choice');
    assert(button('수업에 참여하기'), 'class code entry is kept');
    assert.equal(!!document.querySelector('[data-testid="free-start-check"]'), !!check, `re-check shown only when the host asks (${check})`);
    guard(`chooser (${check ?? 'switched off'})`);
  }
  await update({ freeStartCheck: 'checking' });
  assert.equal(button('확인하는 중…')?.disabled, true, 'a re-check in flight cannot be pressed again');
  await update({ freeStartCheck: 'unavailable' });
  await clickText('무료 시작 다시 확인');
  assert.deepEqual(posted.at(-1), { type: 'freeStartRecheck' });
  // An account is on: its entry sits beside the class entry, still no 체험.
  await update({ freeStartCheck: 'unavailable', account: { status: 'signedOut' } });
  guard('chooser with account entry');

  // ── The class form: unchanged, and any issued code goes through it as before ───────────────────
  await update({ freeStartCheck: 'unavailable' });
  await clickText('수업에 참여하기');
  assert.equal(document.querySelector('label[for="course-code"]')?.textContent, '수업 참여 코드');
  guard('class code form');
  const input = document.getElementById('course-code') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'synthetic-issued-code');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.deepEqual(posted.at(-1), { type: 'connectCourse', token: 'synthetic-issued-code' }, 'the code is posted as before, with no class attached');
  // The Service answers with a code-issued trial seat: the candidate card says 개인 작업.
  await update({ profile: seat({ trial: fresh }), candidate: true });
  assert.equal(document.querySelector('.studio-verified')?.textContent, '개인 작업');
  assert.ok(button('이 활동 시작하기'), 'the issued code can still be started');
  guard('candidate: code-issued trial seat');

  // ── Connected and ended cards of a seat that is not free ───────────────────────────────────────
  for (const [what, trial] of [['fresh', fresh], ['near limit', near], ['exhausted', spent], ['expired', over]] as const) {
    await update({ profile: seat({ trial }), activities: saved });
    guard(`connected code seat (${what})`);
    await update({ profile: seat({ trial }), candidate: true });
    guard(`candidate code seat (${what})`);
  }
  await update({ profile: seat({ trial: spent }) });
  assert.equal(document.getElementById('connect-title')?.textContent, '사용이 끝났습니다');
  assert.ok(document.querySelector('[role="group"][aria-label="사용이 끝난 뒤 고르기"]'), 'the ended choices are named without 체험');
  // Free seats and account seats, for completeness (their copy already said 무료 사용 / 개인 작업).
  for (const trial of [fresh, spent, over]) { await update({ profile: seat({ id: 'studio-open-trial', free: true, trial }) }); guard('free seat'); }
  await update({ profile: seat({ kind: 'personal' }) }); guard('personal seat');
  await update({ profile: seat({ kind: 'classroom' }) }); guard('classroom seat');
  // The saved list labels older trial records 개인 작업, and free ones 무료 사용.
  await update({ activities: saved });
  const savedLabels = [...document.querySelectorAll('.studio-saved-activity-name')].map(e => e.textContent);
  assert.deepEqual(savedLabels, ['개인 작업 · 코드로 받은 활동', '무료 사용 · 무료 활동', '수업 · 수업 활동', '개인 작업 · 계정 활동']);

  // ── The free card (the way in today), for completeness ────────────────────────────────────────
  await update({ freeStart: {}, activities: saved });
  guard('free card');
  await update({ freeStart: { age: '14+' } });
  guard('free card, age answered');

  await act(async () => root.unmount()); dom.window.close();
  console.log(`PASS: no 체험 on ${checked.length} start-page renders; no trial-code choice; class entry and issued codes unchanged`);
}
main().then(() => process.exit(0), e => { console.error(e); dom.window.close(); process.exit(1); });
