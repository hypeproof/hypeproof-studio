// Actual provider/SDK methods with scripted runtime boundaries. No network, CLI or paid calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { turnToolsAvailability, retryTurnToolMode, WebSearchActivity } from '../src/turnTools.ts';
import { SdkWebCitations } from '../src/sdkWebCitations.ts';
import { validActivityDraft, preservedDraftContent } from '../src/activityDraft.ts';
import { canReserveRecovery, recoveryFull } from '../src/recoveryCapacity.ts';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START } from '../src/browserMcp.ts';

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL('..', import.meta.url));
const profile = { profile_id: 'adult-test', tools: { web_search: true }, coach_runtime: 'agent-sdk', sdk_tools: { read: true, write: true, browser: true, subagents: true }, ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } } };
const toolUse = (id, name = 'WebSearch', input = { query: 'source question' }) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, value, error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: error, content: 'Model-facing text is not a source.' }] }, tool_use_result: value });
const searchOutput = (url = 'https://example.test/reference') => ({ query: 'source question', results: ['commentary https://invented.test/', { tool_use_id: 'server-search-id', content: [{ title: 'Observed search hit', url }] }] });
const copy = value => JSON.parse(JSON.stringify(value));
const temporary = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-turn-tools-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };

const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {runSdkCoach,SdkUnavailableError} from './src/sdkCoach'; export {BrowserControl} from './src/browserControl';", resolveDir: extension, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent', plugins: [{ name: 'scripted-provider-runtime', setup(b) {
  b.onResolve({ filter: /^\.\/sdkCoach$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'sdk', namespace: 'runtime' } : undefined);
  b.onResolve({ filter: /^\.\/proxyClient$/ }, args => args.importer.endsWith('/chatPanelProvider.ts') ? { path: 'proxy', namespace: 'runtime' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'runtime' }, args => ({ loader: 'ts', resolveDir: extension, contents: args.path === 'sdk'
    ? `export * from ${JSON.stringify(path.join(extension, 'src/sdkCoach.ts'))}; export const runSdkCoach=(args)=>globalThis.runtime.sdk(args);`
    : `export * from ${JSON.stringify(path.join(extension, 'src/proxyClient.ts'))}; export const proxyChat=(args)=>globalThis.runtime.proxy(args);` }));
} }] });

