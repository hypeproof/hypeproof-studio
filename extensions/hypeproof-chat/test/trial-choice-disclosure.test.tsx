// TC-0069 (REQ-0065) — the start page's "AI 체험하기" choice shows the code requirement and the
// advertised allowance BEFORE the choice is clicked, and the button points at the note through
// aria-describedby. Driven through the rendered StartPage and the host's startState message.
import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createRoot } from 'react-dom/client';
import { parseTrialOffer } from '../src/trialOffer';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.invalid' });
const posted: any[] = [];
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
(window as any).acquireVsCodeApi = () => ({ postMessage: (m: any) => posted.push(m), getState: () => undefined, setState: () => {} });

const CODE_LINE = '지금은 발급받은 체험 코드가 있어야 시작할 수 있습니다.';

async function main() {
  const { StartPage } = await import('../webview-ui/src/StartPage');
  const root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<StartPage />));
  const base = { checking: false, version: 'test' };
  const update = async (state: any) => act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'startState', state } })); });
  const trialButton = () => [...document.querySelectorAll('button')].find(b => b.textContent?.replace(/→/g, '').trim() === 'AI 체험하기')!;
  const noteOf = () => {
    const b = trialButton();
    const id = b.getAttribute('aria-describedby');
    assert.ok(id, 'the choice names its note');
    const n = document.getElementById(id!);
    assert.ok(n, 'the described element exists');
    return n!.textContent ?? '';
  };

  // The offer answers late: before it arrives the code line is already readable.
  await update(base);
  assert.ok(trialButton(), 'the choice is on screen');
  assert.ok(noteOf().includes(CODE_LINE), 'code line before any offer');
  assert.ok(!noteOf().includes('AI 요청'), 'no allowance without an offer');

  // The offer arrives with both numbers: the allowance appears in the same note, still unclicked.
  await update({ ...base, trialOffer: parseTrialOffer({ entry: 'code', duration_hours: 48, request_limit: 50 }) });
  assert.ok(noteOf().includes(CODE_LINE));
  assert.ok(noteOf().includes('체험 2일 · AI 요청 50번'), noteOf());
  assert.equal(posted.filter(m => m.type === 'chooseTrial').length, 0);

  // 1.5 h and 1000 requests.
  await update({ ...base, trialOffer: parseTrialOffer({ entry: 'code', duration_hours: 1.5, request_limit: 1000 }) });
  assert.ok(noteOf().includes('체험 1시간 30분 · AI 요청 1,000번'), noteOf());

  // Only one number, or a zero count: code line stays, allowance is omitted.
  await update({ ...base, trialOffer: parseTrialOffer({ entry: 'code', duration_hours: 48 }) });
  assert.ok(noteOf().includes(CODE_LINE)); assert.ok(!noteOf().includes('AI 요청'));
  await update({ ...base, trialOffer: parseTrialOffer({ entry: 'code', duration_hours: 48, request_limit: 0 }) });
  assert.ok(noteOf().includes(CODE_LINE)); assert.ok(!noteOf().includes('AI 요청'));

  // Existing path: a learner with a code chooses it, reaches the code form, and comes back.
  await update({ ...base, trialOffer: parseTrialOffer({ entry: 'code', duration_hours: 48, request_limit: 50 }) });
  await act(async () => trialButton().click());
  assert.ok(document.getElementById('course-code'), 'code form opens');
  const back = [...document.querySelectorAll('button')].find(b => b.textContent === '시작 방법 다시 선택')!;
  await act(async () => back.click());
  assert.ok(noteOf().includes(CODE_LINE) && noteOf().includes('체험 2일 · AI 요청 50번'), 'note is back after re-choosing');

  await act(async () => root.unmount()); dom.window.close();
  console.log('PASS test_tc_0069_start_page_shows_code_line_and_allowance_before_choice');
}
main().then(() => process.exit(0), e => { console.error(e); dom.window.close(); process.exit(1); });
