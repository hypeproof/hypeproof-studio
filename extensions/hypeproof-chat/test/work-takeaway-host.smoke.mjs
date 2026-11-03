import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { autoTakeawayPanel } from './lib/takeaway-panel-stub.mjs';
import {createTaskHarness} from './task-workspace-harness.mjs';
const require=createRequire(import.meta.url);
const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'takeaway-host-')));
const built=await build({entryPoints:['src/workTakeawayHost.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
try{
 const root=path.join(base,'source'),target=path.join(base,'target');fs.mkdirSync(root);fs.mkdirSync(target);
 let live=true,approve=true,report,details,chooseCount=0,onReview=()=>{};
 const vscode={ViewColumn:{Beside:2},Uri:{file:fsPath=>({fsPath,scheme:'file'})},window:{
  createWebviewPanel:autoTakeawayPanel(html=>{if(html.includes('id="results"')){report=html;return {action:'close'};}details=html;onReview();return {action:approve?'confirm':'close'};}),
  showQuickPick:async()=>{chooseCount++;return '작업 대화만 가져가기';},
  showOpenDialog:async()=>[{scheme:'file',fsPath:target}],
  showWarningMessage:async(_title,options)=>{details=options?.detail;return approve?{title:'사본 가져가기'}:undefined;},
  showInformationMessage:async(_title,options)=>{report=options.detail;}
 }};
 const mod={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),Buffer,setTimeout,clearTimeout});
 const source={root,wikiDirectory:'wiki',secrets:[],owned:{},tasks:[{label:'두 번째 작업',category:'작업',bytes:Buffer.from('task bytes'),extension:'.txt',reason:'읽기용 사본'}],current:()=>live};
 await mod.exports.runWorkTakeaway(source);assert.match(details,/class="columns"/,'review uses the responsive panel');assert.match(details,/두 번째 작업/);assert.match(details,/수업 자료/);assert.match(report,/옮김 · 두 번째 작업/);assert.match(report,/제외 · 강사 메모/);
 assert.equal(fs.readFileSync(path.join(target,fs.readdirSync(target)[0],'작업-기록/1.txt'),'utf8'),'task bytes');
 approve=false;await mod.exports.runWorkTakeaway(source);assert.equal(fs.readdirSync(target).length,1);
 approve=true;onReview=()=>{live=false;};await mod.exports.runWorkTakeaway(source);assert.equal(fs.readdirSync(target).length,1);
 // A real write fails once: retry only that frozen item, never copy the successful sibling again.
 for(const stale of [false,true,'destination']){
  live=true;onReview=()=>{};const create=vscode.window.createWebviewPanel,write=fs.writeFileSync;let attempts=0,successful=0,views=0;
  const retrySource={...source,tasks:[source.tasks[0],{...source.tasks[0],label:'실패 후 다시 시도',bytes:Buffer.from('retry frozen bytes')}]};
  fs.writeFileSync=(file,bytes,...rest)=>{if(String(file).startsWith(target)){if(String(bytes)==='task bytes')successful++;if(String(bytes)==='retry frozen bytes'&&++attempts===1)throw Error('synthetic disk failure');}return write(file,bytes,...rest);};
  vscode.window.createWebviewPanel=autoTakeawayPanel(html=>{if(!html.includes('id="results"'))return {action:'confirm'};views++;if(stale===true)live=false;if(stale==='destination'&&views===1){fs.renameSync(target,target+'-retry-backup');fs.symlinkSync(root,target);}return html.includes('data-retry="1"')?{action:'retry',index:1}:{action:'close'};});
  try{assert.equal(await mod.exports.runWorkTakeaway(retrySource),!stale);assert.equal(attempts,stale?1:2);assert.equal(successful,1);assert.equal(views,stale?1:2);}
  finally{fs.writeFileSync=write;vscode.window.createWebviewPanel=create;if(fs.lstatSync(target).isSymbolicLink()){fs.unlinkSync(target);fs.renameSync(target+'-retry-backup',target);}}
 }
 // A folder redirected while review is open cannot become a new destination inside the source.
 {
  live=true;const backup=target+'-backup';onReview=()=>{fs.renameSync(target,backup);fs.symlinkSync(root,target);};
  try{assert.equal(await mod.exports.runWorkTakeaway(source),false,'changed destination refuses before copying');assert.deepEqual(fs.readdirSync(root),[]);}
  finally{onReview=()=>{};if(fs.lstatSync(target).isSymbolicLink()){fs.unlinkSync(target);fs.renameSync(backup,target);}for(const name of fs.readdirSync(root))fs.rmSync(path.join(root,name),{recursive:true,force:true});}
 }
 // Destination/selection guards must stop before showing a stale confirmation.
 live=true;onReview=()=>{};let warnings=0;
 vscode.window.showWarningMessage=async()=>{warnings++;return {title:'사본 가져가기'};};
 vscode.window.showOpenDialog=async()=>[{scheme:'file',fsPath:root}];
 assert.equal(await mod.exports.runWorkTakeaway(source),false);assert.equal(warnings,1,'source folder refused');assert.deepEqual(fs.readdirSync(root),[]);
 // A destination that is a symlink into the source folder is resolved like the kernel does and refused.
 {const inner=path.join(root,'inner');fs.mkdirSync(inner);const link=path.join(base,'destination-link');fs.symlinkSync(inner,link);
  warnings=0;const before=fs.readdirSync(inner).length;vscode.window.showOpenDialog=async()=>[{scheme:'file',fsPath:link}];
  assert.equal(await mod.exports.runWorkTakeaway(source),false);assert.equal(warnings,1,'symlinked destination refused');assert.deepEqual(fs.readdirSync(inner),[],'nothing written through the link');assert.equal(before,0);fs.rmSync(inner,{recursive:true});}
 warnings=0;vscode.window.showOpenDialog=async()=>[{scheme:'https',fsPath:target}];
 assert.equal(await mod.exports.runWorkTakeaway(source),false);assert.equal(warnings,0,'remote destination refused');
 vscode.window.showQuickPick=async()=> '파일·팀 브레인과 작업 가져가기';
 let picks=0;vscode.window.showOpenDialog=async()=>{picks++;return Array.from({length:101},()=>({scheme:'file',fsPath:root+'/x.txt'}));};
 assert.equal(await mod.exports.runWorkTakeaway(source),false);assert.equal(picks,1,'selection cap stops before destination');
 for(const phase of ['choice','selection','destination']){
  live=true;let picks=0;warnings=0;
  vscode.window.showQuickPick=async()=>{if(phase==='choice')live=false;return '파일·팀 브레인과 작업 가져가기';};
  vscode.window.showOpenDialog=async()=>{picks++;if((phase==='selection'&&picks===1)||(phase==='destination'&&picks===2))live=false;return picks===1?[]:[{scheme:'file',fsPath:target}];};
  assert.equal(await mod.exports.runWorkTakeaway(source),false);assert.equal(warnings,0,phase+' never confirms');assert.equal(picks,phase==='choice'?0:phase==='selection'?1:2);
 }
 // Drive the real provider, both its task store and the classroom workspace-state fallback.
 for(const kind of ['trial','personal','classroom']){
  const hroot=path.join(base,kind);fs.mkdirSync(hroot);const f=await createTaskHarness(hroot);f.activity.kind=kind;
  f.h.cachedProfile={activity_kind:kind};f.h._instructorMode={isInstructor:false};f.h.resolveCoachCwd=()=>hroot;
  let enabled=true,count=0;f.vscode.workspace.getConfiguration=()=>({get:(key,fallback)=>key==='workTakeawayEnabled'?enabled:fallback});
  f.vscode.window.showQuickPick=async()=>{count++;return undefined;};f.vscode.window.showWarningMessage=async()=>{};
  if(kind==='classroom')f.h.taskWorkspace=undefined;
  await f.handle(f.scoped({type:'workTakeaway'}));assert.equal(count,1,kind);
  f.activity.kind='unknown';await f.h.takeMyWork();assert.equal(count,1,'unknown kind');f.activity.kind=kind;
  f.h.resolveCoachCwd=()=>target;await f.h.takeMyWork();assert.equal(count,1,'different folder');f.h.resolveCoachCwd=()=>hroot;
  enabled=false;await f.h.takeMyWork();assert.equal(count,1,'default off');enabled=true;
  f.h._instructorMode.isInstructor=true;await f.h.takeMyWork();assert.equal(count,1,'instructor denied');
  f.h._instructorMode.isInstructor=null;await f.h.takeMyWork();assert.equal(count,1,'unknown actor denied');f.h._instructorMode.isInstructor=false;
  f.h.pendingSends=1;await f.h.takeMyWork();assert.equal(count,1,'running turn denied');f.h.pendingSends=0;
  f.h.connectionChanging=true;await f.h.takeMyWork();assert.equal(count,1,'transition race');f.h.connectionChanging=false;
  f.h.taskChanging=true;await f.h.takeMyWork();assert.equal(count,1,'task race');f.h.taskChanging=false;
  let release;f.vscode.window.showQuickPick=()=>{count++;return new Promise(r=>release=r);};
  const pending=f.h.takeMyWork();while(!release)await new Promise(r=>setTimeout(r,1));const duplicate=await Promise.race([f.h.takeMyWork().then(()=> 'returned'),new Promise(resolve=>setTimeout(()=>resolve('pending'),100))]);assert.equal(duplicate,'returned','double press returns without another dialog');assert.equal(count,2,'double press');release(undefined);await pending;
  // A task store that failed to read must stop before any dialog (no partial list presented as complete).
  if(kind!=='classroom'){const view=f.store.getView;let before=count;f.store.getView=()=>({...view.call(f.store),error:'read_failed'});let warned=0;f.vscode.window.showWarningMessage=async()=>{warned++;};f.vscode.window.showQuickPick=async()=>{count++;return undefined;};
   before=count;assert.equal(await f.h.takeMyWork(),false);assert.equal(count,before,'task read error stops before the first dialog');assert.equal(warned,1,'learner is told');f.store.getView=view;f.vscode.window.showWarningMessage=async()=>{};}
  // The activity can change while the provenance ledger loads; the flow must recheck before any dialog.
  {let flips=0;const realRead=fs.promises.readFile;const generation0=f.h.profileGeneration;
   fs.promises.readFile=async(file,...rest)=>{if(String(file).includes('artifact-provenance')){f.h.profileGeneration=(f.h.profileGeneration??0)+1;flips++;}return realRead(file,...rest);};
   const before=count;f.vscode.window.showQuickPick=async()=>{count++;return undefined;};
   try{assert.equal(await f.h.takeMyWork(),false);}finally{fs.promises.readFile=realRead;f.h.profileGeneration=generation0;}
   assert.ok(flips>0,'the ledger was read');assert.equal(count,before,'changed during the ledger await: no dialog');}
  const history=[{id:'own-turn',role:'user',content:'actual '+kind,createdAt:1},{id:'system-turn',role:'system',content:'class-secret-instruction',createdAt:2}];
  if(kind==='classroom')await f.h.context.workspaceState.update(f.h.historyKey(),history);
  else await f.store.append(f.store.getView().activeTaskId,history);
  const before=kind==='classroom'?JSON.stringify(f.h.getHistory()):fs.readFileSync(f.store.filePath,'utf8');
  f.vscode.window.showQuickPick=async()=> '작업 대화만 가져가기';
  f.vscode.window.showOpenDialog=async()=>[{scheme:'file',fsPath:target}];
  f.vscode.window.showWarningMessage=async()=>({title:'사본 가져가기'});
  let resultText;f.vscode.ViewColumn={Beside:2};f.vscode.window.createWebviewPanel=autoTakeawayPanel(html=>{if(html.includes('id="results"')){resultText=html;return {action:'close'};}return {action:'confirm'};});
  const old=new Set(fs.readdirSync(target));
  {const r=await f.h.takeMyWork();assert.equal(r,true);}
  const created=fs.readdirSync(target).find(name=>!old.has(name));assert.ok(created);
  const bytes=fs.readFileSync(path.join(target,created,'작업-기록/1.txt'),'utf8');assert.equal(bytes,'나\nactual '+kind);
  assert.match(resultText,/옮김/);
  const after=kind==='classroom'?JSON.stringify(f.h.getHistory()):fs.readFileSync(f.store.filePath,'utf8');assert.equal(after,before,'source history unchanged');
  for(const change of ['generation','scope','root']){
   let picks=0;const savedScope=f.h.turnRequestScope,savedGeneration=f.h.profileGeneration;
   f.vscode.window.showQuickPick=async()=>{if(change==='generation')f.h.profileGeneration=99;if(change==='scope')f.h.turnRequestScope=()=> 'different-task';if(change==='root')f.h.resolveCoachCwd=()=>target;return '작업 대화만 가져가기';};
   f.vscode.window.showOpenDialog=async()=>{picks++;return [{scheme:'file',fsPath:target}];};
   assert.equal(await f.h.takeMyWork(),false);assert.equal(picks,0,change+' changed while dialog open');
   f.h.turnRequestScope=savedScope;f.h.profileGeneration=savedGeneration;f.h.resolveCoachCwd=()=>hroot;
  }


 }
 console.log('takeaway panel review, cancel, stale activity, provider seats/races PASS');
}finally{fs.rmSync(base,{recursive:true,force:true});}
