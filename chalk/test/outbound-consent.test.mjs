// Exercise the real sharing script with a minimal DOM and intercepted HTTP.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
class Element {
 children=[]; value=''; checked=false; hidden=false; textContent=''; dataset={};
 constructor(tag=''){this.tag=tag;}
 append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=[...nodes];}
 addEventListener(){} focus(){if(!this.disabled&&this.isConnected!==false)document.activeElement=this;} reset(){} showModal(){this.open=true;} close(){this.open=false;}
 // Walks real descendants so the feedback-decision form that the page builds can be driven.
 all(){return this.children.flatMap(c=>typeof c==='object'&&c?[c,...c.all()]:[]);}
 querySelectorAll(){return [];}
 querySelector(sel){return this.all().find(n=>sel.includes(':checked')?n.tag==='input'&&n.type==='radio'&&n.checked:false)??null;}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
const document={activeElement:null,getElementById:get,createElement:tag=>new Element(tag),createTextNode:t=>t};
const requests=[];let shares=[],holdPost=false,releasePost;
const ctx=vm.createContext({document,window:{addEventListener(){}},Option:class{},TextEncoder,AbortController,crypto:webcrypto,setTimeout,clearTimeout,
 fetch:async(url,init)=>{requests.push({url,init});if(holdPost&&init.method==='POST')await new Promise(r=>releasePost=r);return Response.json(init.method==='POST'?{expires_at:1900000000}:{shares});}});
const html=readFileSync(new URL('../src/ui/sharing.html',import.meta.url),'utf8');
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
const event={preventDefault(){}};
get('token').value='synthetic-token';get('login').onsubmit(event);
await new Promise(r=>setImmediate(r));
get('recipient').value='synthetic-teacher';get('kind').value='help';get('prompt').value='한😀';get('consent').checked=true;get('duration').value='60';
const count=()=>requests.filter(r=>r.init.method==='POST').length;
let send=get('share').onsubmit(event);assert.equal(get('outbound').open,true);assert.equal(count(),0);
assert.deepEqual(get('outbound-items').textContent.split('\n'),['받는 사람: 강사 synthetic-teacher','보낼 항목:','내가 AI에게 보낸 말 · 7 바이트'],'recipient line, item list and byte size, exactly');
assert.equal(get('outbound-excluded').textContent,'포함하지 않는 것: AI 기억, 개인 메모','the fixed exclusion line is shown in the open dialog');
get('outbound-cancel').onclick();await send;assert.equal(count(),0,'Cancel has no HTTP POST');
send=get('share').onsubmit(event);get('prompt').value='not approved';get('outbound-send').onclick();await send;
assert.equal(count(),1);assert.equal(JSON.parse(requests.find(r=>r.init.method==='POST').init.body).content.prompt,'한😀','frozen form sent');
send=get('share').onsubmit(event);get('logout').onclick();await send;assert.equal(count(),1,'disconnect cancels outstanding preview');

get('token').value='synthetic-token';get('login').onsubmit(event);await new Promise(r=>setImmediate(r));
get('recipient').value='synthetic-teacher';get('prompt').value='한😀';
// Escape (the dialog's `cancel` event) is a Cancel, never a send: share form and decision form alike.
send=get('share').onsubmit(event);assert.equal(get('outbound').open,true);
get('outbound').oncancel({preventDefault(){}});await send;assert.equal(count(),1,'Escape on the share dialog has no HTTP POST');assert.equal(get('outbound').open,false);

// Feedback decision: the answer to a person's feedback goes to the instructor, so it has the same dialog.
shares=[{id:'share-1',kind:'help',recipient_id:'teacher-01',status:'answered',expires_at:1900000000,revision:1,feedback:'다시 써 보세요',response:null,content:{}}];
get('refresh').onclick();await new Promise(r=>setImmediate(r));
const form=get('records').children[0].all().find(n=>n.tag==='form');assert.ok(form,'the decision form is offered for an answered share');
const radios=form.all().filter(n=>n.tag==='input'&&n.type==='radio'),reason=form.all().find(n=>n.tag==='textarea');
radios.find(r=>r.value==='revise').checked=true;reason.value='고치겠습니다';
const posts=()=>requests.filter(r=>r.init.method==='POST');
send=form.onsubmit(event);await new Promise(r=>setImmediate(r));
assert.equal(get('outbound').open,true,'the decision opens the confirmation dialog');assert.equal(posts().length,1,'no decision POST while the dialog is open');
assert.deepEqual(get('outbound-items').textContent.split('\n'),['받는 사람: 강사 teacher-01','보낼 항목:','피드백 버전 · 1 바이트','내 결정 · 6 바이트','이유 · 18 바이트'],'decision dialog: recipient, items, sizes');
assert.equal(get('outbound-excluded').textContent,'포함하지 않는 것: AI 기억, 개인 메모');
get('outbound-cancel').onclick();await send;assert.equal(posts().length,1,'Cancel on the decision dialog has no HTTP POST');assert.equal(document.activeElement,form.all().find(n=>n.tag==='button'),'decision returns to enabled submit');
send=form.onsubmit(event);await new Promise(r=>setImmediate(r));
get('outbound').oncancel({preventDefault(){}});await send;assert.equal(posts().length,1,'Escape on the decision dialog has no HTTP POST');
send=form.onsubmit(event);await new Promise(r=>setImmediate(r));get('outbound-send').onclick();await send;
const decision=posts().find(r=>r.url.endsWith('/response'));assert.ok(decision,'approval sends the decision');
assert.deepEqual(JSON.parse(decision.init.body),{expected_revision:1,decision:'revise',reason:'고치겠습니다'});
// The real dismissal waits for exit, answers once and returns focus to the opener.
const opener=get('submit');opener.focus();
send=get('share').onsubmit(event);assert.equal(document.activeElement,get('outbound-cancel'));
let finishExit;get('outbound').getAnimations=()=>[{finished:new Promise(r=>finishExit=r)}];
get('outbound-cancel').onclick();get('outbound-send').onclick();
assert.equal(get('outbound').open,true);assert.equal(get('outbound').dataset.closing,'');
const beforeExit=posts().length;finishExit();await send;
assert.equal(posts().length,beforeExit,'double press cannot approve a cancelled exit');
assert.equal(get('outbound').open,false);assert.equal(document.activeElement,opener,'focus returns');
// The opener is focusable immediately on close, while an in-flight POST still owns the form.
get('outbound').getAnimations=()=>[];holdPost=true;
for(const target of [get('share'),form]){
 send=target.onsubmit(event);get('outbound-send').onclick();await new Promise(r=>setImmediate(r));
 const actor=target===form?form.all().find(n=>n.tag==='button'):get('submit');
 assert.equal(document.activeElement,actor,'focus restored before network completes');
 const before=posts().length;await target.onsubmit(event);
 assert.equal(get('outbound').open,false,'duplicate submission cannot open another consent');assert.equal(posts().length,before);
 releasePost();await send;
}
holdPost=false;
const detached=form.all().find(n=>n.tag==='button');detached.isConnected=false;
send=form.onsubmit(event);get('outbound-cancel').onclick();
assert.equal(document.activeElement,get('token'),'removed opener falls back to token');await send;
console.log('PASS Chalk outbound confirmation: byte size, immutable body, Cancel/Escape/disconnect zero POST, feedback decision dialog');
