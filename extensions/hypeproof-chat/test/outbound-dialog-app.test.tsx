// CGP-KNOW-D-006 — the real App wires the host's outboundPrompt to the in-panel dialog: the message mounts
// OutboundDialog, 보내기 / 취소 post the bound outboundAnswer, a new prompt replaces the old one, and prompt:null clears it.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../webview-ui/src/App';
import { outboundPrompt } from '../src/outboundApproval';
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
const act = (React as any).act;
const prompt = (id: string) => outboundPrompt(id, { recipient: '갤러리 · site.invalid', items: [{ name: 'index.html', bytes: 1200 }],
  also: [{ recipient: '활동 기록 서버 · service.invalid', items: [{ name: 'events.jsonl', bytes: 30 }] }] })!;
const host: any = mountPoint(), root = createRoot(host);
const posted = () => (globalThis as any).__posted as any[];
const answers = () => posted().filter(m => m.type === 'outboundAnswer');
const hostMessage = (data: any) => act(async () => { (globalThis.window as any).dispatchEvent({ type: 'message', data, bubbles: false }); });
const dialog = () => host.querySelector('.hps-outbound');
async function toggle(el: any) { el.type = 'checkbox'; el.checked = !el.checked; await act(async () => click(el)); }
async function main() {
  await act(async () => root.render(<App />));
  assert.equal(dialog(), null, 'no dialog before the host asks');
  await hostMessage({ type: 'outboundPrompt', prompt: prompt('one') });
  assert.ok(dialog(), 'the actual App mounts the dialog from the host prompt');
  assert.ok(dialog().textContent.includes('갤러리 · site.invalid') && dialog().textContent.includes('1,200 바이트'));
  for (const box of dialog().querySelectorAll('input')) await toggle(box);
  await act(async () => click(dialog().querySelector('.hps-outbound-send')));
  assert.deepEqual(answers().at(-1), { type: 'outboundAnswer', id: 'one', selected: ['0:0', '1:0'] }, '보내기 posts the bound full answer');
  assert.equal(dialog(), null, 'the answered dialog closes');
  await hostMessage({ type: 'outboundPrompt', prompt: prompt('two') });
  await act(async () => click(dialog().querySelector('[data-outbound-cancel]')));
  assert.deepEqual(answers().at(-1), { type: 'outboundAnswer', id: 'two', selected: null }, '취소 posts a denial');
  await hostMessage({ type: 'outboundPrompt', prompt: prompt('three') });
  await hostMessage({ type: 'outboundPrompt', prompt: prompt('four') });
  assert.equal(host.querySelectorAll('.hps-outbound').length, 1, 'one dialog at a time');
  assert.ok(dialog().querySelectorAll('input').every((x: any) => !x.checked), 'a new prompt starts unchecked');
  const before = answers().length;
  await hostMessage({ type: 'outboundPrompt', prompt: null });
  assert.equal(dialog(), null, 'host dismissal removes the dialog');
  assert.equal(answers().length, before, 'a host dismissal posts no answer');
  await act(async () => root.unmount());
  console.log('PASS outbound dialog in App: host prompt mounts it, answers post outboundAnswer, prompt:null clears it');
}
void main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
