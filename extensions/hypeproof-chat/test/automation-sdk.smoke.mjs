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
 const host={isAllowed:()=>allowed,refreshAuthorization:async()=>{refreshed++;allowed=true;return true;},confirmSend:async()=>false,runtime:{readSheet:async()=>{reads++;return [['Name'],['Synthetic']];}}};
 const opts=await turn({host});allowed=false;
 const read=opts.mcpServers.hypeproof_email.tools.find(t=>t.name==='sheet_read');
 const result=await read.handler({spreadsheetId:'synthetic',range:'A1:A2'});
 assert.equal(result.isError,undefined);assert.equal(reads,1);assert.equal(refreshed,1);
 host.refreshAuthorization=async()=>false;await read.handler({spreadsheetId:'synthetic',range:'A1:A2'});assert.equal(reads,1);
});


test('browser registration cannot grant email tools when the email host is missing',async()=>{
 const opts=await turn({profile:{game:{template_tier:'website'},sdk_tools:{browser:true},automations:capability},browserHost:{openBrowser:async()=>{},screenshot:async()=>null,startLivePreview:async()=>null}});
 assert.deepEqual(Object.keys(opts.mcpServers),['hypeproof']);
 assert.equal((await opts.canUseTool(names[2],{}, {signal:new AbortController().signal})).behavior,'deny');
 assert.equal((await opts.canUseTool('mcp__hypeproof__browser_read',{}, {signal:new AbortController().signal})).behavior,'allow');
});
