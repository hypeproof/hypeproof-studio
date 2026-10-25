// CGP-CHAT-R-026 — the learner searches their own tasks on this device. Pure search behaviour, the real disk
// store and the real host handler: titles and user/assistant text match (case-insensitive, NFKC), one result
// per task at its latest matching message, snippet as plain parts with the match marked, control and bidi
// characters removed, tool/system lines never searched, at most 50 results; the host answers only the asking
// view, even for a stale task id, never through post() (which would invalidate open approval prompts), never
// for another activity, and with no network request.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchTasks, normalizeTaskQuery, searchPlainText, TASK_SEARCH_QUERY_MAX, TASK_SEARCH_RESULT_MAX } from '../src/taskSearch.ts';
import { TaskWorkspaceStore } from '../src/taskWorkspaceStore.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const msg = (id, role, content, createdAt = 1000) => ({ id, role, content, createdAt });
const text = (parts) => parts.map((p) => p.text).join('');
const bold = (parts) => parts.filter((p) => p.match).map((p) => p.text);

// --- pure search
{
  const tasks = [
    { id: 'a', title: '날씨 앱 만들기', updatedAt: 50, messages: [msg('a1', 'user', 'Weather API 를 어떻게 불러요?', 10), msg('a2', 'assistant', 'fetch 로 weather 를 불러요.', 11), msg('a3', 'tool', 'weather 도구 원시 결과', 12), msg('a4', 'system', 'weather 안내', 13)] },
    { id: 'b', title: '자기소개 페이지', updatedAt: 90, messages: [msg('b1', 'user', '배경을 <b>무지개</b>로\u202e 바꿔 줘\u2028다음 줄', 20)] },
    { id: 'c', title: 'Weather 정리', updatedAt: 70, messages: [] },
  ];
  assert.deepEqual(searchTasks(tasks, ''), []);
  assert.deepEqual(searchTasks(tasks, '   '), []);
  assert.deepEqual(searchTasks(tasks, 42), []);

  const weather = searchTasks(tasks, 'WEATHER');
  assert.deepEqual(weather.map((r) => r.taskId), ['c', 'a'], 'one result per task, newest first');
  const a = weather.find((r) => r.taskId === 'a');
  assert.equal(a.messageId, 'a2', 'the latest matching user/assistant message, never a tool or system line');
  assert.equal(a.at, 11, 'the date is the matched message time');
  assert.deepEqual(bold(a.snippet), ['weather']);
  assert.equal(text(a.title), '날씨 앱 만들기');
  const c = weather.find((r) => r.taskId === 'c');
  assert.equal(c.messageId, undefined, 'a name-only match opens the task without a message target');
  assert.deepEqual(bold(c.title), ['Weather']);
  assert.deepEqual(c.snippet, []);
  assert.equal(c.at, 70);
  assert.deepEqual(searchTasks(tasks, '원시 결과'), [], 'tool output is not searched');
  assert.deepEqual(searchTasks(tasks, '안내'), [], 'system notices are not searched');

  const rainbow = searchTasks(tasks, '무지개');
  assert.equal(rainbow.length, 1);
  assert.equal(text(rainbow[0].snippet), '배경을 <b>무지개</b>로 바꿔 줘 다음 줄', 'markup stays text; bidi removed, U+2028 a space');
  assert.ok(!/[\u202a-\u202e\u2066-\u2069\u2028\u2029\u0000-\u001f]/.test(text(rainbow[0].snippet)));
  // NFKC: a full-width query finds ASCII text, and the reverse.
  assert.equal(searchTasks(tasks, 'ＷＥＡＴＨＥＲ').length, 2);
  assert.equal(normalizeTaskQuery('a\u0000b\u202ec'), 'a bc');
  assert.equal(Array.from(normalizeTaskQuery('가'.repeat(500))).length, TASK_SEARCH_QUERY_MAX);
  assert.equal(searchPlainText('**굵게** `코드`'), '굵게 코드');

  // A long message: the snippet is a window around the match with ellipses, cut on code points.
  const long = [{ id: 'l', title: 't', updatedAt: 1, messages: [msg('l1', 'assistant', '😀'.repeat(200) + ' 목표 ' + '끝'.repeat(200))] }];
  const snip = searchTasks(long, '목표')[0].snippet;
  assert.equal(snip[0].text, '…'); assert.equal(snip.at(-1).text, '…');
  assert.ok(Array.from(text(snip)).length < 100);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(text(snip)), 'no split surrogate pair');

  // Case folding that changes length keeps the marked range on the original text.
  const turkish = searchTasks([{ id: 't', title: 'İstanbul gezi', updatedAt: 1, messages: [] }], 'gezi');
  assert.deepEqual(bold(turkish[0].title), ['gezi']);

  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, title: `과제 ${i}`, updatedAt: i, messages: [] }));
  assert.equal(searchTasks(many, '과제').length, TASK_SEARCH_RESULT_MAX);
  assert.equal(searchTasks(many, '과제')[0].taskId, 'm79');
}

