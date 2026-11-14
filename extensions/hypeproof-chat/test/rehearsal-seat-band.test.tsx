// #4048 (chalk#17) — the student-panel band in a rehearsal seat. It shows "리허설 중" and "끝내고 돌아가기" only when the
// host sent the rehearsal signal; the button asks the host once. Without the signal nothing is drawn.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { RehearsalSeatBand } from '../webview-ui/src/ChatPanel';
const act = (React as any).act;
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;

async function main() {
  // Control first: no signal → no band at all.
  const off = mountPoint(); const offRoot = createRoot(off as any);
  await act(async () => offRoot.render(<RehearsalSeatBand visible={false} onEnd={() => undefined} />));
  assert.equal(off.textContent.includes('리허설 중'), false, 'no band without the signal');
  assert.equal(off.textContent.includes('끝내고 돌아가기'), false, 'no button without the signal');

  // With the signal: the band text and the button are shown, and the button calls onEnd once.
  let ends = 0;
  const host = mountPoint(); const root = createRoot(host as any);
  await act(async () => root.render(<RehearsalSeatBand visible onEnd={() => { ends++; }} />));
  assert.ok(host.textContent.includes('리허설 중'), 'the band text is shown');
  const button = host.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').includes('끝내고 돌아가기'))[0];
  assert.ok(button, 'the band button is shown');
  await act(async () => click(button));
  assert.equal(ends, 1, 'the button calls onEnd once');
  console.log('rehearsal-seat-band render checks passed');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
