import {click,document as doc,mountPoint} from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CommandApprovalDialog} from '../webview-ui/src/CommandApprovalDialog';
import {App} from '../webview-ui/src/App';
for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
const act=(React as any).act,host:any=mountPoint(),root=createRoot(host),answers:any[]=[];
const prompt:any={id:'normal',purpose:'shell',command:'ls <script>\n  cat long-file',destructive:false,rememberAllowed:true};
const fire=(el:any,type:string,extra={})=>el.dispatchEvent({type,bubbles:true,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this._stopped=true},...extra});
async function main(){
 await act(async()=>root.render(<CommandApprovalDialog prompt={prompt} onAnswer={(...a)=>answers.push(a)}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 명령을 실행하려고 해요');assert.equal(doc.activeElement,host.querySelector('[data-command-allow]'));assert.equal(host.querySelector('pre').textContent,'$ '+prompt.command);assert.ok(!host.querySelector('script'));assert.equal(host.querySelectorAll('button').length,3);
 await act(async()=>click(host.querySelectorAll('button')[2]));assert.deepEqual(answers.at(-1),['normal','remember']);await act(async()=>click(host.querySelector('[data-command-allow]')));assert.equal(answers.length,1);
 await act(async()=>root.render(<CommandApprovalDialog key="danger" prompt={{...prompt,id:'danger',destructive:true}} onAnswer={(...a)=>answers.push(a)}/>));
 assert.equal(doc.activeElement,host.querySelector('[data-command-deny]'));assert.equal(host.querySelectorAll('button').length,2);assert.match(host.textContent,/되돌릴 수 없어요/);
 const dialog=host.querySelector('dialog');await act(async()=>fire(dialog,'compositionstart'));await act(async()=>fire(dialog,'keydown',{key:'Escape',keyCode:27}));assert.equal(answers.length,1);await act(async()=>fire(dialog,'compositionend'));await act(async()=>fire(dialog,'keydown',{key:'Escape',keyCode:27}));assert.deepEqual(answers.at(-1),['danger','deny']);
 // M3: the native dialog cancel (the browser's own Esc close request) refuses.
 await act(async()=>root.render(<CommandApprovalDialog key="native-cancel" prompt={{...prompt,id:'native-cancel'}} onAnswer={(...a)=>answers.push(a)}/>));
 const nativeCancel=fire(host.querySelector('dialog'),'cancel',{bubbles:false});assert.deepEqual(answers.at(-1),['native-cancel','deny'],'native cancel refuses');
 // The heading is app copy picked by kind: hostile or unknown purpose values never render as text.
 await act(async()=>root.render(<CommandApprovalDialog key="hostile" prompt={{...prompt,id:'hostile',purpose:'Bash: rm -rf /'}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 알 수 없는 도구를 쓰려고 해요');assert.ok(!host.querySelector('h2').textContent.includes('Bash'));
 await act(async()=>root.render(<CommandApprovalDialog key="kind-destructive" prompt={{...prompt,id:'kind-destructive',purpose:'destructive',destructive:true}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 위험한 명령을 실행하려고 해요');
 void nativeCancel;
 await act(async()=>root.render(<App/>));const message=async(data:any)=>act(async()=>{(globalThis.window as any).dispatchEvent({type:'message',data,bubbles:false});});
 await message({type:'commandApprovalPrompt',prompt});assert.ok(host.querySelector('.hps-command-approval'));await act(async()=>click(host.querySelector('[data-command-allow]')));assert.deepEqual((globalThis as any).__posted.at(-1),{type:'commandApprovalAnswer',id:'normal',choice:'allow'});
 await message({type:'commandApprovalPrompt',prompt:{...prompt,id:'next'}});await message({type:'commandApprovalPrompt',prompt:null});assert.ok(!host.querySelector('.hps-command-approval'));
 await act(async()=>root.unmount());console.log('PASS command dialog and actual App: focus, destructive, exact remember, safe command, Escape/IME, native cancel, fixed heading by kind, once, bound replies, dismissal');
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
