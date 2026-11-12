import React, { act } from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createRoot } from 'react-dom/client';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
const dom = new JSDOM('<div id="root"></div>', {url:'https://studio.invalid'});
const posted: any[]=[];
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
(window as any).acquireVsCodeApi=()=>({postMessage:(m:any)=>posted.push(m),getState:()=>undefined,setState:()=>{}});
async function main(){
 const {StartPage}=await import('../webview-ui/src/StartPage');
 const root=createRoot(document.getElementById('root')!);
 await act(async()=>root.render(<StartPage/>));
 const base={checking:false,version:'test',freeStart:{age:'14+',claiming:false},account:{status:'signedOut'},purchase:{available:false}};
 const update=async(state:any)=>act(async()=>{window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'startState',state}}));});
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.replace(/→/g,'').trim()===text)!;
 await update(base);
 assert(button('Google 로그인')); assert(button('로그인 없이 무료로 시작하기'));
 // REQ-STUDIO-FEEDBACK-ENTRY: the start page nav carries 의견·문제 보내기, which asks the host to open the report form.
 const feedback=button('의견·문제 보내기'); assert(feedback?.closest('nav[aria-label="Studio 탐색"]'),'의견·문제 보내기 is in the start nav');
 await act(async()=>feedback.click()); assert.deepEqual(posted.at(-1),{type:'reportProblem'});
 // The actual account button (not navigation) initiates auth without opening checkout.
 const signIn=document.querySelector<HTMLButtonElement>('.studio-google')!;
 await act(async()=>signIn.click()); assert.equal(posted.at(-1).type,'accountSignIn');
 assert(!posted.some(m=>m.type==='purchaseOpen'||m.type==='purchaseStart'||m.type==='freeStartClaim'));
 await update({...base,account:{status:'waiting',userCode:'ABCD1234'}});
 assert(document.body.textContent?.includes('브라우저에서 연결을 승인해 주세요'));
 await update({...base,account:{status:'signedIn',account:{display_name:'Member',email:'member@example.invalid'},passes:[{id:'super',product_name:'무제한 이용권',status:'active',requests_remaining:100000,requests_limit:100000,duration_seconds:0}]}});
 assert(document.body.textContent?.includes('관리자가 부여한 무제한 이용 권한'));
 await act(async()=>button('무제한으로 시작하기').click());
 assert.deepEqual(posted.at(-1),{type:'accountActivate',passId:'super'});
 await update({...base,purchase:{available:true,focus:1,stage:'choosing',products:[]},account:{status:'signedIn',passes:[{id:'super',product_name:'무제한 이용권',status:'active',requests_remaining:100000,requests_limit:100000,duration_seconds:0}]}});
 assert(button('무제한으로 시작하기'));
 assert(!document.body.textContent?.includes('어떤 이용권으로 시작할까요?'));
 assert.equal(document.querySelector('[role="radiogroup"]'),null);
 // Login remains accessible from a saved activity, independently of purchases.
 await update({...base,freeStart:undefined,profile:{name:'Saved',workspace:'/tmp/saved',kind:'trial'}});
 await act(async()=>button('Google 로그인').click());
 assert(document.querySelector('.studio-google'));
 await update({...base,account:undefined});
 await act(async()=>button('Google 로그인').click());
 assert.equal(posted.at(-1).type,'accountSignIn','disabled runtime remains discoverable and requests host recovery');
 // An outstanding payment must retain its progress/recovery surface.
 await update({...base,purchase:{available:true,stage:'waiting',order:{id:'order-test',label:'Pass',amount:1000}},account:{status:'signedIn',account:{display_name:'Member',email:'member@example.invalid'},passes:[]}});
 assert.equal(button('내 계정 · 이용권').disabled,true);
 assert(document.body.textContent?.includes('브라우저에서 결제를 기다리고 있어요'));
 assert.equal(document.querySelector('.studio-google'),null);
 await act(async()=>button('그만두기').click());
 assert.equal(posted.at(-1).type,'purchaseHide');
 await update({...base,purchase:{available:true,order:{id:'order-test',label:'Pass',amount:1000}}});
 assert(button('로그인 없이 무료로 시작하기'));
 assert.equal(button('Google 로그인').disabled,false);
 await act(async()=>root.unmount()); dom.window.close();
 console.log('PASS: free entry exposes Google auth, approval, granted activation and saved-activity login without checkout');
}
main().then(()=>process.exit(0),e=>{console.error(e);dom.window.close();process.exit(1)});
