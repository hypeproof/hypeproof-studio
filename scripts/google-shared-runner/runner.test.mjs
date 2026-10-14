import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('./runner.gs', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const releaseId = 'hps-email-20261014-v1';
const recipe = { schema: 'hps-email-automation/1', title: '자료 요청', description: '명단을 확인하고 제출 요청', category: 'email', subjectTemplate: '{{name}} 자료 요청', bodyTemplate: '{{document}} — {{dueDate}}', columns: { email: '메일', name: '이름', document: '자료', dueDate: '마감' } };
const canonical = r => ({ schema:r.schema, title:r.title, description:r.description, category:r.category, subjectTemplate:r.subjectTemplate, bodyTemplate:r.bodyTemplate, columns:{email:r.columns.email,name:r.columns.name,document:r.columns.document,dueDate:r.columns.dueDate} });
function harness() {
  let caller = 'alice', failSend = false, clock = 100000;
  const users = new Map(), calls = [], script = new Map([['HPS_SHARED_ALLOWED_SUB_SHA256', JSON.stringify(['alice','bob'].map(hash))]]);
  const properties = map => ({ getProperty: k => map.get(k) ?? null, setProperty: (k,v) => map.set(k,v), getProperties: () => Object.fromEntries(map) });
  const state = () => { if (!users.has(caller)) users.set(caller, new Map()); return users.get(caller); };
  const context = vm.createContext({
    Date: { now: () => clock },
    Utilities: {
      DigestAlgorithm:{SHA_256:'sha256'}, Charset:{UTF_8:'utf8'}, getUuid:randomUUID,
      computeDigest:(_,v) => [...createHash('sha256').update(v).digest()],
      newBlob:v => ({getBytes:() => [...Buffer.from(v)]}),
      base64Encode:v => Buffer.from(v).toString('base64'), base64EncodeWebSafe:v => Buffer.from(v).toString('base64url'),
    },
    PropertiesService: { getUserProperties: () => properties(state()), getScriptProperties: () => properties(script) },
    LockService: { getUserLock:() => ({waitLock(){},releaseLock(){}}) },
    ScriptApp: { getOAuthToken: () => `token:${caller}` },
    UrlFetchApp: { fetch(url, opts) {
      assert.equal(opts.headers.Authorization, `Bearer token:${caller}`);
      assert.equal(opts.followRedirects,false);
      calls.push({caller,url,opts});
      let code=200, body;
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') body={sub:caller};
      else if (url.startsWith('https://sheets.googleapis.com/')) {
        if (!url.includes(`/spreadsheets/sheet-${caller}-00000/`)) { code=403; body={}; }
        else body={values:[['메일','이름','자료','마감'],[`${caller}@example.invalid`,caller,'샘플','2026-10-20']]};
      } else if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        const anyUnknown = [...state().entries()].some(([k,v]) => k.startsWith('hps.sent.') && v === 'unknown');
        assert.ok(anyUnknown, 'uncertainty must be durable before requesting delivery');
        if (failSend) throw new Error('NETWORK_ERROR');
        body={id:'synthetic-provider-id'};
      } else throw new Error('unexpected network destination');
      return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)};
    } },
  });
  vm.runInContext(source,context);
  function call(fn,payload,overrides={}) {
    const r=overrides.recipe ?? recipe;
    const input={protocol:'hps-email-v1',releaseId,accountId:hash(caller),recipe:r,recipeDigest:hash(JSON.stringify(canonical(r))),payload,...overrides};
    return JSON.parse(JSON.stringify(context[fn](JSON.parse(JSON.stringify(input)))));
  }
  const preview = (overrides={}) => call('hpsSharedPreview',{spreadsheetId:`sheet-${caller}-00000`,range:'A1:D21'},overrides).result;
  const send = (p,overrides={}) => call('hpsSharedSendApproved',{approved:true,previewId:p.id,messages:p.messages},overrides).result;
  return {context,call,preview,send,calls,script,users,setCaller:v=>caller=v,setFailure:v=>failSend=v,advance:v=>clock+=v,state};
}

test('two callers read only their own sheets and never share preview or delivery state', () => {
  const h=harness(), a=h.preview();
  assert.equal(a.messages[0].to,'alice@example.invalid');
  assert.equal(a.messages[0].id,hash(JSON.stringify(['alice@example.invalid','alice 자료 요청','샘플 — 2026-10-20'])));
  h.setCaller('bob'); const b=h.preview();
  assert.equal(b.messages[0].to,'bob@example.invalid');
  assert.throws(()=>h.call('hpsSharedPreview',{spreadsheetId:'sheet-alice-00000',range:'A1:D21'}),/GOOGLE_REQUEST_FAILED/);
  assert.throws(()=>h.send(a),/STALE_PREVIEW/);
  assert.equal(h.call('hpsSharedGetSendStatus',{ids:[a.messages[0].id]}).result.records[0].status,'not_attempted');
  h.setCaller('alice');
  assert.throws(()=>h.call('hpsSharedPreview',{spreadsheetId:'sheet-bob-00000',range:'A1:D21'}),/GOOGLE_REQUEST_FAILED/);
  assert.equal(h.send(a).records[0].status,'sent');
  h.setCaller('bob');
  assert.equal(h.call('hpsSharedGetSendStatus',{ids:[a.messages[0].id]}).result.records[0].status,'not_attempted');
});

