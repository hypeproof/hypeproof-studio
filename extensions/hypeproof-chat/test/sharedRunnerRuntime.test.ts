import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppsScriptRuntime, APPS_SCRIPT_TOKEN_KEY, generateAppsScriptEmailProject, AppsScriptRecoveryError } from '../src/appsScriptRuntime.ts';
import { loadSharedRunnerConfig, canonicalSharedRecipe, sharedRecipeDigest, type SharedRunnerConfig } from '../src/sharedRunnerConfig.ts';
import type { EmailRecipe } from '../src/googleAutomation.ts';

const recipe: EmailRecipe = { schema:'hps-email-automation/1', title:'자료 요청', description:'자료 제출 요청', category:'email', subjectTemplate:'{{name}}님 {{document}}', bodyTemplate:'{{dueDate}}까지 보내 주세요.', columns:{email:'email',name:'name',document:'document',dueDate:'dueDate'} };
const config: SharedRunnerConfig = { scriptId:'synthetic_shared_script', deploymentId:'synthetic_shared_deployment', versionNumber:3, protocol:'hps-email-v1', releaseId:'hps-email-20261014-v1' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const accountId = hash('synthetic-subject');
function fixture() {
  const map = new Map([[APPS_SCRIPT_TOKEN_KEY, JSON.stringify({accessToken:'synthetic-token', expiresAt:Date.now()+3600000, accountId, connectionId:'synthetic-connection'})]]);
  const secrets = { get:async (key: string) => map.get(key), store:async (key: string,value: string) => {map.set(key,value);}, delete:async (key: string) => {map.delete(key);} };
  const message = {to:'learner@example.invalid',subject:'테스트 자료',body:'내일까지 제출해 주세요.'};
  const preview = {id:'synthetic-preview',createdAt:Date.now(),messages:[{id:hash(JSON.stringify([message.to,message.subject,message.body])),...message}]};
  const calls: {url:string;body:any}[] = [];
  let alter: ((response:any) => void) | undefined, switchConnection = false, lostSend = false;
  const deps = { clientId:'synthetic-client', sharedRunner:{...config}, secrets, isAllowed:() => true, openBrowser:async (_url:string) => {},
    fetchImpl:(async (url: string | URL | Request, init: RequestInit = {}) => {
      const u=String(url), body=JSON.parse(String(init.body)); calls.push({url:u,body});
      assert.equal(u,`https://script.googleapis.com/v1/scripts/${config.deploymentId}:run`);
      assert.equal(init.method,'POST'); assert.equal(body.devMode,false);
      const input=body.parameters[0]; if(body.function==='hpsSharedPreview') assert.deepEqual(Object.keys(input.payload).sort(),['range','spreadsheetId']); assert.deepEqual(Object.keys(input).sort(),['accountId','payload','protocol','recipe','recipeDigest','releaseId']);
      assert.equal(input.accountId,accountId); assert.equal(input.recipeDigest,sharedRecipeDigest(recipe));
      assert.deepEqual(input.recipe,canonicalSharedRecipe(recipe));
      if (lostSend && body.function==='hpsSharedSendApproved') throw new Error('synthetic-secret');
      const result=body.function==='hpsSharedPreview'?preview:{records:input.payload.ids?input.payload.ids.map((id:string)=>({id,status:'not_attempted'})):preview.messages.map(m=>({id:m.id,status:'sent'}))};
      const response={protocol:config.protocol,releaseId:config.releaseId,accountId,recipeDigest:input.recipeDigest,result}; alter?.(response);
      if(switchConnection) map.set(APPS_SCRIPT_TOKEN_KEY,JSON.stringify({accessToken:'synthetic-other',expiresAt:Date.now()+3600000,accountId:hash('other-subject'),connectionId:'other-connection'}));
      return new Response(JSON.stringify({done:true,response:{result:response}}));
    }) as typeof fetch };
  return { deps, runtime:createAppsScriptRuntime(deps), map, preview, calls, set alter(v:typeof alter){alter=v;}, set switchConnection(v:boolean){switchConnection=v;},set lostSend(v:boolean){lostSend=v;} };
}

test('shared execution reads no source or deployments, pins release and binds approved preview to one connection',async()=>{
  const f=fixture(), d=await f.runtime.sharedDeployment(recipe,1);
  assert(Object.isFrozen(d)); assert(Object.isFrozen(d.recipe!.columns));
  f.deps.sharedRunner.deploymentId='mutated_external_config';
  const hostSheet={spreadsheetId:'synthetic_sheet_id',range:'A1:D2',connection:'host-only-private-binding'};
  const p=await f.runtime.preview(d,hostSheet);
  assert.deepEqual(await f.runtime.getSendStatus(d,p.messages.map(m=>m.id)),{records:[{id:p.messages[0].id,status:'not_attempted'}]});
  assert.deepEqual(await f.runtime.sendApproved(d,p.id,true),{records:[{id:p.messages[0].id,status:'sent'}]});
  const n=f.calls.length;
  await assert.rejects(f.runtime.sendApproved(d,p.id,true),/미리보기/); assert.equal(f.calls.length,n);
  assert.deepEqual(f.calls.map(c=>c.body.function),['hpsSharedPreview','hpsSharedGetSendStatus','hpsSharedSendApproved']);
  const bundle=generateAppsScriptEmailProject(recipe);
  await assert.rejects(f.runtime.createProject('test'),AppsScriptRecoveryError);
  await assert.rejects(f.runtime.uploadProject(d.scriptId,bundle,bundle.digest),AppsScriptRecoveryError);
  await assert.rejects(f.runtime.deployProject(d.scriptId,bundle,bundle.digest),AppsScriptRecoveryError);
  assert.equal(f.calls.length,n);
});

test('pinned deployment, response identity/release/recipe, and mid-request connection changes fail closed',async()=>{
  for(const changed of [{deploymentId:'another_deployment'},{scriptId:'another_script_id'},{versionNumber:4},{sharedReleaseId:'other-release'},{recipe:{...recipe,bodyTemplate:'altered'}}]) {
    const f=fixture(),d=await f.runtime.sharedDeployment(recipe);
    await assert.rejects(f.runtime.preview({...d,...changed},{spreadsheetId:'synthetic_sheet_id',range:'A1:D2'})); assert.equal(f.calls.length,0);
  }
  for(const field of ['accountId','releaseId','recipeDigest','protocol']) {
    const f=fixture(),d=await f.runtime.sharedDeployment(recipe); f.alter=r=>{r[field]='wrong';};
    await assert.rejects(f.runtime.preview(d,{spreadsheetId:'synthetic_sheet_id',range:'A1:D2'}),/일치/); assert.equal(f.runtime.getPreview(f.preview.id),undefined);
  }
  const f=fixture(),d=await f.runtime.sharedDeployment(recipe); f.switchConnection=true;
  await assert.rejects(f.runtime.preview(d,{spreadsheetId:'synthetic_sheet_id',range:'A1:D2'}),/연결/); assert.equal(f.runtime.getPreview(f.preview.id),undefined);
});

test('uncertain send consumes approval once; no retry or raw response reaches callers',async()=>{
  const f=fixture(),d=await f.runtime.sharedDeployment(recipe),p=await f.runtime.preview(d,{spreadsheetId:'synthetic_sheet_id',range:'A1:D2'}); f.lostSend=true;
  assert.deepEqual(await f.runtime.sendApproved(d,p.id,true),{records:[{id:p.messages[0].id,status:'unknown'}]});
  await assert.rejects(f.runtime.sendApproved(d,p.id,true));
  assert.equal(f.calls.filter(c=>c.body.function==='hpsSharedSendApproved').length,1);
});

test('shared OAuth requests execution and identity scopes only, preserving the existing SecretStorage identity contract',async()=>{
  const f=fixture(); f.map.clear(); let accept!:(url:URL)=>void;
  const wait=new Promise<URL>(resolve=>{accept=resolve;});
  const runtime=createAppsScriptRuntime({...f.deps,
    listenOAuth:async()=>({redirectUri:'http://127.0.0.1:41234/oauth/callback',wait,close(){}}),
    openBrowser:async raw=>{
      const u=new URL(raw), scopes=u.searchParams.get('scope')!.split(' ').sort();
      assert.deepEqual(scopes,['openid','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/spreadsheets.readonly','https://www.googleapis.com/auth/script.external_request'].sort());
      accept(new URL('http://127.0.0.1:41234/oauth/callback?code=synthetic-code&state='+u.searchParams.get('state')));
    },
    fetchImpl:(async url=>new Response(JSON.stringify(String(url).includes('/token')?{access_token:'synthetic-token',expires_in:3600,scope:'openid https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/script.external_request'}:{sub:'synthetic-subject'}))) as typeof fetch,
  });
  await runtime.connect(); assert.equal(f.map.size,1); assert(f.map.has(APPS_SCRIPT_TOKEN_KEY));
  assert((await runtime.getConnectionIdentity())!.startsWith(accountId+':'));
});

test('packaged config is exact and failclosed; recipe digest ignores incoming JSON key order',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hps-shared-config-'));
  try {
    assert.equal(loadSharedRunnerConfig(dir),null); mkdirSync(join(dir,'resources'));
    const path=join(dir,'resources','google-shared-runner.json'); writeFileSync(path,JSON.stringify(config)); assert.deepEqual(loadSharedRunnerConfig(dir),config);
    writeFileSync(path,JSON.stringify({...config,workspaceOverride:'untrusted'})); assert.throws(()=>loadSharedRunnerConfig(dir),/운영자/);
    writeFileSync(path,'x'.repeat(4097)); assert.throws(()=>loadSharedRunnerConfig(dir),/운영자/);
    unlinkSync(path); writeFileSync(join(dir,'outside.json'),JSON.stringify(config)); symlinkSync(join(dir,'outside.json'),path); assert.throws(()=>loadSharedRunnerConfig(dir),/운영자/); unlinkSync(path);
    writeFileSync(path,JSON.stringify(config));
    if(process.platform!=='win32') { chmodSync(path,0o666); assert.throws(()=>loadSharedRunnerConfig(dir),/운영자/); chmodSync(path,0o600); chmodSync(join(dir,'resources'),0o777); assert.throws(()=>loadSharedRunnerConfig(dir),/운영자/); chmodSync(join(dir,'resources'),0o700); }
    writeFileSync(path,'{synthetic-private-corruption'); assert.throws(()=>loadSharedRunnerConfig(dir),e=>e instanceof Error&&!e.message.includes('private'));
    const reordered=Object.fromEntries(Object.entries(recipe).reverse()); assert.equal(sharedRecipeDigest(reordered),sharedRecipeDigest(recipe));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
