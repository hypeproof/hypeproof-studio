// REQ-KNOW-09: synthetic request-boundary checks, never a live publish.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outboundDetails, OUTBOUND_EXCLUDED, privateOutboundPath, contentBytes } from '../src/outboundConsent.ts';
import { publishWorldConfirmed } from '../src/galleryPublish.ts';
import { uploadSession, uploadSessionSnapshot, readSessionSnapshot, sendSessionSnapshot } from '../src/spoolUploader.ts';
import { confirmProblemReport, postProblemReport, reportManifestItems } from '../src/reportProblemHelpers.ts';
import { uploadSnapshot } from '../src/evidenceSnapshot.ts';
import { PublishSession } from '../src/publishSession.ts';
import { buildPublishSet } from '../src/publishSet.ts';
assert.equal(contentBytes('한😀'),7);
// The fixed copy, literally (REQ-KNOW-09 acceptance) — never compared with the constant itself.
assert.equal(OUTBOUND_EXCLUDED,'포함하지 않는 것: AI 기억, 개인 메모');
assert.equal(outboundDetails({recipient:'갤러리 · site.invalid',public:true,items:[{name:'index.html',bytes:1234},{name:'제목',bytes:7}]}),
 ['받는 곳: 갤러리 · site.invalid','누구나 볼 수 있어요','보낼 항목:','• index.html (1,234 바이트)','• 제목 (7 바이트)','ⓘ 받는 사람의 AI 기억: 확인 안 됨','','포함하지 않는 것: AI 기억, 개인 메모'].join('\n'),'recipient line, public line, one size line per item, exclusion line');
assert.equal(outboundDetails({recipient:'갤러리 · site.invalid',public:true,items:[{name:'index.html',bytes:3}],also:[{recipient:'수업 기록 운영자 · api.invalid',items:[{name:'events.jsonl',bytes:2048}]}]}),
 ['받는 곳: 갤러리 · site.invalid','누구나 볼 수 있어요','보낼 항목:','• index.html (3 바이트)','ⓘ 받는 사람의 AI 기억: 확인 안 됨','','함께 보내는 것 — 받는 곳: 수업 기록 운영자 · api.invalid','ⓘ 받는 사람의 AI 기억: 확인 안 됨','• events.jsonl (2,048 바이트)','','포함하지 않는 것: AI 기억, 개인 메모'].join('\n'),'a second recipient is its own block with its own sizes');
