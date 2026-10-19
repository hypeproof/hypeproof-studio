// REQ-L13: exercise the real host client, credential store and device/refresh state machine.
import assert from 'node:assert/strict';
import { AccountSession, ACCOUNT_SECRET_KEY, ACCOUNTS_ENABLED_DEFAULT, accountPreviewEnabled, accountProductionEnabled, safeDeviceUrl } from '../src/accountSession.ts';
import { readFileSync } from 'node:fs';
const SERVICE='http://127.0.0.1:8793/v1', SITE='http://localhost:3193';
const reply=(status, body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function harness(extra = {}) {
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
  const make=()=>new AccountSession({service:SERVICE,site:SITE,secrets,label:'Test Studio',fetch,now:()=>world.now,openBrowser:async u=>{world.opened.push(u);return true},invalidated:async id=>{world.invalidated.push(id)},...extra});
  return {world,client:make(),make};
}
assert.equal(accountPreviewEnabled(false,SERVICE,SITE),false);
assert.equal(accountPreviewEnabled(true,SERVICE,SITE),true);
assert.equal(accountPreviewEnabled(true,'https://api.hypeproof-ai.xyz/v1',SITE),false);
assert.equal(accountProductionEnabled(false,'https://api.hypeproof-ai.xyz/v1','https://hypeproof-ai.xyz'),false);
assert.equal(accountProductionEnabled(true,'https://api.hypeproof-ai.xyz/v1','https://hypeproof-ai.xyz'),true);
for(const bad of ['http://api.hypeproof-ai.xyz/v1','https://api.hypeproof-ai.xyz.evil.test/v1','https://api.hypeproof-ai.xyz:443/v1','https://api.hypeproof-ai.xyz/v1?x=1','https://api.hypeproof-ai.xyz/v1#x','https://api.hypeproof-ai.xyz/v2','https://user@api.hypeproof-ai.xyz/v1',SERVICE])assert.equal(accountProductionEnabled(true,bad,'https://hypeproof-ai.xyz'),false);
for(const bad of ['http://hypeproof-ai.xyz','https://hypeproof-ai.xyz.evil.test','https://hypeproof-ai.xyz:443','https://hypeproof-ai.xyz/?x=1','https://hypeproof-ai.xyz/account','https://user@hypeproof-ai.xyz',SITE])assert.equal(accountProductionEnabled(true,'https://api.hypeproof-ai.xyz/v1',bad),false);
// Decision B3: accounts default on. The manifest default and the code fallback agree.
const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(manifest.contributes.configuration.properties['hypeproofChat.accountsEnabled'].default,true);
assert.equal(ACCOUNTS_ENABLED_DEFAULT,true);
// Positive control: the default on the canonical HTTPS Service and Lab enables accounts.
assert.equal(accountProductionEnabled(ACCOUNTS_ENABLED_DEFAULT,'https://api.hypeproof-ai.xyz/v1','https://hypeproof-ai.xyz'),true);
// Negative controls: the default true never enables accounts on any other Service or site
// (a local or staging Service, plain http, a look-alike host), and an explicit false still wins.
for(const [svc,site] of [[SERVICE,SITE],[SERVICE,'https://hypeproof-ai.xyz'],['https://api.hypeproof-ai.xyz/v1',SITE],['http://api.hypeproof-ai.xyz/v1','https://hypeproof-ai.xyz'],['https://staging.hypeproof-ai.xyz/v1','https://hypeproof-ai.xyz'],['https://api.hypeproof-ai.xyz.evil.test/v1','https://hypeproof-ai.xyz']])assert.equal(accountProductionEnabled(ACCOUNTS_ENABLED_DEFAULT,svc,site),false,`${svc} ${site}`);
assert.equal(accountProductionEnabled(false,'https://api.hypeproof-ai.xyz/v1','https://hypeproof-ai.xyz'),false);
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

{
  const returns=[];let state;
  const {world,client}=harness({createReturnUri:async nonce=>{state=nonce;return `hypeproof-studio://hypeproof.hypeproof-chat/account-return?state=${nonce}&windowId=42`;},returned:async()=>{returns.push('original-window');}});
  await client.start();assert.match(state,/^[a-f0-9]{64}$/);
  assert.match(world.calls[0].body.return_uri,/windowId=42/);
  assert.equal(await client.browserReturned('f'.repeat(64)),false,'foreign window nonce cannot trigger approval');
  assert.equal(await client.browserReturned(state),false,'valid callback before browser approval grants nothing');
  assert.equal(world.store.size,0);assert.equal(returns.length,0);
  world.poll='delayed';const polling=client.poll();while(!world.release)await new Promise(r=>setImmediate(r));
  const callback=client.browserReturned(state);world.release();await polling;assert.equal(await callback,true);
  assert.deepEqual(returns,['original-window']);assert.equal(await client.browserReturned(state),false,'callback is consumed');
  assert.equal(world.calls.filter(c=>c.path.endsWith('/device/poll')).length,2,'callback joins in-flight approval poll');
  assert.equal(JSON.stringify(client.view()).includes(state),false,'routing nonce stays out of presentation state');
  client.dispose();console.log('PASS original-window callback requires matching one-shot nonce and Service approval; concurrent polls coalesce');
}
{
  let state;const {world,client}=harness({createReturnUri:async nonce=>{state=nonce;return `hypeproof-studio://hypeproof.hypeproof-chat/account-return?state=${nonce}&windowId=42`;}});
  await client.start();const first=state;client.cancel();assert.equal(await client.browserReturned(first),false);
  await client.start();assert.notEqual(first,state);world.now+=601000;assert.equal(await client.browserReturned(state),false);client.dispose();
  console.log('PASS cancelled, superseded and expired return attempts cannot reuse the original window');
}
{
  let attempts=0;const {client}=harness({openBrowser:async()=>{attempts++;return attempts>2;}});
  await client.start();assert.match(client.view().message,/열지 못/);await client.reopen();assert.match(client.view().message,/열지 못/);
  await client.reopen();assert.match(client.view().message,/승인/);client.dispose();console.log('PASS browser retry reports failed opening and recovers');
}

{
  let state;let returned=0;
  const {world,client}=harness({createReturnUri:async nonce=>{state=nonce;return `hypeproof-studio://hypeproof.hypeproof-chat/account-return?state=${nonce}&windowId=42`;},returned:async()=>{returned++;}});
  await client.start();world.poll='slow';assert.equal(await client.browserReturned(state),false);assert.equal(returned,0);
  world.poll='approved';await client.poll();assert.equal(returned,1,'pending browser return survives slow_down until approval');await client.poll();assert.equal(returned,1);client.dispose();
  console.log('PASS delayed approval completes original-window return once after slow_down');
}
{
  let returned=0;const {world,client}=harness({createReturnUri:async nonce=>`hypeproof-studio://hypeproof.hypeproof-chat/account-return?state=${nonce}&windowId=42`,returned:async()=>{returned++;throw Error('view unavailable');}});
  await client.start();world.poll='approved';await client.poll();await new Promise(r=>setImmediate(r));
  assert.equal(client.view().status,'signedIn');assert.equal(world.store.size,1);assert.equal(returned,1);
  assert.equal(world.opened.filter(u=>u.startsWith('hypeproof-studio:')).length,1,'app requests original-window foreground when browser never returns');
  await client.refreshView();assert.equal(returned,1,'background refresh never steals focus');client.dispose();
  console.log('PASS successful poll requests foreground once, preserves credentials if reveal fails');
}
