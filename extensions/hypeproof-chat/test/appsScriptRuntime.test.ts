import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createAppsScriptRuntime, generateAppsScriptEmailProject, APPS_SCRIPT_TOKEN_KEY, AppsScriptBlockedError, AppsScriptRecoveryError } from '../src/appsScriptRuntime.ts';
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
      else if (u.endsWith(':run')) result = { done: true, response: { result: body.function === 'hpsPreview' ? preview : { records: [{ id: preview.messages[0].id, status: body.function === 'hpsGetSendStatus' ? 'not_attempted' : 'sent', private: 'must drop' }] } } };
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

test('generated approval digest survives API object key reordering while binding every approved value', () => {
  for (const unknown of [false,true]) {
    const f=scriptFixture();
    const p=f.context.hpsPreview({spreadsheetId:'synthetic_sheet_id',range:'A1:D21'});
    const messages=p.messages.map((m: any) => ({body:m.body,subject:m.subject,to:m.to,id:m.id}));
    assert.notEqual(JSON.stringify(messages),JSON.stringify(p.messages),'fixture models unordered API map serialization');
    const altered=structuredClone(messages);altered[0].body+=' altered';
    altered[0].id=digest(JSON.stringify([altered[0].to.toLowerCase(),altered[0].subject,altered[0].body]));
    assert.throws(()=>f.context.hpsSendApproved({previewId:p.id,messages:altered,approved:true}),/STALE_PREVIEW/);
    assert.equal(f.sends,0,'valid message IDs cannot authorize edited preview content');
    f.loseResponse=unknown;
    const result=f.context.hpsSendApproved({previewId:p.id,messages,approved:true});
    assert.equal(result.records[0].status,unknown?'unknown':'sent');
    f.context.hpsSendApproved({previewId:p.id,messages:p.messages,approved:true});
    assert.equal(f.sends,1,'key reordering never creates a second send or retries unknown outcomes');
  }
});

