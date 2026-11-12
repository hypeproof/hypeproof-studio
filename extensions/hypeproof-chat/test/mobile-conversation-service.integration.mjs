// Opt-in synthetic cross-repository contract test. No network server, users or hosted model.
// HYPEPROOF_SERVICE_SOURCE=/checkout node --experimental-strip-types --test test/mobile-conversation-service.integration.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {MobileConversation,sharedTexts} from '../src/mobileConversation.ts';
import {TaskWorkspaceStore} from '../src/taskWorkspaceStore.ts';
const service=process.env.HYPEPROOF_SERVICE_SOURCE;
test('synthetic real Service route/SQL ↔ desktop controller/original task store ↔ phone HTTP requests', {skip:!service},async()=>{
 const root=resolve(service);await import(pathToFileURL(join(root,'worker/test/harness/loader.mjs')).href);
 const {conversationSync}=await import(pathToFileURL(join(root,'worker/src/routes/conversation-sync.ts')).href);
 const {accountToken}=await import(pathToFileURL(join(root,'worker/src/lib/accounts.ts')).href);
 const {Hono}=createRequire(join(root,'worker/package.json'))('hono');
 const db=new DatabaseSync(':memory:');const disk=await mkdtemp(join(tmpdir(),'mobile-service-contract-'));
 try{
  db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE accounts(id TEXT PRIMARY KEY,status TEXT,email TEXT,email_verified INTEGER,display_name TEXT,age_band TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE account_sessions(id TEXT PRIMARY KEY,account_id TEXT,kind TEXT,label TEXT,refresh_hash TEXT,created_at INTEGER,last_used_at INTEGER,revoked_at INTEGER,expires_at INTEGER);
CREATE TABLE account_rate_limits(key TEXT PRIMARY KEY,window INTEGER,count INTEGER,expires_at INTEGER);`);
  const account='acc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',desktop='ses_11111111111111111111111111111111',phone='ses_22222222222222222222222222222222';
  db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(account,'active',null,1,'Synthetic','14+',0,0);
  const now=Math.floor(Date.now()/1000);
  for(const id of [desktop,phone])db.prepare("INSERT INTO account_sessions VALUES(?,?,'studio',?,?,?, ?,NULL,?)").run(id,account,'Synthetic',id,now,now,now+3600);
  db.exec(readFileSync(join(root,'worker/migrations/0072-conversation-sync.sql'),'utf8'));
  function prepare(sql){let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}}
  const env={HPS_ACCOUNTS:'enabled',HPS_CONVERSATION_SYNC:'enabled',HPS_SIGNING_SECRET:'synthetic-only-not-a-real-secret-long-enough',HPS_DB:{prepare,async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}}};
  const tokens={};for(const id of [desktop,phone])tokens[id]=(await accountToken(env,account,id)).access_token;
  const app=new Hono();app.route('/v1/me/conversations',conversationSync);
  async function call(id,path,body,method=body===undefined?'GET':'POST'){
   const r=await app.request('https://synthetic.invalid/v1/me/conversations'+path,{method,headers:{authorization:'Bearer '+tokens[id],'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);const value=await r.json();
   if(!r.ok)throw Object.assign(Error(value.error??`http_${r.status}`),{code:value.error,status:r.status});return value;
  }
  const store=new TaskWorkspaceStore(disk,'synthetic-personal-scope');await store.initialize();const task=store.getView().activeTaskId;
  await store.append(task,[{id:'desktop-original',role:'user',content:'직접 본 불편을 이야기하고 싶어요.',createdAt:1}]);
  let binding,executions=0;const notices=[];
  const scope=()=>({activity:'synthetic-personal',workspace:store.scope,task,title:'Synthetic reflection',ready:true,messages:sharedTexts(store.getHistory())});
  const sync=new MobileConversation({read:()=>structuredClone(binding),save:async v=>{binding=structuredClone(v)},scope,session:async()=>desktop,request:call,exclusive:async f=>f(),stop:()=>{},changed:m=>notices.push(m),execute:async(s,r)=>{
   assert.equal(s.task,task);assert.equal(binding.accepted,r.id);executions++;
   // Only the model execution port is synthetic. Original disk history is used before/after the turn.
   await store.append(task,[{id:r.id,role:'user',content:r.text,createdAt:2},{id:'synthetic-answer-'+executions,role:'assistant',content:'누구에게 어떤 변화가 생기면 좋을까요?',createdAt:3}]);return true;
  }});
  await sync.connect();assert.ok(binding?.created,notices.join('\n'));const id=binding.id;
  assert.equal((await call(phone,'')).conversations[0].id,id);
  assert.equal((await call(phone,`/${id}/events?after=0`)).events[0].message.id,'desktop-original');
  await call(phone,`/${id}/requests`,{id:'phone-request',text:'주변 사람의 불편부터 확인할래요.'});await sync.tick();
  assert.equal((await call(phone,`/${id}/requests`)).requests[0].status,'completed',notices.join('\n'));assert.equal(executions,1);
  const events=(await call(phone,`/${id}/events?after=0`)).events;assert.deepEqual(events.map(e=>e.message.id),['desktop-original','phone-request','synthetic-answer-1']);assert.equal(store.getHistory().length,3);
  await sync.tick();assert.equal(executions,1);
  await call(phone,`/${id}/requests`,{id:'revoked-request',text:'Should not run'});db.prepare('UPDATE account_sessions SET revoked_at=1 WHERE id=?').run(phone);await sync.tick();
  assert.equal((await call(desktop,`/${id}/requests`)).requests.find(r=>r.id==='revoked-request').status,'cancelled');assert.equal(executions,1);
  db.prepare('UPDATE account_sessions SET revoked_at=NULL WHERE id=?').run(phone);
  await call(phone,`/${id}/requests`,{id:'next-request',text:'이제 가장 작은 실험은?'});await sync.tick();assert.equal(executions,2);
  await sync.disconnect(true);assert.equal((await call(phone,'')).conversations.length,0);assert.equal(store.getHistory().length,5);
 }finally{db.close();await rm(disk,{recursive:true,force:true})}
});
