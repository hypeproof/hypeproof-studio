// DES-CGP-DS-23: real seat rendering and keyboard navigation in the isolated DOM.
// Native Tab/Enter and visual geometry are additionally covered by list-rows.browser.mjs.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {document as doc} from '../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';
import {renderBoardStatusPage} from '../src/lib/board-status.ts';
const proto = Object.getPrototypeOf(doc.createElement('div'));
// mini-dom does not reflect the browser's className IDL attribute.
Object.defineProperty(proto,'className',{get(){return this.getAttribute('class')||'';},set(value){this.setAttribute('class',value);},configurable:true});
proto.replaceChildren ??= function (...children) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...children); };
const source = process.env.MANAGE_SOURCE ?? new URL('../src/ui/manage.html', import.meta.url);
const html = renderBoardStatusPage(readFileSync(source, 'utf8'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
const byId = (id) => { if (!nodes.has(id)) nodes.set(id, doc.createElement('div')); return nodes.get(id); };
const stub = { getItem() { return null; }, setItem() {}, removeItem() {} };
const media = () => ({ matches: false, addEventListener() {} });
const ctx = vm.createContext({
  document: { getElementById: byId, createElement: doc.createElement.bind(doc), createElementNS: doc.createElementNS.bind(doc), createTextNode: doc.createTextNode.bind(doc), activeElement: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: doc.createElement('body'), documentElement: doc.createElement('html') },
  window: { addEventListener() {}, matchMedia: media }, location: { hash: '', search: '', pathname: '/manage' }, history: { replaceState() {} },
  sessionStorage: stub, localStorage: stub, URLSearchParams, URL, console, Intl, Date, Math, JSON, crypto: globalThis.crypto,
  setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {}, matchMedia: media, navigator: { clipboard: {} },
  fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  MutationObserver: class { observe() {} disconnect() {} },
});
vm.runInContext(script, ctx);
const run = (code) => vm.runInContext(code, ctx);
const all = (node, cls) => { const out = []; const walk = (n) => { for (const c of n.children ?? []) { if (String(c.className ?? '').split(' ').includes(cls)) out.push(c); walk(c); } }; walk(node); return out; };


const seats=['A','B','C'].map(id=>({seat_id:id,student_id:'학생-'+id,attention:'ok',signal:'fresh'}));
run('renderSeats')({seats});
const rows=byId('ops-rows').children;
const buttons=all(byId('ops-rows'),'seat-open');
assert.equal(buttons.length,3);
for(let i=0;i<buttons.length;i++) {
 assert.equal(buttons[i].tagName.toLowerCase(),'button');
 assert.equal(buttons[i].type,'button');
 assert.equal(buttons[i].textContent,'상세');
 assert.ok(buttons[i].getAttribute('aria-label').includes(seats[i].student_id));
 assert.notEqual(buttons[i].tabIndex,-1,'native button stays in tab order');
 assert.ok(!buttons[i].disabled && !buttons[i].hidden);
}
run('globalThis.opened=[];openSeat=id=>opened.push(id)');
function key(i,key,want) {
 let prevented=false;
 buttons[i].onkeydown({key,preventDefault(){prevented=true;}});
 assert.ok(doc.activeElement===buttons[want],key+' reaches the expected row action');
 assert.ok(prevented);
}
buttons[0].focus();
key(0,'ArrowDown',1);key(1,'ArrowDown',2);key(2,'Home',0);key(0,'End',2);key(2,'ArrowUp',1);
// Filtering must skip hidden rows rather than sending keyboard focus into a faded/hidden action.
rows[1].hidden=true;key(0,'ArrowDown',2);key(2,'ArrowUp',0);
rows[1].hidden=false;
for(const button of buttons) button.onclick();
assert.deepEqual([...run('opened')],['A','B','C'],'every action addresses its own seat');
console.log('list row keyboard: real render, labels, every seat, filtered navigation and actor binding PASS');

// Budget allocations and pending requests are div-based lists, not table rows.
nodes.clear();
const budgetHtml=readFileSync(process.env.BUDGET_SOURCE ?? new URL('../src/ui/budgets.html',import.meta.url),'utf8');
const budgetCtx=vm.createContext({...ctx,AbortController});
vm.runInContext(budgetHtml.match(/<script>([\s\S]*?)<\/script>/)[1],budgetCtx);
vm.runInContext(`
 view={forecast:{reason:'fixture'},as_of:'2026-10-22',seats:[{subject_key:'seat-a',user_id:'학생 가'}],budgets:[{
 account:{id:'budget-a'},can_edit:true,balances:[],
 children:[{account:{id:'child-a',scope_id:'seat-a',kind:'cap'},balances:[]}],
 requests:[{id:'request-a',user_id:'학생 가',note:'추가 요청',state:'pending'}]}]};
 render();globalThis.edited=[];edit=(base,target)=>edited.push(target?.account.id??'new');
 globalThis.recorded=[];api=async(path,method,body)=>recorded.push({path,method,body});refresh=async()=>{};
`,budgetCtx);
const budgetButtons=[];
function collectButtons(node){for(const child of node.children??[]){if(child.tagName?.toLowerCase()==='button')budgetButtons.push(child);collectButtons(child);}}
collectButtons(byId('overview'));
assert.deepEqual(budgetButtons.map(b=>b.textContent),['학생 배분 추가','수업 배정 조절','조절','검토 완료 기록']);
for(const button of budgetButtons){assert.equal(button.type,'button');assert.notEqual(button.tabIndex,-1);assert.ok(!button.hidden&&!button.disabled);button.focus();assert.ok(doc.activeElement===button);await button.onclick();}
assert.deepEqual([...vm.runInContext('edited',budgetCtx)],['new','budget-a','child-a']);
assert.ok(vm.runInContext('recorded[0].path',budgetCtx).endsWith('/budget-requests/request-a'));
assert.equal(vm.runInContext('recorded[0].method',budgetCtx),'PUT');
console.log('budget list: visible labels, native focus and correct action actors PASS');