assert.equal(outboundDetails({recipient:'x',items:[{name:'a',bytes:1}],also:[{recipient:'',items:[{name:'b',bytes:1}]}]}),null,'an unnamed second recipient refuses the whole dialog');
assert.equal(outboundDetails({recipient:'x',items:[]}),null);
assert.equal(outboundDetails({recipient:'갤러리 · s',public:true,notes:['이름이 보여요'],items:[{name:'a',bytes:1}]}),['받는 곳: 갤러리 · s','누구나 볼 수 있어요','이름이 보여요','보낼 항목:','• a (1 바이트)','ⓘ 받는 사람의 AI 기억: 확인 안 됨','','포함하지 않는 것: AI 기억, 개인 메모'].join('\n'),'a note line follows the public line');
assert.ok(outboundDetails({recipient:'teacher',items:[{name:'<b>가</b>',bytes:3}]}).includes(OUTBOUND_EXCLUDED));
assert.ok(!outboundDetails({recipient:'teacher\u202eevil',items:[{name:'a',bytes:1}]}).includes('\u202e'));
assert.equal(outboundDetails({recipient:'',items:[{name:'a',bytes:1}]}),null);
assert.equal(outboundDetails({recipient:'x',items:[{name:'a',bytes:NaN}]}),null);
for(const file of ['wiki/a.md','NOTES/a.md','ｎｏｔｅｓ/a.md','.memory/a','memory\\a'])assert.ok(privateOutboundPath(file));
assert.ok(privateOutboundPath('learning/journal/a.md','learning/journal'));assert.ok(!privateOutboundPath('index.html'));
let calls=[],shown;
const input={previewVisitor:async()=>true,siteBase:'https://gallery.invalid',token:'synthetic',worldId:'world',title:'작품',html:'<p>한😀</p>',fetchImpl:async(u,i)=>{calls.push(JSON.parse(i.body));return Response.json({ok:true,url:'/w/1'});}};
assert.equal((await publishWorldConfirmed(input,async m=>(shown=m,false),async()=>true)).ok,false);assert.equal(calls.length,0);
assert.equal(shown.items[0].bytes,Buffer.byteLength(input.html));
assert.equal((await publishWorldConfirmed(input,async()=>true,async()=>false)).ok,false);assert.equal(calls.length,0);
{ // The account or activity can change while the dialog is open: the approval was for the old one, so nothing is sent.
 let open=false,n=0;const r=await publishWorldConfirmed(input,async()=>{open=true;return true;},async()=>{n++;return !open;});
 assert.equal(r.ok,false);assert.equal(calls.length,0,'identity/activity changed during the dialog: zero publish POSTs');assert.equal(n,3,'checked before preview, after preview, and after the dialog'); }
{ let sent=0;const record={recipient:'수업 기록 운영자 · api.invalid',items:[{name:'events.jsonl',bytes:9}],send:async()=>{sent++;}};
 calls=[];assert.equal((await publishWorldConfirmed(input,async m=>(shown=m,false),async()=>true,record)).ok,false);assert.equal(calls.length,0);assert.equal(sent,0,'Cancel: no page and no session record');
 assert.deepEqual(shown.also,[{recipient:record.recipient,items:record.items}],'the session record is its own block in the gallery dialog');
 assert.deepEqual(shown.notes,['공개 페이지에 내 이름이 함께 보여요 (수업 명단에 적힌 이름을 갤러리가 붙여요)'],'F7: the gallery dialog says the learner\'s name appears on the public page');
 assert.equal((await publishWorldConfirmed(input,async()=>true,async()=>true,record)).ok,true);await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);assert.equal(sent,1,'approved: the listed record goes after the page');
 const failing={...input,fetchImpl:async()=>Response.json({message:'no'},{status:500})};sent=0;assert.equal((await publishWorldConfirmed(failing,async()=>true,async()=>true,record)).ok,false);assert.equal(sent,0,'no record when the page did not publish');calls=[]; }
