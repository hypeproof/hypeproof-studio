// MPER-05: real App/bridge -> existing account reflection host -> real task files.
// Only VS Code presentation, profile configuration and HTTP use the existing entry fixture.
import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { taskWorkspaceRoot, taskWorkspaceScope } from '../src/trialCarryoverSource';
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
  fixture = await personalEntryFixture({ publish: (data: any) => window.dispatchEvent(new dom.window.MessageEvent('message', { data })) });
  await fixture.current.page.openPersonalReflectionEntry(); await fixture.login(); fixture.useChatSurface();
  const { h, connections } = fixture.current, store = h.currentTaskStore();
  const reflection = store.getView().activeTaskId, history = JSON.stringify(store.getHistory());
  assert.equal(store.getHistory()[0].id, 'phone-user');
  // The fixture projects configuration; the real host post() supplies the active reflection identity.
  h.postConfig = async () => h.post({ type: 'config', config: {
    proxyUrl: 'http://127.0.0.1:31999/v1', model: 'fixture-no-model', hasToken: true,
    activity: { ...connections.current, verified: true }, taskWorkspace: store.getView(), activityDraft: store.getDraft(),
    coach: { name: 'HP Studio', personality: '', configured: true },
    profile: { ...fixture.profile, ux: { coach: { naming_mode: 'fixed', fallback_name: 'HP Studio' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } } },
  } });
  const drain = async () => { while (pending.length) { const batch = pending; pending = []; await Promise.all(batch); } };
  const settle = async (work: () => unknown) => act(async () => { await work(); await drain(); });
  const button = () => document.querySelector<HTMLButtonElement>('[data-testid="personal-making-entry"]');
  await settle(() => root.render(<App />)); await settle(() => h.postHistory());
  assert(document.querySelector('textarea'), 'the real App composer must mount before checking the action');
  assert(button(), 'the question conversation must expose making without a command palette or status bar');
  assert.equal(button()!.textContent, '만들기로 이어가기'); assert(!button()!.disabled);
  button()!.focus(); assert.equal(document.activeElement, button(), 'ordinary keyboard-focusable button');
  const requests = fixture.requests.length, commands = fixture.commands.length;
  const reviewed = '내 수업에 쓸 한 화면짜리 안내를 만들고 싶어요.';
  let prompts = 0;
  fixture.vscode.window.showInputBox = async (options: any) => { prompts++; assert.equal(options.value, '요즘 사람을 가르쳐요.'); return reviewed; };
  await settle(() => button()!.click());
  const made = store.getView().activeTaskId;
  assert.notEqual(made, reflection); assert.equal(prompts, 1); assert.equal(store.getView().tasks.length, 3);
  assert.equal(store.getDraft(made).text, reviewed); assert.equal(store.getHistory(made).length, 0);
  assert.equal(JSON.stringify(store.getHistory(reflection)), history);
  assert.equal((document.querySelector('textarea') as HTMLTextAreaElement)?.value, reviewed, 'actual App displays the unsent reviewed draft');
  assert.equal(button(), null, 'ordinary tasks do not offer reflection making');
  assert.equal(fixture.requests.length, requests, 'making makes no Service/model request');
  assert.equal(fixture.commands.length, commands, 'making executes no command/tool');
  assert(!sent.some(m => m.type === 'sendMessage' || m.type === 'retryMessage'));
  const reopened = new store.constructor(taskWorkspaceRoot(h.context.globalStorageUri.fsPath), taskWorkspaceScope(connections.current));
  assert.equal(reopened.filePath, store.filePath, 'reopen the same activity/folder storage, not a different empty workspace');
  await reopened.initialize();
  assert.equal(reopened.getDraft(made).text, reviewed, 'reviewed words survive reopening the actual disk store');
  await settle(() => fixture.send({ type: 'beginPersonalMaking', activityId: connections.current.id, taskId: made }));
  assert.equal(prompts, 1); assert.equal(store.getView().activeTaskId, made); assert.equal(store.getDraft(made).text, reviewed);
  console.log('PASS visible real App -> scoped bridge -> existing host -> durable unsent task; source words and zero dispatch preserved');

  await settle(() => h.handleTaskMessage({ type: 'taskSelect', taskId: made, id: reflection }));
  assert(button());
  const review = deferred(); fixture.vscode.window.showInputBox = async () => { prompts++; return review.promise; };
  const before = prompts;
  await act(async () => { button()!.click(); await new Promise(r => setTimeout(r, 0)); button()!.click(); await new Promise(r => setTimeout(r, 0)); });
  assert.equal(prompts, before + 1, 'repeated visible clicks share the existing single review');
  await settle(() => review.resolve(undefined)); assert.equal(store.getView().tasks.length, 3);
  const stale = sent.findLast(m => m.type === 'beginPersonalMaking');
  await settle(() => h.handleTaskMessage({ type: 'taskSelect', taskId: reflection, id: made }));
  await settle(() => fixture.send(stale)); assert.equal(prompts, before + 1); assert.equal(store.getView().activeTaskId, made);
  await settle(() => fixture.send({ ...stale, activityId: 'different-activity' })); assert.equal(prompts, before + 1);
  console.log('PASS cancel and repeated visible clicks preserve tasks; stale task/activity actions cannot open review');

  await settle(() => h.handleTaskMessage({ type: 'taskSelect', taskId: made, id: reflection })); assert(button());
  const activity = connections.current; connections.active = { ...activity, kind: 'classroom' };
  await settle(() => h.postConfig()); assert.equal(button(), null, 'classroom with the same stored task cannot expose personal making');
  await settle(() => fixture.send({ ...stale, activityId: activity.id, taskId: reflection })); assert.equal(prompts, before + 1);
  assert.equal(JSON.stringify(store.getHistory(reflection)), history);
  assert.equal(store.getView().tasks.length, 3);
  console.log('PASS classroom refuses a forged making message and retains private reflection/history');
}
main().then(async () => { await act(async () => root.unmount()); fixture?.close(); dom.window.close(); process.exit(0); }, e => { console.error(e); fixture?.close(); dom.window.close(); process.exit(1); });
