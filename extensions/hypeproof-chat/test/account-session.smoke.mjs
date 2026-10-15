// REQ-L13: exercise the real host client, credential store and device/refresh state machine.
import assert from 'node:assert/strict';
import { AccountSession, ACCOUNT_SECRET_KEY, accountPreviewEnabled, safeDeviceUrl } from '../src/accountSession.ts';
const SERVICE='http://127.0.0.1:8793/v1', SITE='http://localhost:3193';
const reply=(status, body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function harness() {
  const world={now:1_000_000,store:new Map(),calls:[],opened:[],invalidated:[],refresh:0,poll:'pending',release:undefined,revoke:false,offline:false,failStore:false};
  const secrets={get:async k=>world.store.get(k),store:async(k,v)=>{if(world.failStore)throw Error("secret storage unavailable");world.store.set(k,v)},delete:async k=>{world.store.delete(k)}};
  const bundle=n=>({access_token:`account-secret-${n}`,refresh_token:`refresh-secret-${n}`,session_id:'session-one',expires_in:3600});
  const fetch=async(url,init={})=>{
    const u=new URL(url),body=init.body?JSON.parse(init.body):undefined;
    world.calls.push({path:u.pathname,body,authorization:new Headers(init.headers).get('authorization')});
    if(world.offline)throw new Error('offline');
    if(u.pathname.endsWith('/device/start'))return reply(200,{device_code:'device-secret',user_code:'HPDX-4K7Q',verification_uri_complete:SITE+'/studio/connect?code=HPDX-4K7Q',expires_in:600,interval:3});
    if(u.pathname.endsWith('/device/poll')){
      if(world.poll==='delayed')await new Promise(r=>{world.release=r});
      if(world.poll==='pending')return reply(202,{status:'pending'});
      if(world.poll==='slow')return reply(429,{error:'slow_down'});
      if(world.poll==='denied')return reply(409,{error:'access_denied'});
      return reply(200,bundle(0));
    }
    if(u.pathname.endsWith('/auth/refresh')){world.refresh++;assert.equal(body.refresh_token,`refresh-secret-${world.refresh-1}`,'refresh token is consumed only once');await new Promise(r=>setImmediate(r));return reply(200,bundle(world.refresh));}
    if(u.pathname.endsWith('/auth/logout')){if(world.now>4_600_000&&new Headers(init.headers).get('authorization')==='Bearer account-secret-0')return reply(401,{error:'invalid_token'});return reply(200,{ok:true});}
    if(world.revoke)return reply(401,{error:'session_revoked'});
    if(u.pathname.endsWith('/me'))return reply(200,{account:{id:'account-one',email:'buyer@example.test',display_name:'테스트 고객',access_token:'do-not-forward'}});
    if(u.pathname.endsWith('/me/passes'))return reply(200,{passes:[{id:'ord_one',product_name:'개인 이용권',status:'active',requests_used:3,requests_limit:10,requests_remaining:7,starts_at:null,expires_at:null,duration_seconds:2592000,activation_deadline_at:9000000,amount:100,refresh_token:'never-forward'}]});
    if(u.pathname.endsWith('/activate'))return reply(200,{access_token:`pass-secret-${world.refresh}`,expires_in:3600,pass:{}});
    throw new Error('Unexpected request '+u.pathname);
  };
  const make=()=>new AccountSession({service:SERVICE,site:SITE,secrets,label:'Test Studio',fetch,now:()=>world.now,openBrowser:async u=>{world.opened.push(u);return true},invalidated:async id=>{world.invalidated.push(id)}});
  return {world,client:make(),make};
}
assert.equal(accountPreviewEnabled(false,SERVICE,SITE),false);
assert.equal(accountPreviewEnabled(true,SERVICE,SITE),true);
assert.equal(accountPreviewEnabled(true,'https://api.hypeproof-ai.xyz/v1',SITE),false);
assert.equal(safeDeviceUrl(SITE+'/studio/connect?access_token=leak',SITE),false);
assert.equal(safeDeviceUrl('https://other.test/studio/connect?code=x',SITE),false);
{
  const {world,client}=harness();
  await client.start(); assert.equal(client.view().status,'waiting'); assert.equal(world.store.size,0);
  await client.poll(); assert.equal(world.store.size,0,'pending approval grants no credentials');
  world.poll='approved'; await client.poll(); assert.equal(client.view().status,'signedIn');
  const view=JSON.stringify(client.view()); for(const secret of ['account-secret','refresh-secret','device-secret','do-not-forward','never-forward'])assert.equal(view.includes(secret),false);
  assert.equal(client.view().passes[0].expires_at,null,'an unstarted pass must not present its activation deadline as its usage end');
  assert.equal(client.view().passes[0].duration_seconds,2592000);assert.equal(client.view().passes[0].activation_deadline_at,9000000);
  assert.equal(world.opened[0],SITE+'/studio/connect?code=HPDX-4K7Q');
  const active=await client.activate('ord_one'); assert.equal(active.token,'pass-secret-0');
  world.now+=3_550_000;
  const tokens=await Promise.all(Array.from({length:12},()=>client.accessToken()));
  assert.equal(world.refresh,1);assert.ok(tokens.every(t=>t==='account-secret-1'));
  assert.equal(await client.resolvePass(active.binding),'pass-secret-1','runtime credential read renews the selected pass after refreshing');
  world.revoke=true;await client.refreshView();assert.equal(world.store.has(ACCOUNT_SECRET_KEY),false);assert.deepEqual(world.invalidated,['session-one']);assert.equal(await client.resolvePass(active.binding),undefined);
  client.dispose();
  console.log('PASS explicit approval, credential redaction, serialized refresh, pass renewal and revoke');
}
{
  const {world,client}=harness();await client.start();world.poll='delayed';const pending=client.poll();while(!world.release)await new Promise(r=>setImmediate(r));client.cancel();world.release();await pending;
  assert.equal(world.store.size,0);assert.ok(world.calls.some(c=>c.path.endsWith('/auth/logout')),'late approval is revoked after cancellation');client.dispose();
  console.log('PASS cancellation racing approved poll never installs a session');
}
{
  const {world,client}=harness();await client.start();world.now+=601000;await client.poll();assert.equal(client.view().status,'signedOut');assert.match(client.view().message,/시간/);assert.equal(world.store.size,0);
  await client.start();world.poll='denied';await client.poll();assert.match(client.view().message,/거절/);client.dispose();
  console.log('PASS expiry and denied approval remain signed out with a recovery action');
}
{
  const {world,client,make}=harness();await client.start();world.poll='approved';await client.poll();
  world.now+=3_550_000;world.offline=true;await assert.rejects(()=>client.accessToken());assert.equal(world.store.has(ACCOUNT_SECRET_KEY),true,'offline refresh must preserve session');
  world.offline=false;const other=make();await other.refreshView();await client.signOut();await other.refreshView();assert.equal(world.invalidated.length,2,'a second window observes removed secrets and stops its runtime');
  client.dispose();other.dispose();
  console.log('PASS transient failure preserves credentials; another window observes logout');
}

{
  const {world,client}=harness();await client.start();world.poll='slow';await client.poll();assert.equal(client.view().status,'waiting','Service slow_down preserves the pending approval');
  world.poll='approved';world.failStore=true;await client.poll();assert.equal(world.store.size,0);assert.equal(client.view().status,'signedOut');assert.ok(world.calls.some(c=>c.path.endsWith('/auth/logout')),'an unpersisted session is revoked');
  client.dispose();console.log('PASS polling slowdown retries; failed credential storage revokes the newly issued session');
}

{
  const {world,client}=harness();await client.start();world.poll='approved';await client.poll();world.now+=3_700_000;
  await client.signOut();assert.equal(world.refresh,1,'an expired access token must refresh under the lock before remote logout');assert.equal(world.store.size,0);assert.match(client.view().message,/로그아웃했어요/);assert.equal(world.calls.at(-1).authorization,'Bearer account-secret-1');
  client.dispose();console.log('PASS online logout after access expiry revokes the rotated session');
}
