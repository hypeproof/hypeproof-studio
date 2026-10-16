// Synthetic transport controls only; no application, provider or deployed Service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {endSyntheticSession,fixtureSha} from './session-control.mjs';
import {sha256} from './safety.mjs';
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-session-')),manifestFile=path.join(dir,'service.json'),secretFile=path.join(dir,'admin-control'),source={repository:'hypeproof/hypeproof-service',sha:'a'.repeat(40),sha256:'d'.repeat(64),dirty:false},origin='http://127.0.0.1:17788';
 fs.writeFileSync(secretFile,'synthetic-private-admin',{mode:0o600});
 const control={schema:'hps-feedback-native-session-control/1',cohort:'synthetic-release-acceptance',fixture_sha256:fixtureSha(),instance:'b'.repeat(64),pid:1234,admin_file:secretFile,admin_sha256:sha256(secretFile)};
 const manifest={origin,source,evidence_level:'synthetic-local-Service-not-production',session_control:control};
 const write=()=>fs.writeFileSync(manifestFile,JSON.stringify(manifest));write();
 const identity={schema:control.schema,instance:control.instance,pid:control.pid,fixture_sha256:control.fixture_sha256,source_sha:source.sha,cohort:control.cohort,provider_called:false};
 const calls=[],responses=[new Response(JSON.stringify(identity)),new Response('{}'),new Response(JSON.stringify({ok:true,ended:{session_id:'existing-synthetic-session'}})),new Response(JSON.stringify({error:{type:'session_inactive',message:'수업이 아직 시작 전이에요.'}}),{status:403})];
 const invoke=options=>endSyntheticSession({manifestFile,origin,expectedSource:source,token:'existing-synthetic-A',request:async(url,init)=>{calls.push({url,init});return responses.shift();},...options});
 return {dir,manifest,control,identity,responses,calls,write,invoke,secretFile,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('canonical owned session shutdown verifies identity and existing A before one mutation, then actual denial',async()=>{
 const f=fixture();try{const redacted=[];const result=await f.invoke({onSecret:value=>redacted.push(value)});assert.equal(result.error_type,'session_inactive');assert.equal(result.jwt_expiry,'NOT_RUN');assert.equal(result.provider_dispatch,false);assert.equal(redacted.length,1);assert.equal(f.calls.length,4);assert.equal(f.calls[2].url,'http://127.0.0.1:17788/admin/cohorts/synthetic-release-acceptance/session');assert.equal(f.calls[2].init.method,'DELETE');assert.equal(f.calls[1].init.headers.authorization,'Bearer existing-synthetic-A');assert.equal(f.calls[3].init.headers.authorization,'Bearer existing-synthetic-A');for(const c of f.calls){assert.equal(c.init.redirect,'error');assert(c.init.signal);}assert(!JSON.stringify(result).includes('synthetic-private-admin'));}finally{f.close();}
});
test('deployed target, mismatched fixture/source/secret or external origin refuse before any request',async()=>{
 for(const mutate of [f=>{f.manifest.evidence_level='production';},f=>{f.control.fixture_sha256='0'.repeat(64);},f=>{f.manifest.source={sha:'c'.repeat(40)};},f=>{f.control.cohort='real-class';},f=>{f.control.admin_file='/another/private/file';},f=>fs.writeFileSync(f.secretFile,'changed')]){const f=fixture();try{mutate(f);f.write();await assert.rejects(f.invoke());assert.equal(f.calls.length,0);}finally{f.close();}}
 const f=fixture();try{await assert.rejects(f.invoke({origin:'https://api.hypeproof-ai.xyz'}));assert.equal(f.calls.length,0);}finally{f.close();}
});
test('stale loopback listener and invalid existing A cannot receive canonical mutation',async()=>{
 for(const phase of ['identity','credential']){const f=fixture();try{if(phase==='identity')f.responses[0]=new Response(JSON.stringify({...f.identity,instance:'c'.repeat(64)}));else f.responses[1]=new Response('{}',{status:403});await assert.rejects(f.invoke());assert(!f.calls.some(c=>c.init.method==='DELETE'));}finally{f.close();}}
});
test('unknown mutation outcome is never retried and missing prior session cannot pass',async()=>{
 for(const mode of ['transport','empty-session','not-denied','wrong-denial']){const f=fixture();try{if(mode==='empty-session')f.responses[2]=new Response(JSON.stringify({ok:true,ended:null}));if(mode==='not-denied')f.responses[3]=new Response('{}');if(mode==='wrong-denial')f.responses[3]=new Response(JSON.stringify({error:{type:'auth',message:'wrong'}}),{status:403});const request=async(url,init)=>{f.calls.push({url,init});if(mode==='transport'&&init.method==='DELETE')throw Error('unknown transport outcome');return f.responses.shift();};await assert.rejects(f.invoke({request}));assert.equal(f.calls.filter(c=>c.init.method==='DELETE').length,1);}finally{f.close();}}
});
