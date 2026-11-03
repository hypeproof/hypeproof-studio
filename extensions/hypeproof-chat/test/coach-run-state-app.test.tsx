// REQ-STUDIO-COACH-RUN-STATE (CGP-LEARN-R-016): the real App drives the header's one run state from host
// messages. (a) exactly one state at a time, from the timeline (REQ-C17) and the approval prompts (REQ-E1);
// (b) 확인이 필요해요 whenever any approval is pending: approvalWait and every in-webview approval dialog
// (write, outbound, command, browser, folder consent); (c) a static icon and words, no animation element.
import {mountPoint} from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../webview-ui/src/App';
import {outboundPrompt} from '../src/outboundApproval';
for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
const act=(React as any).act;
const host:any=mountPoint(),root=createRoot(host);
const send=(data:any)=>act(async()=>{(globalThis.window as any).dispatchEvent({type:'message',data,bubbles:false})});
const UX = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = { model: 'claude-sonnet-5', hasToken: true, proxyUrl: 'http://localhost:8787', coach: { name: 'HypeProof', personality: '', configured: true },
  profile: { profile_id: 'p', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/tmp/p', verified: true } };

/** The one run state: asserts it is the only one drawn and returns its key and words. */
function state(where:string){
  const all=host.querySelectorAll('.hps-run-state');
  assert.equal(all.length,1,`${where}: exactly one run state is drawn`);
  const el=all[0];
  assert.ok(el.closest('header.hps-header'),`${where}: it sits in the chat header`);
  assert.equal(el.getAttribute('aria-live'),'polite',`${where}: changes are announced politely`);
  assert.equal(el.querySelectorAll('svg').length,1,`${where}: one static icon`);
  assert.equal(el.querySelector('svg').getAttribute('aria-hidden'),'true',`${where}: the icon is decoration; the words carry the state`);
  return {key:el.getAttribute('data-run-state'),text:el.textContent};
}
const expect=(where:string,key:string,text:string)=>assert.deepEqual(state(where),{key,text},where);
const tool=(id:string,icon:string,label:string,st='running')=>({type:'toolLog',streamId:'s',id,icon,label,state:st});

async function main(){
  try{
    await act(async()=>root.render(<App/>));await send({type:'config',config});
    expect('before any turn','ready','준비됨');

    await send({type:'streamStart',streamId:'s',messageId:'a'});
    expect('stream open, nothing yet','thinking','생각 중');
    await send(tool('think-0','💭','응답 준비 중 · 120 토큰'));
    expect('thinking line','thinking','생각 중');
    await send(tool('t1','📖','파일 읽기 index.html'));
    expect('reading a file','searching','찾는 중');
    await send(tool('t1','📖','파일 읽기 index.html','done'));
    expect('the read finished','thinking','생각 중');
    await send(tool('t2','🌐','웹 검색: 공룡'));
    expect('web search','searching','찾는 중');
    await send(tool('t2','🌐','웹 검색: 공룡','done'));
    await send(tool('t3','✍️','파일 고치기 index.html'));
    expect('writing a file','creating','만드는 중');
    await send(tool('t4','🔧','도구 사용 중'));
    expect('an unknown tool is not claimed as searching or making','thinking','생각 중');
    await send(tool('t4','🔧','도구 사용 중','done'));
    expect('back to the write still running','creating','만드는 중');

    // (b) every approval source wins while it is open, and only while it is open.
    await send({type:'approvalWait',streamId:'s',waiting:true});
    expect('host approval modal','approval','확인이 필요해요');
    await send({type:'approvalWait',streamId:'s',waiting:false});
    expect('host approval answered','creating','만드는 중');
    const dialogs:[string,any][]=[
      ['writeApprovalPrompt',{id:'w1',title:'파일을 저장할까요?',verb:'저장',files:['a.txt']}],
      ['outboundPrompt',outboundPrompt('o1',{recipient:'갤러리 · site.invalid',items:[{name:'index.html',bytes:1200}]})],
      ['commandApprovalPrompt',{id:'c1',purpose:'shell',command:'ls',destructive:false,rememberAllowed:false}],
      ['browserApprovalPrompt',{id:'b1',title:'브라우저를 열까요?',host:'example.invalid',label:'인터넷',place:'internet',rememberLabel:'이 사이트는 항상 허용'}],
      ['folderConsentPrompt',{id:'f1',folder:'/tmp/p'}],
    ];
    for(const [type,prompt] of dialogs){
      await send({type,prompt});
      expect(`${type} open`,'approval','확인이 필요해요');
      await send({type,prompt:null});
      expect(`${type} closed`,'creating','만드는 중');
    }
    // An approval raised before any turn (folder consent at activity start) still reads 확인이 필요해요.
    await send(tool('t3','✍️','파일 고치기 index.html','done'));
    await send({type:'streamChunk',streamId:'s',delta:'다 고쳤어요.'});
    expect('the coach writes its answer','thinking','생각 중');
    await send({type:'streamEnd',streamId:'s'});
    expect('turn done','ready','준비됨');
    await send({type:'folderConsentPrompt',prompt:{id:'f2',folder:'/tmp/p'}});
    expect('approval with no turn running','approval','확인이 필요해요');
    await send({type:'folderConsentPrompt',prompt:null});
    expect('consent answered','ready','준비됨');

    // A running line from an earlier turn never describes the current one.
    await send({type:'streamStart',streamId:'s2',messageId:'b'});
    expect('new turn','thinking','생각 중');
    await send({type:'streamStopped',streamId:'s2'});
    expect('stopped by the learner','paused','멈춤');
    await send({type:'streamStart',streamId:'s3',messageId:'c'});
    expect('a new turn clears 멈춤','thinking','생각 중');
    await send({type:'streamError',streamId:'s3',error:'연결이 끊겼어요'});
    expect('the turn failed','error','문제가 생겼어요');
    await send({type:'streamStart',streamId:'s4',messageId:'d'});
    await send({type:'streamEnd',streamId:'s4'});
    expect('the next turn finished','ready','준비됨');
    // Offline is never 준비됨; coming back online is.
    const setOnline=(v:boolean)=>Object.defineProperty(globalThis.navigator,'onLine',{value:v,configurable:true});
    setOnline(false);await act(async()=>{(globalThis.window as any).dispatchEvent({type:'offline',bubbles:false})});
    expect('offline','error','문제가 생겼어요');
    setOnline(true);await act(async()=>{(globalThis.window as any).dispatchEvent({type:'online',bubbles:false})});
    expect('back online','ready','준비됨');
    // The product test run (내 제품 테스트) is coach work too.
    await send({type:'verifyState',view:{running:true,criteria:[],results:[]}});
    expect('verify run','thinking','생각 중');
    await send({type:'verifyState',view:{running:false,criteria:[],results:[]}});
    expect('verify finished','ready','준비됨');
    console.log('PASS coach run state (real App): ready, thinking, searching, creating, approval from approvalWait and 5 dialogs, paused, error, offline, verify run; one state at a time');
  }finally{await act(async()=>root.unmount());}
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
