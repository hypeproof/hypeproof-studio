import test from 'node:test';
import assert from 'node:assert/strict';
import { localEmailTools, localTurnBudget } from '../src/localRuntime/emailTools.ts';
import { startToolServer } from '../src/localRuntime/toolServer.mjs';
const profile={automations:{enabled:true,provider:'gmail',maxRecipients:20},game:{template_tier:'website'}};

test('local subscription MCP uses the same profile gates, private metadata and human send approval',async()=>{
  const controller=new AbortController();let approved=false,sends=0,questions=0;
  const host={isAllowed:()=>true,askUser:async()=>{questions++;return{answer:'자료 요청'};},readConfiguredSheet:async()=>({rowCount:1,columns:['이메일','이름','서류','기한']}),confirmSend:async()=>approved,runtime:{getPreview:()=>({id:'snapshot',messages:[{id:'row',to:'synthetic@example.invalid',subject:'제목',body:'비공개 본문'}]}),send:async()=>{sends++;return{records:[{id:'row',status:'sent',providerId:'private-provider-id'}]};}}};
  for(const rejected of [{},{...profile,automations:{enabled:false,provider:'gmail'}},{...profile,game:{template_tier:'kids-rich'}}])assert.equal(localEmailTools({profile:rejected,host,signal:controller.signal}).definitions.length,0);
  const tools=localEmailTools({profile,host,signal:controller.signal});assert.equal(tools.definitions.length,10);
  const server=await startToolServer(tools.definitions,tools.call,controller.signal);
  const invoke=async(name,args)=>{const response=await fetch(server.url,{method:'POST',headers:{authorization:'Bearer '+server.token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return(await response.json()).result;};
  try{
    assert.equal((await invoke('email_ask_user',{question:'무엇을 반복하나요?',choices:'[]',allowFreeText:'true'})).isError,undefined);assert.equal(questions,1);
    const sheet=await invoke('email_sheet_read',{});assert.equal(JSON.stringify(sheet).includes('synthetic@example.invalid'),false);
    assert.equal((await invoke('email_sheet_read',{spreadsheetId:'invented'})).isError,true);
    await invoke('email_email_send',{previewId:'snapshot'});assert.equal(sends,0);
    approved=true;const receipt=await invoke('email_email_send',{previewId:'snapshot'});assert.equal(sends,1);assert.equal(JSON.stringify(receipt).includes('private-provider-id'),false);
    controller.abort();await assert.rejects(tools.call('email_email_send',{previewId:'snapshot'}));assert.equal(sends,1);
  }finally{server.close();}
});

test('local model deadline pauses for a human answer and still stops unattended execution',async()=>{
  let waiting=true;const budget=localTurnBudget(()=>waiting,25);
  try{await new Promise(resolve=>setTimeout(resolve,65));assert.equal(budget.signal.aborted,false);waiting=false;await new Promise(resolve=>setTimeout(resolve,50));assert.equal(budget.signal.aborted,true);}finally{budget.dispose();}
});

test('Claude CLI disables builtin tools and allows only managed Studio MCP tools', {skip:process.platform==='win32'}, async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {runClaude}=await import('../src/localRuntime/claudeClient.mjs');
  const root=await mkdtemp(join(tmpdir(),'hps-claude-flags-'));
  const executable=join(root,'synthetic-claude');
  await writeFile(executable,'#!'+process.execPath+'\n'+String.raw`
const args=process.argv.slice(2);
if(args[0]==='auth') console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));
else {
  const config=JSON.parse(args[args.indexOf('--mcp-config')+1]);
  if(config.mcpServers.studio.timeout<=60000||process.env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS!=='0')process.exit(3);
  if(args[args.indexOf('--tools')+1]!==''||args[args.indexOf('--allowedTools')+1]!=='mcp__studio__*'||!args.includes('--strict-mcp-config'))process.exit(2);
  process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',subtype:'success',result:'synthetic'})));
}
`,{mode:0o700});
  try{let text='';await runClaude({executable,cwd:root,messages:[],signal:AbortSignal.timeout(2000),onDelta:value=>text+=value,toolServer:{url:'http://127.0.0.1:1/mcp',token:'synthetic'}});assert.equal(text,'synthetic');}finally{await rm(root,{recursive:true,force:true});}
});

test('Google browser consent stays outside the active model budget after its question card closes', async()=>{
  const {createGoogleAutomationRuntime}=await import('../src/googleAutomation.ts');
  let finishOAuth,opened,consentUrl;
  const browserOpened=new Promise(resolve=>{opened=resolve;});
  const callback=new Promise(resolve=>{finishOAuth=resolve;});
  const secrets=new Map();
  const runtime=createGoogleAutomationRuntime({
    clientId:'synthetic-desktop-client',isAllowed:()=>true,
    secrets:{get:async key=>secrets.get(key),store:async(key,value)=>secrets.set(key,value),delete:async key=>secrets.delete(key)},
    ledger:{load:async()=>({}),save:async()=>{}},
    listenOAuth:async()=>({redirectUri:'http://127.0.0.1:23456/oauth/callback',wait:callback,close(){}}),
    openBrowser:async url=>{consentUrl=new URL(url);opened();},
    fetchImpl:async url=>new Response(JSON.stringify(String(url).includes('/token')?{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600}:{sub:'synthetic-sender'})),
  });
  let questionOpen=true,tools;
  const budget=localTurnBudget(()=>tools?.isWaiting()??false,25);
  const host={isAllowed:()=>true,isAwaitingUser:()=>questionOpen,runtime,confirmSend:async()=>false,
    connectGoogle:async()=>{questionOpen=false;await runtime.connect();return{connected:true};}};
  tools=localEmailTools({profile,host,signal:budget.signal});
  try{
    const connecting=tools.call('email_google_connect',{mode:'reuse'});
    await browserOpened;assert.equal(questionOpen,false);assert.equal(tools.isWaiting(),true);
    await new Promise(resolve=>setTimeout(resolve,75));assert.equal(budget.signal.aborted,false,'closing the host question must not charge browser consent time');
    const response=new URL('http://127.0.0.1:23456/oauth/callback');response.searchParams.set('state',consentUrl.searchParams.get('state'));response.searchParams.set('code','synthetic-code');finishOAuth(response);
    assert.deepEqual(JSON.parse(await connecting),{connected:true});assert.equal(tools.isWaiting(),false);assert.equal(secrets.size,1);
    await new Promise(resolve=>setTimeout(resolve,50));assert.equal(budget.signal.aborted,true,'active execution deadline resumes after consent completes');
  }finally{budget.dispose();}
});
