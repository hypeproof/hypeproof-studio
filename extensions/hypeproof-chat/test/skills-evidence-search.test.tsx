import React, {act} from 'react';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {SkillsPanel} from '../webview-ui/src/SkillsPanel';
const {JSDOM}=createRequire(process.cwd()+'/package.json')('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://studio.test',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=require('react-dom/client');
const view:any={available:true,notice:null,week:null,result:null,skills:[{skill:'product-builder',title:'제품 고치기'},{skill:'critic',title:'검토하기'}],pickers:{experiments:[],decisions:[],evidence:[{id:'a',label:'인터뷰 Alpha'},{id:'b',label:'관찰 Beta'},{id:'c',label:'인터뷰 Gamma'}]}};
async function run(){
 const host=document.getElementById('root')!;const root=createRoot(host);const sent:any[]=[];
 await act(async()=>root.render(<SkillsPanel view={view} error={null} done={null} running={false} onRefresh={()=>{}} onClose={()=>{}} onRun={(skill,form)=>sent.push({skill,form})}/>));
 const click=async(el:any)=>{assert.ok(el);await act(async()=>el.click());};
 await click(host.querySelector('[data-testid="skill-product-builder"]'));
 const search=()=>host.querySelector('input[aria-label="근거 검색"]') as HTMLInputElement;
 assert.ok(search(),'evidence search exists');
 const query=async(text:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(search(),text);search().dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
 const boxes=()=>Array.from(host.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
 await click(boxes()[0]);
 await query('  bETA  ');assert.equal(boxes().length,1);assert.match(boxes()[0].parentElement!.textContent!,/Beta/);
 await click(boxes()[0]);assert.match(host.textContent!,/선택한 근거 2개/);
 await query('no such evidence');assert.equal(boxes().length,0);assert.match(host.textContent!,/검색 결과가 없어요/);
 await click(host.querySelector('[data-testid="skill-run"]'));
 assert.deepEqual(sent,[{skill:'product-builder',form:{evidence_refs:['a','b']}}]);
 (host.querySelector('button[aria-label="근거 검색 지우기"]') as HTMLButtonElement).focus();
 await click(host.querySelector('button[aria-label="근거 검색 지우기"]'));
 assert.equal(document.activeElement,search(),'clearing keeps keyboard focus in search');
 assert.equal(search().value,'');assert.equal(boxes().length,3);assert.deepEqual(boxes().map(b=>b.checked),[true,true,false]);
 await query('인터뷰');assert.equal(boxes().length,2);
 await click(host.querySelector('[data-testid="skill-critic"]'));
 await click(host.querySelector('[data-testid="skill-product-builder"]'));
 assert.equal(search().value,'');assert.equal(boxes().length,3);assert.ok(boxes().every(b=>!b.checked));
 await act(async()=>root.unmount());dom.window.close();
 console.log('PASS evidence search: matching, empty result, clear, retained callback selection and skill reset');
}
// React scheduler may retain a MessagePort after the jsdom window closes.
run().then(()=>process.exit(0)).catch(error=>{console.error(error);dom.window.close();process.exit(1);});
