import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{startAuthService}from'./auth-service.mjs';
test('actual pinned Worker start/pending/approve/poll/me; no client credential bootstrap or model route',{skip:!process.env.HPS_AUTH_SERVICE_TEST_SOURCE,timeout:60000},async()=>{
 const pin=JSON.parse(readFileSync(new URL('../../config/service-deployment.json',import.meta.url)));
 const fixture=await startAuthService({source:process.env.HPS_AUTH_SERVICE_TEST_SOURCE,expectedSha:pin.sha});
 const call=async(path,body,token)=>{const r=await fetch(fixture.origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,value:await r.json()};};
 try{for(const phase of['seed','erase','absence']){
  fixture.arm(phase);const started=await call('/v1/auth/device/start',{});assert.equal(started.status,200);assert.equal(new URL(started.value.verification_uri).origin,fixture.origin);
  const pending=await call('/v1/auth/device/poll',{device_code:started.value.device_code});assert.equal(pending.status,202);
  await new Promise(r=>setTimeout(r,3100));const consumed=await call('/v1/auth/device/poll',{device_code:started.value.device_code});assert.equal(consumed.status,200);assert.equal(consumed.value.account.id,fixture.account);
  for(let i=0;i<2;i++){const me=await call('/v1/me',null,consumed.value.access_token);assert.equal(me.status,200);assert.equal(me.value.session_id,consumed.value.session_id);}
 }
 assert.equal((await call('/v1/me',null,'wrong')).status,401);
 assert.equal((await call('/v1/messages',{})).status,403);assert.equal((await call('/v1/internal/accounts/device/approve',{})).status,403);
 const evidence=await fixture.snapshot(true);assert.equal(evidence.approvals.length,3);assert.equal(evidence.requests.filter(r=>r.path==='/v1/auth/device/poll'&&r.status===200).length,3);assert.equal(evidence.outbound,0);assert.equal(evidence.denied.length,2);
 }finally{await fixture.close();}
});
