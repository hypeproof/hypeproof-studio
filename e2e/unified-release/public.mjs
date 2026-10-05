#!/usr/bin/env node
// Candidate App against the current public Service, trial and classroom.
//
// Credentials (#1404). Static codes do not survive a second release: a trial
// code's one-hour window and request allowance start on first use and a reissue
// to the same handle does not reset them, and a classroom code needs an open
// session. So every run mints its own, on the synthetic acceptance cohort
// (worker/src/profiles/synthetic-release-acceptance.ts):
//   1. a fresh `synthetic-` handle per run and platform → a fresh trial allowance
//   2. POST session/open → a short session + the classroom code
//   3. POST tokens/issue native_trial → the trial code for the same handle
//   4. finally: revoke the trial grant, close the session (revokes the classroom
//      code). A session a hard kill leaves behind blocks nothing: the
//      live-session freeze ignores this cohort because the worker reports it
//      as synthetic, and the next run replaces it.
// Auth, either one (same order as scripts/run-sdk-contract.sh):
//   HPS_ACCEPTANCE_ISSUER  preferred: issuer scoped to ONLY this cohort/profile
//                          with can_start_session and max_session_hours >= 1
//   HPS_ADMIN_PASSWORD     fallback: the admin secret the freeze already uses,
//                          so no new long-lived secret is required
// With neither set, HPS_ACCEPTANCE_TRIAL_CODE / HPS_ACCEPTANCE_CLASSROOM_CODE
// are still read (the pre-#1404 path, single-use per release).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {appIdentity,treeHash} from './artifact.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [app,output,sha,version]=process.argv.slice(2);
const base='https://api.hypeproof-ai.xyz/v1';
const service=base.replace(/\/v1$/,'');
const COHORT='synthetic-release-acceptance',PROFILE=COHORT;
const auth=process.env.HPS_ACCEPTANCE_ISSUER?'Bearer '+process.env.HPS_ACCEPTANCE_ISSUER
 :process.env.HPS_ADMIN_PASSWORD?'Basic '+Buffer.from(':'+process.env.HPS_ADMIN_PASSWORD).toString('base64'):null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// KV is eventually consistent: a session or roster entry written a moment ago
// can read as missing (run-sdk-contract.sh measured ~1-2 s, 2026-09-10). Retry
// only that answer, 403, for at most 20 s; anything else is the real result.
async function settle(request){
 let response;
 for(let attempt=0;attempt<20;attempt++){response=await request();if(response.status!==403)break;await sleep(1000);}
 return response;
}
async function admin(method,route,body){
 const response=await settle(()=>fetch(service+'/admin'+route,{method,headers:{authorization:auth,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)}));
 const json=await response.json().catch(()=>null);
 if(!response.ok)throw Error('BLOCKED: '+method+' /admin'+route+' -> '+response.status+(json?.code||json?.error?' '+(json.code??json.error):''));
 return json;
}
let temp,user,opened,trialMinted=false;
try{
 const identity=appIdentity(app),before=treeHash(app);
 if(identity.sha!==sha||identity.version!==version)throw Error('Wrong candidate identity');
 const health=await fetch(base+'/health',{signal:AbortSignal.timeout(15000)});
 if(!health.ok)throw Error('Public Service health failed');
 const initial=await health.json();
 if(!initial.version||initial.version==='unknown')throw Error('Unidentified public Service');
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'hps-public-acceptance-'));
 const codes={};
 if(auth){
  user=('synthetic-acceptance-'+process.platform+'-'+Date.now().toString(36)+'-'+randomUUID().slice(0,8)).slice(0,64);
  // force:true replaces a session a killed run left behind. Safe on THIS cohort
  // only: the worker refuses every non-synthetic handle on its roster.
  opened=await admin('POST','/cohorts/'+COHORT+'/session/open',{profile_id:PROFILE,user,session_hours:1,token_hours:1,force:true});
  codes.classroom=opened.token;
  codes.trial=(await admin('POST','/tokens/issue',{u:user,c:COHORT,p:PROFILE,hours:1,native_trial:true})).token;
  trialMinted=true;
 }else{
  codes.trial=process.env.HPS_ACCEPTANCE_TRIAL_CODE;codes.classroom=process.env.HPS_ACCEPTANCE_CLASSROOM_CODE;
 }
 const activities=[];
 for(const kind of ['trial','classroom']){
  const credential=codes[kind];
  if(!credential)throw Error('BLOCKED: no acceptance credential (set HPS_ACCEPTANCE_ISSUER or HPS_ADMIN_PASSWORD) and no static '+kind+' code');
  const response=await settle(()=>fetch(base+'/profile',{headers:{authorization:'Bearer '+credential},signal:AbortSignal.timeout(15000)}));
  if(!response.ok)throw Error(kind+' public profile rejected: '+response.status);
  const profile=await response.json();
  if(profile.activity_kind!==kind||!profile.activity_id)throw Error('Wrong activity kind or public Service predates activity binding');
  if(auth&&profile.profile_id!==PROFILE)throw Error(kind+' code served '+profile.profile_id+', not the synthetic acceptance profile');
  const evidence=path.resolve(output,kind);fs.mkdirSync(evidence,{recursive:true});
  const token=path.join(temp,kind);fs.writeFileSync(token,credential,{mode:0o600});
  const env={...process.env,HPS_APP_PATH:path.resolve(app),HPS_E2E_TOKEN_FILE:token,HPS_E2E_PROXY_URL:base,HPS_PUBLIC_ACTIVITY:'1',HPS_NATIVE_MANAGED:kind==='trial'?'1':'0',HPS_NATIVE_EVIDENCE_DIR:evidence,HPS_QUIET_NO_HIDE:'1'};
  for(const name of Object.keys(env))if(/API_KEY|ADMIN_PASSWORD|ISSUER|TOKEN$|_CODE$/.test(name))delete env[name];
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--config=native-trial.config.ts','--workers=1','--retries=0'],{cwd:path.join(root,'e2e'),env,stdio:'inherit'});
   child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(kind+' public App check failed')));
  });
  const result=JSON.parse(fs.readFileSync(path.join(evidence,'public-activity.json'),'utf8'));
  if(result.status!=='PASS'||!result.created||!result.revised||!result.originalPreserved)throw Error('Incomplete public acceptance');
  activities.push({kind,status:'PASS',fileOperations:true,profileId:profile.profile_id});
 }
 const after=await fetch(base+'/health',{signal:AbortSignal.timeout(15000)});
 if(!after.ok||(await after.json()).version!==initial.version||treeHash(app)!==before)throw Error('Service or App changed during acceptance');
 const receiptPath=path.join(output,'../receipt.json'),receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
 receipt.publicService={base,version:initial.version,status:'PASS',credentials:auth?'per-run-synthetic':'static-codes',activities};
 fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 if(temp)fs.rmSync(temp,{recursive:true,force:true});
 // Cleanup failures are reported, never turned into an acceptance failure: the
 // codes expire within the hour and the freeze ignores this cohort's session.
 if(trialMinted)await admin('DELETE','/cohorts/'+COHORT+'/native-trials/'+user).catch(error=>console.error('trial grant not revoked: '+error.message));
 if(opened)await admin('POST','/cohorts/'+COHORT+'/session/close',{jti:opened.jti,exp:opened.exp}).catch(error=>console.error('acceptance session not closed: '+error.message));
}
