// S3. A fresh synthetic classroom token must resolve to the acceptance profile.
// Never replace an existing session or fall back to the admin password.
import {randomUUID} from 'node:crypto';
import {withReleaseSeat} from '../../../../e2e/unified-release/controlled-seat.mjs';
const COHORT = 'synthetic-release-acceptance';

export async function checkCohort({env, serviceUrl, controlled,verification,budget,fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms))}) {
  if(controlled){
    if(!budget||!verification)throw Error('BLOCKED: scoped smoke budget/context unavailable');
    const identity=JSON.parse((await import('node:fs')).readFileSync(env.HPS_ENGINE_IDENTITY_FILE,'utf8')).identity;
    const result=await withReleaseSeat({purpose:'public-classroom',pins:{candidateSha:identity.sourceSha,serviceSha:verification.serviceSha,testRevision:verification.testRevision},env,beforeEffect:budget.permit,fetchImpl},async seat=>{
      const response=await fetchImpl('https://api.hypeproof-ai.xyz/v1/profile',{headers:{authorization:'Bearer '+seat.token},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('BLOCKED: owned classroom profile rejected');const profile=await response.json();
      if(profile.profile_id!==seat.profile||profile.activity_kind!=='classroom'||profile.activity_id!==seat.activityId)throw Error('BLOCKED: owned classroom activity binding changed');return {profileId:profile.profile_id,activityId:profile.activity_id};
    });return {result:'PASS',detail:'owned synthetic classroom authenticated, rostered and active with remaining allowance; cleanup confirmed',seat:result.seat,cleanup:result.cleanup};
  }
  if (!env.HPS_ACCEPTANCE_ISSUER) return {result: 'NOT_RUN', detail: 'no credential (HPS_ACCEPTANCE_ISSUER); provision the synthetic acceptance cohort scope'};
  const base = serviceUrl.replace(/\/$/, '');
  const user = `synthetic-smoke-${randomUUID()}`;
  let opened, failure;
  async function request(route, auth, body) {
    let response;
    try {
      response = await fetchImpl(base + route, {
        method: body ? 'POST' : 'GET',
        headers: {authorization: `Bearer ${auth}`, ...(body ? {'content-type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw Error(`${route}: transport failed`); } // Do not print credentials or response bodies.
    return response;
  }
  try {
    const response = await request(`/admin/cohorts/${COHORT}/session/open`, env.HPS_ACCEPTANCE_ISSUER,
      {profile_id: COHORT, user, session_hours: 1, token_hours: 1, force: false});
    if (!response.ok) throw Error(`session/open: HTTP ${response.status}`);
    opened = await response.json();
    if (!opened.token || !opened.jti || !Number.isFinite(opened.exp) || opened.cohort !== COHORT || opened.profile !== COHORT || opened.user !== user) {
      throw Error('session/open: wrong or incomplete synthetic identity');
    }
    let profile;
    // Match public acceptance's bounded KV propagation retry, only for 403.
    for (let attempt = 0; attempt < 20; attempt++) {
      profile = await request('/v1/profile', opened.token);
      if (profile.status !== 403 || attempt === 19) break;
      await sleep(1000);
    }
    if (!profile.ok) throw Error(`profile: HTTP ${profile.status}`);
    const value = await profile.json();
    if (value.profile_id !== COHORT || value.activity_kind !== 'classroom' || !value.activity_id) throw Error('profile: wrong synthetic activity binding');
  } catch (error) {
    failure = error instanceof SyntaxError ? 'invalid JSON response' : error.message;
  } finally {
    if (opened) {
      try {
        const response = await request(`/admin/cohorts/${COHORT}/session/close`, env.HPS_ACCEPTANCE_ISSUER,
          {jti: opened.jti, exp: opened.exp});
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const closed = await response.json();
        if (!closed.ok || !opened.jti || closed.revoked !== opened.jti || closed.distribute_fenced === false) throw Error('revocation not confirmed');
      } catch { failure = `${failure ? failure + '; ' : ''}synthetic session cleanup failed`; }
    }
  }
  return failure ? {result: 'FAIL', detail: failure}
    : {result: 'PASS', detail: 'synthetic classroom token resolved to its profile; session closed and token revoked'};
}

export default {
  id: 'S3',
  name: 'Token -> cohort',
  run: checkCohort,
};
