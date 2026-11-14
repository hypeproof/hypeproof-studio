// MPER-03/04: real App/bridge -> existing account reflection host -> real task files.
// Only VS Code presentation, profile configuration and HTTP use the existing entry fixture.
import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.invalid', pretendToBeVisual: true });
let fixture: any, pending: Promise<unknown>[] = [], sent: any[] = [];
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as any;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
// JSDOM has no layout observer; geometry is checked separately in the browser/app lane.
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(window as any).acquireVsCodeApi = () => ({ postMessage(message: any) {
  sent.push(message);
  if (fixture) pending.push(message.type === 'ready' ? fixture.current.h.postConfig() : fixture.send(message));
}, getState: () => undefined, setState() {} });
let root: import('react-dom/client').Root;
async function main() {
  // React probes input support at import time; give it the real JSDOM document first.
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.getElementById('root')!);
  const { personalEntryFixture, deferred } = await import(pathToFileURL(process.cwd() + '/test/personal-entry-harness.mjs').href);
  const { App } = await import('../webview-ui/src/App');
  let body: any, failed = false, offline = false;
  const posted = deferred(), release = deferred();
  const words = '내가 정말 중요하게 생각하는 일은 무엇일까요?';
  const reason = '이번 달 이용 한도에 닿았습니다.';
  const snapshot = () => ({ state: { id: 'personal-reflection', revision: failed ? 3 : 2,
    messages: failed ? [{ id: body.id, role: 'user', content: body.text, created_at: 3 }] : [],
    has_earlier: false, turn: failed ? { id: body.id, text: body.text, status: 'failed', updated_at: 3 } : null },
    opening: '요즘 어떤 일에 시간을 쓰세요?', hint: '정리되지 않아도 괜찮아요.' });
  const response = (value: any, status = 200) => new Response(JSON.stringify(value), { status });
  fixture = await personalEntryFixture({ publish: (data: any) => window.dispatchEvent(new dom.window.MessageEvent('message', { data })),
    responseFor: async (route: string, options: any) => {
      if (offline && route.endsWith('/auth/refresh')) throw new TypeError('Synthetic offline refresh');
      if (route.endsWith('/me/reflection/turns')) { body = JSON.parse(options.body); posted.resolve(); await release.promise; failed = true; return response({ error: 'reflection_monthly_limit' }, 429); }
      if (route.endsWith('/me/reflection')) return response(snapshot());
    } });
  // VS Code owns Memento; this test adapter persists its exact values on disk.
  const bindingFile = path.join(fixture.root, 'global-state.json'); fs.writeFileSync(bindingFile, '{}');
  Object.assign(fixture.globalState, {
    keys: () => Object.keys(JSON.parse(fs.readFileSync(bindingFile, 'utf8'))),
    get: (key: string, fallback: any) => JSON.parse(fs.readFileSync(bindingFile, 'utf8'))[key] ?? fallback,
    update: async (key: string, value: any) => { const saved = JSON.parse(fs.readFileSync(bindingFile, 'utf8')); if (value === undefined) delete saved[key]; else saved[key] = value; fs.writeFileSync(bindingFile + '.next', JSON.stringify(saved)); fs.renameSync(bindingFile + '.next', bindingFile); },
  });
  await fixture.current.page.openPersonalReflectionEntry(); await fixture.login(); fixture.useChatSurface();
  const projectConfig = () => {
    const { h, connections } = fixture.current, store = h.currentTaskStore();
    h.postConfig = async () => h.post({ type: 'config', config: {
      proxyUrl: 'http://127.0.0.1:31999/v1', model: 'fixture-no-model', hasToken: true,
      activity: { ...connections.current, verified: true }, taskWorkspace: store.getView(), activityDraft: store.getDraft(),
      coach: { name: 'HP Studio', personality: '', configured: true },
      profile: { ...fixture.profile, ux: { coach: { naming_mode: 'fixed', fallback_name: 'HP Studio' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } } },
    } });
  };
  projectConfig();
  const drain = async () => { while (pending.length) { const batch = pending; pending = []; await Promise.all(batch); } };
  const settle = async (work: () => unknown) => act(async () => { await work(); await drain(); });
  await settle(() => root.render(<App />)); await settle(() => fixture.current.h.postHistory());
  const input = document.querySelector<HTMLTextAreaElement>('textarea')!; assert(input);
  await settle(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, words); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  const send = document.querySelector<HTMLButtonElement>('button[aria-label="메시지 보내기"]'); assert(send && !send.disabled);
  await act(async () => { send.click(); await posted.promise; });
  const store = fixture.current.h.currentTaskStore(), task = store.getView().activeTaskId;
  const richDraft = { ...store.getDraft(), text: '계속 쓰던 다른 생각\n아직 보내지 않아요', queued: '나중에 다룰 생각',
    images: ['data:image/png;base64,aGVsbG8='], imports: [{ object_id: 'kept-reference', revision: 1, hash16: '1234567890abcdef' }] };
  await act(async () => { await store.saveDraft(task, richDraft); });
  await settle(() => release.resolve());
  assert(body, 'mounted composer must reach the real account reflection transport');
  assert.equal(fixture.requests.filter((r: any) => r.route.endsWith('/me/reflection/turns')).length, 1);
  assert(fixture.posts.findLast((p: any) => p.type === 'history').messages.some((m: any) => m.id === body.id), 'recorded failed GET reached real host disk history');
  assert(document.body.textContent?.includes(reason), 'typed admission explanation must remain visible after recorded-failed GET');
  assert.equal(fixture.current.h.currentTaskStore().getHistory().filter((m: any) => m.id === body.id).length, 1);
  assert.equal(JSON.stringify(store.getDraft(task)), JSON.stringify(richDraft), 'refusal must preserve the concurrent rich draft');
  await settle(() => fixture.current.h.refreshPersonalReflection());
  assert(document.body.textContent?.includes(reason), 'explicit history refresh retains the reason');
  const beforeReopen = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  const binding = Object.values(beforeReopen).find((v: any) => v?.admissionFailure) as any;
  assert.deepEqual(binding.admissionFailure, { id: body.id, code: 'reflection_monthly_limit' });
  await settle(() => root.unmount());
  await fixture.reload(); await fixture.current.page.openChat(); await fixture.current.h.prepareTaskWorkspace(false); fixture.useChatSurface(); projectConfig();
  root = createRoot(document.getElementById('root')!);
  await settle(() => root.render(<App />)); await settle(() => fixture.current.h.postHistory());
  assert(document.querySelector('textarea'), 'fresh App must receive configuration through the reopened real host panel');
  assert(document.body.textContent?.includes(reason), 'fresh host and mounted App read the reason from the disk-backed binding');
  assert.equal(JSON.stringify(fixture.current.h.currentTaskStore().getDraft(task)), JSON.stringify(richDraft));
  assert.equal(fixture.current.h.currentTaskStore().getHistory(task).filter((m: any) => m.id === body.id).length, 1);
  assert.equal(fixture.requests.filter((r: any) => r.route.endsWith('/me/reflection/turns')).length, 1, 'refresh and fresh host never resend');
  console.log('PASS mounted App send → real account/host/disk → recorded failed GET retains typed refusal and one original question');

  // Exercise real AccountSession refresh failure, not a stubbed conversationSession.
  // A fresh App must still receive its saved local history while identity is unavailable.
  const accountKey = 'hypeproofChat.personalAccount.v1';
  const credentials = JSON.parse(fixture.vault.get(accountKey));
  fixture.vault.set(accountKey, JSON.stringify({ ...credentials, expiresAt: Date.now() + 60_000 }));
  const beforeOffline = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  offline = true;
  await settle(() => root.unmount());
  root = createRoot(document.getElementById('root')!);
  await settle(() => root.render(<App />));
  assert(!document.body.textContent?.includes(words), 'fresh mount cannot reuse the old timeline DOM');
  const historiesBefore = fixture.posts.filter((p: any) => p.type === 'history').length;
  const refreshesBefore = fixture.requests.filter((r: any) => r.route.endsWith('/auth/refresh')).length;
  await settle(() => fixture.current.h.postHistory());
  assert.equal(fixture.requests.filter((r: any) => r.route.endsWith('/auth/refresh')).length, refreshesBefore + 1, 'near-expired account performs one actual failed refresh');
  assert.equal(fixture.posts.filter((p: any) => p.type === 'history').length, historiesBefore + 1, 'offline refresh still delivers saved history');
  const offlineHistory = fixture.posts.findLast((p: any) => p.type === 'history');
  assert.equal(offlineHistory.reflectionFailure, undefined, 'unverified identity must not project the admission marker');
  assert.equal(document.body.textContent?.split(words).length, 2, 'saved question remains visible exactly once while offline');
  assert(!document.body.textContent?.includes(reason), 'no unverified refusal explanation is projected');
  assert.equal(document.querySelector<HTMLTextAreaElement>('textarea')?.value, richDraft.queued + '\n' + richDraft.text, 'fresh composer preserves queued and unsent words');
  assert.equal(JSON.stringify(fixture.current.h.currentTaskStore().getDraft(task)), JSON.stringify(richDraft), 'offline history preserves every rich draft field');
  assert.deepEqual(JSON.parse(fs.readFileSync(bindingFile, 'utf8')), beforeOffline, 'failed refresh does not discard the persisted admission marker');
  assert.equal(fixture.requests.filter((r: any) => r.route.endsWith('/me/reflection/turns')).length, 1, 'offline remount never replays the question');
  console.log('PASS real offline credential refresh → fresh App retains local question and rich draft, omits unverified marker, no replay');
}
main().then(async () => { await act(async () => root.unmount()); fixture?.close(); dom.window.close(); process.exit(0); }, e => { console.error(e); fixture?.close(); dom.window.close(); process.exit(1); });
