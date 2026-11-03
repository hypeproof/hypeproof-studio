// CGP-ART-R-011 — the real App wires the publish panel to the host: copy, refresh (focus and the 15 s poll) and close
// each post their message, the sharing label comes from the host's view, and an unreadable read is shown as unknown
// (with the last known state marked stale), never as a failed publish.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../webview-ui/src/App';
import type { PublishView } from '../src/publishView';
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
// The lightweight DOM omits select.options; the real publish form needs it.
Object.defineProperty(Object.getPrototypeOf(mountPoint()), 'options', { configurable: true, get() { return (this as any).querySelectorAll('option'); } });
const act = (React as any).act;
const timers = new Map<number, () => void>();
const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
globalThis.setInterval = ((fn: () => void, ms: number) => { timers.set(ms, fn); return ms; }) as any;
globalThis.clearInterval = ((ms: number) => timers.delete(ms)) as any;
const posted = () => (globalThis as any).__posted as any[];
const ofType = (t: string) => posted().filter(m => m.type === t);
const host: any = mountPoint(), root = createRoot(host);
const hostMessage = (data: any) => act(async () => { (globalThis.window as any).dispatchEvent({ type: 'message', data, bubbles: false }); });
const link = { id: 'l', channel: null, state: 'live' as const, expires_at: Date.now() + 86400000, share_url: 'https://test.invalid/l/a/', qr: null };
const exp = { id: 'e', week: 1, question: 'q', method: 'task_test', success_criteria: [], hypothesis: null, product_version_id: 'v1', current_version: true, status: 'running', links: [link], sessions: null };
const base: PublishView = { available: true, reason: null, project: { id: 'p', title: 't' }, version: { id: 'v1', files: [], manifest_added: [], refusal: null, refusal_lines: [] }, verification: { state: 'not_verified', open: [] }, hypotheses: [], experiments: [exp] as any, timing: null, notice: null };
const UX = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = { model: 'claude-sonnet-5', hasToken: true, proxyUrl: 'http://localhost:8787', coach: { name: 'HypeProof', personality: '', configured: true },
  profile: { profile_id: 'p', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/tmp/p', verified: true } };
const rows = () => host.querySelectorAll('[data-testid="publish-sharing"]');
const panel = () => host.querySelector('[data-testid="publish-panel"]');
async function main() {
  await act(async () => root.render(<App />));
  await hostMessage({ type: 'config', config });
  assert.equal(panel(), null);
  await hostMessage({ type: 'publishState', view: base });
  assert.ok(panel(), 'the host view mounts the panel');
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /링크가 있는 누구나 · .*까지 · 활성 링크 1개/);
  assert.equal(rows()[0].querySelector('[role="status"]') !== null, true, 'the label is a status region');
  // Opening settings is local navigation; revoking keeps the existing exact-link host message.
  const beforeSettings = posted().length;
  await act(async () => click(panel().querySelector('[data-testid="sharing-pill"]')));
  assert.equal(panel().querySelector('[data-testid="sharing-pill"]').getAttribute('aria-expanded'), 'true');
  assert.equal(posted().length, beforeSettings, 'opening settings cannot publish or create a link');
  await act(async () => click(panel().querySelector('[data-testid="publish-revoke"]')));
  assert.deepEqual(ofType('publishRevoke').map(m => m.linkId), ['l']);
  // copy -> host with the version id only
  await act(async () => click(rows()[0].querySelector('button')));
  assert.deepEqual(ofType('publishCopy').map(m => m.versionId), ['v1']);
  // refresh: the 15 s poll and window focus both reach the host
  await act(async () => timers.get(15000)!());
  assert.equal(ofType('publishRefresh').length, 1, 'poll');
  await act(async () => (globalThis.window as any).dispatchEvent({ type: 'focus' }));
  assert.equal(ofType('publishRefresh').length, 2, 'focus');
  // a read that failed: last known state stays, marked stale; copy is off; no failed-publish text
  await hostMessage({ type: 'publishState', view: { ...base, read_failed: true, stale_at: Date.now(), reason: '공유 상태를 확인하지 못했어요 (503).' } });
  const text = panel().textContent;
  assert.match(text, /공유 상태를 확인하지 못했어요 \(503\)/);
  assert.match(text, /에 확인한 마지막 상태예요/);
  assert.match(rows()[0].textContent, /에 확인한 상태/);
  assert.equal(rows()[0].getAttribute('data-stale'), 'true');
  assert.ok(rows()[0].querySelector('button').hasAttribute('disabled'), 'copy is off while the state is unknown');
  assert.doesNotMatch(text, /공개하지 못했어요/);
  assert.ok(host.querySelector('[data-testid="publish-sharing-unknown"] [role="status"]'));
  // nothing known at all: the unknown row alone, still a status region
  await hostMessage({ type: 'publishState', view: { ...base, available: false, experiments: [], read_failed: true, reason: '공유 상태를 확인하지 못했어요 (503).' } });
  assert.equal(rows().length, 0);
  assert.match(host.querySelector('[data-testid="publish-sharing-unknown"] [role="status"]').textContent, /공유 상태를 확인하지 못했어요/);
  assert.equal(host.querySelector('[data-testid="publish-unavailable"]'), null, 'not the generic unavailable text');
  // close tells the host (the gate), then unmounts
  await act(async () => click(panel().querySelector('button[aria-label="닫기"]')));
  assert.equal(ofType('publishClose').length, 1, 'close reaches the host');
  assert.equal(panel(), null);
  await act(async () => root.unmount());
  globalThis.setInterval = realSet; globalThis.clearInterval = realClear;
  console.log('PASS publish sharing in App: copy, refresh (poll+focus), close post to the host; unreadable state is marked');
}
void main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
