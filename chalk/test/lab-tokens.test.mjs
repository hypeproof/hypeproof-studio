import assert from 'node:assert/strict';
import {test} from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import {labTokens} from '../src/routes/lab-tokens.ts';
import smoke from '../../scripts/release/smoke/checks/s6-chalk-lab-tokens.mjs';

const request = (auth = 'Bearer synthetic-issuer') => new Request('https://chalk.test/cohorts/class-one/lab-tokens', {
  headers: {authorization: auth, cookie: 'not-forwarded', 'cf-access-authenticated-user-email': 'forged@example.test'},
});
const fixture = {board: {code: 'NAMED2', cohort: 'class-one', profile: 'profile-one',
  students: [{handle: 'student-one', token: 'synthetic-student-token', claimedBy: 'Student One'}]}};

test('production uses only the fixed Lab origin, Bearer and bounded read; failures stay failures', async () => {
  const previous = globalThis.fetch;
  try {
    for (const status of [200, 401, 403, 502]) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://hypeproof-ai.xyz/api/workshop/boa-room/instructor?cohort=class-one');
        assert.deepEqual(init.headers, {authorization: 'Bearer synthetic-issuer'});
        assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
        return Response.json(status === 200 ? fixture : {error: 'denied'}, {status});
      };
      const response = await labTokens.fetch(request(), {ENVIRONMENT: 'production', HPS_LAB_ORIGIN: 'https://untrusted.test'});
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), status === 200 ? fixture : {error: 'denied'});
    }
  } finally {globalThis.fetch = previous;}
});

test('rejects missing/Basic credentials before transport, and refuses redirect/network failures', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = () => {throw new Error('must not fetch');};
    for (const auth of ['', 'Basic synthetic']) assert.equal((await labTokens.fetch(request(auth), {})).status, 401);
    globalThis.fetch = async () => new Response(null, {status: 302, headers: {location: 'https://untrusted.test'}});
    assert.equal((await labTokens.fetch(request(), {})).status, 502);
    globalThis.fetch = async () => {throw new Error('network');};
    assert.equal((await labTokens.fetch(request(), {})).status, 502);
  } finally {globalThis.fetch = previous;}
});

test('read-only release smoke compares credentials without putting them in reports', async () => {
  const previous = globalThis.fetch;
  try {
    assert.equal((await smoke.run({env: {}, chalkUrl: 'https://chalk.test'})).result, 'NOT_RUN');
    globalThis.fetch = async () => Response.json(fixture);
    const report = await smoke.run({env: {HPS_LAB_TOKEN_READ_ISSUER: 'synthetic-issuer', HPS_LAB_TOKEN_READ_COHORT: 'class-one'}, chalkUrl: 'https://chalk.test'});
    assert.equal(report.result, 'PASS'); assert.ok(!JSON.stringify(report).includes('synthetic-'));
    globalThis.fetch = async () => Response.json({error: 'denied'}, {status: 403});
    assert.equal((await smoke.run({env: {HPS_LAB_TOKEN_READ_ISSUER: 'synthetic-issuer', HPS_LAB_TOKEN_READ_COHORT: 'class-one'}, chalkUrl: 'https://chalk.test'})).result, 'FAIL');
  } finally {globalThis.fetch = previous;}
});

const releaseId = '11111111-2222-4333-8444-555555555555', releaseCohort = 'release-test-' + releaseId, releaseProfile = 'synthetic-release-acceptance';
const ownerKey = 'a'.repeat(64);
const ownedBoard = () => ({schema:'hps-release-board-input/1',seatId:releaseId,scope:{parentCohort:releaseProfile,purpose:'classroom'},run:{repositoryId:1239447574,runId:9,runAttempt:1},expiresAt:new Date(Date.now()+60000).toISOString(),board:{code:releaseId,cohort:releaseCohort,profile:releaseProfile,students:[{handle:'synthetic-'+releaseId,token:'synthetic-owned-token',claimedBy:'synthetic-'+releaseId}]},comparison:'NOT_OBSERVED'});
const ownedRequest = (cohort=releaseCohort,profile=releaseProfile,key=ownerKey) => new Request(`https://chalk.test/cohorts/${cohort}/lab-tokens?profile=${profile}`,{headers:{authorization:'Bearer synthetic-issuer','x-hps-release-seat-key':key,cookie:'must-not-forward','cf-access-authenticated-user-email':'forged@example.test'}});

test('controlled synthetic view uses the actual Chalk-to-Lab path with exact profile and private ownership key',async()=>{
 const prior=globalThis.fetch;try{const body=ownedBoard();let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,`https://hypeproof-ai.xyz/api/workshop/boa-room/instructor?cohort=${releaseCohort}&profile=${releaseProfile}`);assert.deepEqual(init.headers,{authorization:'Bearer synthetic-issuer','x-hps-release-seat-key':ownerKey});assert.equal(init.method,'GET');assert.equal(init.redirect,'error');return Response.json(body);};
 const response=await labTokens.fetch(ownedRequest(),{ENVIRONMENT:'dev',HPS_LAB_ORIGIN:'https://untrusted.test'});assert.equal(response.status,200);assert.deepEqual(await response.json(),body);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(calls,1);
 }finally{globalThis.fetch=prior;}
});
test('controlled view cannot fall back to existing cohorts or omit explicit profile/ownership',async()=>{
 const prior=globalThis.fetch;try{globalThis.fetch=()=>{throw Error('unexpected transport');};
 for(const req of [ownedRequest('existing-live-cohort'),ownedRequest(releaseCohort,''),ownedRequest(releaseCohort,releaseProfile,''),ownedRequest('release-test-invalid'),ownedRequest(releaseCohort,'unscoped-profile')])assert([400,401].includes((await labTokens.fetch(req,{})).status));
 }finally{globalThis.fetch=prior;}
});
test('controlled view retains denied/stale/mismatched reads as failures and never fetches another board',async()=>{
 const prior=globalThis.fetch;try{
 for(const status of [401,403,404,409,410,503]){let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'denied',token:'must-not-echo'},{status});};const response=await labTokens.fetch(ownedRequest(),{});assert.equal(response.status,status);assert(!JSON.stringify(await response.json()).includes('must-not-echo'));assert.equal(calls,1);}
 for(const mode of ['profile','owner','expired','comparison','oversized','redirect']){let calls=0;globalThis.fetch=async()=>{calls++;const body=ownedBoard();if(mode==='profile')body.board.profile='wrong';if(mode==='owner')body.board.students[0].claimedBy='someone-else';if(mode==='expired')body.expiresAt=new Date(Date.now()-1000).toISOString();if(mode==='comparison')body.comparison='PASS';if(mode==='oversized')return new Response('x'.repeat(65537));if(mode==='redirect')return new Response(null,{status:302});return Response.json(body);};assert.equal((await labTokens.fetch(ownedRequest(),{})).status,502);assert.equal(calls,1);}
 }finally{globalThis.fetch=prior;}
});
