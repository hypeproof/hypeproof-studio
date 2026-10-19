// S4. Chat API, via the existing canary contract (scripts/run-sdk-contract.sh):
// open a short session on the canary cohort, run the SDK request-shape test, close it.
// Only the cohort-scoped canary issuer is used here; the admin password is never handed to smoke.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {withReleaseSeat} from '../../../../e2e/unified-release/controlled-seat.mjs';

export default {
  id: 'S4',
  name: 'Chat API',
  async run({env, studioDir, serviceUrl,controlled,verification,budget,fetchImpl=fetch,spawnImpl=spawnSync}) {
    if(controlled){
      if(!verification||!budget)throw Error('BLOCKED: SDK smoke context/budget missing');
      const identity=JSON.parse(fs.readFileSync(env.HPS_ENGINE_IDENTITY_FILE,'utf8')).identity;
      const observed=await withReleaseSeat({purpose:'sdk-contract',pins:{candidateSha:identity.sourceSha,serviceSha:verification.serviceSha,testRevision:verification.testRevision},env,beforeEffect:budget.permit,fetchImpl},async seat=>{
        budget.permit();const childEnv={...env};for(const key of Object.keys(childEnv))if(/KEY|SECRET|ISSUER|PASSWORD|TOKEN|_CODE$/.test(key))delete childEnv[key];delete childEnv.NODE_OPTIONS;
        Object.assign(childEnv,{TOKEN:seat.token,WORKER_URL:'https://api.hypeproof-ai.xyz/v1',HPS_CONTROLLED_SDK_SMOKE:'1',HPS_SMOKE_BUDGET_DEADLINE:String(budget.deadline)});
        const run=spawnImpl(process.execPath,['--import',path.join(studioDir,'scripts/release/smoke/budget-preload.mjs'),'--test',path.join(studioDir,'tests/rehearsal/07-sdk-request-shape.test.mjs')],{cwd:studioDir,env:childEnv,encoding:'utf8',timeout:5*60*1000});
        const text=String(run.stdout??'')+String(run.stderr??'');if(run.status!==0||!(/\btests\s+6\b/.test(text)&&/\bpass\s+6\b/.test(text)&&/\bskipped\s+0\b/.test(text)))throw Error('BLOCKED: actual six SDK request-shape probes did not all complete');return {tests:6,maxRequests:6,maxOutputTokens:64};
      });return {result:'PASS',detail:'six existing SDK-shape probes passed on owned scoped seat; request/output ceilings and cleanup confirmed',seat:observed.seat,cleanup:observed.cleanup,requestShape:observed.result};
    }
    if (!env.HPS_CANARY_ISSUER) {
      return {result: 'NOT_RUN', detail: 'no credential (HPS_CANARY_ISSUER)'};
    }
    const {HPS_ADMIN_PASSWORD: _dropped, ...scoped} = env;
    const run = spawnSync('bash', [path.join(studioDir, 'scripts/run-sdk-contract.sh')], {
      cwd: studioDir, env: {...scoped, PROD: serviceUrl}, encoding: 'utf8', timeout: 5 * 60 * 1000,
    });
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').at(-1) ?? '';
    if (run.status === 0) return {result: 'PASS', detail: tail};
    return {result: 'FAIL', detail: `exit ${run.status}: ${tail}`};
  },
};
