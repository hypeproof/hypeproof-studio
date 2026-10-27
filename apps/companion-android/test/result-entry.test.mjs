import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {mountPoint,click} from '../../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';
import {createCompanionSelection} from '../../../extensions/hypeproof-chat/src/companionSelection.ts';
import {packCompanionPreviewPayload} from '../../../extensions/hypeproof-chat/src/companionPreviewPayload.ts';

const deps=process.env.COMPANION_REACT_DEPS??fileURLToPath(new URL('../../../extensions/hypeproof-chat/webview-ui/node_modules',import.meta.url));
const webRequire=createRequire(deps+'/react/package.json'),require=createRequire(import.meta.url),React=webRequire('react');
const act=async work=>React.act(async()=>{await work();await Promise.resolve();});
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
const pair={id:'ci_'+'a'.repeat(32),status:'paired',account_id:'account',host_id:'host',device_id:'phone',workspace_id:'workspace',project_id:'project',invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:Math.floor(Date.now()/1000)+900,capability:'preview.read'};
const text='<!doctype html><button onclick="document.getElementById(\'answer\').textContent=\'정답이에요\'">정답 확인</button><p id="answer">퀴즈</p><!--'+'한글 퀴즈 '.repeat(1200)+'-->';
const request={schema:'hps-companion-host-request/1',requestId:'original-request',actorId:'account',deviceId:'phone',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:'task',version:1,epoch:1,consentRevision:1,artifactId:'quiz',artifactVersion:await hash(text),operation:'preview.read'};
const metadata=async(r,revision)=>{const value=await createCompanionSelection(r,pair,revision);return{message_id:value.messageId,message_hash:await hash(value.text),text:value.text};};
const first=await metadata(request,1),next=await metadata({...request,requestId:'later-request'},2),stale=await metadata({...request,requestId:'older-declaration'},1);
const result=JSON.stringify({schema:'hps-companion-host-result/1',requestId:request.requestId,outcome:{state:'completed',code:'preview_read',requestId:request.requestId,artifact:{id:'quiz',version:request.artifactVersion,text}}});
const frames=await Promise.all((await packCompanionPreviewPayload(result,request.requestId)).map(async(text,i)=>({message_id:'result_'+i,message_hash:await hash(text),text})));

