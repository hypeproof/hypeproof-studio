import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { permittedMcpToolsFor, evaluateSdkToolUse } from '../src/sdkCoachHelpers.ts';
import { GOOGLE_AUTOMATION_MCP_TOOLS as names } from '../src/googleAutomationMcp.ts';
let dir,runSdkCoach;
test.before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'email-sdk-'));const out=join(dir,'sdk.cjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/sdkCoach.ts',import.meta.url))],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent',external:['@anthropic-ai/claude-agent-sdk','zod'],plugins:[{name:'vscode-stub',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};',loader:'js'}));}}]});
 ({runSdkCoach}=createRequire(import.meta.url)(out));
});
test.after(async()=>rm(dir,{recursive:true,force:true}));
const capability={enabled:true,provider:'gmail',maxRecipients:20};
test('email capability is independent of browser; minors and ungranted names fail closed',()=>{
 assert.deepEqual(permittedMcpToolsFor({automations:capability,game:{template_tier:'website'}}),names);
 assert.deepEqual(permittedMcpToolsFor({automations:capability,game:{template_tier:'kids-rich'}}),[]);
 assert.deepEqual(permittedMcpToolsFor({automations:{...capability,enabled:false}}),[]);
 assert.deepEqual(permittedMcpToolsFor({automations:{...capability,provider:'other'}}),[]);
 for(const toolName of names){
  assert.equal(evaluateSdkToolUse({toolName,input:{},permittedTools:[]}).decision,'deny');
  assert.equal(evaluateSdkToolUse({toolName,input:{},permittedTools:names}).decision,'allow');
 }
});
async function turn({host,profile={automations:capability,game:{template_tier:'website'}},browserHost,withFactory=true}){
 let options;const sdk={query:args=>{options=args.options;return(async function*(){yield{type:'result',subtype:'success',is_error:false};})();},...(withFactory?{tool:(name,description,schema,handler)=>({name,handler}),createSdkMcpServer:server=>server}:{})};
 await runSdkCoach({sdk,zod:{string:()=>({})},binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'synthetic',model:'synthetic',profile,systemPrompt:'',history:[],userText:'synthetic',signal:new AbortController().signal,stallTimeoutMs:0,onDelta:()=>{},requestApproval:async()=>false,emailAutomationHost:host,browserHost});return options;
}
test('real SDK registration grants only an installed email server and preserves mandatory human send gate',async()=>{
 let approved=false,sent=0;const preview={id:'preview-1',createdAt:Date.now(),messages:[{id:'message-1',to:'synthetic@example.test',subject:'Synthetic',body:'Synthetic'}]};
 const host={isAllowed:()=>true,confirmSend:async()=>approved,runtime:{getPreview:()=>preview,send:async()=>{sent++;return{records:[{id:'message-1',status:'sent'}]};}}};
 const options=await turn({host});
 assert.deepEqual(Object.keys(options.mcpServers),['hypeproof_email']);
 assert.deepEqual(options.allowedTools,[]);
 const send=options.mcpServers.hypeproof_email.tools.find(t=>t.name==='email_send');
 await send.handler({previewId:preview.id});assert.equal(sent,0);
 approved=true;await send.handler({previewId:preview.id});assert.equal(sent,1);
 host.isAllowed=()=>false;await send.handler({previewId:preview.id});assert.equal(sent,1);
 for(const args of [{host:undefined},{host:{...host,isAllowed:()=>false}},{host,withFactory:false},{host,profile:{}}]){
  const opts=await turn(args);
  assert.equal(opts.mcpServers?.hypeproof_email,undefined);
  const verdict=await opts.canUseTool(names[2],{previewId:preview.id},{signal:new AbortController().signal});
  assert.equal(verdict.behavior,'deny');
 }
});


test('a long SDK turn refreshes expired authorization before MCP dispatch',async()=>{
 let allowed=true,refreshed=0,reads=0;
 const host={isAllowed:()=>allowed,refreshAuthorization:async()=>{refreshed++;allowed=true;return true;},confirmSend:async()=>false,readConfiguredSheet:async()=>{reads++;return{rowCount:1,columns:['Name']};},runtime:{}};
 const opts=await turn({host});allowed=false;
 const read=opts.mcpServers.hypeproof_email.tools.find(t=>t.name==='sheet_read');
 const result=await read.handler({});
 assert.equal(result.isError,undefined);assert.equal(reads,1);assert.equal(refreshed,1);
 host.refreshAuthorization=async()=>false;await read.handler({});assert.equal(reads,1);
});


