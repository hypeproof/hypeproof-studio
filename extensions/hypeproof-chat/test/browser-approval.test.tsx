import {click,document as doc,mountPoint} from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserApprovalDialog} from '../webview-ui/src/BrowserApprovalDialog';
import {App} from '../webview-ui/src/App';
for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
const act=(React as any).act,host:any=mountPoint(),root=createRoot(host),answers:any[]=[];
const prompt={id:'request',title:'브라우저를 열까요?',host:'very-long-example-host-name.example',label:'인터넷',place:'internet' as const,rememberLabel:'이 사이트는 항상 허용 (very-long-example-host-name.example)'};
const fire=(el:any,type:string,extra={})=>el.dispatchEvent({type,bubbles:true,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this._stopped=true},...extra});
async function main(){
 await act(async()=>root.render(<BrowserApprovalDialog prompt={prompt} onAnswer={(...a)=>answers.push(a)}/>));
 assert.equal(doc.activeElement,host.querySelector('[data-browser-deny]'));assert.equal(host.querySelector('strong').textContent,prompt.host);assert.equal(host.querySelector('.hps-browser-badge').textContent,'인터넷');assert.equal(host.querySelector('svg').getAttribute('aria-hidden'),'true');assert.equal(host.querySelectorAll('button').length,3);
 await act(async()=>click(host.querySelector('[data-browser-remember]')));assert.deepEqual(answers.at(-1),['request','remember']);await act(async()=>click(host.querySelector('[data-browser-open]')));assert.equal(answers.length,1);
 await act(async()=>root.render(<BrowserApprovalDialog key="file" prompt={{...prompt,id:'file',place:'file',host:'<script>filename',label:'내 컴퓨터 파일',rememberLabel:null}} onAnswer={(...a)=>answers.push(a)}/>));assert.equal(host.querySelectorAll('button').length,2);assert.ok(!host.querySelector('script'));assert.match(host.querySelector('strong').textContent,/<script>/);
 const dialog=host.querySelector('dialog');await act(async()=>fire(dialog,'compositionstart'));await act(async()=>fire(dialog,'keydown',{key:'Escape',keyCode:27}));assert.equal(answers.length,1);await act(async()=>fire(dialog,'compositionend'));await act(async()=>fire(dialog,'keydown',{key:'Escape',keyCode:27}));assert.deepEqual(answers.at(-1),['file','deny']);
 await act(async()=>root.render(<App/>));const message=async(data:any)=>act(async()=>{(globalThis.window as any).dispatchEvent({type:'message',data,bubbles:false});});await message({type:'browserApprovalPrompt',prompt});await act(async()=>click(host.querySelector('[data-browser-open]')));assert.deepEqual((globalThis as any).__posted.at(-1),{type:'browserApprovalAnswer',id:'request',choice:'open'});
 await message({type:'browserApprovalPrompt',prompt});await message({type:'browserApprovalPrompt',prompt:null});assert.ok(!host.querySelector('.hps-browser-approval'));await act(async()=>root.unmount());console.log('PASS browser dialog and actual App: full host, text/shape badge, no file remember, safe labels, initial refusal, IME/Escape, once, bound reply');
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
