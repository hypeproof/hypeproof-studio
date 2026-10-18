import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskHarness } from './task-workspace-harness.mjs';
const urls = ['https://example.org/a', 'https://example.org/b'];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'hps-source-flow-'));
  const f = await createTaskHarness(root);
  await f.store.append(f.store.getView().activeTaskId, [{ id: 'sources', role: 'assistant', content: 'Sources', createdAt: 1, citations: urls.map(url => ({url,title:url,domain:'example.org',tier:4})) }]);
  return { ...f, cleanup: () => rm(root, {recursive:true,force:true}) };
}
test('source acknowledgment and return bind exact task/request/origin surface; repeat open reuses owned tab', async () => {
  const f = await setup();
  try {
    const taskId = f.store.getView().activeTaskId;
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[0],requestId:'first'}));
    assert.deepEqual(f.posts.findLast(p=>p.type==='sourceOpenResult'), {type:'sourceOpenResult',requestId:'first',taskId,activityId:f.activity.id,url:urls[0],opened:true});
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[0],requestId:'second'}));
    assert.equal(f.opened.length,1);
    for (const bad of [{requestId:'first',url:urls[0]},{requestId:'second',url:urls[1]}]) {
      await f.handle(f.scoped({type:'taskReturnFromSource',...bad}));
      assert.equal(f.posts.at(-1).opened,false); assert.equal(f.browserState.commands.length,0);
    }
    await f.h.handleMessage(f.scoped({type:'taskReturnFromSource',url:urls[0],requestId:'second'}), {postMessage: async()=>true});
    assert.equal(f.browserState.commands.length,0,'foreign surface cannot take focus');
    await f.handle(f.scoped({type:'taskReturnFromSource',url:urls[0],requestId:'second'}));
    assert.equal(f.posts.findLast(p=>p.type==='sourceReturn').requestId,'second');
    assert.deepEqual(f.browserState.commands,['editorChat.reveal']);
  } finally {await f.cleanup();}
});
test('replace only owned unchanged source tab; preserve user navigation and unrelated tabs', async () => {
  const f = await setup();
  try {
    const foreign={url:'https://foreign.example',close:async()=>{throw Error('must not close')}};f.browserState.tabs.push(foreign);
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[0],requestId:'a'}));
    const first=f.browserState.tabs.at(-1);
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[1],requestId:'b'}));
    assert.equal(f.browserState.tabs.includes(first),false);
    const navigated=f.browserState.tabs.at(-1);navigated.url='https://example.org/user-navigation';
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[0],requestId:'c'}));
    assert.ok(f.browserState.tabs.includes(navigated));assert.ok(f.browserState.tabs.includes(foreign));
  } finally {await f.cleanup();}
});
test('failed opening/focus and unsafe URLs never acknowledge success; a stale asynchronous open cannot attach to another task', async () => {
  const f=await setup();
  try {
    f.browserState.failOpen=true;
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[0],requestId:'fail'}));
    assert.equal(f.posts.at(-1).opened,false);assert.equal(f.opened.length,0);
    f.browserState.failOpen=false;
    for(const url of ['javascript:alert(1)','https://unknown.example','https://name:password@example.org/a']) {
      await f.handle(f.scoped({type:'taskOpenSource',url,requestId:'unsafe'}));assert.equal(f.posts.at(-1).opened,false);
    }
    await f.handle(f.scoped({type:'taskOpenSource',url:urls[0],requestId:'focus'}));
    f.browserState.failReturn=true;
    await f.handle(f.scoped({type:'taskReturnFromSource',url:urls[0],requestId:'focus'}));assert.equal(f.posts.at(-1).opened,false);assert.equal(f.posts.some(p=>p.type==='sourceReturn'),false);
    f.browserState.failReturn=false;
    let resolveOpen,entered;const waiting=new Promise(r=>{entered=r});
    f.browserState.beforeOpen=()=>{entered();return new Promise(r=>{resolveOpen=r})};
    const pending=f.handle(f.scoped({type:'taskOpenSource',url:urls[1],requestId:'stale'}));
    await waiting;await f.store.create('new scope', {taskId:f.store.getView().activeTaskId,revision:f.store.getView().revision});resolveOpen();await pending;
    assert.equal(f.posts.some(p=>p.type==='sourceOpenResult'&&p.requestId==='stale'&&p.opened),false);
    assert.equal(f.browserState.tabs.some(t=>t.url===urls[1]),false);
  } finally {await f.cleanup();}
});
