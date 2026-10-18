// Test-only canonical session shutdown. Never accepts a deployed or arbitrary Service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {classifyProfileFailure} from '../../extensions/hypeproof-chat/src/proxyClientHelpers.ts';
import {loopback,sha256} from './safety.mjs';
export const fixtureSha=()=>sha256(fileURLToPath(new URL('./service.mjs',import.meta.url)));
export async function openSyntheticControl({manifestFile,origin,expectedSource,onSecret=()=>{},onProgress=()=>{},request=fetch}){
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),control=manifest.session_control;
 assert.equal(loopback(origin),origin,'Explicit loopback origin only');
 assert.equal(manifest.origin,origin,'Manifest must identify this endpoint');
 assert.equal(manifest.evidence_level,'synthetic-local-Service-not-production');
 assert.equal(expectedSource?.repository,'hypeproof/hypeproof-service');
 assert(/^[a-f0-9]{40}$/.test(expectedSource.sha)&&/^[a-f0-9]{64}$/.test(expectedSource.sha256)&&expectedSource.dirty===false,'Exact clean Service source receipt required');
 assert(isDeepStrictEqual(manifest.source,expectedSource),'Source receipt must match preflight');
 assert.equal(control?.schema,'hps-feedback-native-session-control/1');
 assert.equal(control.cohort,'synthetic-release-acceptance');
 assert.equal(control.fixture_sha256,fixtureSha(),'Only the current actual-source metadata fixture may be mutated');
 assert(/^[a-f0-9]{64}$/.test(control.instance),'Private fixture instance identity required');
 assert(Number.isInteger(control.pid)&&control.pid>0,'Owned fixture process required');
 const secretFile=path.join(path.dirname(manifestFile),'admin-control');
 assert.equal(control.admin_file,secretFile,'Admin secret must be the fixture-local private file');
 assert(!fs.lstatSync(secretFile).isSymbolicLink()&&fs.statSync(secretFile).isFile());
 assert.equal(sha256(secretFile),control.admin_sha256,'Private fixture credential changed');
 const secret=fs.readFileSync(secretFile,'utf8');assert(secret.length>0);onSecret(secret);
 const call=(route,options={})=>request(origin+route,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
 const identityResponse=await call('/__feedback-native/identity');assert.equal(identityResponse.status,200,'Owned fixture attestation unavailable');
 assert(isDeepStrictEqual(await identityResponse.json(),{schema:control.schema,instance:control.instance,pid:control.pid,fixture_sha256:control.fixture_sha256,source_sha:expectedSource.sha,cohort:control.cohort,provider_called:false,...(manifest.scripted?{scripted_origin:manifest.scripted.origin,scripted_mode:manifest.scripted.mode,scripted_module_sha256:manifest.scripted.source_sha256}:{})}),'Do not mutate a stale or different listener');
 onProgress({phase:'owned_fixture_identity_verified',source_sha:expectedSource.sha,fixture_sha256:control.fixture_sha256});
 return {manifest,control,secret,call};
}
export async function endSyntheticSession(options){
 const {token,onProgress=()=>{},expectedSource}=options;
 const {control,call,secret}=await openSyntheticControl(options);
 const auth={authorization:'Bearer '+token};
 assert.equal((await call('/v1/profile',{headers:auth})).status,200,'Existing A credential must be valid before session shutdown');
 onProgress({phase:'existing_a_profile_validated',status:200});
 onProgress({phase:'canonical_session_shutdown_requested',method:'DELETE',cohort:control.cohort});
 const ended=await call('/admin/cohorts/'+control.cohort+'/session',{method:'DELETE',headers:{authorization:'Basic '+Buffer.from('admin:'+secret).toString('base64')}});
 assert.equal(ended.status,200,'Canonical synthetic session shutdown failed; no retry');
 onProgress({phase:'canonical_session_shutdown_response',status:ended.status});
 const receipt=await ended.json();assert.equal(receipt.ok,true);assert(receipt.ended?.session_id,'An actual existing session must have ended');
 const denied=await call('/v1/profile',{headers:auth});assert.equal(denied.status,403,'Existing A token must be denied after canonical session shutdown');
 const error=(await denied.json()).error;assert.equal(error?.type,'session_inactive');assert(typeof error.message==='string'&&error.message.length>0);
 const uiFailure=classifyProfileFailure(denied.status,JSON.stringify({error}));
 assert.equal(uiFailure.reason,'forbidden','Current App must classify the actual profile denial');
 onProgress({phase:'existing_a_profile_denied',status:403,error_type:error.type});
 return {session_ended:true,jwt_expiry:'NOT_RUN',canonical_delete_status:200,profile_after_status:403,error_type:error.type,friendly:error.message,ui_friendly:uiFailure.friendly,ui_failure_reason:uiFailure.reason,source_sha:expectedSource.sha,fixture_sha256:control.fixture_sha256,provider_dispatch:false};
}

export async function scriptedState(options){
 const {manifest}=await openSyntheticControl(options);assert.equal(manifest.scripted?.schema,'hps-native-scripted-upstream/1');
 const origin=loopback(manifest.scripted.origin);assert.equal(origin,manifest.scripted.origin);
 return (await fetch(origin+'/__scripted/state',{redirect:'error',signal:AbortSignal.timeout(5000)})).json();
}
export async function releaseScriptedTurn(options,name){
 assert(['STOP_HOLD','QUIT_HOLD','FILE_HOLD'].includes(name));
 const {manifest,secret}=await openSyntheticControl(options);assert.equal(manifest.scripted?.schema,'hps-native-scripted-upstream/1');
 const origin=loopback(manifest.scripted.origin);assert.equal(origin,manifest.scripted.origin);
 const response=await fetch(origin+'/__scripted/release',{method:'POST',headers:{'x-hps-native-control':secret},body:JSON.stringify({name}),redirect:'error',signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,200,'Explicit owned fixture cleanup failed; not cancellation evidence');return {cleanup_only:true};
}
export async function revokeSyntheticB(options){
 const {manifest,control,secret,call}=await openSyntheticControl(options),file=path.join(path.dirname(options.manifestFile),'token-b');
 assert.equal(manifest.token_b_file,file);const token=fs.readFileSync(file,'utf8');options.onSecret?.(token);
 const auth={authorization:'Bearer '+token};assert.equal((await call('/v1/profile',{headers:auth})).status,200);
 const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString('utf8'));
 assert.equal(payload.c,control.cohort);assert.equal(payload.u,'synthetic-feedback-B');assert(/^[a-f0-9-]{36}$/.test(payload.jti));
 const response=await call('/admin/tokens/revoke',{method:'POST',headers:{authorization:'Basic '+Buffer.from('admin:'+secret).toString('base64'),'content-type':'application/json'},body:JSON.stringify({jti:payload.jti,cohort:control.cohort,exp:payload.exp,reason:'synthetic native invalid-credential check'})});assert.equal(response.status,200);
 const denied=await call('/v1/profile',{headers:auth});assert.equal(denied.status,401);const error=(await denied.json()).error;assert.equal(error.code,'revoked');
 return {before:200,after:401,error_code:'revoked',ui_friendly:classifyProfileFailure(401,JSON.stringify({error})).friendly,provider_called:false};
}
