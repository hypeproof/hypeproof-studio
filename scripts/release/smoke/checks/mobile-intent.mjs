// Optional, scoped smoke check. Does not register itself in the desktop RC suite.
// The test install identity must persist so reruns cannot reset the free allowance.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
export default {
  id:'MOBILE-INTENT',name:'Standalone mobile intent admission and chat',
  async run({env,studioDir}){
    if(!env.HP_MOBILE_TEST_INSTALL_ID)return {result:'NOT_RUN',detail:'No persistent mobile test install identity supplied.'};
    const run=spawnSync(process.execPath,[path.join(studioDir,'apps/studio-mobile/test/live-smoke.mjs')],{env,encoding:'utf8',timeout:90000});
    return {result:run.status===0?'PASS':'FAIL',detail:(run.stdout||run.stderr||'No output').trim()};
  },
};
