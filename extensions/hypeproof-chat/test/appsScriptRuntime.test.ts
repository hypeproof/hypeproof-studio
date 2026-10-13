import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createAppsScriptRuntime, generateAppsScriptEmailProject, APPS_SCRIPT_TOKEN_KEY, AppsScriptBlockedError } from '../src/appsScriptRuntime.ts';
import type { EmailRecipe } from '../src/googleAutomation.ts';

const recipe: EmailRecipe = { schema: 'hps-email-automation/1', title: '자료 요청', description: '자료 제출 요청', category: 'email', subjectTemplate: '{{name}}님 {{document}}', bodyTemplate: '{{dueDate}}까지 보내 주세요.', columns: { email: 'email', name: 'name', document: 'document', dueDate: 'dueDate' } };
const rows = [['email','name','document','dueDate'],['learner@example.invalid','테스트','보고서','내일']];
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const bundle = generateAppsScriptEmailProject(recipe);
  const secrets = new Map([[APPS_SCRIPT_TOKEN_KEY, JSON.stringify({ accessToken: 'synthetic-token', expiresAt: Date.now() + 3600000, accountId: 'synthetic-account', connectionId: 'synthetic-connection' })]]);
  const calls: { url: string; body: any }[] = [];
  let files = bundle.files, failure = 0, failRun = false, changeVersion = false, allow = true;
  const message = { to: 'learner@example.invalid', subject: '테스트님 보고서', body: '내일까지 보내 주세요.' };
  const preview = { id: 'synthetic-preview-id', createdAt: Date.now(), messages: [{ id: digest(JSON.stringify([message.to,message.subject,message.body])), ...message }] };
  const deps = {
    clientId: 'synthetic-client', isAllowed: () => allow,
    secrets: { get: async (k: string) => secrets.get(k), store: async (k: string, v: string) => { secrets.set(k,v); }, delete: async (k: string) => { secrets.delete(k); } },
    openBrowser: async (_url: string) => {},
    fetchImpl: (async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url), body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, body });
      if (failRun && u.endsWith(':run')) throw new Error('synthetic lost execution response');
      if (failure) return new Response(JSON.stringify({ error: 'must not leak secret' }), { status: failure });
      let result: any;
      if (u.endsWith('/projects')) result = { scriptId: 'synthetic_script_id' };
      else if (u.includes('/content')) { if (body) files = body.files; result = { files }; }
      else if (u.endsWith('/versions')) result = { versionNumber: 1 };
      else if (u.endsWith('/deployments')) result = { deploymentId: 'synthetic_deployment_id' };
      else if (u.includes('/deployments/')) result = { deploymentConfig: { versionNumber: changeVersion ? 2 : 1 } };
      else if (u.endsWith(':run')) result = { done: true, response: { result: body.function === 'hpsPreview' ? preview : { records: [{ id: preview.messages[0].id, status: 'sent', private: 'must drop' }] } } };
      else throw new Error('unexpected request');
      return new Response(JSON.stringify(result));
    }) as typeof fetch,
  };
  return { bundle, deps, runtime: createAppsScriptRuntime(deps), calls, secrets, preview, set failure(v: number) { failure=v; }, set failRun(v: boolean) { failRun=v; }, set changeVersion(v: boolean) { changeVersion=v; }, set allow(v: boolean) { allow=v; } };
}

test('create/upload/private version/deploy/preview/approve executes the exact immutable deployment with no data in generated source', async () => {
  const f = fixture();
  assert.ok(!JSON.stringify(f.bundle).includes('learner@example.invalid'));
  const manifest = JSON.parse(f.bundle.files[0].source);
  assert.equal(manifest.executionApi.access, 'MYSELF'); assert.equal(manifest.webapp, undefined);
  const p = await f.runtime.createProject(recipe.title);
  await assert.rejects(f.runtime.uploadProject(p.scriptId, f.bundle, 'wrong'), /승인/);
  await f.runtime.uploadProject(p.scriptId, f.bundle, f.bundle.digest);
  const d = await f.runtime.deployProject(p.scriptId, f.bundle, f.bundle.digest);
  const preview = await f.runtime.preview(d, { spreadsheetId: 'synthetic_sheet_id', range: 'Sheet1!A1:D21' });
  assert.equal(preview.messages[0].subject, '테스트님 보고서');
  assert.throws(() => { (preview.messages[0] as any).to = 'changed@example.invalid'; });
  await assert.rejects(f.runtime.sendApproved(d, preview.id, false), /승인/);
  assert.deepEqual(await f.runtime.sendApproved(d, preview.id, true), { records: [{ id: preview.messages[0].id, status: 'sent' }] });
  await assert.rejects(f.runtime.sendApproved(d, preview.id, true), /미리보기/);
  const runs = f.calls.filter(c => c.url.endsWith(':run'));
  assert.equal(runs.length, 2); assert.ok(runs.every(c => c.url.includes('/scripts/synthetic_deployment_id:run') && c.body.devMode === false));
  assert.deepEqual(runs.map(c => c.body.function), ['hpsPreview','hpsSendApproved']);
});

