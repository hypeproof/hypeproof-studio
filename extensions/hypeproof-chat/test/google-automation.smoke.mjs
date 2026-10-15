import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGoogleAutomationRuntime, gmailMime } from '../src/googleAutomation.ts';
import { buildGoogleAutomationMcpServer } from '../src/googleAutomationMcp.ts';

const recipe = { schema:'hps-email-automation/1', title:'자료 요청', description:'선택한 시트로 자료를 요청합니다.', category:'email', subjectTemplate:'{{name}}님 {{document}} 요청', bodyTemplate:'{{name}}님, {{dueDate}}까지 {{document}}를 보내 주세요.', columns:{email:'email',name:'name',document:'document',dueDate:'dueDate'} };
const rows = [['email','name','document','dueDate'],['learner@example.invalid','테스트','보고서','내일']];
function fixture(overrides={}) {
  const secrets = new Map([['hps.google.email-automation.v1', JSON.stringify({accessToken:'synthetic-token',accountId:'synthetic-account',expiresAt:Date.now()+3600000})]]);
  let ledger = {}; const events = []; let sends = 0;
  const deps = { clientId:'synthetic-client', secrets:{get:async k=>secrets.get(k),store:async(k,v)=>{secrets.set(k,v);},delete:async k=>{secrets.delete(k);}}, isAllowed:()=>true, openBrowser:async()=>{}, ledger:{load:async()=>structuredClone(ledger),save:async value=>{ledger=structuredClone(value); events.push(Object.values(ledger).map(x=>x.status).join(','));}}, fetchImpl:async (url, init)=>{if(url.includes('/messages/send')){sends++; events.push('HTTP'); return new Response(JSON.stringify({id:'synthetic-message'}));} return new Response(JSON.stringify({values:rows}));}, ...overrides };
  return {runtime:createGoogleAutomationRuntime(deps),deps,secrets,events,get sends(){return sends;},get ledger(){return ledger;}};
}