test('browser registration cannot grant email tools when the email host is missing',async()=>{
 const opts=await turn({profile:{game:{template_tier:'website'},sdk_tools:{browser:true},automations:capability},browserHost:{openBrowser:async()=>{},screenshot:async()=>null,startLivePreview:async()=>null}});
 assert.deepEqual(Object.keys(opts.mcpServers),['hypeproof']);
 assert.equal((await opts.canUseTool(names[2],{}, {signal:new AbortController().signal})).behavior,'deny');
 assert.equal((await opts.canUseTool('mcp__hypeproof__browser_read',{}, {signal:new AbortController().signal})).behavior,'allow');
});

test('inline human questions pause the SDK stall clock and stop cancels the pending question',async()=>{
 for(const cancel of [false,true]){
  const ctrl=new AbortController();let release,waited=false,cancelled=0;
  const host={isAllowed:()=>true,confirmSend:async()=>false,runtime:{},askUser:async()=>{waited=true;return new Promise(resolve=>{release=resolve;setTimeout(()=>{if(cancel)ctrl.abort();else resolve({answer:'자료 요청'});},60);});},cancelPendingQuestion:()=>{cancelled++;release?.({cancelled:true});}};
  const sdk={tool:(name,_description,_schema,handler)=>({name,handler}),createSdkMcpServer:x=>x,query:({options})=>(async function*(){const tool=options.mcpServers.hypeproof_email.tools.find(t=>t.name==='ask_user');await tool.handler({question:'어떤 업무인가요?',choices:'[]',allowFreeText:'true'});yield{type:'result',subtype:'success',is_error:false};})()};
  const result=runSdkCoach({sdk,zod:{string:()=>({})},binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'synthetic',model:'synthetic',profile:{automations:capability,game:{template_tier:'website'}},systemPrompt:'',history:[],userText:'synthetic',signal:ctrl.signal,stallTimeoutMs:10,onDelta:()=>{},requestApproval:async()=>false,emailAutomationHost:host});
  if(cancel)await assert.rejects(result,error=>error.name==='AbortError');else await result;
  assert.equal(waited,true);assert.equal(cancelled,cancel?1:0);
 }
});

test('configured sheet tool cannot be redirected by model-supplied private identifiers',async()=>{
 let reads=0;const opts=await turn({host:{isAllowed:()=>true,confirmSend:async()=>false,readConfiguredSheet:async()=>{reads++;return{rowCount:1,columns:['Name']};},runtime:{}}});
 const read=opts.mcpServers.hypeproof_email.tools.find(t=>t.name==='sheet_read');
 assert.equal((await read.handler({spreadsheetId:'invented-id',range:'A1:D21'})).isError,true);assert.equal(reads,0);
 assert.equal((await read.handler({})).isError,undefined);assert.equal(reads,1);
});

test('public questions redirect private setup without showing a card or collecting account values',async()=>{
 let displayed=0,configured=0,connected=0;
 const host={isAllowed:()=>true,confirmSend:async()=>false,runtime:{},askUser:async()=>{displayed++;return{answer:'선택 완료'};},configureSheet:async mode=>{assert.equal(mode,'reuse');configured++;return{rowCount:1};},connectGoogle:async mode=>{assert.equal(mode,'reuse');connected++;return{connected:true};}};
 const options=await turn({host});
 const tools=options.mcpServers.hypeproof_email.tools;
 const ask=tools.find(t=>t.name==='ask_user');
 for(const [question,nextTool] of [
  ['미리보기에 사용할 Google 시트 주소를 입력해 주세요. (비공개 입력)','sheet_configure'],
  ['사용할 스프레드시트 링크를 붙여넣어 주세요.','sheet_configure'],
  ['Please paste the Google Sheets URL.','sheet_configure'],
  ['사용할 Google 계정의 이메일 주소를 알려 주세요.','google_connect'],
  ['Enter your Google account email address.','google_connect'],
  ['수신자 이메일 주소를 입력해 주세요.','sheet_configure'],
 ]){
  const result=await ask.handler({question,choices:'[]',allowFreeText:'true'});
  assert.equal(result.isError,undefined);
  const guidance=JSON.parse(result.content[0].text);
  assert.equal(guidance.questionDisplayed,false);
  assert.equal(guidance.recoveryRequired,true);
  assert.equal(guidance.nextTool,nextTool);
  assert.equal(displayed,0);
  assert.equal(result.content[0].text.includes(question),false);
  await tools.find(t=>t.name===guidance.nextTool).handler(guidance.arguments);
 }
 assert.equal(configured,4);assert.equal(connected,2);
 for(const question of [
  '어떤 업무 메일을 자동화하고 싶나요?',
  'Google 계정 연결을 진행할까요?',
  'Google 시트 읽기 권한을 허용할까요?',
  '미리보기와 실제 발송 중 무엇을 할까요?',
  '메일 본문에 “시트 주소를 입력해 주세요”라는 문구를 넣을까요?',
  '이메일 주소가 들어 있는 열 이름은 무엇인가요?',
 ]){
  const result=await ask.handler({question,choices:'[{"id":"continue","label":"계속"}]',allowFreeText:'true'});
  assert.equal(JSON.parse(result.content[0].text).answer,'선택 완료');
 }
 assert.equal(displayed,6);
});