test('identity, allowlist, release and recipe mismatches fail before data access or writes', () => {
  const h=harness();
  assert.throws(()=>h.preview({accountId:hash('bob')}),/CALLER_NOT_ALLOWED/);
  h.setCaller('owner'); assert.throws(()=>h.preview(),/CALLER_NOT_ALLOWED/); h.setCaller('alice');
  assert.throws(()=>h.preview({releaseId:'other-release'}),/RUNNER_BINDING_MISMATCH/);
  assert.throws(()=>h.preview({recipeDigest:'0'.repeat(64)}),/RECIPE_DIGEST_MISMATCH/);
  assert.throws(()=>h.preview({recipe:{...recipe,execute:'sendEverything()'}}),/INVALID_RECIPE/);
  assert.throws(()=>h.preview({recipe:{...recipe,bodyTemplate:'{{arbitraryCode}}'}}),/INVALID_RECIPE/);
  assert.throws(()=>h.preview({recipe:{...recipe,subjectTemplate:'bad\r\nHeader: injected'}}),/INVALID_RECIPE/);
  h.script.set('HPS_SHARED_ALLOWED_SUB_SHA256','[]'); assert.throws(()=>h.preview(),/RUNNER_NOT_CONFIGURED/);
  assert.equal(h.users.size,0);
  assert.ok(h.calls.every(c=>c.url.includes('userinfo')));
});

test('unordered recipe maps retain digest; exact approval binds messages, recipe and expiry', () => {
  const h=harness(), reordered=Object.fromEntries(Object.entries(recipe).reverse());
  reordered.columns=Object.fromEntries(Object.entries(recipe.columns).reverse());
  const p=h.preview({recipe:reordered});
  assert.throws(()=>h.call('hpsSharedSendApproved',{approved:false,previewId:p.id,messages:p.messages}),/APPROVAL_REQUIRED/);
  const tampered=structuredClone(p); tampered.messages[0].body='different'; tampered.messages[0].id=hash(JSON.stringify([tampered.messages[0].to,tampered.messages[0].subject,tampered.messages[0].body]));
  assert.throws(()=>h.send(tampered),/STALE_PREVIEW/);
  assert.throws(()=>h.send(p,{recipe:{...recipe,title:'new recipe'}}),/STALE_PREVIEW/);
  h.advance(1800001); assert.throws(()=>h.send(p),/STALE_PREVIEW/);
  assert.equal(h.calls.filter(c=>c.url.includes('/messages/send')).length,0);
});

test('successful approval cannot cause duplicate mail even after a fresh preview or release update', () => {
  const h=harness(), p=h.preview();
  assert.equal(h.send(p).records[0].status,'sent');
  assert.equal(h.send(p).records[0].status,'sent');
  const fresh=h.preview(); assert.equal(h.send(fresh).records[0].status,'sent');
  // Version-independent ledger survives deployment updates in the same script project.
  const revised=source.replaceAll(releaseId,'hps-email-20261014-v2').replace(/const /g,'var ');
  const context2=vm.createContext({...h.context}); vm.runInContext(revised,context2);
  const envelope={protocol:'hps-email-v1',releaseId:'hps-email-20261014-v2',accountId:hash('alice'),recipe,recipeDigest:hash(JSON.stringify(recipe)),payload:{spreadsheetId:'sheet-alice-00000',range:'A1:D21'}};
  const next=context2.hpsSharedPreview(envelope).result;
  envelope.payload={approved:true,previewId:next.id,messages:next.messages};
  assert.equal(context2.hpsSharedSendApproved(envelope).result.records[0].status,'sent');
  assert.equal(h.calls.filter(c=>c.url.includes('/messages/send')).length,1);
});

test('ambiguous provider result remains unknown and is never retried or cleared', () => {
  const h=harness(), p=h.preview(); h.setFailure(true);
  assert.equal(h.send(p).records[0].status,'unknown');
  h.setFailure(false);
  assert.equal(h.send(p).records[0].status,'unknown');
  assert.equal(h.send(h.preview()).records[0].status,'unknown');
  assert.equal(h.call('hpsSharedGetSendStatus',{ids:[p.messages[0].id]}).result.records[0].status,'unknown');
  assert.equal(h.calls.filter(c=>c.url.includes('/messages/send')).length,1);
});

test('capacity preserves existing ledger and refuses new delivery', () => {
  const h=harness(), p=h.preview();
  for(let i=0;i<2000;i++)h.state().set(`hps.sent.${i}`,'unknown');
  assert.throws(()=>h.send(p),/LEDGER_CAPACITY/);
  assert.equal(h.state().get('hps.sent.0'),'unknown');
  assert.equal(h.calls.filter(c=>c.url.includes('/messages/send')).length,0);
});
