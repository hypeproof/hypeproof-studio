// #4464(a) — the rejection line above the input area. Drawn only on the rehearsal seat and only in the error state.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { RehearsalRejectLine } from '../webview-ui/src/ChatPanel';
const act = (React as any).act;
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;

const SENTENCE = '아직 AI에게 한 번도 묻지 않았습니다. 단계마다 한 번 이상 물어본 뒤 보내세요.';

async function render(props: any) {
  const host = mountPoint(); const root = createRoot(host as any);
  await act(async () => root.render(<RehearsalRejectLine {...props} />));
  return host;
}

async function main() {
  // Positive: seat + error → the sentence is drawn as an alert, with a close button.
  let closes = 0;
  const seat = await render({ seat: true, result: { state: 'error', message: SENTENCE }, onClose: () => { closes++; } });
  assert.ok(seat.textContent.includes(SENTENCE), 'the sentence is drawn on the rehearsal seat');
  const alert = seat.findAll((e: any) => e.getAttribute?.('role') === 'alert')[0];
  assert.ok(alert, 'the line is an alert region');
  const close = seat.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').includes('닫기'))[0];
  assert.ok(close, 'a close button is drawn');
  await act(async () => click(close));
  assert.equal(closes, 1, 'the close button calls onClose once');

  // Control: not a rehearsal seat → nothing, even in the error state.
  const notSeat = await render({ seat: false, result: { state: 'error', message: SENTENCE }, onClose: () => undefined });
  assert.equal(notSeat.textContent.includes(SENTENCE), false, 'no line outside the rehearsal seat');

  // Control: seat, but sending or sent → nothing.
  const sending = await render({ seat: true, result: { state: 'sending' }, onClose: () => undefined });
  assert.equal(sending.textContent.includes(SENTENCE), false, 'no line while sending');
  const sent = await render({ seat: true, result: { state: 'sent', verdict: 'passed', reasons: [] }, onClose: () => undefined });
  assert.equal(sent.textContent.includes(SENTENCE), false, 'no line on a sent result');

  // Control: no result at all → nothing.
  const none = await render({ seat: true, result: null, onClose: () => undefined });
  assert.equal(none.textContent.trim(), '', 'nothing without a result');
  console.log('rehearsal-report-reject render checks passed');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