// --- real disk store and real host
const root = await mkdtemp(join(tmpdir(), 'task-search-'));
const realFetch = globalThis.fetch;
let network = 0;
globalThis.fetch = (...args) => { network++; return realFetch(...args); };
try {
  const f = await createTaskHarness(root);
  const first = f.store.getView().activeTaskId;
  await f.store.append(first, [msg('u1', 'user', '버튼 색을 파랗게 바꾸고 싶어요', 1000), msg('r1', 'assistant', 'CSS 의 color 를 바꾸면 돼요.', 1001)]);
  await f.store.create('새 작업', { taskId: first, revision: f.store.getView().revision });
  const second = f.store.getView().activeTaskId;
  await f.store.append(second, [msg('u2', 'user', '그림을 넣고 싶어요', 2000)]);

  // Store: other tasks are searched from the task file, not only the open one.
  const fromStore = f.store.search('파랗게');
  assert.deepEqual(JSON.parse(JSON.stringify(fromStore.map((r) => [r.taskId, r.messageId]))), [[first, 'u1']]);
  const unread = await mkdtemp(join(tmpdir(), 'task-search-empty-'));
  assert.equal(new TaskWorkspaceStore(unread, 'nobody').search('파랗게'), null, 'an unread task file is "cannot search", not "no match"');
  await rm(unread, { recursive: true, force: true });
  const reopened = new TaskWorkspaceStore(root, 'synthetic-personal-a');
  assert.deepEqual([...reopened.search('파랗게').map((r) => r.messageId)], ['u1'], 'a reopened store finds the saved text');

  // Privacy on disk: a superseded (edited-away) version and a tool line are kept by the store but never
  // searched, and another learner's or classroom scope in the same folder is never read.
  await f.store.append(second, [msg('u3', 'user', '고양이 그려 줘', 2100), { ...msg('t3', 'tool', '도구원시출력 비밀', 2101), tool: { icon: '🔧', label: 'Write(x)', state: 'done' } }, msg('a3', 'assistant', '고양이 답', 2102)]);
  await f.store.append(second, [{ ...msg('u3b', 'user', '강아지 그려 줘', 2200), editOf: 'u3' }, msg('a3b', 'assistant', '강아지 답', 2201)]);
  assert.ok(f.store.getHistory(second).some((m) => m.id === 'u3'), 'fixture: the earlier version is still stored');
  assert.equal(f.store.search('고양이').length, 0, 'a superseded version is not searched');
  assert.equal(f.store.search('도구원시출력').length, 0, 'tool output is not searched');
  assert.deepEqual([...f.store.search('강아지').map((r) => r.messageId)], ['a3b']);
  const otherLearner = new TaskWorkspaceStore(root, 'synthetic-classroom-b');
  await otherLearner.initialize();
  await otherLearner.append(otherLearner.getView().activeTaskId, [msg('x1', 'user', '다른학생비밀 문장', 3000)]);
  assert.equal(f.store.search('다른학생비밀').length, 0, 'another scope on this device is never searched');
  assert.equal(new TaskWorkspaceStore(root, 'synthetic-personal-a').search('다른학생비밀').length, 0, 'not even after a reread');

  // Host: answers the asking view only, even when the view's task id is stale, without post().
  let invalidated = 0;
  f.h.writeApprovalRequest = { cancel() {}, invalidate() { invalidated++; }, respond() {} };
  const asked = [];
  const other = { postMessage: async (message) => { asked.push(JSON.parse(JSON.stringify(message))); return true; } };
  const before = f.posts.length;
  await f.h.handleMessage({ type: 'taskSearch', query: '파랗게', requestId: 'req-1', activityId: f.activity.id, taskId: first }, other);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].type, 'taskSearchResult');
  assert.equal(asked[0].requestId, 'req-1');
  assert.equal(asked[0].scope, f.store.scope);
  assert.equal(asked[0].taskId, second, 'tagged with the open task so a view on another activity/task drops it');
  assert.deepEqual(asked[0].results.map((r) => r.messageId), ['u1']);
  assert.equal(f.posts.length, before, 'nothing broadcast to the other views, no task error for a stale task id');
  assert.equal(invalidated, 0, 'an open approval prompt survives a search');
  assert.equal(f.store.getView().activeTaskId, second, 'searching never switches task');

  // Another activity's view, malformed requests, and a seat without a task workspace get no answer.
  await f.h.handleMessage({ type: 'taskSearch', query: '파랗게', requestId: 'req-2', activityId: 'someone-else', taskId: second }, other);
  await f.h.handleMessage({ type: 'taskSearch', query: '파랗게', requestId: 'x'.repeat(101), activityId: f.activity.id }, other);
  await f.h.handleMessage({ type: 'taskSearch', query: { toString: () => '파랗게' }, requestId: 'req-3', activityId: f.activity.id }, other);
  assert.equal(asked.length, 1);
  const workspace = f.h.taskWorkspace;
  f.h.taskWorkspace = undefined;
  await f.h.handleMessage({ type: 'taskSearch', query: '파랗게', requestId: 'req-4', activityId: f.activity.id }, other);
  f.h.taskWorkspace = workspace;
  assert.equal(asked.length, 1, 'no task workspace (classroom seat): no search');
  assert.equal(network, 0, 'search makes no network request');
  // Nothing but the answer leaves the handler: no broadcast, no model/Service message type of any kind.
  assert.deepEqual(asked.map((m) => m.type), ['taskSearchResult']);
  assert.equal(f.posts.length, before, 'no outbound host message of any type');
  console.log('PASS task search: pure matching, snippet safety, disk store, host answer routing, no network');
} finally {
  globalThis.fetch = realFetch;
  await rm(root, { recursive: true, force: true });
}