test('forged code, stale account, changed deployment and denied grant never send; setup errors are actionable and sanitized', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.uploadProject('synthetic_script_id', structuredClone(f.bundle), f.bundle.digest), /코드/);
  const mutated = generateAppsScriptEmailProject(recipe); mutated.files[1].source = 'function arbitrary() {}';
  mutated.digest = digest(JSON.stringify(mutated.files));
  await assert.rejects(f.runtime.uploadProject('synthetic_script_id', mutated, mutated.digest), /코드/);
  await f.runtime.uploadProject('synthetic_script_id', f.bundle, f.bundle.digest);
  const d = await f.runtime.deployProject('synthetic_script_id', f.bundle, f.bundle.digest);
  f.changeVersion = true;
  await assert.rejects(f.runtime.preview(d, { spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' }), /버전/);
  assert.equal(f.calls.filter(c => c.url.endsWith(':run')).length, 0);
  f.changeVersion = false; f.failure = 403;
  await assert.rejects(f.runtime.preview(d, { spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' }), AppsScriptBlockedError);
  f.failure = 0;
  await f.runtime.disconnect();
  await assert.rejects(f.runtime.preview(d, { spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' }), /연결/);
  f.allow = false; await assert.rejects(f.runtime.createProject('test'), /활동/);
});

test('network uncertainty consumes send approval and does not retry HTTP or expose Google error bodies', async () => {
  const f = fixture(); await f.runtime.uploadProject('synthetic_script_id', f.bundle, f.bundle.digest);
  const d = await f.runtime.deployProject('synthetic_script_id', f.bundle, f.bundle.digest);
  const p = await f.runtime.preview(d, { spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' });
  f.failRun = true;
  const result = await f.runtime.sendApproved(d,p.id,true);
  assert.equal(result.records[0].status, 'unknown');
  assert.equal(f.calls.filter(c => c.url.endsWith(':run') && c.body.function === 'hpsSendApproved').length, 1);
  const before = f.calls.length;
  await assert.rejects(f.runtime.sendApproved(d,p.id,true)); assert.equal(f.calls.length,before);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

function scriptFixture() {
  const bundle = generateAppsScriptEmailProject(recipe), properties = new Map<string,string>();
  let sends = 0, loseResponse = false;
  const context = vm.createContext({
    Utilities: { DigestAlgorithm: { SHA_256:'sha256' }, Charset: { UTF_8:'utf8' }, computeDigest: (_a: string, value: string) => Array.from(createHash('sha256').update(value).digest()), getUuid: () => 'synthetic-preview-id', newBlob: (s: string) => ({ getBytes: () => Buffer.from(s) }), base64Encode: (s: string) => Buffer.from(s).toString('base64'), base64EncodeWebSafe: (s: string) => Buffer.from(s).toString('base64url') },
    ScriptApp: { getOAuthToken: () => 'synthetic-token' },
    LockService: { getUserLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k: string) => properties.get(k), setProperty: (k: string,v: string) => properties.set(k,v), getProperties: () => Object.fromEntries(properties) }) },
    UrlFetchApp: { fetch: (url: string) => {
      if (url.includes('/messages/send')) { sends++; if (loseResponse) throw new Error('lost response after delivery'); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id:'synthetic-mail' }) }; }
      assert.ok(url.startsWith('https://sheets.googleapis.com/'));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ values: rows }) };
    } },
  });
  vm.runInContext(bundle.files.find(f => f.name === 'Code')!.source,context);
  return { context, properties, get sends() { return sends; }, set loseResponse(v: boolean) { loseResponse=v; } };
}

test('generated script executes synthetic Sheets→preview→approved Gmail with durable duplicate and unknown-outcome suppression', () => {
  for (const unknown of [false,true]) {
    const f = scriptFixture();
    const p = f.context.hpsPreview({ spreadsheetId:'synthetic_sheet_id',range:'A1:D21' });
    assert.equal(p.messages[0].subject,'테스트님 보고서');
    assert.equal(f.sends,0);
    assert.throws(() => f.context.hpsSendApproved({ previewId:p.id,messages:p.messages,approved:false }));
    const altered = structuredClone(p.messages); altered[0].subject='tampered';
    assert.throws(() => f.context.hpsSendApproved({ previewId:p.id,messages:altered,approved:true }));
    f.loseResponse=unknown;
    const result=f.context.hpsSendApproved({ previewId:p.id,messages:p.messages,approved:true });
    assert.equal(result.records[0].status,unknown?'unknown':'sent');
    f.context.hpsSendApproved({ previewId:p.id,messages:p.messages,approved:true });
    assert.equal(f.sends,1);
    assert.equal(f.properties.get('hps.sent.'+p.messages[0].id),unknown?'unknown':'sent');
  }
});

test('OAuth binds PKCE/state, asks only necessary management and execution scopes, and rejects partial consent', async () => {
  for (const goodState of [false,true]) {
    const f=fixture(); f.secrets.clear(); let resolve!: (value: URL) => void, exchanges=0;
    const wait=new Promise<URL>(r => { resolve=r; });
    const runtime=createAppsScriptRuntime({ ...f.deps,
      listenOAuth:async () => ({redirectUri:'http://127.0.0.1:41234/oauth/callback',wait,close() {}}),
      openBrowser:async raw => { const u=new URL(raw); assert.equal(u.searchParams.get('code_challenge_method'),'S256'); assert.equal(u.searchParams.get('include_granted_scopes'),'true'); assert.ok(!u.searchParams.get('scope')!.includes('/auth/drive')); resolve(new URL('http://127.0.0.1:41234/oauth/callback?code=synthetic-code&state='+(goodState?u.searchParams.get('state'):'wrong'))); },
      fetchImpl:(async () => { exchanges++; return new Response(JSON.stringify({ access_token:'synthetic-token',expires_in:3600,scope:'openid' })); }) as typeof fetch,
    });
    await assert.rejects(runtime.connect(),goodState?/권한/:/로그인/);
    assert.equal(exchanges,goodState?1:0); assert.equal(f.secrets.size,0);
  }
});