test('Apps Script tools require an explicit profile AND host grant, with protected inline approvals',async()=>{
 const appsName='mcp__hypeproof_email__apps_script_upload';
 assert.equal(permittedMcpToolsFor({automations:capability,game:{template_tier:'website'}}).includes(appsName),false);
 const profile={automations:{...capability,appsScript:true},game:{template_tier:'website'}};
 let calls=0;const host={isAllowed:()=>true,isAppsScriptAllowed:()=>true,confirmSend:async()=>false,runtime:{},appsScriptUpload:async()=>{calls++;return{cancelled:true};}};
 const options=await turn({host,profile});
 assert.equal((await options.canUseTool(appsName,{}, {signal:new AbortController().signal})).behavior,'allow');
 const tool=options.mcpServers.hypeproof_email.tools.find(t=>t.name==='apps_script_upload');
 assert.equal(JSON.parse((await tool.handler({})).content[0].text).cancelled,true);assert.equal(calls,1);
 host.isAppsScriptAllowed=()=>false;assert.equal((await tool.handler({})).isError,true);assert.equal(calls,1);
 const denied=await turn({host,profile});assert.equal(denied.mcpServers.hypeproof_email.tools.some(t=>t.name==='apps_script_upload'),false);
 assert.equal((await denied.canUseTool(appsName,{}, {signal:new AbortController().signal})).behavior,'deny');
});

test('Apps Script sessions cannot bypass Google execution and review through legacy preview/send tools',async()=>{
 let scriptAllowed=true,legacyCalls=0;
 const scriptModes=[];
 const host={isAllowed:()=>true,isAppsScriptAllowed:()=>scriptAllowed,runtime:{getPreview:()=>{legacyCalls++;throw new Error('Legacy send bypass');}},confirmSend:async()=>{legacyCalls++;return true;},previewSavedSkill:async()=>{legacyCalls++;throw new Error('Legacy preview bypass');},appsScriptRun:async mode=>{scriptModes.push(mode);return mode==='preview'?{reviewed:true,nextAction:'wait_for_user'}:{cancelled:true};}};
 const options=await turn({host,profile:{automations:{...capability,appsScript:true},game:{template_tier:'website'}}});
 const tools=options.mcpServers.hypeproof_email.tools;
 for(const [name,input,mode] of [['email_preview',{recipe:'{}'},'preview'],['email_send',{previewId:'legacy-id'},'send']]){
  const guidance=JSON.parse((await tools.find(t=>t.name===name).handler(input)).content[0].text);
  assert.equal(guidance.recoveryRequired,true);assert.equal(guidance.previewCreated,false);assert.equal(guidance.sent,false);
  assert.equal(guidance.nextTool,'apps_script_run');assert.deepEqual(guidance.arguments,{mode});
  const result=await tools.find(t=>t.name===guidance.nextTool).handler(guidance.arguments);
  assert.deepEqual(JSON.parse(result.content[0].text),mode==='preview'?{reviewed:true,nextAction:'wait_for_user'}:{cancelled:true});
 }
 assert.deepEqual(scriptModes,['preview','send']);assert.equal(legacyCalls,0);
 scriptAllowed=false;
 for(const name of ['email_preview','email_send']){
  const guidance=JSON.parse((await tools.find(t=>t.name===name).handler({})).content[0].text);
  assert.equal(guidance.recoveryRequired,true);
  assert.equal((await tools.find(t=>t.name===guidance.nextTool).handler(guidance.arguments)).isError,true);
 }
 assert.equal(legacyCalls,0);assert.deepEqual(scriptModes,['preview','send']);
});
