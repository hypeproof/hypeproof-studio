// #3221 part 2 — an HTML page the AI made or changed in the work folder gets 'PDF로 저장' in the AI가 한 일 list, so the
// person makes a PDF with Studio's own browser instead of the coach running another app's program.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import { TaskActivity } from '../webview-ui/src/TaskActivity';

async function main() {
  const act = (React as unknown as { act: (fn: () => void | Promise<void>) => Promise<void> }).act;
  const summary = {
    read: [{ target: 'notes.html', inside: true }], web: [], search: [],
    created: [{ target: 'report-src.htm', inside: true }, { target: 'style.css', inside: true }, { target: 'elsewhere.html', inside: false }],
    changed: [{ target: 'index.html', inside: true }],
  } as any;
  const target = mountPoint(); const root = createRoot(target); const saved: string[] = [];
  await act(() => root.render(<TaskActivity summary={summary} reviewPaths={new Set()} onShowReview={() => {}} onSavePdf={(p) => saved.push(p)} />));
  const chip = (verb: string) => target.querySelector(`.hps-task-activity-chip[data-verb="${verb}"]`)!;
  const pdfButtons = () => [...target.querySelectorAll('button')].filter((b) => b.textContent === 'PDF로 저장');
  await act(() => click(chip('created')));
  assert.equal(pdfButtons().length, 1, 'only the HTML page inside the work folder (not the CSS file, not an outside page)');
  assert.equal(pdfButtons()[0].getAttribute('aria-label'), 'report-src.htm PDF로 저장');
  await act(() => click(pdfButtons()[0]));
  assert.deepEqual(saved, ['report-src.htm']);
  await act(() => click(chip('changed')));
  assert.equal(pdfButtons().length, 1); await act(() => click(pdfButtons()[0])); assert.deepEqual(saved, ['report-src.htm', 'index.html']);
  await act(() => click(chip('read')));
  assert.equal(pdfButtons().length, 0, 'a page the AI only read gets no PDF button');
  // Without the handler (e.g. an older host) no button is drawn.
  await act(() => root.render(<TaskActivity summary={summary} reviewPaths={new Set()} onShowReview={() => {}} />));
  await act(() => click(chip('created')));
  assert.equal(pdfButtons().length, 0);
  await act(() => root.unmount());
  console.log('task-activity-pdf: PASS');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