test('read, render exact snapshot, require approval, persist before send and deduplicate across preview/restart', async()=>{
  const f=fixture(); const values=await f.runtime.readSheet({spreadsheetId:'synthetic_sheet_id',range:'Sheet1!A1:D101'});
  const preview=await f.runtime.preview({recipe,rows:values});
  assert.equal(preview.messages[0].subject,'테스트님 보고서 요청');
  assert.equal(preview.messages[0].body,'테스트님, 내일까지 보고서를 보내 주세요.');
  assert.throws(()=>{preview.messages[0].to='changed@example.invalid';},TypeError);
  await assert.rejects(f.runtime.send({previewId:preview.id,approved:false}),/승인/);
  const result=await f.runtime.send({previewId:preview.id,approved:true});
  assert.equal(result.records[0].status,'sent'); assert.deepEqual(f.events,['sending','HTTP','sent']);
  const again=createGoogleAutomationRuntime(f.deps); const p2=await again.preview({recipe,rows});
  await again.send({previewId:p2.id,approved:true}); assert.equal(f.sends,1);
  const mime=Buffer.from(gmailMime(preview.messages[0]),'base64url').toString();
  assert.match(mime,/To: learner@example.invalid\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(mime,/Content-Type: text\/plain/);
});

test('wrong OAuth state never exchanges or stores a credential; PKCE binds successful exchange',async()=>{
  for (const valid of [false,true]) {
    let resolve; const wait=new Promise(r=>{resolve=r;}); let exchanged=0; let verifier; let challenge;
    const f=fixture({listenOAuth:async()=>({redirectUri:'http://127.0.0.1:43210/oauth/callback',wait,close(){}}),openBrowser:async raw=>{const url=new URL(raw); challenge=url.searchParams.get('code_challenge'); assert.equal(url.searchParams.get('code_challenge_method'),'S256'); resolve(new URL(`http://127.0.0.1:43210/oauth/callback?code=synthetic-code&state=${valid?url.searchParams.get('state'):'wrong'}`));},fetchImpl:async(url,init)=>{if(url.includes('/userinfo')) return new Response(JSON.stringify({sub:'synthetic-account'}));exchanged++;verifier=init.body.get('code_verifier');return new Response(JSON.stringify({access_token:'new-token',expires_in:3600,refresh_token:'new-refresh'}));}});
    f.secrets.clear();
    if(valid){await f.runtime.connect();assert.equal(exchanged,1);assert.ok(verifier.length>=43);assert.ok(challenge);assert.equal((await f.runtime.status()).connected,true);}else{await assert.rejects(f.runtime.connect(),/ログ|로그인/);assert.equal(exchanged,0);assert.equal(f.secrets.size,0);}
  }
});

test('reject malformed cells, duplicated headers/recipients and header injection before any send',async()=>{
  const f=fixture();
  for(const bad of [ [rows[0],['a@example.invalid',{bad:true},'doc','day']], [rows[0],['a@example.invalid','Name\r\nBcc: other@example.invalid','doc','day']], [rows[0],['a@example.invalid\r\nBcc: other@example.invalid','Name','doc','day']], [rows[0],rows[1],rows[1]], [['email','name','document','document'],rows[1]] ]) await assert.rejects(f.runtime.preview({recipe,rows:bad}));
  await assert.rejects(f.runtime.preview({recipe:{...recipe,subjectTemplate:'{{unsupported}}'},rows}));
  await assert.rejects(f.runtime.preview({recipe:{...recipe,extra:'unexpected'},rows}));
  assert.equal(f.sends,0);
});

test('uncertain network outcome is durable and never retried, including recovered sending state',async()=>{
  let sends=0; const f=fixture({fetchImpl:async()=>{sends++;throw new Error('synthetic network interruption');}});
  const p=await f.runtime.preview({recipe,rows});
  assert.equal((await f.runtime.send({previewId:p.id,approved:true})).records[0].status,'unknown');
  await f.runtime.send({previewId:p.id,approved:true});assert.equal(sends,1);
  const ledgerKey=createHash('sha256').update(`synthetic-account:${p.messages[0].id}`).digest('hex');
  const pending={ [ledgerKey]:{id:p.messages[0].id,status:'sending'} };
  const recovered=fixture({ledger:{load:async()=>pending,save:async()=>{throw new Error('should not save');}},fetchImpl:async()=>{throw new Error('must not call');}});
  const p2=await recovered.runtime.preview({recipe,rows});
  assert.equal((await recovered.runtime.send({previewId:p2.id,approved:true})).records[0].status,'unknown');
});

test('double-click is locked and failed durability prevents sending',async()=>{
  let unblock; const pending=new Promise(r=>{unblock=r;});
  const f=fixture({fetchImpl:async()=>{await pending;return new Response(JSON.stringify({id:'synthetic'}));}});
  const p=await f.runtime.preview({recipe,rows});const first=f.runtime.send({previewId:p.id,approved:true});
  await assert.rejects(f.runtime.send({previewId:p.id,approved:true}),/발송 중/);unblock();await first;
  let sends=0;const broken=fixture({ledger:{load:async()=>({}),save:async()=>{throw new Error('disk full');}},fetchImpl:async()=>{sends++;return new Response('{}');}});
  const p2=await broken.runtime.preview({recipe,rows});await assert.rejects(broken.runtime.send({previewId:p2.id,approved:true}),/disk full/);assert.equal(sends,0);
});

test('MCP cannot grant itself capability or manufacture human approval',async()=>{
  const f=fixture();let permitted=false;let confirmed=0;
  const factory={tool:(name,_description,_schema,handler)=>({name,handler}),createSdkMcpServer:x=>x};const z={string:()=>({})};
  const host={runtime:f.runtime,isAllowed:()=>permitted,confirmSend:async p=>{confirmed++;assert.equal(p.messages[0].to,'learner@example.invalid');return false;}};
  assert.equal(buildGoogleAutomationMcpServer(factory,z,host),undefined);permitted=true;
  const server=buildGoogleAutomationMcpServer(factory,z,host);const send=server.tools.find(x=>x.name==='email_send');
  const p=await f.runtime.preview({recipe,rows});await send.handler({previewId:p.id,approved:true});assert.equal(confirmed,1);assert.equal(f.sends,0);
  permitted=false;assert.equal((await send.handler({previewId:p.id})).isError,true);assert.equal(confirmed,1);
});

test('a rejected private Sheet read reports its real stage without exposing provider data',async()=>{
  for (const [status,reason] of [[403,'sheet_access_denied'],[404,'sheet_not_found'],[503,'sheet_read_unavailable']]) {
    let rejectRead=false;
    const f=fixture({fetchImpl:async()=>rejectRead ? new Response('private-sheet-id private@example.invalid synthetic-token',{status}) : new Response(JSON.stringify({values:rows}))});
    await f.runtime.readSheet({spreadsheetId:'own_synthetic_sheet',range:'A1:D21'});
    rejectRead=true;
    const factory={tool:(name,_description,_schema,handler)=>({name,handler}),createSdkMcpServer:x=>x};
    const server=buildGoogleAutomationMcpServer(factory,{string:()=>({})},{runtime:f.runtime,isAllowed:()=>true,confirmSend:async()=>false,
      configureSheet:async()=>f.runtime.readSheet({spreadsheetId:'private_sheet_id',range:'A1:D21'})});
    const result=await server.tools.find(x=>x.name==='sheet_configure').handler({mode:'change'});
    assert.equal(result.isError,true);
    const safe=JSON.parse(result.content[0].text);
    assert.equal(safe.failureStage,'sheet_read');assert.equal(safe.reason,reason);assert.equal(safe.nextAction,'wait_for_user');
    assert.doesNotMatch(JSON.stringify(result),/private.sheet.id|private@example|synthetic-token/);
    await assert.rejects(f.runtime.previewLatestSheet({recipe}),/시트를 다시 읽어/);assert.equal(f.sends,0);
  }
});

test('provider limits and capability revocation fail closed; sender accounts have separate durable receipts',async()=>{
  let allowed=true;
  const f=fixture({maxRecipients:1,isAllowed:()=>allowed});
  await assert.rejects(f.runtime.preview({recipe,rows:[...rows,['second@example.invalid','다른 이름','자료','오늘']]}),/최대 1명/);
  let p=await f.runtime.preview({recipe,rows});
  allowed=false;await assert.rejects(f.runtime.send({previewId:p.id,approved:true}),/사용할 수 없어요/);assert.equal(f.sends,0);
  allowed=true;await f.runtime.send({previewId:p.id,approved:true});
  const current=JSON.parse(f.secrets.get('hps.google.email-automation.v1'));current.accountId='another-synthetic-sender';f.secrets.set('hps.google.email-automation.v1',JSON.stringify(current));
  p=await f.runtime.preview({recipe,rows});await f.runtime.send({previewId:p.id,approved:true});assert.equal(f.sends,2);
});

test('skill-save failures preserve the saved recipe and guide repair without Google setup or private error details',async()=>{
  const f=fixture();let saved;let writes=0;let googleCalls=0;let allowed=true;let storageFails=false;
  const factory={tool:(name,description,schema,handler)=>({name,description,schema,handler}),createSdkMcpServer:x=>x};
  const server=buildGoogleAutomationMcpServer(factory,{string:()=>({})},{runtime:f.runtime,isAllowed:()=>allowed,
    saveSkill:async value=>{if(storageFails)throw Error('private@example.invalid synthetic-secret');writes++;saved=value;return{saved:true};},
    connectGoogle:async()=>{googleCalls++;return{};},confirmSend:async()=>false});
  const save=server.tools.find(t=>t.name==='skill_save');
  assert.match(save.description,/"category":"email"/,'SDK authoring gets the required contract even without a local-CLI prompt');
  const valid=await save.handler({recipe:JSON.stringify(recipe)});assert.equal(JSON.parse(valid.content[0].text).saved,true);
  const missingCategory={...recipe};delete missingCategory.category;
  for(const input of ['{"private@example.invalid":',JSON.stringify(missingCategory),JSON.stringify({...recipe,columns:{...recipe.columns,due_date:'기한'}})]) {
    const result=await save.handler({recipe:input});assert.equal(result.isError,true);
    const failure=JSON.parse(result.content[0].text);assert.equal(failure.failureStage,'skill_save');assert.equal(failure.saved,false);assert.equal(failure.nextAction,'check_recipe_and_activity');
    assert.doesNotMatch(JSON.stringify(result),/private@example.invalid|synthetic-secret/);
    assert.deepEqual(saved,recipe);assert.equal(writes,1);
  }
  storageFails=true;let result=await save.handler({recipe:JSON.stringify(recipe)});assert.equal(result.isError,true);assert.doesNotMatch(JSON.stringify(result),/private@example.invalid|synthetic-secret/);storageFails=false;
  allowed=false;result=await save.handler({recipe:JSON.stringify(recipe)});assert.equal(result.isError,true);assert.equal(writes,1);
  allowed=true;const corrected={...recipe,title:'수정한 자료 요청'};result=await save.handler({recipe:JSON.stringify(corrected)});
  assert.equal(JSON.parse(result.content[0].text).saved,true);assert.deepEqual(saved,corrected);assert.equal(writes,2);assert.equal(googleCalls,0);assert.equal(f.sends,0);
});

test('actual loopback callback binds localhost, returns a URL, and closes',async()=>{
  const { listenGoogleOAuth }=await import('../src/googleAutomation.ts');
  const listener=await listenGoogleOAuth();
  try { assert.equal(new URL(listener.redirectUri).hostname,'127.0.0.1');const response=await fetch(`${listener.redirectUri}?code=synthetic&state=synthetic`);assert.equal(response.status,200);assert.equal((await listener.wait).searchParams.get('code'),'synthetic'); } finally { listener.close(); }
});

test('MCP keeps contacts and composed email local, requires exact native approval, and returns aggregate receipts',async()=>{
  const f=fixture();let approved=false;let confirmations=0;
  const factory={tool:(name,_description,schema,handler)=>({name,schema,handler}),createSdkMcpServer:x=>x};
  const server=buildGoogleAutomationMcpServer(factory,{string:()=>({})},{runtime:f.runtime,isAllowed:()=>true,readConfiguredSheet:async()=>{const data=await f.runtime.readSheet({spreadsheetId:'synthetic_sheet_id',range:'Sheet1!A1:D21'});return{rowCount:data.length-1,columns:data[0]};},confirmSend:async preview=>{confirmations++;assert.equal(preview.messages[0].to,rows[1][0]);assert.equal(preview.messages[0].subject,'테스트님 보고서 요청');assert.equal(preview.messages[0].body,'테스트님, 내일까지 보고서를 보내 주세요.');return approved;}});
  const tools=Object.fromEntries(server.tools.map(tool=>[tool.name,tool]));
  const results=[];
  results.push(await tools.sheet_read.handler({}));
  assert.deepEqual(JSON.parse(results[0].content[0].text),{rowCount:1,columns:rows[0]});
  assert.deepEqual(Object.keys(tools.email_preview.schema),['recipe']);
  results.push(await tools.email_preview.handler({recipe:JSON.stringify(recipe)}));
  const summary=JSON.parse(results[1].content[0].text);
  assert.deepEqual(Object.keys(summary).sort(),['confirmationRequired','count','previewId']);
  assert.equal(summary.count,1);assert.equal(summary.confirmationRequired,true);
  results.push(await tools.email_send.handler({previewId:summary.previewId,approved:true}));
  assert.equal(f.sends,0);assert.equal(confirmations,1);
  approved=true;results.push(await tools.email_send.handler({previewId:summary.previewId}));
  assert.equal(f.sends,1);assert.equal(confirmations,2);
  assert.deepEqual(JSON.parse(results.at(-1).content[0].text),{counts:{sent:1,sending:0,unknown:0,failed:0},unattempted:0});
  const modelVisible=JSON.stringify(results);
  for(const sensitive of [...rows[1],'synthetic-message','subject','body','providerId']) assert.equal(modelVisible.includes(sensitive),false,`Unexpected private field: ${sensitive}`);
  assert.equal((await tools.email_preview.handler({recipe:JSON.stringify(recipe),rows:JSON.stringify(rows)})).isError,true);
});

test('cached sheet cannot cross Google account changes or survive disconnect',async()=>{
  const f=fixture();await f.runtime.readSheet({spreadsheetId:'synthetic_sheet_id',range:'Sheet1!A1:D21'});
  assert.equal((await f.runtime.previewLatestSheet({recipe})).messages[0].to,rows[1][0]);
  const value=JSON.parse(f.secrets.get('hps.google.email-automation.v1'));value.accountId='different-account';f.secrets.set('hps.google.email-automation.v1',JSON.stringify(value));
  await assert.rejects(f.runtime.previewLatestSheet({recipe}),/다시 읽어/);
  await f.runtime.readSheet({spreadsheetId:'synthetic_sheet_id',range:'Sheet1!A1:D21'});await f.runtime.disconnect();
  await assert.rejects(f.runtime.previewLatestSheet({recipe}),/다시 읽어/);
});

test('cross-window sender change invalidates approved previews and rows; same-account reconnect also invalidates approval',async()=>{
  for(const field of ['accountId','connectionId']) {
    const f=fixture();
    const data=await f.runtime.readSheet({spreadsheetId:'synthetic_sheet_id',range:'Sheet1!A1:D21'});
    const preview=await f.runtime.preview({recipe,rows:data});
    const value=JSON.parse(f.secrets.get('hps.google.email-automation.v1'));value[field]='other-window-connection';f.secrets.set('hps.google.email-automation.v1',JSON.stringify(value));
    await assert.rejects(f.runtime.send({previewId:preview.id,approved:true}),/계정이 변경/);
    await assert.rejects(f.runtime.preview({recipe,rows:data}),/연결이 변경/);
    assert.equal(f.sends,0);assert.deepEqual(f.ledger,{});
  }
});

test('token retrieval racing another window cannot send with one sender and record under another',async()=>{
  const f=fixture();const preview=await f.runtime.preview({recipe,rows});
  const originalGet=f.deps.secrets.get;let reads=0;
  f.deps.secrets.get=async key=>{
    const value=await originalGet(key);
    if(++reads===2){const other=JSON.parse(value);other.accessToken='other-window-access-token';other.accountId='other-window-sender';other.connectionId='other-window-connection';f.secrets.set(key,JSON.stringify(other));}
    return value;
  };
  await assert.rejects(f.runtime.send({previewId:preview.id,approved:true}),/연결이 변경/);
  assert.equal(f.sends,0);assert.deepEqual(f.ledger,{});
});

test('existing Google consent refreshes silently; revocation needs consent while outage does not request it',async()=>{
  let refreshes=0,browsers=0,identityStatus=200;
  const sender='synthetic-google-sub';
  const f=fixture({openBrowser:async()=>{browsers++;},fetchImpl:async(url,init)=>{
    if(url.includes('/token')){refreshes++;assert.equal(init.body.get('grant_type'),'refresh_token');return new Response(JSON.stringify({access_token:'refreshed-token',expires_in:3600}));}
    if(identityStatus!==200)return new Response('{}',{status:identityStatus});
    assert.equal(init.headers.authorization,'Bearer refreshed-token');return new Response(JSON.stringify({sub:sender}));
  }});
  f.secrets.set('hps.google.email-automation.v1',JSON.stringify({accessToken:'old-token',refreshToken:'existing-refresh',expiresAt:0,accountId:createHash('sha256').update(sender).digest('hex'),connectionId:'existing-consent'}));
  assert.equal(await f.runtime.ensureConnected(),true);assert.equal(await f.runtime.ensureConnected(),true);assert.equal(refreshes,1);assert.equal(browsers,0);
  assert.equal(JSON.parse(f.secrets.get('hps.google.email-automation.v1')).connectionId,'existing-consent');
  identityStatus=401;assert.equal(await f.runtime.ensureConnected(),false);
  identityStatus=503;await assert.rejects(f.runtime.ensureConnected(),/잠시 후/);assert.equal(browsers,0);
});


test('desktop client secret reaches only token exchange, never browser consent URL',async()=>{
  let resolve;const wait=new Promise(r=>{resolve=r;});let exchangeSeen=false;
  const f=fixture({clientSecret:'synthetic-desktop-secret',listenOAuth:async()=>({redirectUri:'http://127.0.0.1:43210/oauth/callback',wait,close(){}}),openBrowser:async raw=>{assert.equal(raw.includes('synthetic-desktop-secret'),false);const url=new URL(raw);resolve(new URL('http://127.0.0.1:43210/oauth/callback?code=synthetic-code&state='+url.searchParams.get('state')));},fetchImpl:async(url,init)=>{if(url.includes('/userinfo'))return new Response(JSON.stringify({sub:'synthetic-account'}));exchangeSeen=true;assert.equal(init.body.get('client_secret'),'synthetic-desktop-secret');return new Response(JSON.stringify({access_token:'synthetic-access',expires_in:3600,refresh_token:'synthetic-refresh'}));}});
  f.secrets.clear();await f.runtime.connect();assert.equal(exchangeSeen,true);assert.equal(JSON.stringify([...f.secrets.values()]).includes('synthetic-desktop-secret'),false);
});
