import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?{}:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortSignal,URL,TextEncoder,TextDecoder});
const proto=module.exports.ChatPanelProvider.prototype;
const storage=new Map();
const context={workspaceState:{get:(key,fallback)=>storage.get(key)??fallback,update:async(key,value)=>storage.set(key,structuredClone(value))}};
const makeHost=()=>Object.assign(Object.create(proto),{context,activeCohortId:'synthetic-activity',activeStreams:new Map([['turn',{}]]),turnTimelines:new Map(),nativeHistoryScope:null});
const host=makeHost();
host.turnTimelines.set('turn',{items:[
 {id:'reply',role:'assistant',content:'메일 스킬을 준비했어요.',createdAt:1},
 {id:'saved',role:'tool',content:'',createdAt:2,tool:{icon:'',label:'스킬 저장',state:'done'}},
 {id:'oauth',role:'tool',content:'',createdAt:3,tool:{icon:'',label:'Google 연결',state:'running'}},
],openId:null,baseId:'reply',seg:1,pending:[]});
host.recordAutomationAnswer({id:'public',kind:'choice',private:false,title:'어떤 업무인가요?',choices:[{id:'request',label:'자료 요청'}]},{questionId:'public',choiceId:'request'});
host.recordAutomationAnswer({id:'private',kind:'sheet',private:true,title:'비공개 설정'},{questionId:'private',text:'private-sheet-value'});
await host.preserveInterruptedAutomationTurn('turn','reply','자료 요청 메일을 만들고 싶어요.','메일 스킬을 준비했어요.',[],'코치');
// A fresh provider reads the same activity history without any runtime/tool call.
const reopened=makeHost(),history=reopened.getHistory();
assert.equal(history[0].content,'자료 요청 메일을 만들고 싶어요.');
assert.ok(history.some(m=>m.role==='assistant'&&m.content==='어떤 업무인가요?'));
assert.ok(history.some(m=>m.role==='user'&&m.content==='자료 요청'));
assert.equal(history.find(m=>m.id==='saved').tool.state,'done','confirmed results survive Stop');
assert.equal(history.find(m=>m.id==='oauth').tool.state,'error','interrupted work never reopens as running');
assert.match(history.at(-1).content,/중지/);assert.match(history.at(-1).content,/자동으로 다시 실행하지/);
assert.equal(JSON.stringify(history).includes('private-sheet-value'),false,'private answers never become conversation history');
reopened.activeCohortId='different-activity';assert.equal(reopened.getHistory().length,0,'another activity does not inherit the interrupted conversation');
console.log('PASS interrupted automation: public answers, explicit cancellation, stable history reload, private exclusion and activity isolation');
