import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRoot } from 'react-dom/client';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.invalid', pretendToBeVisual: true });
let fixture: any, pending: Promise<unknown>[] = [], messages: any[] = [];
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
(window as any).acquireVsCodeApi = () => ({ postMessage: (message: any) => { messages.push(message); if (fixture) pending.push(fixture.send(message)); }, getState: () => undefined, setState: () => {} });
async function main() {
 const { personalEntryFixture, deferred } = await import(pathToFileURL(process.cwd() + '/test/personal-entry-harness.mjs').href);
 const { StartPage } = await import('../webview-ui/src/StartPage');
 const { TaskWorkspace } = await import('../webview-ui/src/TaskWorkspace');
 let root: ReturnType<typeof createRoot>;
 const publish = (message: any) => window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
 const drain = async () => { while (pending.length) { const batch = pending; pending = []; await Promise.all(batch); } };
 const setup = async (options: any = {}) => {
  messages = []; fixture = await personalEntryFixture({ ...options, publish });
  root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(<StartPage />); await drain(); });
  await act(async () => { publish(fixture.posts.filter((m: any) => m.type === 'startState').at(-1)); });
  assert.equal(fixture.current.connections.current, undefined, 'fresh fixture has no activity, pass credential or task');
  assert.equal(fixture.current.h.currentTaskStore(), undefined);
 };
 const close = async () => { await act(async () => { await drain(); root.unmount(); }); fixture.close(); fixture = undefined; };
 const click = async (selector: string) => { const b = document.querySelector<HTMLButtonElement>(selector); assert(b, selector); assert(!b.disabled, selector); await act(async () => { b.click(); await drain(); }); };
 const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.replace(/→/g, '').trim() === text)!;
 const login = async () => act(async () => { await fixture.login(); await drain(); });
 const reflectionGets = () => fixture.requests.filter((r: any) => r.route.endsWith('/me/reflection')).length;
 const paidCalls = () => fixture.requests.filter((r: any) => /reflection\/turns|chat\/completions/.test(r.route));

 await setup();
 await click('[data-testid="personal-reflection-entry"]');
 assert.equal(fixture.current.accounts.view().status, 'waiting');
 assert(document.body.textContent?.includes('브라우저에서 연결을 승인해 주세요'));
 await login();
 let store = fixture.current.h.currentTaskStore(); assert(store); const reflection = store.getView().activeTaskId;
 assert.deepEqual(Array.from(store.getHistory(), (m: any) => m.id), ['phone-user', 'phone-answer']);
 assert.equal(store.getView().tasks.length, 2); assert.equal(paidCalls().length, 0);
 assert(fixture.requests.some((r: any) => r.route.endsWith('/me/passes/super/activate')));
 assert(fixture.requests.some((r: any) => r.route.endsWith('/activity')));
 await act(async () => {
  await fixture.current.h.handleTaskMessage({ type: 'taskCreate', taskId: reflection });
  // The same bridge used by App binds the restored rail message to its activity and task.
  publish({ type: 'config', config: { activity: { id: fixture.current.connections.current.id }, taskWorkspace: store.getView() } });
  fixture.useChatSurface();
  root.render(<TaskWorkspace view={store.getView()} messages={[]} busy={false} error={null} personalReflection><div>현재 작업</div></TaskWorkspace>);
 });
 await click('[data-testid="personal-reflection-entry"]');
 assert.equal(store.getView().activeTaskId, reflection); assert.equal(store.getView().tasks.length, 3);
 assert(fixture.commands.some((c: any) => c.name === 'hypeproof-chat.personalReflection'));
 console.log('PASS visible first entry and restored rail → real account/admission/host/store; same-account task reuse and zero AI/tool turns');
 await close();

 for (const phase of ['beforeHandoff', 'beforeConsent']) {
  const mounted = await personalEntryFixture({ realPanel: true });
  mounted.control[phase] = async () => mounted.current.source.emit({ type: 'ready' });
  await mounted.current.page.openPersonalReflectionEntry();
  await mounted.login();
  assert.equal(mounted.requests.filter((r: any) => r.route.endsWith('/me/reflection')).length, 1,
    `chat ready during ${phase} must not cancel the first question`);
  assert.equal(mounted.current.h.currentTaskStore().getHistory()[0].id, 'phone-user');
  mounted.close();
 }
 console.log('PASS real start-panel listener ignores chat ready during handoff and disclosure');

 await setup({ passes: [{ id: 'normal-pass', product_name: '내 이용권', status: 'paid', requests_remaining: 10, requests_limit: 10, requests_used: 0, duration_seconds: 86400 }] });
 await click('[data-testid="personal-reflection-entry"]'); await login();
 assert.equal(fixture.current.connections.current, undefined); assert.equal(reflectionGets(), 0);
 const choose = byText('이 이용권으로 시작하기'); assert(choose && !choose.disabled);
 await act(async () => { choose.click(); await drain(); });
 assert.equal(fixture.current.connections.current.kind, 'personal');
 assert.equal(fixture.current.h.currentTaskStore().getHistory()[0].id, 'phone-user');
 assert.equal(fixture.requests.filter((r: any) => r.route.endsWith('/activate')).length, 1);
 console.log('PASS normal paid pass requires its existing explicit selection and retains the question intent');
 await close();

 await setup(); fixture.control.activationDenied = true;
 await click('[data-testid="personal-reflection-entry"]'); await login();
 assert.equal(fixture.current.connections.current, undefined); assert.equal(reflectionGets(), 0);
 assert(document.body.textContent?.includes('거절') || document.body.textContent?.includes('이용권') || document.body.textContent?.includes('확인'));
 await act(async () => { byText('돌아가기').click(); await drain(); });
 assert.equal(fixture.current.accounts.view().status, 'signedIn', 'canceling navigation must not sign out a valid account');
 await fixture.current.page.finishAccountSignIn(); assert.equal(reflectionGets(), 0);
 console.log('PASS admission refusal and leaving account choices preserve work, identity and no delayed question');
 await close();

 await setup(); await click('[data-testid="personal-reflection-entry"]');
 await act(async () => { byText('로그인 취소').click(); await drain(); }); await login();
 assert.equal(fixture.current.connections.current, undefined); assert.equal(reflectionGets(), 0);
 console.log('PASS canceled login cannot later activate a pass or open a question'); await close();

 await setup(); const activation = deferred(), activationStarted = deferred();
 fixture.control.beforeActivate = async () => { activationStarted.resolve(); await activation.promise; };
 await click('[data-testid="personal-reflection-entry"]');
 await act(async () => {
  const switching = fixture.login(); await activationStarted.promise;
  fixture.control.accountId = 'account-b'; await fixture.current.accounts.refreshView(); activation.resolve();
  await switching;
 });
 assert.equal(fixture.current.connections.current, undefined); assert.equal(reflectionGets(), 0);
 console.log('PASS account change while an activation responds cannot bind or import old private conversation'); await close();

 await setup(); const reply = deferred(), replyStarted = deferred();
 fixture.control.beforeReflection = async () => { replyStarted.resolve(); await reply.promise; };
 await click('[data-testid="personal-reflection-entry"]');
 await act(async () => {
  const opening = fixture.login(); await replyStarted.promise;
  await fixture.current.page.openPersonalReflectionEntry(); await fixture.current.page.openPersonalReflectionEntry();
  assert.equal(reflectionGets(), 1); reply.resolve(); await opening;
 });
 store = fixture.current.h.currentTaskStore(); assert.equal(store.getView().tasks.length, 2); assert.equal(paidCalls().length, 0);
 const old = store.getView().activeTaskId; await act(async () => { await fixture.current.h.handleTaskMessage({ type: 'taskCreate', taskId: old }); });
 const draftTask = store.getView().activeTaskId; await store.saveDraft(draftTask, { text: '아직 쓰는 글', images: [], queued: null });
 await act(async () => { await fixture.current.page.openPersonalReflectionEntry(); });
 assert.equal(store.getDraft(draftTask).text, '아직 쓰는 글'); assert.equal(store.getView().activeTaskId, draftTask); assert.equal(reflectionGets(), 1);
 console.log('PASS repeated presses share one opening; unsent draft is retained and blocks navigation'); await close();

 await setup({ reload: true }); await click('[data-testid="personal-reflection-entry"]'); await login();
 assert.equal(reflectionGets(), 0, 'window must reload before the destination store opens');
 const marker = fixture.marker(); assert.equal(marker.personalReflection.accountId, 'account-a'); assert.equal(marker.personalReflection.sessionId, 'session-a');
 assert(!JSON.stringify(marker).includes('synthetic-account-token')); assert(!JSON.stringify(marker).includes('synthetic-personal-pass'));
 let resumed: any; await act(async () => { resumed = await fixture.reload(); }); assert.equal(resumed.verdict, 'valid'); assert.equal(fixture.marker(), undefined);
 assert.equal(fixture.current.h.currentTaskStore().getHistory()[0].id, 'phone-user'); assert.equal(reflectionGets(), 1);
 let second: any; await act(async () => { second = await fixture.reload(); }); assert.equal(second.verdict, 'absent'); assert.equal(reflectionGets(), 1);
 console.log('PASS production ensureWorkspace marker survives a fresh host, binds account/activity/folder, consumes once and never sends AI'); await close();

 await setup({ reload: true }); await click('[data-testid="personal-reflection-entry"]'); await login(); fixture.control.accountId = 'account-b';
 await act(async () => { await fixture.reload(); }); assert.equal(reflectionGets(), 0); assert.equal(fixture.marker(), undefined);
 console.log('PASS fresh host with a different account consumes the old navigation without importing private output'); await close();

 await setup(); const disk = deferred(), diskStarted = deferred(); fixture.control.beforeStore = async () => { diskStarted.resolve(); await disk.promise; };
 await click('[data-testid="personal-reflection-entry"]');
 await act(async () => {
  const preparing = fixture.login(); await diskStarted.promise;
  let ready = false; const concurrent = fixture.current.h.prepareTaskWorkspace(false).then(() => { ready = true; });
  await new Promise(r => setTimeout(r, 10)); assert.equal(ready, false, 'concurrent preparation must wait for disk initialization'); assert.equal(reflectionGets(), 0);
  disk.resolve(); await concurrent; await preparing;
 });
 assert.equal(fixture.current.h.currentTaskStore().getHistory()[0].id, 'phone-user');
 console.log('PASS concurrent config/store preparation waits for real durable initialization before reflection'); await close();

 await setup(); fixture.control.consent = undefined;
 await click('[data-testid="personal-reflection-entry"]'); await login();
 store = fixture.current.h.currentTaskStore(); assert.equal(reflectionGets(), 0); assert.equal(store.getView().tasks.length, 1);
 const existing = store.getView().activeTaskId;
 fixture.current.h.activeStreams.set('existing-stream', new AbortController());
 await act(async () => { await fixture.current.page.openPersonalReflectionEntry(); });
 assert.equal(store.getView().activeTaskId, existing); assert.equal(reflectionGets(), 0);
 fixture.current.h.activeStreams.clear();
 const classroom = { ...fixture.profile, activity_id: 'b'.repeat(64), activity_kind: 'classroom' };
 await fixture.current.connections.commit('synthetic-classroom-pass', classroom, fixture.work);
 const classActivity = fixture.current.connections.current.id;
 await act(async () => { await fixture.current.page.openPersonalReflectionEntry(); });
 assert.equal(fixture.current.connections.current.id, classActivity); assert.equal(reflectionGets(), 0);
 assert(document.body.textContent?.includes('수업은 그대로 유지했어요'));
 console.log('PASS disclosure cancel, active stream and classroom preserve existing work without fetching reflection'); await close();

 for (const change of ['task', 'activity'] as const) {
  await setup(); const late = deferred(), lateStarted = deferred();
  fixture.control.beforeReflection = async () => { lateStarted.resolve(); await late.promise; };
  await click('[data-testid="personal-reflection-entry"]');
  await act(async () => {
   const opening = fixture.login(); await lateStarted.promise;
   store = fixture.current.h.currentTaskStore();
   let selectedActivity = fixture.current.connections.current.id;
   if (change === 'task') await fixture.current.h.handleTaskMessage({ type: 'taskCreate', taskId: store.getView().activeTaskId });
   else {
    await fixture.current.connections.commit('synthetic-other-pass', { ...fixture.profile, activity_id: 'c'.repeat(64) }, fixture.work);
    selectedActivity = fixture.current.connections.current.id;
   }
   const selected = store.getView().activeTaskId;
   late.resolve(); await opening;
   assert.equal(store.getView().activeTaskId, selected); assert.equal(store.getHistory().length, 0);
   assert.equal(store.getView().tasks.length, change === 'task' ? 2 : 1);
   assert.equal(fixture.current.connections.current?.id, selectedActivity, 'a refused late snapshot must not roll back the selected activity');
  });
  await close();
 }
 console.log('PASS task/activity change while snapshot responds preserves selected work without importing or redirecting');

 await setup({ reload: true }); fixture.control.failMarker = true;
 await click('[data-testid="personal-reflection-entry"]'); await login();
 assert.equal(fixture.marker(), undefined); assert.equal(reflectionGets(), 0);
 assert.equal(fixture.current.connections.current, undefined);
 assert(!fixture.commands.some((c: any) => c.name === 'vscode.openFolder'));
 console.log('PASS failed resume persistence rolls back activity and never opens a folder or reflection'); await close();

 for (const invalid of ['expired', 'session'] as const) {
  await setup({ reload: true }); await click('[data-testid="personal-reflection-entry"]'); await login();
  if (invalid === 'expired') fixture.marker().at -= 11 * 60_000;
  else fixture.marker().personalReflection.sessionId = 'old-session';
  await act(async () => { await fixture.reload(); });
  assert.equal(fixture.marker(), undefined); assert.equal(reflectionGets(), 0);
  await close();
 }
 console.log('PASS expired activity marker and mismatched session never revive a private question');
 dom.window.close();
}
main().then(() => process.exit(0), e => { console.error(e); fixture?.close(); dom.window.close(); process.exit(1); });
