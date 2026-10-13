import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { automationNamespace, createAutomationLedger } from '../src/automationLedger.ts';
const storage=await mkdtemp(join(tmpdir(),'hps-conversation-host-'));
const recipe={schema:'hps-email-automation/1',category:'email',title:'자료 요청',description:'반복 자료 요청 메일',subjectTemplate:'{{name}}님 자료 요청',bodyTemplate:'{{document}}를 {{dueDate}}까지 부탁드립니다.',columns:{email:'이메일',name:'이름',document:'서류',dueDate:'기한'}};
let token='synthetic-participant',grant=true,handlers,question=null,started=0,panelCount=0,connected=0,published=0,readInput,tick,googleReady=false,connectionChecks=0;
const current={serverId:'a'.repeat(64),token,service:'https://service.example.test/v1'};
const commands=new Map(),globals=new Map(),secrets=new Map(),questions=[],runtimeDeps=[];
let desktopClientId='synthetic-desktop-client',operatorInput='synthetic-desktop-secret',operatorOptions,devContext;
const uri=fsPath=>({fsPath});
const vscode={workspace:{isTrusted:true,getConfiguration:()=>({get:(key,fallback)=>key==='proxyUrl'?current.service:fallback}),fs:{}},Uri:{joinPath:(root,...parts)=>uri(join(root.fsPath,...parts)),parse:url=>({url})},ViewColumn:{One:1},env:{appName:'HypeProof Studio Dev',openExternal:async()=>true},commands:{executeCommand:async(name,key,value)=>{assert.equal(name,'setContext');assert.equal(key,'hypeproofChat.devGoogleOperator');devContext=value;},registerCommand:(name,fn)=>{commands.set(name,fn);return{dispose(){}};}},window:{showInputBox:async options=>{operatorOptions=options;return operatorInput;},showWarningMessage:async()=>undefined,createWebviewPanel:()=>{panelCount++;throw new Error('Form must not open');}}};
const fixture={current,fetchProfileResult:async()=>({ok:true,profile:{activity_id:current.serverId,automations:{enabled:grant,provider:'gmail',maxRecipients:20,oauthClientId:desktopClientId}}}),createGoogleAutomationRuntime:deps=>(runtimeDeps.push(deps),{status:async()=>({connected:false,configured:true}),ensureConnected:async()=>{connectionChecks++;return googleReady;},getConnectionIdentity:async()=>googleReady?'synthetic-connection':null,connect:async()=>{connected++;googleReady=true;},disconnect:async()=>{},readSheet:async input=>{readInput=input;return[['이메일','이름','서류','기한'],['synthetic@example.invalid','개인명','계약서','내일']];},send:async()=>{throw new Error('No real sending in host tests');}})};
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/automationHost.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['vscode'],plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^\.\/(activityConnections|proxyClient|googleAutomation)$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('activityConnections')?`export const ACTIVITY_TOKEN_KEY='token';export const activityConnections=()=>({current:globalThis.fixture.current});`:args.path.endsWith('proxyClient')?`export const fetchProfileResult=(...args)=>globalThis.fixture.fetchProfileResult(...args);`:`export const createGoogleAutomationRuntime=(...args)=>globalThis.fixture.createGoogleAutomationRuntime(...args);export const validateEmailRecipe=value=>{if(value?.schema!=='hps-email-automation/1')throw Error('Invalid recipe');return structuredClone(value);};`,loader:'js'}));}}]});
let pauseDetail=false,releaseDetail;
const fetcher=async (url,init)=>{
  if(pauseDetail && url.endsWith('/chosen')) await new Promise(resolve=>{releaseDetail=resolve;});
  if(init.method==='POST'){published++;const body=JSON.parse(init.body);assert.deepEqual(body.recipe,recipe);assert.match(body.requestId,/^skill-[0-9a-f]{64}$/);return new Response(JSON.stringify({item:{id:'published',title:recipe.title}}));}
  return new Response(JSON.stringify({item:{id:'chosen',title:recipe.title},recipe,items:[{id:'chosen',title:recipe.title,description:recipe.description,mine:false}]}));
};
const module={exports:{}};const require=createRequire(import.meta.url);
vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),fixture,console,URL,Date,Buffer,TextDecoder,AbortSignal,structuredClone,fetch:fetcher,setInterval:fn=>{tick=fn;return 1;},clearInterval(){},process});
const ctx={globalStorageUri:uri(storage),extensionUri:uri(storage),subscriptions:[],globalState:{get:key=>globals.get(key),update:async(key,value)=>globals.set(key,value)},secrets:{get:async key=>key==='token'?token:secrets.get(key),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)}};
const host=module.exports.registerAutomationHost(ctx,{beginAutomationConversation:async()=>{started++;},setAutomationConversationHandlers:value=>{handlers=value;},showAutomationQuestion:async value=>{question=value;questions.push(value);}});
const waitQuestion=async()=>{for(let i=0;i<100;i++){if(question)return question;await new Promise(r=>setTimeout(r,2));}throw Error('No question shown');};
try {
  await commands.get('hypeproof-chat.emailAutomation')();assert.equal(started,1);assert.equal(panelCount,0);assert.equal(globals.size,0,'intent discovery must not save an assumed default skill');
  const operator=commands.get('hypeproof-chat.configureGoogleDesktopClient');assert.equal(typeof operator,'function');assert.equal(devContext,true);
  assert.equal((await operator()).configured,true);assert.equal(operatorOptions.password,true);assert.equal(operatorOptions.ignoreFocusOut,true);
  assert.equal(secrets.size,1);assert.match([...secrets.keys()][0],/^hps\.google\.desktop-client\.[a-f0-9]{64}$/);
  await host.getMcpHost();assert.equal(runtimeDeps.at(-1).clientSecret,'synthetic-desktop-secret');
  assert.equal(JSON.stringify(questions).includes('synthetic-desktop-secret'),false);assert.equal(JSON.stringify([...globals.values()]).includes('synthetic-desktop-secret'),false);
  operatorInput=undefined;assert.equal((await operator()).cancelled,true);assert.equal(secrets.size,1);
  desktopClientId='another-synthetic-client';await host.getMcpHost();assert.equal(runtimeDeps.at(-1).clientSecret,undefined,'desktop secrets must not cross client IDs');
  desktopClientId='synthetic-desktop-client';
  let mcp=await host.getMcpHost();
  let pending=mcp.askUser({question:'누구에게 어떤 안내를 반복하나요?',choices:[{id:'documents',label:'제출 자료 요청'}],allowFreeText:true});
  let card=await waitQuestion();assert.equal(card.private,false);assert.equal(handlers.isWaiting(),true);
  await handlers.answer({questionId:'stale',choiceId:'documents'});assert.equal(handlers.isWaiting(),true);
  await handlers.answer({questionId:card.id,text:'actual@example.invalid'});assert.match(question.error,/비공개/);assert.equal(handlers.isWaiting(),true);
  await handlers.answer({questionId:card.id,choiceId:'documents'});assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{choiceId:'documents'});assert.equal(question,null);
  await mcp.saveSkill(recipe);assert.deepEqual([...globals.values()][0],recipe);
  await assert.rejects(mcp.saveSkill({...recipe,bodyTemplate:'actual@example.invalid'}),/실제 주소/);
  pending=mcp.connectGoogle();card=await waitQuestion();assert.equal(card.kind,'connect');await handlers.answer({questionId:card.id,cancelled:true});assert.equal((await pending).cancelled,true);assert.equal(connected,0);mcp=await host.getMcpHost();
  googleReady=true;pending=mcp.configureSheet();card=await waitQuestion();assert.equal(card.private,true);
  await handlers.answer({questionId:card.id,text:'wrong'});assert.match(question.error,/Sheets/);
  await handlers.answer({questionId:card.id,text:'https://docs.google.com/spreadsheets/d/'+'s'.repeat(30)+'/edit'});
  const summary=await pending;assert.equal(summary.rowCount,1);const questionCount=questions.length;assert.equal((await mcp.connectGoogle()).reused,true);assert.equal((await mcp.configureSheet()).reused,true);assert.equal(questions.length,questionCount,'existing Google and Sheet connection must not ask again');assert.equal((await mcp.readConfiguredSheet()).rowCount,1);assert.equal(readInput.range,'A1:D21');assert.equal(JSON.stringify(summary).includes('synthetic@example.invalid'),false);assert.equal(JSON.stringify(summary).includes('s'.repeat(30)),false);
  // Another window's account mutation owns this same filesystem lock.
  const otherWindowLedger=createAutomationLedger(storage,automationNamespace(current.service,current.serverId));
  let acquired,releaseLock;const locked=new Promise(resolve=>{acquired=resolve;});
  const held=otherWindowLedger.withLock(async()=>{acquired();await new Promise(resolve=>{releaseLock=resolve;});});await locked;
  const checksBefore=connectionChecks;await assert.rejects(mcp.connectGoogle(),/다른 창/);
  assert.equal(connectionChecks,checksBefore,'credential refresh must not run while another window holds the account lock');
  releaseLock();await held;assert.equal((await mcp.connectGoogle()).reused,true);assert.equal(connectionChecks,checksBefore+1);
  pending=mcp.publishSkill();card=await waitQuestion();assert.equal(card.kind,'publish');assert.deepEqual(card.recipe,recipe);await handlers.answer({questionId:card.id,cancelled:true});assert.equal((await pending).cancelled,true);assert.equal(published,0);mcp=await host.getMcpHost();
  pending=mcp.publishSkill();card=await waitQuestion();await handlers.answer({questionId:card.id,approved:true});assert.equal((await pending).published,true);assert.equal(published,1);await handlers.answer({questionId:card.id,approved:true});assert.equal(published,1);
  // Stop must survive both answer authorization and the later store token check.
  for(const pauseAt of [1,2]) {
    const beforePublished=published;
    const publishing=mcp.publishSkill();const publication=await waitQuestion();
    const originalProfile=fixture.fetchProfileResult;let profileCalls=0,releaseGate;
    fixture.fetchProfileResult=async()=>{if(++profileCalls===pauseAt)await new Promise(resolve=>{releaseGate=resolve;});return originalProfile();};
    const answered=handlers.answer({questionId:publication.id,approved:true});
    const outcome=publishing.then(value=>({value}),error=>({error}));
    for(let i=0;i<100&&!releaseGate;i++)await new Promise(resolve=>setTimeout(resolve,2));
    assert.ok(releaseGate);mcp.cancelPendingQuestion();releaseGate();await answered;await outcome;
    assert.equal(published,beforePublished,'Stop before POST must prevent publication');assert.equal(question,null);
    fixture.fetchProfileResult=originalProfile;mcp=await host.getMcpHost();
  }
  const preview={id:'preview',createdAt:Date.now(),messages:[{id:'row',to:'synthetic@example.invalid',subject:'실제 제목',body:'최종 전체 본문'}]};
  pending=mcp.confirmSend(preview);card=await waitQuestion();assert.equal(card.preview.messages[0].body,'최종 전체 본문');grant=false;await handlers.answer({questionId:card.id,approved:true});assert.equal(await pending,false,'revoked at answer must not authorize sending');grant=true;
  pending=mcp.askUser({question:'어떤 표현이 좋을까요?',choices:[],allowFreeText:true});card=await waitQuestion();current.serverId='b'.repeat(64);current.token=token='different-participant';tick();assert.equal((await pending).cancelled,true);assert.equal(question,null);assert.equal(handlers.isWaiting(),false);
  assert.ok([...globals.values()].every(value=>!('rows'in value)&&!('sheetUrl'in value)));
  // A slow cohort download cannot display its old recipe in a new activity.
  mcp=await host.getMcpHost();pauseDetail=true;
  const installing=mcp.installSkill('chosen').then(value=>({value}),error=>({error}));
  for(let i=0;i<100&&!releaseDetail;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(releaseDetail);
  current.serverId='c'.repeat(64);current.token=token='third-participant';await host.getMcpHost();
  releaseDetail();const installed=await installing;
  assert.ok(installed.error,'stale download must be rejected');assert.equal(question,null,'old cohort recipe must never be shown in the new activity');
  vscode.env.appName='HypeProof Studio';commands.delete('hypeproof-chat.configureGoogleDesktopClient');module.exports.registerAutomationHost(ctx,{});assert.equal(commands.has('hypeproof-chat.configureGoogleDesktopClient'),false);assert.equal(devContext,false);
  console.log('PASS conversation host: intent-first entry, private answers, one-use approvals, auto-save, independent publish, locked refresh, Stop races, stale install privacy');
} finally { await rm(storage,{recursive:true,force:true}); }