for(const injectLater of [false,true])test('actual Android React entry renders exact original framed result '+(injectLater?'with later metadata held':'without metadata interruption'),async()=>{
 assert.ok(new TextEncoder().encode(text).length>=8192&&new TextEncoder().encode(text).length<=24576);assert.ok(frames.length>8);
 const host=mountPoint();host.setAttribute('id','root');let root;
 const prepared=[],sent=[],acks=[],returned=new Map(),seen=new Set();
 let batchIndex=0;const stream=[first,...(injectLater?[next,stale]:[]),...frames];
 class Pair{
  constructor(options){Object.assign(this,options);this.invitation=null;}
  async inspect(){this.invitation={...pair,status:'open'};}
  async claimDevice(){this.invitation={...pair,status:'claimed',compare_code:'a'.repeat(12)};}
  async refresh(){if(this.invitation.status==='claimed')this.invitation={...pair,status:'approved'};return this.invitation;}
  async consume(){this.invitation={...pair};}
 }
 class Relay{
  constructor(options){Object.assign(this,options);this.role='device';this.row={...pair};this.closed=false;}
  async publishOffer(){}async connect(){}
  diagnostics(){return{closed:this.closed,context_digest:'c'.repeat(64)};}
  async prepare(value,id){prepared.push({value,id});return'prepared';}async send(id){sent.push(id);}
  async receive(){const raw=batchIndex++===0?[first]:stream.slice(1).splice((batchIndex-2)*8,8);return raw.filter(m=>{if(seen.has(m.message_id))return false;seen.add(m.message_id);returned.set(m.message_id,(returned.get(m.message_id)??0)+1);return true;});}
  async acknowledge(id){acks.push(id);return{};}close(){this.closed=true;}
 }
 const endpoint={onmessage:null,postMessage(raw){const message=JSON.parse(raw);if(message.kind==='identity')queueMicrotask(()=>endpoint.onmessage?.({data:JSON.stringify({id:message.id,ok:true,value:{accountId:'account',sessionId:'device-session'}})}));}};
 window.CompanionNative=endpoint;
 const compiled=await build({entryPoints:[fileURLToPath(new URL('../web/main.tsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'},jsx:'automatic',external:['react','react/jsx-runtime','react-dom/client'],plugins:[{name:'trusted-client-fixture',setup(api){
  if(process.env.COMPANION_ENTRY_BASELINE){const sha=process.env.COMPANION_ENTRY_BASELINE;assert.match(sha,/^[a-f0-9]{40}$/);api.onLoad({filter:/\/web\/main\.tsx$/},args=>({contents:execFileSync('git',['show',sha+':apps/companion-android/web/main.tsx'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'}),loader:'tsx',resolveDir:path.dirname(args.path)}));}
  api.onResolve({filter:/^@hypeproof\/companion-client$/},()=>({path:'clients',namespace:'fixture'}));api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const CompanionPreviewClient=globalThis.__Clients.Pair;export const CompanionRelayClient=globalThis.__Clients.Relay;',loader:'js'}));api.onResolve({filter:/^@companion\/selection$/},()=>({path:fileURLToPath(new URL('../../../extensions/hypeproof-chat/src/companionSelection.ts',import.meta.url))}));}}]});
 const module={exports:{}};
 try{
  await act(()=>vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,__Clients:{Pair,Relay},require:id=>id==='react-dom/client'?{createRoot(el){root=webRequire(id).createRoot(el);return root;}}:id.startsWith('react')?webRequire(id):require(id),window,document,navigator:{userAgent:'node'},crypto,TextEncoder,TextDecoder,AbortController,performance,structuredClone,setTimeout,clearTimeout,queueMicrotask,atob,btoa,console}));
  const button=label=>host.findAll(e=>e.localName==='button'&&e.textContent===label)[0];
  const until=async predicate=>{for(let i=0;i<1200;i++){if(predicate())return;await act(()=>new Promise(r=>setTimeout(r,5)));}assert.fail('expected UI transition did not settle');};
  const press=async label=>{await until(()=>button(label));await act(()=>click(button(label)));};
  await press('기기 연결 확인');await until(()=>host.querySelector('#challenge'));
  await act(()=>{const input=host.querySelector('#challenge');input.value='{}';input.dispatchEvent({type:'input',bubbles:true,preventDefault(){},stopPropagation(){}});});
  await press('초대 확인·참여 요청');await press('컴퓨터 승인 확인·기기 키 준비');await press('암호화 연결 확인');await press('선택한 작업 받기');await press('선택한 결과 보기');
  await until(()=>acks.includes(injectLater?'result_5':'result_7')||host.findAll(e=>e.getAttribute('data-state')==='waiting_for_computer').length>0);
  assert.equal(host.findAll(e=>e.localName==='iframe').length,0,'partial framed bytes must not render HTML');
  await until(()=>host.findAll(e=>e.getAttribute('data-state')==='completed'||e.getAttribute('data-state')==='waiting_for_computer').length>0);
  assert.equal(host.findAll(e=>e.getAttribute('data-state')==='completed').length,1,'valid later selection must not poison the original result receiver; '+JSON.stringify({ui:host.textContent,acks,prepared:prepared.map(p=>p.id),returned:Array.from(returned.keys())}));
  const iframe=host.findAll(e=>e.localName==='iframe')[0];assert.ok(iframe);assert.ok((iframe.getAttribute('srcDoc')??iframe.getAttribute('srcdoc')??iframe.srcDoc).endsWith(text));
  assert.deepEqual(sent,[request.requestId]);assert.equal(prepared.length,1);assert.equal(JSON.parse(prepared[0].value).requestId,request.requestId);
  if(injectLater){assert.ok(acks.includes(next.message_id));assert.ok(acks.includes(stale.message_id));assert.equal(returned.get(next.message_id),1,'authenticated client may deduplicate later delivery');assert.match(host.textContent,/새 선택/);assert.match(host.textContent,/자동.*요청하지/);}
 }finally{if(root)await act(()=>root.unmount());host.remove();delete window.CompanionNative;}
});
