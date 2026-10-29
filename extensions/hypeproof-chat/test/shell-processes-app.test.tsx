// REQ-CGP-AGENT-60 — the actual App: the "실행 중인 것" list belongs to one activity. A config for
// another activity clears it before the host re-posts that activity's own list; the same
// activity's config keeps it (negative control).
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../webview-ui/src/App';
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
const act = (React as any).act;
const host: any = mountPoint(), root = createRoot(host);
const hostMessage = async (data: any) => act(async () => { (globalThis.window as any).dispatchEvent({ type: 'message', data, bubbles: false }); });
const config = (id: string) => ({ type: 'config', config: { activity: { id, name: 'x', kind: 'trial', workspace: '/tmp/w', verified: true } } });
const panel = () => host.querySelector('.hps-running-processes');
async function main() {
  await act(async () => root.render(<App />));
  await hostMessage(config('activity-a'));
  await hostMessage({ type: 'runningProcesses', entries: [{ id: 'live:1', purpose: '미리보기 서버', kind: 'preview', folder: '작업 폴더 전체 (site)', address: '127.0.0.1:43210', state: 'running' }] });
  assert.ok(panel(), 'the host list is drawn');
  assert.ok(panel().textContent.includes('미리보기 서버 실행 중'));
  await act(async () => click(panel().querySelector('button')));
  assert.deepEqual((globalThis as any).__posted.at(-1), { type: 'stopRunningProcess', id: 'live:1', activityId: 'activity-a' }, 'stop sends only the owned id, bound to its activity');
  await hostMessage(config('activity-a'));
  assert.ok(panel(), 'same activity keeps its list');
  await hostMessage(config('activity-b'));
  assert.equal(panel(), null, 'another activity never shows the previous activity\'s processes');
  await act(async () => root.unmount());
  console.log('shell-processes-app: PASS');
}
void main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
