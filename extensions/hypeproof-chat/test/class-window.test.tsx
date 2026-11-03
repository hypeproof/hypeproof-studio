import { mountPoint, click, document } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { currentClassWindow, classWindowNotice } from '../src/classWindow';
import { ClassWindowNotice } from '../webview-ui/src/ClassWindowNotice';
async function main() {
const identity = { u: 'learner', c: 'cohort', p: 'lesson' };
let now = 1800000000000;
const connection = { class_run_id: 'run-a', student: identity, run: { starts_at: now - 3600000, ends_at: now + 600001 } };
const known = currentClassWindow(connection, identity, true)!;
assert.ok(known);
known.noticeId = "notice-a";
for (const key of ['u', 'c', 'p']) assert.equal(currentClassWindow(connection, { ...identity, [key]: 'other' }, true), null);
for (const c of [null, { ...connection, student: undefined }, { ...connection, run: undefined }, { ...connection, run: { starts_at: now, ends_at: NaN } }, { ...connection, run: { starts_at: now, ends_at: now } }]) assert.equal(currentClassWindow(c, identity, true), null);
assert.equal(currentClassWindow(connection, identity, false), null);
assert.equal(currentClassWindow(connection, undefined, true), null);
assert.equal(classWindowNotice(known, now), null);
assert.equal(classWindowNotice(known, now + 1), '수업이 10분 뒤에 끝나요');
assert.equal(classWindowNotice(known, known.endsAt - 1), '수업이 1분 뒤에 끝나요');
assert.equal(classWindowNotice(known, known.endsAt), null);
assert.equal(classWindowNotice(known, known.startsAt - 1), null);
assert.equal(classWindowNotice(undefined, now), null);
const originalNow = Date.now, originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
Date.now = () => now;
const timers = new Map<number, () => void>(); const delays: number[] = []; let seq = 0;
globalThis.setInterval = ((fn: () => void, ms: number) => { delays.push(ms); timers.set(++seq, fn); return seq; }) as any;
globalThis.clearInterval = ((id: number) => timers.delete(id)) as any;
const dismissed: string[] = [];
const host = mountPoint() as any; const root = createRoot(host); const act = (React as any).act;
const tick = async () => { await act(() => { for (const fn of timers.values()) fn(); }); };
try {
  await act(() => root.render(<ClassWindowNotice window={known} onDismiss={id => dismissed.push(id)} />));
  // The T-10 line must appear without a reload or focus event, so the clock has to tick at least once a minute; a slowed timer fails here.
  assert.ok(delays.length > 0 && delays.every(ms => ms >= 1 && ms <= 1000), `notice tick delay must be <= 1000 ms, got ${delays}`);
  assert.equal(host.querySelector('[role="status"]'), null);
  now++; await tick(); assert.equal(host.textContent, '수업이 10분 뒤에 끝나요');
  assert.equal(host.querySelectorAll('button').length, 1, 'only a quiet dismissal, never a turn action');
  // Closing returns focus to the composer (the shell's textarea), not to <body> and not to the removed button.
  const shell = document.createElement('div'); shell.setAttribute('class', 'hps-shell'); document.body.appendChild(shell); shell.appendChild(host);
  const composer = document.createElement('textarea'); shell.appendChild(composer);
  assert.ok(document.activeElement !== composer, 'composer starts unfocused');
  await act(() => click(host.querySelector('button'))); assert.deepEqual(dismissed, ['notice-a']);
  assert.ok(document.activeElement === composer, 'dismissal returns focus to the composer');
  assert.match(host.textContent, /10분/, 'wait for host receipt; failed persistence must not optimistically hide');
  now = known.endsAt - 30000; await tick(); assert.equal(host.textContent, '수업이 1분 뒤에 끝나요');
  // Extension, switching class and unknown state replace the old notice immediately.
  await act(() => root.render(<ClassWindowNotice window={{ ...known, id: 'run-b', endsAt: now + 3600000 }} />));
  assert.equal(host.textContent, '');
  await act(() => root.render(<ClassWindowNotice window={known} onDismiss={id => dismissed.push(id)} />)); assert.match(host.textContent, /1분/);
  now = known.endsAt; await act(() => window.dispatchEvent({ type: 'focus' } as Event)); assert.equal(host.textContent, '');
  now--; await tick(); assert.match(host.textContent, /1분/);
  await act(() => root.render(<ClassWindowNotice window={null} />)); assert.equal(host.textContent, '');
  await act(() => root.unmount()); assert.equal(timers.size, 0);
  console.log('PASS class-window identity, unknown, T-10 boundary, end, replacement, focus and cleanup');
} finally { Date.now = originalNow; globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }

}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
