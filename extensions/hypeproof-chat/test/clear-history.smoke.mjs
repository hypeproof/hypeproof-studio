import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
let choice,release,modalCount=0;
const vscode={window:{showWarningMessage:async()=>{modalCount++;return choice==='wait'?new Promise(r=>release=r):choice;}}};
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortSignal,URL,TextEncoder,TextDecoder});
const clear=module.exports.ChatPanelProvider.prototype.clearHistory;
let key='participant-a',streaming=false;const writes=[],posts=[];
const host={historyKey:()=>key,hasActiveStream:()=>streaming,context:{workspaceState:{update:async(k,v)=>writes.push([k,v])}},post:async msg=>posts.push(msg),aiDisclosure:{noticeForHistoryClear:()=> 'AI notice'}};
choice=undefined;await clear.call(host);assert.equal(writes.length,0,'cancel preserves history');
choice='대화 지우기';await clear.call(host);assert.equal(writes.length,1);assert.equal(writes[0][0],'participant-a');assert.equal(posts[0].type,'history');
streaming=true;const before=modalCount;await clear.call(host);assert.equal(modalCount,before,'cannot clear an active conversation');streaming=false;
choice='wait';const pending=clear.call(host);await clear.call(host);assert.equal(modalCount,before+1,'duplicate opens no second dialog');key='participant-b';release('대화 지우기');await pending;assert.equal(writes.length,1,'identity change cannot clear either history');
console.log('PASS clear history: explicit confirmation, cancellation, duplicate, active-stream and identity-change protection');

// Task transitions are already asynchronous before the confirmation can open.
const transitionDialogs=modalCount;host.taskChanging=true;await clear.call(host);assert.equal(modalCount,transitionDialogs);host.taskChanging=false;
let activeTask='a',fail=true;const cleared=[];
host.currentTaskStore=()=>store;const store={getView:()=>({activeTaskId:activeTask}),clearHistory:async id=>{if(fail)throw new Error('/private/sensitive/store');cleared.push(id);}};
choice='대화 지우기';const beforeFailure=writes.length;await clear.call(host);assert.equal(writes.length,beforeFailure);assert.equal(cleared.length,0);assert.equal(posts.at(-1).type,'taskWorkspaceError');assert.match(posts.at(-1).error,/다시 시도/);assert.ok(!posts.at(-1).error.includes('/private'));assert.equal(host.clearingHistory,false);
fail=false;await clear.call(host);assert.deepEqual(cleared,['a'],'explicit retry clears original task');
choice='wait';const scoped=clear.call(host);activeTask='b';release('대화 지우기');await scoped;assert.deepEqual(cleared,['a'],'confirmation never retargets another task');
console.log('PASS clear history failure feedback, retry and task-scope guards');
