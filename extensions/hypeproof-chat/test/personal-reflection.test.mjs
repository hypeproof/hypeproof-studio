import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readReflection,reflectionFailure} from '../src/personalReflection.ts';
import {AccountSession,ACCOUNT_SECRET_KEY} from '../src/accountSession.ts';
const snapshot=()=>({state:{id:'personal-reflection',revision:2,messages:[{id:'phone',role:'user',content:'어떤 일을 하고 싶은지 모르겠어요.',created_at:1},{id:'answer',role:'assistant',content:'최근 마음에 남은 순간이 있나요?',created_at:2}],has_earlier:false,turn:null},opening:'요즘 어떤 일에 시간을 많이 쓰세요?',hint:'정리되지 않아도 괜찮아요.'});
test('accepts shared text but rejects executable roles, duplicate identities and malformed acknowledgments',()=>{
 const value=snapshot();assert.equal(readReflection(value).state.messages[0].id,'phone');
 for(const edit of [v=>v.state.messages[0].role='tool',v=>v.state.messages[1].id='phone',v=>v.state.revision=-1,v=>v.acknowledged_id='../../foreign',v=>v.state.turn={id:'t',text:'private',status:'executing',updated_at:1}]){
  const changed=snapshot();edit(changed);assert.throws(()=>readReflection(changed));
 }
});
test('account reflection uses the same credential and turn identity; revocation fences subsequent requests',async()=>{
 const values=new Map([[ACCOUNT_SECRET_KEY,JSON.stringify({service:'https://api.hypeproof-ai.xyz/v1',accessToken:'synthetic',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,sessionId:'same-session'})]]);const calls=[];let status=200;
 const accounts=new AccountSession({service:'https://api.hypeproof-ai.xyz/v1',site:'https://hypeproof-ai.xyz',label:'synthetic',openBrowser:async()=>false,secrets:{get:async k=>values.get(k),store:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)},fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(status===200?snapshot():{error:'session_revoked'}),{status});}});
 const turn={id:'persisted-turn',text:'오늘 내 이야기',revision:2};
 await accounts.reflectionRequest('same-session','/turns',turn);
 assert.equal(calls[0].url,'https://api.hypeproof-ai.xyz/v1/me/reflection/turns');
 assert.equal(calls[0].init.headers.authorization,'Bearer synthetic');assert.deepEqual(JSON.parse(calls[0].init.body),turn);
 await assert.rejects(accounts.reflectionRequest('foreign','/turns',turn));
 await assert.rejects(accounts.reflectionRequest('same-session','/../secret'));assert.equal(calls.length,1);
 await accounts.reflectionRequest('same-session','/turns/persisted-turn/cancel',{});assert.equal(calls[1].init.method,'POST');
 status=401;await assert.rejects(accounts.reflectionRequest('same-session'));assert.equal(values.has(ACCOUNT_SECRET_KEY),false);
 await assert.rejects(accounts.reflectionRequest('same-session'));assert.equal(calls.length,3);
});
test('account changes while a reflection response is in flight cannot import the old account transcript',async()=>{
 const bundle={service:'https://api.hypeproof-ai.xyz/v1',accessToken:'synthetic',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,sessionId:'old-session'};
 const values=new Map([[ACCOUNT_SECRET_KEY,JSON.stringify(bundle)]]);
 const accounts=new AccountSession({service:bundle.service,site:'https://hypeproof-ai.xyz',label:'synthetic',openBrowser:async()=>false,secrets:{get:async k=>values.get(k),store:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)},fetch:async()=>{values.set(ACCOUNT_SECRET_KEY,JSON.stringify({...bundle,sessionId:'new-session'}));return new Response(JSON.stringify(snapshot()));}});
 await assert.rejects(accounts.reflectionRequest('old-session'));assert.equal(JSON.parse(values.get(ACCOUNT_SECRET_KEY)).sessionId,'new-session');
});
test('admission refusals preserve the account and explain only the known allowance period',async()=>{
 const bundle={service:'https://api.hypeproof-ai.xyz/v1',accessToken:'synthetic',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,sessionId:'same-session'};
 const values=new Map([[ACCOUNT_SECRET_KEY,JSON.stringify(bundle)]]),calls=[];
 let status=429,code='reflection_monthly_limit';
 const accounts=new AccountSession({service:bundle.service,site:'https://hypeproof-ai.xyz',label:'synthetic',openBrowser:async()=>{throw Error('Admission refusal must not reopen login');},secrets:{get:async k=>values.get(k),store:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)},fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({error:code}),{status});}});
 for(const refusal of [{status:429,code:'reflection_monthly_limit',period:true},{status:429,code:'reflection_budget_limit'},{status:503,code:'reflection_admission_unavailable'},{status:403,code:'reflection_access_required'}]){
  ({status,code}=refusal);const before=calls.length;
  await assert.rejects(accounts.reflectionRequest('same-session','/turns',{id:'retained-turn',text:'보낸 생각',revision:2}),error=>{
   assert.equal(error.code,code);const message=reflectionFailure(error);
   assert.doesNotMatch(message,/오늘|내일|다시 로그인/);
   if(refusal.period){assert.match(message,/이번 달/);assert.match(message,/다음 달/);}
   else assert.doesNotMatch(message,/이번 달|다음 달/);
   if(status===503)assert.match(message,/이용 상태를 확인하지 못/);
   if(status===403)assert.match(message,/이용 권한/);
   return true;
  });
  assert.equal(calls.length,before+1,'no automatic retry');assert.deepEqual(JSON.parse(values.get(ACCOUNT_SECRET_KEY)),bundle,'allowance refusal does not revoke login');
 }
});