const original=input.html;assert.equal((await publishWorldConfirmed(input,async()=>{input.html='unapproved';return true;},async()=>true)).ok,true);assert.equal(calls[0].html,original);
const root=mkdtempSync(join(tmpdir(),'hps-outbound-'));
try {
 writeFileSync(join(root,'events.jsonl'),'한😀\n');writeFileSync(join(root,'session.meta.json'),'{}');
 const session={dir:root,sessionId:'synthetic-session',day:'2026-10-20'};
 for(const upload of [uploadSession,uploadSessionSnapshot]) {
  calls=[];const args={session,baseUrl:'https://service.invalid/v1',token:'t',fetchFn:async(u,i)=>{calls.push([u,i.body]);return Response.json({key:'k'});}};
  assert.equal((await upload({...args,confirm:async m=>(shown=m,false)})).ok,false);assert.equal(calls.length,0);
  assert.equal((await upload(args)).ok,false);assert.equal(calls.length,0);
  const prior=Buffer.from('한😀\n');writeFileSync(join(root,'events.jsonl'),prior);
  assert.equal((await upload({...args,confirm:async()=>{writeFileSync(join(root,'events.jsonl'),'later');return true;}})).ok,true);
  assert.deepEqual(Buffer.from(calls.find(([u])=>u.includes('events.jsonl'))[1]),prior);
 }
 const scope={grant_id:'g',class_run_id:'r',seat_id:'s',student:{u:'u',c:'c',p:'p'},activity:null,run:{starts_at:0,ends_at:999999}};
 let live=scope,saved=null;calls=[];
 const deps={scope:()=>live,copy:async()=>({binding:{},files:[{name:'session.meta.json',data:new Uint8Array([1])},{name:'events.jsonl',data:new Uint8Array([2,3])}]}),loadState:async()=>saved,saveState:async s=>{saved=structuredClone(s);},put:async(...a)=>{calls.push(a);return{status:200};},seal:async(...a)=>{calls.push(a);return{status:200,receipt_id:'receipt'};}};
 assert.equal((await uploadSnapshot('batch',{...deps,confirm:async m=>(shown=m,false)})).code,'consent_declined');assert.equal(calls.length,0);assert.equal(shown.find(i=>i.name==='events.jsonl').bytes,2);
 assert.equal((await uploadSnapshot('batch',{...deps,confirm:async()=>{throw Error('cancelled copy retried');}})).code,'consent_declined');
 saved=null;assert.equal((await uploadSnapshot('batch',{...deps,confirm:async()=>{live={...scope,grant_id:'new'};return true;}})).code,'not_connected');assert.equal(calls.length,0);
 live=scope;saved=null;assert.equal((await uploadSnapshot('batch',{...deps,confirm:async()=>true})).ok,true);assert.equal(calls.length,3);
 writeFileSync(join(root,'index.html'),'<p>page</p>');mkdirSync(join(root,'notes'));writeFileSync(join(root,'notes/private.md'),'private');
 { // REQ-KNOW-51 (CGP-KNOW-R-033) replaced the blanket refusal: a memory file the learner typed in is part of the set and labelled.
  const chosen=await buildPublishSet(root,'/index.html',['notes/private.md'],{projectId:'prj-synthetic',testOrigin:null});assert.equal(chosen.ok,true);assert.deepEqual(chosen.set.memory,['notes/private.md']);
  assert.equal((await buildPublishSet(root,'/index.html',[],{projectId:'prj-synthetic',testOrigin:null})).set.files.some(f=>f.path.startsWith('notes/')),false,'not selected: not in the set'); }
 const form={question:'q',method:'task_test',success_criteria:['c'],hypothesis:'h',expires_in_days:1};
 const project={id:'prj-synthetic',title:'project',members:['synthetic']};
 const state={project,test_origin:null,versions:[{id:'v',files:[{path:'approved.html',bytes:7,sha256:'a'}]}],hypotheses:[],experiments:[{id:'exp-synthetic',product_version_id:'v'}],links:[]};
 let generation='one',confirm=async m=>(shown=m,false);calls=[];
 const ports={previewVisitor:async()=>true,switchOn:()=>true,scopeKey:()=>generation,confirmOutbound:m=>confirm(m),token:async()=> 't',base:()=> 'https://service.invalid/v1/curriculum',root:()=>root,entry:()=>'/index.html',events:async()=>[],projectId:()=>project.id,setProjectId:async()=>{},week:()=>1,defaultTitle:()=> 'title',qr:u=>u,fetchImpl:async(u,i)=>{calls.push([u,i]);if((i?.method??'GET')!=='GET')return Response.json(new URL(u).pathname.endsWith('/experiments')?{experiment:{id:'exp-synthetic'}}:{share_url:'https://test.invalid/l/1'});return Response.json(new URL(u).pathname.endsWith('/projects')?{projects:[project]}:state);}};
 const pub=new PublishSession(ports);
 assert.equal((await pub.submit(form)).ok,false);assert.ok(!calls.some(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')));
 calls=[];assert.equal((await pub.link('exp-synthetic',{expires_in_days:1})).ok,false);assert.equal(shown.items[0].name,'approved.html');assert.ok(!calls.some(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')));
 confirm=async()=>{generation='two';return true;};calls=[];assert.equal((await pub.link('exp-synthetic',{expires_in_days:1})).ok,false);assert.ok(!calls.some(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')));
 confirm=async()=>true;calls=[];assert.equal((await pub.link('exp-synthetic',{expires_in_days:1})).ok,true);assert.equal(calls.filter(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')).length,1);
 let changeDuringToken=false;ports.token=async()=>{if(changeDuringToken)generation='during-token';return 't';};
 confirm=async()=>{changeDuringToken=true;return true;};calls=[];assert.equal((await pub.link('exp-synthetic',{expires_in_days:1})).ok,false);assert.ok(!calls.some(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')));changeDuringToken=false;
 const submitted=structuredClone(form);confirm=async()=>{submitted.question='unapproved';submitted.success_criteria.push('unapproved');return true;};calls=[];
 assert.equal((await pub.submit(submitted)).ok,true);const experimentBody=JSON.parse(calls.find(([u,i])=>u.endsWith('/experiments')&&i.method==='POST')[1].body);assert.equal(experimentBody.question,'q');assert.deepEqual(experimentBody.success_criteria,['c']);
 confirm=async()=>{writeFileSync(join(root,'index.html'),'changed');return true;};calls=[];assert.equal((await pub.submit(form)).ok,false);assert.ok(!calls.some(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')));
 state.versions[0].files[0].path='notes/private.md';calls=[];assert.equal((await pub.link('exp-synthetic',{expires_in_days:1})).ok,false);assert.ok(!calls.some(([,i])=>/^(POST|PUT|PATCH|DELETE)$/.test(i?.method??'GET')));
 { // problem report (F1): frozen body, recipient, items with sizes; Cancel or no adapter sends nothing
  const body={description:'버튼이 안 눌려요 한😀',contact:'010',recent_turns:[{role:'user',content:'내 질문'},{role:'assistant',content:'AI 답'}],attachments:{os:'x'},request_id:'r',profile_id:'p'};
  let m=null;assert.equal(await confirmProblemReport('https://api.invalid/v1',body,async x=>(m=x,false)),null);
  assert.equal(m.recipient,'Studio 운영팀 (문제 신고 채널) · api.invalid');
  assert.deepEqual(m.items.map(i=>i.name),['내가 쓴 문제 설명','내가 적은 연락처','최근 대화 1 · 내가 보낸 말','최근 대화 2 · AI의 답','앱 정보 (버전·운영체제·요청 번호·프로필)']);
  assert.equal(m.items[0].bytes,Buffer.byteLength(JSON.stringify(body.description)));assert.equal(m.items[2].bytes,Buffer.byteLength(JSON.stringify(body.recent_turns[0])));
  assert.equal(await confirmProblemReport('https://api.invalid/v1',body,undefined),null,'no adapter, no report');
  const frozen=await confirmProblemReport('https://api.invalid/v1',body,async()=>{body.description='changed after approval';return true;});
  assert.equal(JSON.parse(frozen).description,'버튼이 안 눌려요 한😀','the approved body is what is sent');
  const posted=[];assert.equal((await postProblemReport('https://api.invalid/v1',frozen,'t',async(u,i)=>{posted.push([u,i.body]);return Response.json({report_id:'R1'});})).ok,true);assert.deepEqual(posted,[['https://api.invalid/v1/report',frozen]]);
  assert.deepEqual(reportManifestItems({description:'d'}).map(i=>i.name),['내가 쓴 문제 설명','앱 정보 (버전·운영체제·요청 번호·프로필)'],'no turns, no contact: none listed');
 }
 { // gallery session record: the bytes listed are the bytes sent, even if the spool grows after the dialog
  writeFileSync(join(root,'events.jsonl'),'before\n');const read=readSessionSnapshot({dir:root,sessionId:'s',day:'d'});assert.equal(read.ok,true);
  writeFileSync(join(root,'events.jsonl'),'before\nafter the dialog\n');const puts=[];
  assert.equal((await sendSessionSnapshot({session:{dir:root,sessionId:'s',day:'d'},baseUrl:'https://service.invalid/v1',token:'t',fetchFn:async(u,i)=>{puts.push([u,Buffer.from(i.body).toString()]);return Response.json({key:'k'});}},read.entries)).ok,true);
  assert.equal(puts.find(([u])=>u.includes('events.jsonl'))[1],'before\n');
 }
 console.log('PASS outbound manifests, gallery, logs, collection, test publish/share; Cancel sends no content requests');
}finally{rmSync(root,{recursive:true,force:true});}