function fixture(t, { runtimeMode = 'agent-sdk', resolvedProfile = copy(profile), local = false, instructor = false, choice } = {}) {
  const root = temporary(t), posts = [], history = [], calls = { sdk: [], proxy: [], observation: 0, network: 0 };
  const runtime = { sdk: async args => { calls.sdk.push(args); args.onDelta('모델 답변 '+calls.sdk.length); return { kind: 'success' }; }, proxy: async args => { calls.proxy.push(args); args.onDelta('자동 모드 답변 '+calls.proxy.length); return { text: '자동 모드 답변 '+calls.proxy.length, toolUses: [] }; } };
  const values = { coachRuntime: runtimeMode, proxyUrl: 'http://127.0.0.1:1/v1' };
  const vscode = { env: { appName: local ? 'HypeProof Studio Dev' : 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) }, window: { createOutputChannel: () => ({ appendLine() {} }) }, Uri: { file: fsPath => ({ fsPath }) } };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), runtime, console,
    process: { ...process, env: { PATH: process.env.PATH, APPDATA: root, ...(local ? { HPS_DEV_RUNTIME: '1', HPS_DEV_PROVIDER: 'codex', HPS_DEV_EXECUTABLE: '/fixture/codex', HPS_DEV_MODEL: 'fixture' } : {}) } },
    Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, crypto: globalThis.crypto, setTimeout, clearTimeout,
    fetch: async () => { calls.network++; throw new Error('Network is forbidden in this test'); },
  });
  const { ChatPanelProvider, runSdkCoach, SdkUnavailableError, BrowserControl } = module.exports;
  const h = Object.create(ChatPanelProvider.prototype), state = new Map();
  const context = { globalState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) }, workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) }, secrets: { get: async () => 'synthetic-test-token' } };
  Object.assign(h, { context, nativeHistoryScope: 'task-a', pendingSends: 0, activeStreams: new Map(), turnTimelines: new Map(), turnRequests: new Map(),
    _instructorMode: { isInstructor: instructor, onTurnSuccess() {}, async revertModelOnTurnError() {} }, cachedProfile: resolvedProfile,
    getHistory: () => history, appendHistory: async items => { for (const item of items) { const i = history.findIndex(previous => previous.id === item.id); if (i < 0) history.push(copy(item)); else history[i] = copy(item); } },
    post: async event => posts.push(copy(event)), postConfig: async () => {}, postHistory: async () => posts.push({type: "history", messages: copy(history)}), getCoach: () => ({ name: '코치', personality: '', configured: true }),
    ensureProfile: async () => resolvedProfile, loadAccess: async () => {}, accessState: choice ? { selected: choice.id, view: { choices: [choice] } } : undefined,
    pullQuestResultFromPreview: async () => {}, elementQueue: { take: () => undefined }, verifySession: { running: false, takeCoachContext: () => null, endTurn() {} },
    isCurriculumRuntimeEnabled: () => false, takeProjectSwitchBrief: async () => null, isLearningWikiEnabled: () => false,
    prepareObservation: async () => { calls.observation++; return null; }, crBlobSinkFor: () => undefined, savePastedImages: async () => ({ note: '' }), commitAttachedImages: () => '',
    resolveCoachCwd: () => undefined, crSdkResults: { reset() {}, onToolUse() {}, onToolResult() {} }, liveServer: { currentUrl: () => undefined },
    buildBrowserMcpHost: () => ({}), saveAgentMdIfPresent: async () => {}, observationWrites: Promise.resolve(), sitePublisher: () => ({ available: () => false }),
    // Object.create skips class fields; the funnel reporter (studio-funnel-events) is one of them.
    funnel: { emit() {}, setTarget() {}, active: false },
  });
  return { h, posts, history, runtime, calls, runSdkCoach, SdkUnavailableError, BrowserControl, root, vscode };
}


