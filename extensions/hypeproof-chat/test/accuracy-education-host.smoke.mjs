import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
const vscode={env:{appName:'HypeProof Studio'},workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}};
let runtimeCalls=0, outcome='ok', activeHost;
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortController,AbortSignal,URL,TextEncoder,TextDecoder,crypto:webcrypto,fetch:async()=>{
 runtimeCalls++;
 if(outcome==='aborted') for(const ctrl of activeHost.activeStreams.values())ctrl.abort();
 if(outcome==='error') throw Error('synthetic transport failure');
 return new Response('data: '+JSON.stringify({choices:[{delta:{content:outcome==='empty'?'':'first AI result'}}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}});
const proto=module.exports.ChatPanelProvider.prototype;
const directory=mkdtempSync(join(tmpdir(),'accuracy-host-'));
let token='x.'+Buffer.from(JSON.stringify({c:'synthetic',u:'learner'})).toString('base64url')+'.x';
function host(){
 const history=[],posts=[];
 const h=Object.create(proto); const fields={
 context:{globalStorageUri:{fsPath:directory},secrets:{get:async()=>token},workspaceState:{get:()=>undefined},globalState:{get:()=>undefined}},
 pendingSends:0,activeStreams:new Map(), delegationControls: new Map(),turnTimelines:new Map(),turnRequests:new Map(),answerTurnIds:new Map(),observationWrites:Promise.resolve(),
 _instructorMode:{isInstructor:false,onTurnSuccess(){},revertModelOnTurnError:async()=>{}},finishNotifier:{release(){},turnEnded(){}},
 crSdkResults:{reset(){}},elementQueue:{take:()=>null},verifySession:{takeCoachContext:()=>null,endTurn(){}},liveServer:{currentUrl:()=>null},
 getHistory:()=>history,appendHistory:async items=>history.push(...items),post:async m=>{posts.push(m);},
 coachDisplayName:()=> '코치',getCoach:()=>({name:'코치',personality:'',configured:true}),ensureProfile:async()=>null,loadAccess:async()=>{},postConfig:async()=>{},
 dropPageAttachment(){},isCurriculumRuntimeEnabled:()=>false,takeProjectSwitchBrief:async()=>null,isLearningWikiEnabled:()=>false,
 prepareObservation:async()=>null,crBlobSinkFor:()=>null,recordLearnerUploads(){},resolveCoachCwd:()=>undefined,
 beginTurnRestore:async()=>null,endTurnRestore:async()=>{},saveAgentMdIfPresent:async()=>{},
 proxyUsageRecorder:()=>()=>{},handleSendError:async(error)=>{ throw error; },
 };
 for(const [key,value] of Object.entries(fields))Object.defineProperty(h,key,{value,writable:true,configurable:true});
 return {h,history,posts};
}
try {
 const {h,history,posts}=host();
 activeHost=h; await h.handleSend('질문',[]);
 assert.equal(runtimeCalls,1,'real proxy runtime reached');
 assert.ok(history.some(m=>m.content==='first AI result'));
 await h.postAccuracyEducation('read-1');
 const view=posts.findLast(m=>m.type==='accuracyEducation');
 assert.ok(view.offer,'successful real runtime creates offer');
 assert.equal(view.offer.messageId,history.findLast(m=>m.role==='assistant').id);
 assert.ok(posts.findIndex(m=>m.type==='streamEnd')<posts.findIndex(m=>m.type==='accuracyEducationChanged'),'card only after result ends');
 await h.handleMessage({type:'accuracyEducationDismiss',messageId:'wrong'});
 await h.postAccuracyEducation('read-2');assert.ok(posts.at(-1).offer);
 await h.handleMessage({type:'accuracyEducationDismiss',messageId:view.offer.messageId});
 await h.postAccuracyEducation('read-3');assert.equal(posts.at(-1).offer,null);
 for(const mode of ['empty','error','aborted','instructor','app']) {
   token='x.'+Buffer.from(JSON.stringify({c:'synthetic',u:mode})).toString('base64url')+'.x';
   const test=host();activeHost=test.h;outcome=mode;
   const before=runtimeCalls;
   if(mode==='instructor')test.h._instructorMode.isInstructor=true;
   if(mode==='app')test.h.cachedProfile={worlds:[{id:'guest',emoji:'',guest:'손님',chip:'손님'}]};
   if(mode==='error'||mode==='instructor')test.h.handleSendError=async()=>{};
   await test.h.handleSend(mode==='app'?'다른 친구도 있어?':'새 질문',[]);
   assert.equal(runtimeCalls-before,(mode==='app'||mode==='instructor')?0:1,mode+' reaches intended path');
   await test.h.postAccuracyEducation('negative-'+mode);
   assert.equal(test.posts.at(-1).offer,null,mode+' never consumes first education');
 }
 const race=host();let reads=0;
 race.h.context.secrets.get=async()=>++reads===1?'old-token':'new-token';
 await race.h.postAccuracyEducation('stale-token');
 assert.equal(race.posts.length,0,'identity changed during read: no old response');
 reads=0;let scope='before';race.h.turnRequestScope=()=>scope;
 race.h.context.secrets.get=async()=>{if(++reads===2)scope='after';return token;};
 await race.h.postAccuracyEducation('stale-task');
 assert.equal(race.posts.length,0,'task changed during second read: no old response');
 console.log('PASS accuracy host: actual runtime completion -> offer -> exact-target durable dismissal');
} finally {rmSync(directory,{recursive:true,force:true});}
