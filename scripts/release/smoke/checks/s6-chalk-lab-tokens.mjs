// Read-only dependency smoke. Credentials and token hashes never enter the report.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {withReleaseSeat} from '../../../../e2e/unified-release/controlled-seat.mjs';
export function validBoard(board,{cohort,profile}={}){
 if(!board||board.cohort!==cohort||typeof board.profile!=='string'||!board.profile||(profile&&board.profile!==profile)||typeof board.code!=='string'||!board.code||!Array.isArray(board.students)||!board.students.length)return false;
 const handles=new Set(),tokens=new Set();return board.students.every(student=>{if(!student||typeof student.handle!=='string'||!student.handle||typeof student.token!=='string'||!student.token||!Object.hasOwn(student,'claimedBy')||(student.claimedBy!==null&&(typeof student.claimedBy!=='string'||!student.claimedBy))||handles.has(student.handle)||tokens.has(student.token))return false;handles.add(student.handle);tokens.add(student.token);return true;});
}
export default {
  id: 'S6', name: 'Chalk Lab tokens',
  async run({env, chalkUrl,controlled=false,verification,budget,ownedRead=false,fetchImpl=fetch}) {
    if(controlled){
      if(!verification||!budget)throw Error('BLOCKED: owned board comparison context/budget missing');
      const identity=JSON.parse(fs.readFileSync(env.HPS_ENGINE_IDENTITY_FILE,'utf8')).identity;
      const proof=await withReleaseSeat({purpose:'public-classroom',pins:{candidateSha:identity.sourceSha,serviceSha:verification.serviceSha,testRevision:verification.testRevision},env,beforeEffect:budget.permit,fetchImpl},async(seat,{ownershipKey})=>{
        budget.permit();return this.run({env:{...env,HPS_LAB_TOKEN_READ_ISSUER:env.HPS_ACCEPTANCE_ISSUER,HPS_LAB_TOKEN_READ_COHORT:seat.cohort,HPS_LAB_TOKEN_READ_PROFILE:seat.profile,HPS_LAB_TOKEN_READ_URL:'https://hypeproof-ai.xyz'},chalkUrl:'https://chalk.hypeproof-ai.xyz',fetchImpl:async(url,options)=>fetchImpl(url,{...options,headers:{...options.headers,'x-hps-release-seat-key':ownershipKey}}),ownedRead:true});
      });return {...proof.result,seat:proof.seat,cleanup:proof.cleanup};
    }

    const issuer = env.HPS_LAB_TOKEN_READ_ISSUER, cohort = env.HPS_LAB_TOKEN_READ_COHORT;
    if (!issuer || !cohort) return {result: 'NOT_RUN', detail: 'no scoped Lab-board read fixture configured'};
    const lab = env.HPS_LAB_TOKEN_READ_URL || 'https://hypeproof-ai.xyz';
    if(ownedRead&&(!/^release-test-[a-f0-9-]{36}$/.test(cohort)||!env.HPS_LAB_TOKEN_READ_PROFILE||lab!=='https://hypeproof-ai.xyz'||chalkUrl!=='https://chalk.hypeproof-ai.xyz'))return {result:'BLOCKED',detail:'owned synthetic board scope/canonical read adapters required'};
    const urls = [`${lab}/api/workshop/boa-room/instructor?cohort=${encodeURIComponent(cohort)}&profile=${encodeURIComponent(env.HPS_LAB_TOKEN_READ_PROFILE??'')}`,
      `${chalkUrl}/admin/cohorts/${encodeURIComponent(cohort)}/lab-tokens?profile=${encodeURIComponent(env.HPS_LAB_TOKEN_READ_PROFILE??'')}`];
    const boards = [];
    try {
      for (const url of urls) {
        const response = await fetchImpl(url, {headers: {authorization: `Bearer ${issuer}`}, redirect: 'manual', signal: AbortSignal.timeout(15000)});
        if (!response.ok) return {result: ownedRead&&response.status===404?'BLOCKED':'FAIL', detail: response.status===404?'scoped Lab/Chalk board producer unavailable (source/deployment capability missing)':`credential read refused: HTTP ${response.status}`};
        boards.push((await response.json()).board);
      }
      if (boards.some(b => !b || !Array.isArray(b.students) || !b.students.length)) {
        return {result: 'NOT_RUN', detail: 'no current distribution credentials to compare'};
      }
      const fingerprint = b => createHash('sha256').update(JSON.stringify({code: b.code, cohort: b.cohort, profile: b.profile,
        students: b.students.map(s => ({handle: s.handle, token: s.token, claimedBy: s.claimedBy})).sort((a, b) => a.handle.localeCompare(b.handle))})).digest('hex');
      if (boards.some(b => !validBoard(b,{cohort,profile:env.HPS_LAB_TOKEN_READ_PROFILE}))) {
        return {result: 'FAIL', detail: 'invalid scoped token-read contract'};
      }
      return fingerprint(boards[0]) === fingerprint(boards[1])
        ? {result: 'PASS', detail: `matching current board: ${boards[0].students.length} student credentials`}
        : {result: 'FAIL', detail: 'Lab and Chalk current boards differ'};
    } catch { return {result: 'FAIL', detail: 'Lab/Chalk token-read dependency unavailable'}; }
  },
};
