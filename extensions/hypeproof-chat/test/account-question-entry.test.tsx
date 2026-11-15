import React, {act} from 'react';
import assert from 'node:assert/strict';
import {createRoot} from 'react-dom/client';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(process.cwd()+'/package.json')('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'https://studio.invalid',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
const posts:any[]=[];
(window as any).acquireVsCodeApi=()=>({postMessage:(m:any)=>posts.push(m),getState:()=>undefined,setState:()=>{}});
async function main(){
 const {StartPage}=await import('../webview-ui/src/StartPage');
 const root=createRoot(document.getElementById('root')!);
 const update=async(state:any)=>act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'startState',state}})));
 const card={schema:'hps-card/1',key:'growth:one',kind:'growth-choice',attempt:1,urgency:'normal',expires_at:null,deliver_via:['in_app'],title:'오늘의 질문',preface:null,prompt:'어디부터 시작할까요?',segments:[{kind:'text',label:null,text:'<img src=x onerror=alert(1)>'}],choices:[{id:'goal',label:'목표부터'}],select:'pick',text:{label:'내 생각',placeholder:'짧게 적어도 좋아요',max:2000,value:null},actions:[{id:'continue',label:'선택하고 이어가기',primary:true,needs_answer:true}],skip:'나중에',note:null};
 const state:any={checking:false,version:'test',account:{status:'signedIn',account:{id:'account-a',display_name:'테스트 사용자',email:'fixture@example.test'},passes:[]},questionCard:{status:'ready',card,binding:'account-a-bound-view',busy:false},memberApprovals:{entryVisible:true,status:'ready',cards:[],pending:[],busy:false}};
 try {
  await act(async()=>root.render(<StartPage/>)); await update(state);
  assert.match(document.querySelector('[data-testid="account-greeting"]')?.textContent ?? '',/안녕하세요, 테스트 사용자님/);
  assert(document.querySelector('[data-testid="member-approval-entry"]'));
  assert.equal(document.querySelector('.studio-question img'),null);
  assert.equal(posts.filter(p=>p.type==='questionCardAct'&&p.action==='shown').length,1);
  const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('.studio-question button')].find(b=>b.textContent===label)!;
  assert.equal(button('선택하고 이어가기').disabled,true);
  await act(async()=>button('목표부터').click());assert.equal(posts.filter(p=>p.action==='answer').length,0);
  await update({...state,questionCard:{...state.questionCard,busy:false}});
  assert.equal(button('목표부터').getAttribute('aria-pressed'),'true','same-card refresh preserves selection');
  await act(async()=>button('선택하고 이어가기').click());
  assert.deepEqual(posts.at(-1),{type:'questionCardAct',binding:'account-a-bound-view',key:'growth:one',action:'answer',answer:{choice:'goal',action:'continue',text:''}});
  await update({...state,account:{status:'signedOut'}});
  assert.equal(document.querySelector('[data-testid="account-question-card"]'),null);assert.equal(document.querySelector('[data-testid="account-greeting"]'),null);assert.equal(document.querySelector('[data-testid="member-approval-entry"]'),null);
  await update({...state,account:{...state.account,account:{...state.account.account,id:'account-b',display_name:'새 사용자'}},questionCard:{...state.questionCard,binding:'account-b-bound-view'}});
  assert.equal(button('목표부터').getAttribute('aria-pressed'),'false','new account starts with no previous private choice');
  assert.equal(posts.filter(p=>p.type==='memberApprovalDecision').length,0,'question choice cannot become approval');
  console.log('PASS actual StartPage greeting, visible question/approval entry, explicit choice, safe text, refresh retention, logout and account change');
 } finally {await act(async()=>root.unmount());dom.window.close()}
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)});