import { attemptGroups, visibleAttempts, selectAttempt, attemptHistory, applyAttemptSelection, validAttemptMeta } from '../src/answerAttempts.ts';
import { modelConversation, validEditTarget } from '../src/editResend.ts';
const u=(id,extra={})=>({id,role:'user',content:'질문',createdAt:1,...extra});
const a=(id,content)=>({id,role:'assistant',content,createdAt:2});
const transcript=()=>[u('u1'),a('a1','첫 답'),u('u2',{retryOf:'u1'}),a('a2','둘째 답')];
test('attempt projection, choice, history and hostile selection',()=>{
  const rows=transcript();
  assert.deepEqual(visibleAttempts(rows).items.map(x=>x.id),['u1','a2']);
  const selected=selectAttempt(rows,'u1','u1',true); rows[0]=selected;
  assert.equal(selected.chosenAttemptId,'u1');
  assert.equal(selectAttempt(rows,'u1','u2',false).visibleAttemptId,'u2');
  assert.deepEqual(modelConversation(rows).map(x=>x.id),['u1','a1']);
  assert.deepEqual(attemptHistory(rows,'u2'),[]);
  assert.equal(selectAttempt(rows,'u1','foreign',true),null);
  assert.equal(selectAttempt([u('u1')],'u1','u1',true),null);
  rows[2].content+='\n\n새 이미지 경로';
  assert.equal(attemptGroups(rows)[0].attempts.length,2);
});
test('disk reopen retains every attempt and selection, including edit/retry/edit',async t=>{
  const root=temporary(t), store=new TaskWorkspaceStore(root,'attempts'); await store.initialize();
  const task=store.getView().activeTaskId;
  const rows=[u('old',{content:'원래 질문'}),a('old-a','원래 답'),u('u1',{editOf:'old',visibleAttemptId:'u1',chosenAttemptId:'u1'}),a('a1','첫 답'),u('u2',{editOf:'old',retryOf:'u1'}),a('a2','둘째 답')];
  await store.append(task,rows);
  const reopened=new TaskWorkspaceStore(root,'attempts');
  assert.deepEqual(reopened.getHistory(),rows);
  assert.deepEqual(modelConversation(reopened.getHistory()).map(x=>x.id),['u1','a1']);
  assert.ok(validEditTarget(visibleAttempts(reopened.getHistory()).items,'old'));
  await reopened.append(task,[u('u3',{editOf:'old',content:'다시 고친 질문'}),a('a3','셋째 답')]);
  assert.equal(new TaskWorkspaceStore(root,'attempts').getHistory().length,8);
});
for (const runtimeMode of ['proxy','agent-sdk']) test(`${runtimeMode}: actual retry uses one prompt, pager never calls runtime, next send uses selected answer`,async t=>{
  const f=fixture(t,{runtimeMode,resolvedProfile:{...copy(profile),coach_runtime:runtimeMode}});
  await f.h.handleMessage({type:'sendMessage',text:'질문',history:[],userMessageId:'u1'});
  await f.h.handleMessage({type:'retryMessage',prompt:'질문',history:copy(f.history),sourceMessageId:'u1',userMessageId:'u2'});
  assert.equal(attemptGroups(f.history)[0].attempts.length,2);
  const calls=runtimeMode==='proxy'?f.calls.proxy:f.calls.sdk;
  assert.equal(calls.length,2); assert.equal(calls[1].history.length,0);
  await f.h.handleMessage({type:'selectAnswerAttempt',rootId:'u1',attemptId:'u1',choose:true});
  assert.equal(calls.length,2);
  assert.equal(f.history[0].chosenAttemptId,'u1');
  const events=f.h.context.globalState.get('answer-attempt-events:'+f.h.turnRequestScope(),[]);
  assert.equal(events.length,1); assert.equal(events[0].event,'answer_attempt_chosen');
  assert.equal(events[0].actor,'learner'); assert.equal(events[0].attemptId,'u1');
  await f.h.handleMessage({type:'sendMessage',text:'다음 질문',history:copy(f.history),userMessageId:'u3'});
  assert.equal(calls.length,3); assert.ok(calls[2].history.find(x=>x.role==='assistant').content.endsWith('1')); assert.equal(calls[2].history.filter(x=>x.role==='assistant').length,1);
});
test('host refuses stale task, activity, foreign attempt, instructor and running requests',async t=>{
  for (const mode of ['task','activity','foreign','instructor','stream','pending']) {
    const f=fixture(t); f.history.push(...transcript());
    const message={type:'selectAnswerAttempt',rootId:'u1',attemptId:'u1',choose:true};
    if(mode==='task') message.taskId='other'; if(mode==='activity') message.activityId='other';
    if(mode==='foreign') message.attemptId='other'; if(mode==='instructor') f.h._instructorMode.isInstructor=true;
    if(mode==='stream') f.h.activeStreams.set('running',new AbortController()); if(mode==='pending') f.h.pendingSends=1;
    await f.h.handleMessage(message);
    assert.equal(f.history[0].chosenAttemptId,undefined,mode);
    assert.deepEqual(f.h.context.globalState.get('answer-attempt-events:'+f.h.turnRequestScope(),[]),[],mode);
  }
});

