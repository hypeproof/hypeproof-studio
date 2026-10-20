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
 const send=confirm=>sendBudgetRequest('https://service.invalid/v1','tok','class:source-1',note,confirm,fetchImpl);
 assert.equal(await send(undefined),false,'no confirm function: nothing sent');assert.equal(fetches.length,0,'no confirm function: zero fetches');
 let shown;assert.equal(await send(async d=>(shown=d,false)),false);assert.equal(fetches.length,0,'Cancel: zero fetches');
 assert.equal(shown.recipient,'이용권을 관리하는 강사 · service.invalid');
 assert.deepEqual(shown.items,[{name:'추가 사용이 필요한 이유 (내가 쓴 글)',bytes:Buffer.byteLength(note)},{name:'이용권 번호',bytes:Buffer.byteLength('class:source-1')}],'exact item names and byte sizes');
 assert.ok(shown.items[0].bytes>0&&contentBytes(note)===shown.items[0].bytes);
 assert.equal(await send(async()=>true),true);assert.equal(fetches.length,1);assert.deepEqual(fetches[0].body,{source_id:'class:source-1',note});
}
console.log('PASS access DTO/unknown counts, feature narrowing, owned SDK funding/turn headers and injection denial');
