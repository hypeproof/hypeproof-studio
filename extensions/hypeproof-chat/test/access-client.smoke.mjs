import assert from 'node:assert/strict';
const {parseAccessView,validFundingSource,accessProfile,sendBudgetRequest}=await import('../src/accessClient.ts');
const {contentBytes}=await import('../src/outboundConsent.ts');
const {buildSdkGatewayEnv}=await import('../src/sdkCoachHelpers.ts');
assert(validFundingSource('class:source-1'));assert(!validFundingSource('source\nx-hps-extra:yes'));
const view={schema:'hps-access-view/1',configured:true,as_of:new Date().toISOString(),choices:[{id:'source',label:'Synthetic',mode:'included',source_kind:'cohort',active:true,available:true,state:'ready',ends_at:Date.now()+1000,can_request:true,allowed:{models:['synthetic-model'],efforts:['low'],features:['read'],runtimes:['agent-sdk']},resources:[{meter:'currency:USD:micro',limit:100,remaining:50,spent:30,held:20,overrun:0,unresolved:1,shared:true}]}]};
assert.equal(parseAccessView(view),view);assert.throws(()=>parseAccessView({...view,choices:[{...view.choices[0],resources:[{...view.choices[0].resources[0],remaining:null}]}]}));
assert.throws(()=>parseAccessView({...view,as_of:'unknown'}));
const profile={sdk_tools:{read:true,write:true,shell:true,subagents:true,browser:true},tools:{web_search:true},browser_control:{enabled:true,max_iterations:4}};
const narrowed=accessProfile(profile,view.choices[0]);assert(narrowed.sdk_tools.read);for(const f of ['write','shell','subagents','browser'])assert.equal(narrowed.sdk_tools[f],false);assert.equal(narrowed.tools.web_search,false);assert.equal(narrowed.browser_control.enabled,false);
const env=buildSdkGatewayEnv({ANTHROPIC_CUSTOM_HEADERS:'x-hps-funding-source: ambient-source\nx-hps-turn-id: wrong-turn'}, {proxyUrl:'https://synthetic.invalid/v1',token:'synthetic-token',fundingSource:'class-source',turnId:'shared-turn'});
assert.match(env.ANTHROPIC_CUSTOM_HEADERS,/x-hps-funding-source: class-source/);assert(!env.ANTHROPIC_CUSTOM_HEADERS.includes('ambient-source'));assert(!env.ANTHROPIC_CUSTOM_HEADERS.includes('wrong-turn'));
assert.throws(()=>buildSdkGatewayEnv({}, {proxyUrl:'https://synthetic.invalid/v1',token:'synthetic-token',fundingSource:'bad\nheader'}));
const none=buildSdkGatewayEnv({ANTHROPIC_CUSTOM_HEADERS:'x-hps-funding-source: ambient-source'},{proxyUrl:'https://synthetic.invalid/v1',token:'synthetic-token'});assert(!none.ANTHROPIC_CUSTOM_HEADERS?.includes('funding-source'));
{ // REQ-KNOW-09: the extra-usage reason is the learner's words to the funding owner.
 const note='마지막 검증을 하고 싶어요 😀',fetches=[],fetchImpl=async(u,i)=>{fetches.push({u:String(u),body:JSON.parse(i.body)});return new Response('{}',{status:200});};
 const send=confirm=>sendBudgetRequest('https://service.invalid/v1','tok','class:source-1',{note},confirm,fetchImpl);
 assert.equal(await send(undefined),false,'no confirm function: nothing sent');assert.equal(fetches.length,0,'no confirm function: zero fetches');
 let shown;assert.equal(await send(async d=>(shown=d,false)),false);assert.equal(fetches.length,0,'Cancel: zero fetches');
 assert.equal(shown.recipient,'이용권을 관리하는 강사 · service.invalid');
 assert.deepEqual(shown.items,[{name:'추가 사용이 필요한 이유 (내가 쓴 글)',bytes:Buffer.byteLength(note)},{name:'이용권 번호',bytes:Buffer.byteLength('class:source-1')}],'exact item names and byte sizes');
 assert.ok(shown.items[0].bytes>0&&contentBytes(note)===shown.items[0].bytes);
 assert.equal(await send(async()=>true),true);assert.equal(fetches.length,1);assert.deepEqual(fetches[0].body,{source_id:'class:source-1',note});
}
{ // CGP-SHELL-R-030: the Service's request policy. A minor seat sends a fixed reason only; a malformed policy offers nothing.
 const REASONS=[{id:'finish_work',label:'하던 작업을 마무리하고 싶어요'},{id:'fix_problem',label:'문제를 고치는 중이에요'}];
 const MINOR={reasons:REASONS,note:false,note_max:280,cooldown_until:null},ADULT={...MINOR,note:true};
 const withPolicy=p=>({...view,choices:[{...view.choices[0],request_policy:p}]});
 assert.deepEqual(parseAccessView(structuredClone(withPolicy(MINOR))).choices[0].request_policy,MINOR);
 assert.equal(parseAccessView(structuredClone(view)).choices[0].request_policy,undefined,'an older Service: no policy');
 for(const bad of [{...MINOR,note:'yes'},{...MINOR,reasons:[]},{...MINOR,reasons:[{id:'Bad Id',label:'x'}]},{...MINOR,note_max:281},{...MINOR,cooldown_until:'soon'},'policy'])
  assert.equal(parseAccessView(structuredClone(withPolicy(bad))).choices[0].request_policy,null,JSON.stringify(bad));
 let fetches=[],status=201,reply='{}';const fetchImpl=async(u,i)=>{fetches.push(JSON.parse(i.body));return new Response(reply,{status});};
 const send=(input,policy,confirm=async()=>true)=>sendBudgetRequest('https://service.invalid/v1','tok','class:source-1',input,confirm,fetchImpl,policy);
 await assert.rejects(send({note:'선생님 저 민지예요'},MINOR),/이유를 골라서/);await assert.rejects(send({reason:'finish_work',note:'제 이름은'},MINOR),/이유를 골라서/);
 await assert.rejects(send({},MINOR),/하나 골라/);await assert.rejects(send({reason:'more'},MINOR),/다시 골라/);
 await assert.rejects(send({reason:'finish_work'},null),/요청할 수 없어요/);
 assert.equal(fetches.length,0,'nothing reaches the Service for a refused minor request');
 let shown;assert.equal(await send({reason:'fix_problem'},MINOR,async d=>(shown=d,true)),true);
 assert.deepEqual(fetches.at(-1),{source_id:'class:source-1',reason:'fix_problem'});
 assert.deepEqual(shown.items.map(i=>i.name),['고른 이유: 문제를 고치는 중이에요','이용권 번호']);
 assert.equal(await send({},ADULT),true);assert.deepEqual(fetches.at(-1),{source_id:'class:source-1'},'an adult may send neither');
 assert.equal(await send({reason:'finish_work',note:'한 번만 더'},ADULT),true);assert.deepEqual(fetches.at(-1),{source_id:'class:source-1',reason:'finish_work',note:'한 번만 더'});
 await assert.rejects(send({note:'가'.repeat(281)},ADULT),/280자 이내/);
 status=429;reply=JSON.stringify({error:{code:'budget_request_cooldown'}});
 await assert.rejects(send({reason:'finish_work'},MINOR),/10분이 지나면 다시 요청할 수 있어요/);
 status=503;reply='not json';await assert.rejects(send({reason:'finish_work'},MINOR),/보내지 못했습니다/);
}
console.log('PASS access DTO/unknown counts, feature narrowing, owned SDK funding/turn headers and injection denial');