test('selection acknowledgement preserves same-session image reattach bytes',()=>{
 const image='data:image/png;base64,cGhvdG8=';
 const rows=transcript(); rows[0].images=[image];
 const selected=selectAttempt(rows,'u1','u1',true);
 delete selected.images;
 const updated=applyAttemptSelection(rows,selected);
 assert.deepEqual(updated[0].images,[image]);assert.equal(updated[0].visibleAttemptId,'u1');
 assert.equal(updated[0].chosenAttemptId,'u1');assert.deepEqual(updated.slice(1),rows.slice(1));
});
test('selection holds sends and task-switch busy state; a double press records one event',async t=>{
 const f=fixture(t);f.history.push(...transcript());
 let release; const gate=new Promise(resolve=>{release=resolve});
 const append=f.h.appendHistory;
 f.h.appendHistory=async rows=>{await gate;return append(rows)};
 const message={type:'selectAnswerAttempt',rootId:'u1',attemptId:'u1',choose:true};
 const choosing=f.h.handleMessage(message);
 assert.equal(f.h.hasActiveStream(),true);
 await f.h.handleMessage(message);
 const sending=f.h.handleMessage({type:'sendMessage',text:'다음',history:copy(f.history),userMessageId:'u3'});
 assert.equal(f.calls.sdk.length,0);
 release();await choosing;await sending;
 assert.equal(f.h.context.globalState.get('answer-attempt-events:'+f.h.turnRequestScope()).length,1);
 assert.equal(f.posts.filter(p=>p.type==='answerAttemptSelected').length,1);
 assert.equal(f.h.hasActiveStream(),false);
});
for(const runtimeMode of ['proxy','agent-sdk'])test(`${runtimeMode}: image bytes ride retry request`,async t=>{
 const f=fixture(t,{runtimeMode,resolvedProfile:{...copy(profile),coach_runtime:runtimeMode,input:{image_paste:true}}});
 f.h.ensureAttachmentStaging=()=>{};
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mD4AAAAASUVORK5CYII=';
 await f.h.handleMessage({type:'sendMessage',text:'사진 질문',history:[],images:[image],userMessageId:'u1'});
 await f.h.handleMessage({type:'retryMessage',prompt:'사진 질문',history:copy(f.history),images:[image],sourceMessageId:'u1',userMessageId:'u2'});
 const calls=runtimeMode==='proxy'?f.calls.proxy:f.calls.sdk;
 assert.equal(calls.length,2);assert.deepEqual(copy(calls[1].images),[image]);
 assert.equal(attemptGroups(f.history)[0].attempts.length,2);
});

test('sidecar metadata refuses hostile and oversized ids',()=>{
 assert.equal(validAttemptMeta({retryOf:'u1',visibleAttemptId:'u2'}),true);
 for(const value of [null,[],{extra:'u1'},{retryOf:'../escape'},{retryOf:'a\u202e'},{retryOf:'x'.repeat(129)},{retryOf:7}])assert.equal(validAttemptMeta(value),false);
});
test('failed retry keeps its attempt and original answer',async t=>{
 const f=fixture(t);f.history.push(...transcript().slice(0,2));
 f.runtime.sdk=async()=>{throw new Error('synthetic failure')};
 await f.h.handleMessage({type:'retryMessage',prompt:'질문',history:copy(f.history),sourceMessageId:'u1',userMessageId:'u2'});
 assert.equal(attemptGroups(f.history)[0].attempts.length,2);
 assert.equal(attemptGroups(f.history)[0].attempts[0].lines[0].content,'첫 답');
});

test('empty failed attempt can be browsed but cannot be chosen',()=>{
 const rows=[...transcript().slice(0,2),u('u2',{retryOf:'u1'})];
 assert.equal(selectAttempt(rows,'u1','u2',false).visibleAttemptId,'u2');
 assert.equal(selectAttempt(rows,'u1','u2',true),null);
 assert.equal(selectAttempt(rows,'u1','u1',false).visibleAttemptId,'u1');
});

test('denial notices survive sidecar read and later append after retry',async t=>{
 const {denialNotice,denialNoticeLabel}=await import('../src/denialNotice.ts');
 const root=temporary(t),store=new TaskWorkspaceStore(root,'denial-attempts');await store.initialize();
 const task=store.getView().activeTaskId;await store.append(task,transcript());
 const notice={id:'notice',role:'tool',content:'',createdAt:3,tool:{icon:'🔒',label:denialNoticeLabel(denialNotice('safety')),state:'error'}};
 await store.appendDenial(task,notice);
 assert.ok(store.getHistory().some(m=>m.id==='notice'));
 await store.append(task,[u('next'),a('next-a','next')]);
 assert.ok(new TaskWorkspaceStore(root,'denial-attempts').getHistory().some(m=>m.id==='notice'));
});

