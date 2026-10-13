import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const bundle = await build({entryPoints:['src/appsScriptHost.ts','src/automationQuestSession.ts'],bundle:true,platform:'node',format:'cjs',outdir:'/tmp/unused-apps-host',write:false});
const require=createRequire(import.meta.url), loaded={};
for(const file of bundle.outputFiles){const module={exports:{}};vm.runInNewContext(file.text,{module,exports:module.exports,require,console,URL,Date,Buffer,AbortSignal,structuredClone,fetch,setTimeout,clearTimeout});Object.assign(loaded,module.exports);}
const {createAppsScriptHost,createAutomationQuestSession,withAutomationQuest}=loaded;
const recipe={schema:'hps-email-automation/1',category:'email',title:'자료 요청',description:'반복 자료 요청',subjectTemplate:'{{name}}님',bodyTemplate:'{{document}} {{dueDate}}',columns:{email:'이메일',name:'이름',document:'자료',dueDate:'기한'}};
function fixture(){
 let current=structuredClone(recipe),saved,preview,ledger={},answers=[],approved=true,permitted=true,sends=0,uploads=0,connected=false;
 const connection='account:connection';
 const runtime={isConnected:async()=>connected,getConnectionIdentity:async()=>connected?connection:null,connect:async()=>{connected=true;},createProject:async()=>({scriptId:'synthetic-project-id'}),uploadProject:async(id,project)=>{uploads++;return{digest:project.digest};},deployProject:async(id,project)=>({scriptId:id,deploymentId:'synthetic-deployment-id',versionNumber:1,digest:project.digest,connectionIdentity:connection}),preview:async()=>preview={id:'preview-identity',createdAt:Date.now(),messages:[{id:'mail-id',to:'synthetic@example.invalid',subject:'자료',body:'본문'}]},getPreview:()=>preview,sendApproved:async()=>{sends++;return{records:[{id:'mail-id',status:'sent'}]};}};
 const deps={runtime,maxRecipients:20,allowed:async()=>permitted,recipe:()=>current,ask:async question=>{answers.push(question);return{questionId:'q',approved,cancelled:!approved};},load:async()=>saved,save:async value=>{saved=value;},sheet:async()=>({spreadsheetId:'synthetic-spreadsheet',range:'A1:D21',connection}),lock:async work=>{if(!permitted)throw Error('revoked');return work();},ledger:{load:async()=>structuredClone(ledger),save:async value=>{ledger=structuredClone(value);}},openBrowser:async()=>{}};
 return {host:createAppsScriptHost(deps),deps,answers,get sends(){return sends;},get uploads(){return uploads;},set approved(value){approved=value;},set permitted(value){permitted=value;},changeRecipe(){current={...current,bodyTemplate:'수정한 내용'};},prior(){ledger[createHash('sha256').update('account:mail-id').digest('hex')]={id:'mail-id',status:'unknown'};}};
}
test('Apps Script authoring requires code and deployment approvals, then exact host preview approval',async()=>{
 const f=fixture(), h=f.host;
 assert.equal((await h.appsScriptPrepare()).uploaded,false);
 f.approved=false;assert.equal((await h.appsScriptUpload()).cancelled,true);assert.equal(f.uploads,0);
 f.approved=true;assert.equal((await h.appsScriptUpload()).uploaded,true);
 assert.equal((await h.appsScriptRun('preview')).deploymentRequired,true);
 assert.equal((await h.appsScriptDeploy()).deployed,true);
 const p=await h.appsScriptRun('preview');assert.equal(p.count,1);assert.equal(JSON.stringify(p).includes('synthetic@'),false);
 f.approved=false;await h.appsScriptRun('send');assert.equal(f.sends,0);
 f.approved=true;assert.equal((await h.appsScriptRun('send')).sent,true);assert.equal(f.sends,1);
 assert.equal((await h.appsScriptRun('send')).previewRequired,true);
 assert.equal(f.answers.findLast(q=>q.kind==='preview').preview.messages[0].body,'본문');
});
test('changed skill, revoked capability and previous Gmail/unknown attempts cannot authorize sending',async()=>{
 const f=fixture(),h=f.host;await h.appsScriptUpload();await h.appsScriptDeploy();await h.appsScriptRun('preview');f.prior();
 assert.equal((await h.appsScriptRun('send')).previousAttempt,true);assert.equal(f.sends,0);
 f.changeRecipe();assert.equal((await h.appsScriptRun('preview')).deploymentRequired,true);
 f.permitted=false;await assert.rejects(()=>h.appsScriptUpload());assert.equal(f.uploads,1);
});
test('graph progress reflects tool outcomes; blocked actions stay incomplete',async()=>{
 const renders=[],quest=createAutomationQuestSession(async html=>renders.push(html));
 const host=withAutomationQuest({runtime:{},isAllowed:()=>true,confirmSend:async()=>false,askUser:async()=>({answer:'자료 요청'}),saveSkill:async()=>({saved:true}),appsScriptPrepare:async()=>({prepared:true}),appsScriptUpload:async()=>({setupRequired:true})},quest);
 await host.workflowPlan({title:'자료 요청',nodes:[{id:'goal',label:'업무 파악',dependsOn:[]},{id:'skill',label:'스킬 작성',dependsOn:['goal']},{id:'prepare',label:'코드 준비',dependsOn:['skill']},{id:'upload',label:'Google 저장',dependsOn:['prepare']}]});
 await host.askUser({});await host.saveSkill(recipe);await host.appsScriptPrepare();await host.appsScriptUpload();
 assert.equal(quest.snapshot().nodes.filter(n=>n.status==='succeeded').length,3);
 assert.equal(quest.snapshot().nodes.find(n=>n.id==='upload').status,'blocked');
 assert.ok(renders.at(-1).includes('3 / 4') || renders.at(-1).includes('3/4'));
 await assert.rejects(()=>host.workflowPlan({title:'우회',nodes:[{id:'send',label:'발송',dependsOn:[],status:'succeeded'}]}));
});
