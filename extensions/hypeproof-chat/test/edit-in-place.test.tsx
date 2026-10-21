import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EditAction, EditPrompt, VersionPager } from '../webview-ui/src/EditResend';
import { AttemptPager } from '../webview-ui/src/AttemptPager';
import { staticTokens } from './lib/expand-design-tokens.mjs';
const act=(React as any).act;
const fireEv=(target:any,type:string,extra:any={})=>{const ev:any={type,bubbles:true,cancelable:true,defaultPrevented:false,timeStamp:Date.now(),isComposing:false,keyCode:0,shiftKey:false,...extra,preventDefault(){ev.defaultPrevented=true;},stopPropagation(){ev._stopped=true;}};target.dispatchEvent(ev);return ev;};
const fire=(target:any,type:string,extra:any={})=>target.dispatchEvent({type,bubbles:true,cancelable:true,timeStamp:Date.now(),isComposing:false,keyCode:0,shiftKey:false,...extra,preventDefault(){},stopPropagation(){(this as any)._stopped=true;}});
(async()=>{
 const host:any=mountPoint(); const root=createRoot(host); let edits=0; const saved:any[]=[]; let cancelled=0;
 const draw=async(node:any)=>{await act(async()=>root.render(node));};
 await draw(<EditAction onEdit={()=>edits++}/>);
 const button=host.querySelector('button'); assert.equal(button.textContent,'수정');
 assert.equal(button.getAttribute('aria-label'),'보낸 메시지 수정'); assert.notEqual(button.getAttribute('tabindex'),'-1'); assert.equal(button.getAttribute('disabled'),null);
 assert.equal(host.querySelector('svg').getAttribute('width'),'16'); assert.equal(host.querySelector('svg').getAttribute('height'),'16');
 assert.equal(host.querySelector('svg').getAttribute('data-icon'),'pencil');
 button.focus(); assert.equal(doc.activeElement,button); await act(async()=>click(button)); assert.equal(edits,1);
 await draw(<EditPrompt text="한글 질문" images={[]} revertNote={false} onCancel={()=>cancelled++} onSave={(...args)=>saved.push(args)}/>);
 const area=host.querySelector('textarea'); assert.equal(area.value,'한글 질문'); assert.equal(doc.activeElement,area);
 assert.deepEqual(host.querySelectorAll('button').map((e:any)=>e.textContent),['취소','다시 보내기']);
 for(const extra of [{isComposing:true},{keyCode:229}]) await act(async()=>fire(area,'keydown',{key:'Enter',...extra}));
 assert.equal(saved.length,0,'native IME Enter cannot submit');
 await act(async()=>fire(area,'compositionstart'));
 await act(async()=>fire(area,'keydown',{key:'Enter'}));
 await act(async()=>fire(area,'keydown',{key:'Escape'}));
 assert.equal(saved.length,0,'composition state fallback cannot submit'); assert.equal(cancelled,0,'composition Escape cannot cancel');
 await act(async()=>fire(area,'compositionend'));
 await act(async()=>fire(area,'keydown',{key:'Enter',shiftKey:true})); assert.equal(saved.length,0);
 await act(async()=>fire(area,'keydown',{key:'Enter'})); assert.deepEqual(saved,[['한글 질문',[]]]);
 // Enter on empty or whitespace-only text must not save (the button is disabled; the key path has its own guard).
 for(const blank of ['','   \n ']){
  const before=saved.length;
  await draw(<EditPrompt key={'blank'+blank.length} text={blank} images={[]} revertNote={false} onCancel={()=>cancelled++} onSave={(...args)=>saved.push(args)}/>);
  const empty=host.querySelector('textarea'); assert.equal(empty.value,blank);
  assert.ok(host.querySelectorAll('button')[1].hasAttribute('disabled'),'save button disabled on blank text');
  await act(async()=>{fireEv(empty,'keydown',{key:'Enter'});});
  assert.equal(saved.length,before,'Enter on blank text must not call onSave');
 }
 // A composition key stays with the IME: it must not bubble to panel/workspace handlers.
 await draw(<EditPrompt key="ime" text="한글 질문" images={[]} revertNote={false} onCancel={()=>cancelled++} onSave={(...args)=>saved.push(args)}/>);
 const ime=host.querySelector('textarea');
 for(const [name,extra] of [['isComposing',{isComposing:true}],['keyCode 229',{keyCode:229}]] as const)
  for(const k of ['Enter','Escape']){let ev:any; await act(async()=>{ev=fireEv(ime,'keydown',{key:k,...extra});}); assert.equal(ev._stopped,true,`${name} ${k} must stopPropagation`);}
 await act(async()=>fire(ime,'compositionstart'));
 for(const k of ['Enter','Escape']){let ev:any; await act(async()=>{ev=fireEv(ime,'keydown',{key:k});}); assert.equal(ev._stopped,true,`composition-state ${k} must stopPropagation`);}
 await act(async()=>fire(ime,'compositionend'));
 { // control: outside composition the same keys are handled, not swallowed by the IME branch
  let ev:any; const n=cancelled; await act(async()=>{ev=fireEv(ime,'keydown',{key:'Escape'});}); assert.equal(cancelled,n+1,'Escape cancels once'); assert.equal(ev.defaultPrevented,true);
 }
 // Escape cancels exactly once and never saves.
 { const n=cancelled, sv=saved.length; await draw(<EditPrompt key="esc" text="고칠 글" images={[]} revertNote={false} onCancel={()=>cancelled++} onSave={(...args)=>saved.push(args)}/>);
  await act(async()=>{fireEv(host.querySelector('textarea'),'keydown',{key:'Escape'});}); assert.equal(cancelled,n+1,'Escape calls onCancel once'); assert.equal(saved.length,sv,'Escape never saves'); }
 // Opening scrolls the editor box into view with the least movement (classroom at 800px tall).
 { const proto=Object.getPrototypeOf(host); const orig=proto.scrollIntoView; const calls:any[]=[]; proto.scrollIntoView=function(...a:any[]){calls.push([this,...a]);};
  try{ await draw(<EditPrompt key="scroll" text="x" images={[]} revertNote={false} onCancel={()=>{}} onSave={()=>{}}/>); }finally{proto.scrollIntoView=orig;}
  assert.equal(calls.length,1,'scrollIntoView called once on open'); assert.equal(calls[0][0].getAttribute('class'),'hps-edit-box'); assert.deepEqual(calls[0][1],{block:'nearest'}); }
 await draw(<EditPrompt text="한글 질문" images={[]} revertNote={false} onCancel={()=>cancelled++} onSave={(...args)=>saved.push(args)}/>);
 cancelled=0;
 await act(async()=>click(host.querySelectorAll('button')[0])); assert.equal(cancelled,1);
 const pages:number[]=[];
 await draw(<VersionPager pager={{key:'u1',index:0,count:2}} onPage={n=>pages.push(n)}/>);
 assert.equal(host.querySelector('[role="group"]').getAttribute('aria-label'),'메시지 버전');
 assert.ok(host.textContent.includes('1/2')); assert.ok(host.textContent.includes('이 버전은 보기만 해요'));
 const arrows=host.querySelectorAll('button'); assert.ok(arrows[0].hasAttribute("disabled")); await act(async()=>click(arrows[1])); assert.deepEqual(pages,[1]);
 await draw(<VersionPager pager={{key:'u1',index:1,count:2}} onPage={n=>pages.push(n)}/>);
 assert.ok(host.querySelectorAll('button')[1].hasAttribute('disabled')); assert.ok(!host.textContent.includes('이 버전은 보기만 해요'));
 await act(async()=>click(host.querySelectorAll('button')[0])); assert.deepEqual(pages,[1,0]);
 await draw(<AttemptPager index={0} count={2} onPage={n=>pages.push(n)}/>);
 assert.equal(host.querySelector('[role="group"]').getAttribute('aria-label'),'답변 1/2');
 assert.equal(host.querySelectorAll('button')[1].getAttribute('aria-label'),'다음 답변');
 await act(async()=>click(host.querySelectorAll('button')[1])); assert.deepEqual(pages,[1,0,1]);
 await act(async()=>root.unmount()); host.remove();
 // CSS contracts supplement the mounted interaction tests; browser geometry remains an owner check.
 const css=staticTokens(fs.readFileSync(path.join(process.cwd(),'webview-ui/src/designTokens.css'),'utf8'))(fs.readFileSync(path.join(process.cwd(),'webview-ui/src/styles.css'),'utf8'));
 const rule=(selector:string)=>{const body=css.slice(css.indexOf(selector+' {')+selector.length+2); return body.slice(0,body.indexOf('}'));};
 for(const selector of ['.hps-user-actions','.hps-version-pager','.hps-edit-actions']) assert.match(rule(selector),/flex-wrap: wrap/,selector);
 for(const selector of ['.hps-edit-box','.hps-edit-box textarea','.hps-edit-actions','.hps-user-actions','.hps-version-pager']) {assert.match(rule(selector),/min-width: 0/,selector);assert.match(rule(selector),/max-width: 100%/,selector);}
 assert.match(rule('.hps-edit-box textarea'),/box-sizing: border-box/); assert.match(rule('.hps-edit-box textarea'),/(?:^|;)\s*width: 100%/);
 assert.match(rule('.hps-user-actions button'),/min-width: 44px/);assert.match(rule('.hps-user-actions button'),/min-height: 44px/);
 assert.match(rule('.hps-edit-actions button'),/min-height: 44px/);
 assert.match(rule('.hps-version-pager button'),/min-width: 44px/); assert.match(rule('.hps-version-pager button'),/min-height: 44px/); assert.match(rule('.hps-version-pager button'),/font: inherit/);
 assert.match(rule('.hps-edit-prompt'),/display: inline-flex/);
 for(const sel of ['.hps-version-note','.hps-edit-note']) assert.match(rule(sel),/overflow-wrap: anywhere/);
 console.log('PASS edit icon, focus, inline actions, IME events, shared version navigation and CSS sizing contracts');
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