test('host preserves edit grouping across a new-id retry and accepts next edit',async t=>{
 const f=fixture(t);
 await f.h.handleMessage({type:'sendMessage',text:'원래',history:[],userMessageId:'old'});
 await f.h.handleMessage({type:'sendMessage',text:'수정',history:copy(f.history),userMessageId:'edited',editOf:'old'});
 await f.h.handleMessage({type:'retryMessage',prompt:'수정',history:copy(f.history),sourceMessageId:'edited',userMessageId:'retry'});
 assert.equal(f.history.find(m=>m.id==='retry').editOf,'old');
 assert.equal(f.history.find(m=>m.id==='retry').retryOf,'edited');
 assert.doesNotThrow(()=>f.h.requireEditTarget('old'));
 await f.h.handleMessage({type:'sendMessage',text:'다시 수정',history:copy(f.history),userMessageId:'edit2',editOf:'old'});
 assert.equal(f.calls.sdk.length,4);assert.equal(f.calls.sdk[3].history.length,0);
});

// Round 2 (verifier FAIL): failed retry, the send-after-select race, retry after browsing back, tool-mode grouping.
for (const runtimeMode of ['proxy', 'agent-sdk']) test(`${runtimeMode}: a zero-output failed retry never replaces the last good answer in the next turn's history`, async t => {
  const f = fixture(t, { runtimeMode, resolvedProfile: { ...copy(profile), coach_runtime: runtimeMode } });
  const calls = runtimeMode === 'proxy' ? f.calls.proxy : f.calls.sdk, key = runtimeMode === 'proxy' ? 'proxy' : 'sdk', working = f.runtime[key];
  await f.h.handleMessage({ type: 'sendMessage', text: '질문', history: [], userMessageId: 'u1' });
  f.runtime[key] = async () => { throw new Error('synthetic failure'); };
  await f.h.handleMessage({ type: 'retryMessage', prompt: '질문', history: copy(f.history), sourceMessageId: 'u1', userMessageId: 'u2' });
  const group = attemptGroups(f.history)[0];
  assert.equal(group.attempts.length, 2); assert.equal(group.attempts[1].lines.some(x => x.role === 'assistant' && x.content.trim()), false);
  f.runtime[key] = working;
  await f.h.handleMessage({ type: 'sendMessage', text: '다음 질문', history: copy(f.history), userMessageId: 'u3' });
  const history = calls.at(-1).history.map(x => [x.role, x.content]);
  assert.equal(JSON.stringify(history.map(x => x[0])), '["user","assistant"]', JSON.stringify(history));
  assert.ok(history[1][1].endsWith('1'), 'the first, good answer is what the next turn carries');
});
test('failed retry: history keeps the newest good attempt, and a first attempt that never answered stays as it was', () => {
  const failed = [u('u1'), a('a1', '첫 답'), u('u2', { retryOf: 'u1' }), a('a2', '둘째 답'), u('u3', { retryOf: 'u1' })];
  assert.deepEqual(visibleAttempts(failed).items.map(x => x.id), ['u1'], 'the pager still shows the failed attempt');
  assert.deepEqual(visibleAttempts(failed, true).items.map(x => x.id), ['u1', 'a2'], 'the model sees the newest answered attempt');
  assert.deepEqual(modelConversation(failed).map(x => x.id), ['u1', 'a2']);
  assert.deepEqual(visibleAttempts([u('u1'), u('u2', { retryOf: 'u1' })], true).items.map(x => x.id), ['u1']);
  const browsed = [u('u1', { visibleAttemptId: 'u1' }), a('a1', '첫 답'), u('u2', { retryOf: 'u1' }), a('a2', '둘째 답')];
  assert.deepEqual(modelConversation(browsed).map(x => x.id), ['u1', 'a1'], 'an answered selection is honoured');
});
test('a send right after a slow selection write sends the selected answer, not the previous visible one', async t => {
  const f = fixture(t); f.history.push(...transcript());
  let release; const gate = new Promise(resolve => { release = resolve; });
  const append = f.h.appendHistory;
  f.h.appendHistory = async rows => { if (rows.some(row => row.visibleAttemptId === 'u1')) await gate; return append(rows); };
  const choosing = f.h.handleMessage({ type: 'selectAnswerAttempt', rootId: 'u1', attemptId: 'u1', choose: false });
  const sending = f.h.handleMessage({ type: 'sendMessage', text: '다음', history: copy(f.history), userMessageId: 'u3' });
  await new Promise(resolve => setTimeout(resolve, 20));
  release(); await choosing; await sending;
  assert.equal(f.calls.sdk.length, 1);
  assert.equal(JSON.stringify(f.calls.sdk[0].history.map(x => x.content)), JSON.stringify(['질문', '첫 답']));
});
test('a late selection acknowledgement after a scope change is not posted', async t => {
  const f = fixture(t); f.history.push(...transcript());
  let release; const gate = new Promise(resolve => { release = resolve; });
  const append = f.h.appendHistory;
  f.h.appendHistory = async rows => { await gate; return append(rows); };
  const choosing = f.h.handleMessage({ type: 'selectAnswerAttempt', rootId: 'u1', attemptId: 'u1', choose: false });
  f.h.nativeHistoryScope = 'task-b';
  release(); await choosing;
  assert.equal(f.posts.filter(p => p.type === 'answerAttemptSelected').length, 0);
});
for (const runtimeMode of ['proxy', 'agent-sdk']) test(`${runtimeMode}: retry after browsing back makes the new attempt the visible one and the next history`, async t => {
  const f = fixture(t, { runtimeMode, resolvedProfile: { ...copy(profile), coach_runtime: runtimeMode } });
  const calls = runtimeMode === 'proxy' ? f.calls.proxy : f.calls.sdk;
  await f.h.handleMessage({ type: 'sendMessage', text: '질문', history: [], userMessageId: 'u1' });
  await f.h.handleMessage({ type: 'retryMessage', prompt: '질문', history: copy(f.history), sourceMessageId: 'u1', userMessageId: 'u2' });
  await f.h.handleMessage({ type: 'selectAnswerAttempt', rootId: 'u1', attemptId: 'u1', choose: false });
  assert.equal(f.history[0].visibleAttemptId, 'u1');
  await f.h.handleMessage({ type: 'retryMessage', prompt: '질문', history: copy(f.history), sourceMessageId: 'u1', userMessageId: 'u3' });
  assert.equal(f.history[0].visibleAttemptId, 'u3', 'the new attempt is shown');
  assert.equal(attemptGroups(f.history)[0].index, 2);
  await f.h.handleMessage({ type: 'sendMessage', text: '다음', history: copy(f.history), userMessageId: 'u4' });
  assert.ok(calls.at(-1).history.find(x => x.role === 'assistant').content.endsWith('3'), 'the third answer is what the next turn carries');
});
test('attempts group only within one tool mode', () => {
  const rows = [u('u1', { toolMode: 'auto' }), a('a1', '첫 답'), u('u2', { retryOf: 'u1', toolMode: 'web-search' }), a('a2', '검색 답')];
  assert.equal(attemptGroups(rows).length, 2, 'a web-search retry is not an attempt of an auto prompt');
  assert.deepEqual(visibleAttempts(rows).items.map(x => x.id), ['u1', 'a1', 'u2', 'a2']);
  const same = [u('u1'), a('a1', '첫 답'), u('u2', { retryOf: 'u1', toolMode: 'auto' }), a('a2', '둘째 답')];
  assert.equal(attemptGroups(same).length, 1, 'an unset mode is auto');
});
