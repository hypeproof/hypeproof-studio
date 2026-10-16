// Read-only dependency smoke. Credentials and token hashes never enter the report.
import {createHash} from 'node:crypto';
export default {
  id: 'S6', name: 'Chalk Lab tokens',
  async run({env, chalkUrl}) {
    const issuer = env.HPS_LAB_TOKEN_READ_ISSUER, cohort = env.HPS_LAB_TOKEN_READ_COHORT;
    if (!issuer || !cohort) return {result: 'NOT_RUN', detail: 'no scoped Lab-board read fixture configured'};
    const lab = env.HPS_LAB_TOKEN_READ_URL || 'https://hypeproof-ai.xyz';
    const urls = [`${lab}/api/workshop/boa-room/instructor?cohort=${encodeURIComponent(cohort)}`,
      `${chalkUrl}/admin/cohorts/${encodeURIComponent(cohort)}/lab-tokens`];
    const boards = [];
    try {
      for (const url of urls) {
        const response = await fetch(url, {headers: {authorization: `Bearer ${issuer}`}, redirect: 'manual', signal: AbortSignal.timeout(15000)});
        if (!response.ok) return {result: 'FAIL', detail: `credential read refused: HTTP ${response.status}`};
        boards.push((await response.json()).board);
      }
      if (boards.some(b => !b || !Array.isArray(b.students) || !b.students.length)) {
        return {result: 'NOT_RUN', detail: 'no current distribution credentials to compare'};
      }
      const fingerprint = b => createHash('sha256').update(JSON.stringify({code: b.code, cohort: b.cohort, profile: b.profile,
        students: b.students.map(s => ({handle: s.handle, token: s.token, claimedBy: s.claimedBy})).sort((a, b) => a.handle.localeCompare(b.handle))})).digest('hex');
      if (boards.some(b => b.cohort !== cohort || b.students.some(s => typeof s.token !== 'string' || !s.token))) {
        return {result: 'FAIL', detail: 'invalid scoped token-read contract'};
      }
      return fingerprint(boards[0]) === fingerprint(boards[1])
        ? {result: 'PASS', detail: `matching current board: ${boards[0].students.length} student credentials`}
        : {result: 'FAIL', detail: 'Lab and Chalk current boards differ'};
    } catch { return {result: 'FAIL', detail: 'Lab/Chalk token-read dependency unavailable'}; }
  },
};
