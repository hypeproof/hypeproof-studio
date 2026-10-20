import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {document as doc,mountPoint} from '../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';
import {boardStatusScript,renderBoardStatusPage} from '../src/lib/board-status.ts';
const proto=Object.getPrototypeOf(doc.createElement('div'));
proto.replaceChildren=function(...children){while(this.firstChild)this.removeChild(this.firstChild);this.append(...children);};
const ui=Function(boardStatusScript+';return boardStatus;')();
const labels=['작업 중','막힘','선생님 확인 필요','쉬는 중','끝남','확인 불가'];
assert.deepEqual(Object.values(ui.states).map(x=>x.label),labels);
assert.equal(new Set(Object.values(ui.states).map(x=>x.icon)).size,6);
for (const [state,key] of [['ok','working'],['failing','blocked'],['stuck','blocked'],['slowing','review'],['quiet','unknown'],['absent','unknown'],['silent','unknown'],['<img>','unknown'],['toString','unknown']]) assert.equal(ui.legacy({state}),key,state);
const fresh={signal:'fresh',attention:'ok'};
for (const [extra,want] of [
 [{runtime:{status:'running'}},'working'],[{runtime:{status:'error'}},'blocked'],
 [{attention:'blocked',runtime:{status:'running'}},'blocked'],[{attention:'caution'},'review'],
 [{runtime:{status:'idle'}},'idle'],[{runtime:{status:'waiting_approval'}},'unknown'],
 [{step:{status:'submitted',basis:'current'}},'done'],[{step:{status:'reviewed',basis:'current'}},'done'],
 [{step:{status:'submitted',basis:'previous'}},'unknown'],[{step:{status:'reviewed',basis:'unknown'}},'unknown'],
 [{step:{status:'submitted'}},'unknown'],[{runtime:{status:'running'},step:{status:'submitted',basis:'current'}},'working'],
 [{signal:'stale',runtime:{status:'idle'},step:{status:'submitted',basis:'current'}},'unknown'],
 [{signal:'none',runtime:{status:'running'}},'unknown'],[{attention:'unknown',runtime:{status:'running'}},'unknown'],
 [{runtime:{status:'waiting_user'},step:{status:'submitted',basis:'current'}},'unknown'],
 [{runtime:{status:'waiting_approval'},step:{status:'submitted',basis:'current'}},'unknown'],
 [{runtime:{status:'running',received_at:10},sample:{runtime_status:'idle',received_at:11}},'idle'],
 [{runtime:{status:'idle',received_at:12},sample:{runtime_status:'running',received_at:11}},'idle'],
 [{},'unknown'],
]) assert.equal(ui.ops({...fresh,...extra}),want,JSON.stringify(extra));
assert.equal(ui.ops(fresh,true),'review');
assert.equal(ui.ops({...fresh,signal:'stale'},true),'unknown');
assert.equal(ui.ops({...fresh,attention:'blocked'},true),'blocked');
for(const key of Object.keys(ui.states)) {
 const chip=ui.chip(key);assert.ok(chip.textContent.includes(ui.states[key].label));
 assert.equal(chip.children[0].getAttribute('aria-hidden'),'true');
 assert.equal(chip.children[0].textContent,ui.states[key].icon);
 assert.ok(chip.className.includes('cgp-'+key));assert.equal(chip.title,ui.states[key].detail);
}
assert.ok(ui.chip('constructor').textContent.includes('확인 불가'));
const host=mountPoint();const keys=Object.keys(ui.states);let selected='all';
const draw=()=>ui.filters(host,keys,selected,key=>{selected=key;draw();});
draw();assert.equal(host.children.length,7);
const by=key=>host.children.find(x=>x.getAttribute('data-state')===key);
for(const key of keys){
 assert.equal(by(key).getAttribute('aria-pressed'),'false');assert.equal(by(key).type,'button');
 by(key).onclick();assert.equal(selected,key);assert.equal(by(key).getAttribute('aria-pressed'),'true');
 assert.equal(by('all').getAttribute('aria-pressed'),'false');
 by(key).onclick();assert.equal(selected,'all');assert.equal(by('all').getAttribute('aria-pressed'),'true');
}
by('unknown').focus();draw();assert.ok(doc.activeElement===by('unknown'),'filter refresh keeps focused button');
// Chalk's own esbuild (via wrangler): CI installs the app deps without optional binaries. Wrangler keeps function names; serializing a compiled closure used to leak __name.
const require=createRequire(new URL('../package.json',import.meta.url));
const compiled=require('esbuild').buildSync({entryPoints:[fileURLToPath(new URL('../src/lib/board-status.ts',import.meta.url))],bundle:true,keepNames:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports});
for(const page of ['board','manage']){
 const html=readFileSync(new URL('../src/ui/'+page+'.html',import.meta.url),'utf8');
 const rendered=module.exports.renderBoardStatusPage(html);
 assert.equal(rendered,renderBoardStatusPage(html),"compiled and source payload agree");
 assert.ok(!rendered.includes('// BOARD_STATUS_SCRIPT'));assert.ok(!rendered.includes('/* BOARD_STATUS_CSS */'));
 // Execute the exact browser factory embedded by the route, not a separate mirror.
 const start=rendered.indexOf('const boardStatus = (')+'const boardStatus = ('.length;
 const end=rendered.indexOf(')();',start);
 const factory=Function('return ('+rendered.slice(start,end)+')')();
 assert.equal(factory().ops({...fresh,runtime:{status:'idle'}}),'idle');
}
console.log('board status mapping, icons, filters and shipped injection PASS');

// Execute the actual legacy page read path. A late read cannot restore cleared counts
// after disconnect, overwrite a newer poll, or display a different cohort's results.
const nodes=new Map();
const element=id=>{if(!nodes.has(id))nodes.set(id,doc.createElement('div'));return nodes.get(id);};
const requests=[];
const pageDoc={getElementById:element,createElement:doc.createElement.bind(doc),createTextNode:doc.createTextNode.bind(doc),activeElement:doc.activeElement};
const ctx=vm.createContext({document:pageDoc,location:{hash:'',search:'',pathname:'/board'},history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},URLSearchParams,setInterval(){return 1;},clearInterval(){},console,fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))});
const shipped=renderBoardStatusPage(readFileSync(new URL('../src/ui/board.html',import.meta.url),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInContext(shipped,ctx);
const payload={seats:[],degraded:[],thresholds:{},roster:{},now:1};
const load=()=>vm.runInContext('load()',ctx);
const stop=()=>vm.runInContext('stop()',ctx);
const answer=req=>req.resolve({ok:true,json:async()=>payload});
element('issuer').value='synthetic';element('cohort').value='class-a';
let pending=load();stop();answer(requests.shift());await pending;
assert.equal(element('summary').children.length,0,'late response after stop ignored');
pending=load();element('cohort').value='class-b';answer(requests.shift());await pending;
assert.equal(element('summary').children.length,0,'changed cohort ignores old response');
pending=load();const old=requests.shift();const newer=load();answer(requests.shift());await newer;
assert.equal(element('summary').children.length,7,'current successful read renders filters');
old.reject(new Error('late failure'));await pending;
assert.equal(element('summary').children.length,7,'late failure cannot clear newer counts');
pending=load();requests.shift().reject(new Error('current failure'));await pending;
assert.equal(element('summary').children.length,0,'current failure clears previous counts');
console.log('actual board request generation and disconnect races PASS');
