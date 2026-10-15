import test from 'node:test';
import assert from 'node:assert/strict';
import { localEmailTools, localTurnBudget } from '../src/localRuntime/emailTools.ts';
import { startToolServer } from '../src/localRuntime/toolServer.mjs';
import { createAppsScriptRuntime, APPS_SCRIPT_TOKEN_KEY } from '../src/appsScriptRuntime.ts';
import { buildGoogleAutomationMcpServer } from '../src/googleAutomationMcp.ts';
import { AutomationPublicationWithdrawnError } from '../src/automationErrors.ts';
const profile={automations:{enabled:true,provider:'gmail',maxRecipients:20},game:{template_tier:'website'}};

test('SDK and local publication report withdrawn intent without leaking errors or retrying',async()=>{
 for(const transport of ['sdk','local']) for(const typed of [true,false]){
  let attempts=0;
  const host={isAllowed:()=>true,runtime:{},confirmSend:async()=>false,publishSkill:async()=>{
   attempts++;
   if(typed)throw new AutomationPublicationWithdrawnError();
   throw Object.assign(new Error('private-provider-body'),{name:'AutomationPublicationWithdrawnError',reason:'publication_unpublished'});
  }};
  let text;
  if(transport==='sdk'){
   const server=buildGoogleAutomationMcpServer({tool:(name,description,schema,handler)=>({name,handler}),createSdkMcpServer:s=>s},{string:()=>({})},host);
   const result=await server.tools.find(t=>t.name==='skill_publish').handler({});
   assert.equal(result.isError,true);text=result.content[0].text;
  }else{
   const tools=localEmailTools({profile,host,signal:new AbortController().signal});
   await assert.rejects(tools.call('email_skill_publish',{}),error=>{text=error.message;return true;});
   assert.equal(tools.isWaiting(),false);
  }
  assert.equal(attempts,1);assert.ok(!text.includes('private-provider-body'));
  if(typed){
   const data=JSON.parse(text);
   assert.equal(data.failureStage,'skill_publish');assert.equal(data.reason,'publication_unpublished');
   assert.equal(data.published,false);assert.equal(data.nextAction,'request_fresh_publication_approval');
   assert.match(data.guidance,/자동 재시도하지/);
  }else assert.ok(!text.includes('request_fresh_publication_approval'));
 }
});

test('SDK and local tools distinguish unfinished Google login from setup failure without leaking errors or retrying',async()=>{
 for(const transport of ['sdk','local']) for(const scenario of ['callback','operator','unknown','cancelled']){
  let opened=0,closed=0,network=0,attempts=0,rejectCallback;
  const wait=new Promise((_,reject)=>{rejectCallback=reject;});void wait.catch(()=>{});
  const secrets=new Map([[APPS_SCRIPT_TOKEN_KEY,'synthetic-existing-credential'],['send-ledger','synthetic-unknown-send']]);
  const before=[...secrets];
  const runtime=createAppsScriptRuntime({clientId:scenario==='operator'?'':'synthetic-client',isAllowed:()=>true,
   secrets:{get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)},
   listenOAuth:async()=>({redirectUri:'http://127.0.0.1:23456/oauth/callback',wait,close(){closed++;}}),
   openBrowser:async()=>{opened++;rejectCallback(new Error('private-callback-url-and-token'));},
   fetchImpl:async()=>{network++;throw Error('unexpected Google request');},
  });
  const host={runtime:{},isAllowed:()=>true,confirmSend:async()=>false,connectGoogle:async()=>{
   attempts++;if(scenario==='cancelled')return{cancelled:true};
   if(scenario==='unknown')throw Error('private-provider-body-and-account');
   await runtime.connect();return{connected:true};
  }};
  let result;
  if(transport==='sdk'){
   const server=buildGoogleAutomationMcpServer({tool:(name,description,schema,handler)=>({name,handler}),createSdkMcpServer:s=>s},{string:()=>({})},host);
   result=await server.tools.find(t=>t.name==='google_connect').handler({mode:'change'});
  }else{
   const tools=localEmailTools({profile,host,signal:new AbortController().signal});
   const server=await startToolServer(tools.definitions,tools.call,new AbortController().signal);
   try{
    const response=await fetch(server.url,{method:'POST',headers:{authorization:'Bearer '+server.token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'email_google_connect',arguments:{mode:'change'}}})});
    result=(await response.json()).result;
   }finally{server.close();}
   assert.equal(tools.isWaiting(),false);
  }
  const text=result.content.map(c=>c.text??'').join('\n');assert.ok(!text.includes('private-'));
  const data=JSON.parse(text);
  if(scenario==='cancelled'){assert.deepEqual(data,{cancelled:true});assert.notEqual(result.isError,true);}
  else{
   assert.equal(result.isError,true);assert.equal(data.failureStage,'google_connect');assert.equal(data.connectionConfirmed,false);assert.equal(data.nextAction,'wait_for_user');
   assert.equal(data.reason,scenario==='callback'?'oauth_callback_incomplete':'google_connection_unconfirmed');
   assert.equal(data.recovery,scenario==='callback'?'reconnect':scenario==='operator'?'operator':'check_connection');
  }
  assert.equal(attempts,1);assert.equal(network,0);assert.deepEqual([...secrets],before);
  assert.equal(opened,scenario==='callback'?1:0);assert.equal(closed,opened);
 }
});

