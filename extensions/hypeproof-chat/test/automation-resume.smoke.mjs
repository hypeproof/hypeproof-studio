import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const commands=[];
const vscode={commands:{executeCommand:async command=>commands.push(command)}};
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortSignal,URL,TextEncoder,TextDecoder});
const proto=module.exports.ChatPanelProvider.prototype;
let scope='returning',busy=false,editor=false,focusCount=0;
const stored=new Map([['returning',[{role:'user',content:'자료 요청을 자동화하고 싶어요.'},{role:'assistant',content:'메일 스킬이 준비됐어요.'}]]]);
const sent=[];
const host={
  focusEditor:()=>{focusCount++;return editor;},
  hasActiveStream:()=>busy,
  historyKey:()=>scope,
  getHistory:proto.getHistory,
  context:{workspaceState:{get:(key,fallback)=>stored.get(key)??fallback}},
  handleSend:async(text)=>{sent.push({scope,text});stored.set(scope,[{role:'user',content:text}]);},
};
// Returning to an existing activity is navigation, not a new paid AI request.
await proto.beginAutomationConversation.call(host);
await proto.beginAutomationConversation.call(host);
assert.equal(sent.length,0);
assert.equal(focusCount,2);
assert.equal(commands.length,2);
assert.equal(stored.get('returning').length,2,'existing messages remain intact');
// A fresh activity also waits for the learner: opening before funding selection is free.
scope='new-activity';editor=true;
await proto.beginAutomationConversation.call(host);
assert.equal(sent.length,0);
assert.equal(stored.has('new-activity'),false,'opening does not fabricate a user message');
await proto.beginAutomationConversation.call(host);
assert.equal(sent.length,0,'opening again still waits for explicit learner input');
assert.equal(commands.length,2,'an existing editor is focused without opening a duplicate sidebar');
// A busy or approval-blocked activity cannot start an extra onboarding request.
scope='busy-empty';busy=true;
await proto.beginAutomationConversation.call(host);
assert.equal(sent.length,0);
console.log('PASS automation resume: existing history opens without AI request; fresh activity waits for learner input; busy activity remains unchanged');
