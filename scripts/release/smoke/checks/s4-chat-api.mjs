// S4. Chat API, via the existing canary contract (scripts/run-sdk-contract.sh):
// open a short session on the canary cohort, run the SDK request-shape test, close it.
// Only the cohort-scoped canary issuer is used here; the admin password is never handed to smoke.
import {spawnSync} from 'node:child_process';
import path from 'node:path';

export default {
  id: 'S4',
  name: 'Chat API',
  async run({env, studioDir, serviceUrl}) {
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