test('read-only remote send status binds immutable deployment and exact IDs without consuming approval or sending', async () => {
  const f=fixture();await f.runtime.uploadProject('synthetic_script_id',f.bundle,f.bundle.digest);
  const d=await f.runtime.deployProject('synthetic_script_id',f.bundle,f.bundle.digest);
  const p=await f.runtime.preview(d,{spreadsheetId:'synthetic_sheet_id',range:'A1:D21'});
  assert.deepEqual(await f.runtime.getSendStatus(d,[p.messages[0].id]),{records:[{id:p.messages[0].id,status:'not_attempted'}]});
  assert(f.runtime.getPreview(p.id));
  assert.equal(f.calls.filter(c=>c.body?.function==='hpsSendApproved').length,0);
  await assert.rejects(f.runtime.getSendStatus(d,['invalid']));
  f.changeVersion=true;await assert.rejects(f.runtime.getSendStatus(d,[p.messages[0].id]),/버전/);
  const script=scriptFixture(),preview=script.context.hpsPreview({spreadsheetId:'synthetic_sheet_id',range:'A1:D21'}),id=preview.messages[0].id;
  for(const value of [undefined,'unknown','sent','unexpected']) {
    if(value!==undefined)script.properties.set('hps.sent.'+id,value);
    const before=JSON.stringify([...script.properties]);
    assert.equal(script.context.hpsGetSendStatus({ids:[id]}).records[0].status,value===undefined?'not_attempted':value==='sent'?'sent':'unknown');
    assert.equal(JSON.stringify([...script.properties]),before);assert.equal(script.sends,0);
  }
  assert.throws(()=>script.context.hpsGetSendStatus({ids:[id,id]}));
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

test('refresh failures distinguish operator settings, expired grants and transient faults without erasing credentials or retrying', async () => {
  const cases: [number, unknown, 'reconnect' | 'retry' | 'operator'][] = [
    [400, { error: 'invalid_grant' }, 'reconnect'],
    [400, { error: 'invalid_client' }, 'operator'],
    [400, { error: 'admin_policy_enforced' }, 'operator'],
    [400, { error: 'org_internal' }, 'operator'],
    [400, { error: 'unauthorized_client' }, 'operator'],
    [400, { error: 'temporarily_unavailable' }, 'retry'],
    [400, { error: 'server_error' }, 'retry'],
    [429, { error: 'invalid_client' }, 'retry'],
    [503, { error: 'invalid_grant' }, 'retry'],
    [400, { error: 'unrecognized', error_description: 'invalid_client' }, 'reconnect'],
    [400, { error: { code: 'invalid_client' } }, 'reconnect'],
    [400, null, 'reconnect'],
  ];
  for (const [status, body, recovery] of cases) {
    const f = fixture(); let requests = 0;
    const saved = JSON.stringify({ accessToken: 'synthetic-private-token', refreshToken: 'synthetic-refresh', expiresAt: 0, accountId: 'synthetic-account', connectionId: 'synthetic-connection' });
    f.secrets.set(APPS_SCRIPT_TOKEN_KEY, saved);
    const runtime = createAppsScriptRuntime({ ...f.deps, fetchImpl: (async (url: string | URL | Request) => {
      requests++; assert.equal(String(url), 'https://oauth2.googleapis.com/token');
      return new Response(body === null ? '<not-json>synthetic-private-response' : JSON.stringify({ ...body as object, private: 'synthetic-private-response' }), { status, headers: { 'x-private': 'synthetic-private-header' } });
    }) as typeof fetch });
    await assert.rejects(runtime.createProject('test'), (error: unknown) => {
      assert(error instanceof AppsScriptRecoveryError); assert.equal(error.recovery, recovery);
      assert(!JSON.stringify(error).includes('synthetic-private')); assert(!error.message.includes('synthetic-private')); return true;
    });
    assert.equal(requests, 1); assert.equal(f.secrets.get(APPS_SCRIPT_TOKEN_KEY), saved);
    assert.equal((await runtime.status()).connected, true);
  }
});

test('API machine reasons route quota, scope and disabled-service recovery; free text and untrusted detail types cannot choose recovery', async () => {
  const cases: [number, unknown, 'reconnect' | 'retry' | 'operator' | 'setup'][] = [
    ...['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded'].map(reason => [403, { errors: [{ reason }] }, 'retry'] as [number, unknown, 'retry']),
    [403, { errors: [{ reason: 'insufficientPermissions' }] }, 'reconnect'],
    [403, { errors: [{ reason: 'accessNotConfigured' }] }, 'operator'],
    ...(['RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'SERVICE_DISABLED'] as const).map(reason => [403, { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com', reason }] }, reason === 'SERVICE_DISABLED' ? 'operator' : reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ? 'reconnect' : 'retry'] as [number, unknown, 'operator' | 'reconnect' | 'retry']),
    [403, { message: 'SERVICE_DISABLED', status: 'PERMISSION_DENIED' }, 'setup'],
    [403, { errors: [{ reason: 'forbidden', message: 'rateLimitExceeded' }] }, 'setup'],
    [403, { details: [{ '@type': 'arbitrary', domain: 'googleapis.com', reason: 'SERVICE_DISABLED' }] }, 'setup'],
    [403, { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'untrusted.invalid', reason: 'SERVICE_DISABLED' }] }, 'setup'],
    [403, { errors: [{ reason: 'rateLimitExceeded synthetic-private-response' }] }, 'setup'],
    [403, null, 'setup'],
    [401, {}, 'reconnect'], [429, {}, 'retry'], [502, {}, 'retry'],
  ];
  for (const [status, body, recovery] of cases) {
    const f = fixture(), saved = f.secrets.get(APPS_SCRIPT_TOKEN_KEY); let requests = 0;
    const runtime = createAppsScriptRuntime({ ...f.deps, fetchImpl: (async () => {
      requests++; return new Response(body === null ? 'synthetic-private-response' : JSON.stringify({ error: { ...body as object, private: 'synthetic-private-response' } }), { status });
    }) as typeof fetch });
    await assert.rejects(runtime.createProject('test'), (error: unknown) => {
      if (recovery === 'setup') assert(error instanceof AppsScriptBlockedError);
      else { assert(error instanceof AppsScriptRecoveryError); assert.equal(error.recovery, recovery); }
      assert(error instanceof Error); assert(!error.message.includes('synthetic-private')); assert(!JSON.stringify(error).includes('synthetic-private')); return true;
    });
    assert.equal(requests, 1); assert.equal(f.secrets.get(APPS_SCRIPT_TOKEN_KEY), saved);
  }
});