test('local subscription MCP uses the same profile gates, private metadata and human send approval',async()=>{
  const controller=new AbortController();let approved=false,sends=0,questions=0,withdrawals=0;
  const host={isAllowed:()=>true,unpublishSkill:async id=>{assert.equal(id,'owned-publication');withdrawals++;return{cancelled:true};},askUser:async()=>{questions++;return{answer:'자료 요청'};},readConfiguredSheet:async()=>({rowCount:1,columns:['이메일','이름','서류','기한']}),confirmSend:async()=>approved,runtime:{getPreview:()=>({id:'snapshot',messages:[{id:'row',to:'synthetic@example.invalid',subject:'제목',body:'비공개 본문'}]}),send:async()=>{sends++;return{records:[{id:'row',status:'sent',providerId:'private-provider-id'}]};}}};
  for(const rejected of [{},{...profile,automations:{enabled:false,provider:'gmail'}},{...profile,game:{template_tier:'kids-rich'}}])assert.equal(localEmailTools({profile:rejected,host,signal:controller.signal}).definitions.length,0);
  const tools=localEmailTools({profile,host,signal:controller.signal});assert.equal(tools.definitions.length,12);assert.ok(tools.definitions.some(tool=>tool.name==='email_workflow_plan'));
  const server=await startToolServer(tools.definitions,tools.call,controller.signal);
  const invoke=async(name,args)=>{const response=await fetch(server.url,{method:'POST',headers:{authorization:'Bearer '+server.token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return(await response.json()).result;};
  try{
    assert.equal((await invoke('email_ask_user',{question:'무엇을 반복하나요?',choices:'[]',allowFreeText:'true'})).isError,undefined);assert.equal(questions,1);
    const sheet=await invoke('email_sheet_read',{});assert.equal(JSON.stringify(sheet).includes('synthetic@example.invalid'),false);
    assert.equal((await invoke('email_sheet_read',{spreadsheetId:'invented'})).isError,true);
    await invoke('email_email_send',{previewId:'snapshot'});assert.equal(sends,0);
    approved=true;const receipt=await invoke('email_email_send',{previewId:'snapshot'});assert.equal(sends,1);assert.equal(JSON.stringify(receipt).includes('private-provider-id'),false);
    assert.equal((await invoke('email_skill_unpublish',{id:''})).isError,true);assert.equal(withdrawals,0);
    const withdrawal=await invoke('email_skill_unpublish',{id:'owned-publication'});assert.equal(withdrawal.isError,undefined);assert.equal(withdrawals,1);assert.match(JSON.stringify(withdrawal),/cancelled/);
    controller.abort();await assert.rejects(tools.call('email_skill_unpublish',{id:'owned-publication'}));assert.equal(withdrawals,1);await assert.rejects(tools.call('email_email_send',{previewId:'snapshot'}));assert.equal(sends,1);
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


test('local Apps Script tools require both grants and keep OAuth wait outside the model timer',async()=>{
 const controller=new AbortController();let release;
 const host={isAllowed:()=>true,isAppsScriptAllowed:()=>true,runtime:{},confirmSend:async()=>false,appsScriptUpload:async()=>new Promise(resolve=>{release=resolve;})};
 assert.equal(localEmailTools({profile,host,signal:controller.signal}).definitions.some(t=>t.name==='email_apps_script_upload'),false);
 const enabled={...profile,automations:{...profile.automations,appsScript:true}};
 const tools=localEmailTools({profile:enabled,host,signal:controller.signal});
 const pending=tools.call('email_apps_script_upload',{});
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(tools.isWaiting(),true);
 release({cancelled:true});assert.equal(JSON.parse(await pending).cancelled,true);assert.equal(tools.isWaiting(),false);
 host.isAppsScriptAllowed=()=>false;await assert.rejects(()=>tools.call('email_apps_script_upload',{}));
});

test('withdrawal confirmation pauses the local model budget until the private answer settles',async()=>{
  const abort=new AbortController();let answer;
  const host={isAllowed:()=>true,runtime:{},confirmSend:async()=>false,unpublishSkill:()=>new Promise(resolve=>{answer=resolve;})};
  const tools=localEmailTools({profile,host,signal:abort.signal});
  const pending=tools.call('email_skill_unpublish',{id:'owned'});
  for(let i=0;i<20&&!answer;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(typeof answer,'function');assert.equal(tools.isWaiting(),true);
  answer({cancelled:true});await pending;assert.equal(tools.isWaiting(),false);
});

test('local and SDK version selectors remain optional and reject malformed identities before host dispatch',async()=>{
 const calls=[];const host={isAllowed:()=>true,runtime:{},confirmSend:async()=>false,
  publishSkill:async parentId=>{calls.push(['publish',parentId]);return{published:true};},
  listSkills:async id=>{calls.push(['list',id]);return{items:[]};}};
 const local=localEmailTools({profile,host,signal:new AbortController().signal});
 for(const name of ['email_skill_publish','email_skill_list']){
  const schema=local.definitions.find(t=>t.name===name).inputSchema;
  assert.deepEqual(schema.required,[]);assert.ok(Object.values(schema.properties).every(s=>s.type==='string'&&!('optional'in s)));
 }
 assert.deepEqual(local.definitions.find(t=>t.name==='email_skill_install').inputSchema.required,['id']);
 await local.call('email_skill_publish',{});await local.call('email_skill_publish',{parentId:'release-one'});
 await local.call('email_skill_list',{});await local.call('email_skill_list',{id:'release-one'});
 assert.deepEqual(calls,[['publish',undefined],['publish','release-one'],['list',undefined],['list','release-one']]);
 const server=buildGoogleAutomationMcpServer({tool:(name,description,schema,handler)=>({name,schema,handler}),createSdkMcpServer:s=>s},{string:()=>({optional:()=>({optional:true})})},host);
 for(const [name,key]of [['skill_publish','parentId'],['skill_list','id']]){
  const tool=server.tools.find(t=>t.name===name);assert.equal(tool.schema[key].optional,true);
  for(const bad of ['',42,'x'.repeat(201)])assert.equal((await tool.handler({[key]:bad})).isError,true);
 }
 assert.equal(calls.length,4,'malformed selectors never reach a host action');
});