test('OAuth callback recovery requires the bound redirect/state and one error code, and never exchanges on failure', async () => {
  for (const variant of ['operator', 'retry', 'wrong-state', 'duplicate-error', 'code-and-error']) {
    const f = fixture(); let resolve!: (value: URL) => void, requests = 0, closed = 0;
    const saved = f.secrets.get(APPS_SCRIPT_TOKEN_KEY), wait = new Promise<URL>(r => { resolve = r; });
    const runtime = createAppsScriptRuntime({ ...f.deps,
      listenOAuth: async () => ({ redirectUri: 'http://127.0.0.1:41234/oauth/callback', wait, close() { closed++; } }),
      openBrowser: async raw => {
        const u = new URL(raw), callback = new URL('http://127.0.0.1:41234/oauth/callback');
        callback.searchParams.set('state', variant === 'wrong-state' ? 'wrong' : u.searchParams.get('state')!);
        callback.searchParams.set('error', variant === 'retry' ? 'temporarily_unavailable' : 'invalid_client');
        callback.searchParams.set('error_description', 'synthetic-private-response');
        if (variant === 'duplicate-error') callback.searchParams.append('error', 'invalid_client');
        if (variant === 'code-and-error') callback.searchParams.set('code', 'synthetic-code');
        resolve(callback);
      },
      fetchImpl: (async () => { requests++; throw new Error('unexpected request'); }) as typeof fetch,
    });
    await assert.rejects(runtime.connect(), (error: unknown) => {
      assert(error instanceof Error); assert(!error.message.includes('synthetic-private'));
      if (variant === 'operator' || variant === 'retry') { assert(error instanceof AppsScriptRecoveryError); assert.equal(error.recovery, variant); }
      else assert(!(error instanceof AppsScriptRecoveryError));
      return true;
    });
    assert.equal(requests, 0); assert.equal(closed, 1); assert.equal(f.secrets.get(APPS_SCRIPT_TOKEN_KEY), saved);
  }
});

test('quota or server failures during an approved send remain unknown and consume approval without an automatic retry', async () => {
  for (const status of [403, 429, 503]) {
    const f = fixture(); let sendAttempts = 0;
    const runtime = createAppsScriptRuntime({ ...f.deps, fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(url).endsWith(':run') && body.function === 'hpsSendApproved') {
        sendAttempts++;
        return new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }], message: 'synthetic-private-response' } }), { status });
      }
      return f.deps.fetchImpl(url, init);
    }) as typeof fetch });
    await runtime.uploadProject('synthetic_script_id', f.bundle, f.bundle.digest);
    const d = await runtime.deployProject('synthetic_script_id', f.bundle, f.bundle.digest);
    const p = await runtime.preview(d, { spreadsheetId: 'synthetic_sheet_id', range: 'A1:D21' });
    assert.deepEqual(await runtime.sendApproved(d, p.id, true), { records: [{ id: p.messages[0].id, status: 'unknown' }] });
    await assert.rejects(runtime.sendApproved(d, p.id, true), /미리보기/);
    assert.equal(sendAttempts, 1); assert.equal(await runtime.isConnected(), true);
  }
});
