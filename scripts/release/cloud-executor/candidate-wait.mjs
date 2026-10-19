import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {workflowApiBudget} from './workflow-api.mjs';
export async function waitForCandidate({identity,tag,temporary,env=process.env,run=execFileSync,sleep=ms=>new Promise(r=>setTimeout(r,ms)),authorize,clock}={}){
 const budget=await workflowApiBudget('candidate-wait',{identity,env,authorize,clock});const command=args=>{budget?.before();return run('gh',args,{env,encoding:'utf8',timeout:600000,maxBuffer:8388608});};
 for(let attempt=1;attempt<=150;attempt++){const raw=command(['release','view',tag,'--json','isDraft,assets']),candidate=JSON.parse(raw);if(!Array.isArray(candidate.assets)||candidate.assets.length>128)throw Error('BLOCKED: candidate asset metadata outside bounded envelope');fs.writeFileSync(path.join(temporary,'candidate.json'),raw);
  if(candidate.isDraft===false){command(['release','download',tag,'--dir',path.join(temporary,'already-published')]);run(process.execPath,['scripts/check-unified-release.mjs',path.join(temporary,'already-published'),identity.sourceSha,tag.slice(1)],{env,stdio:'inherit',timeout:600000});fs.appendFileSync(env.GITHUB_OUTPUT,'published=true\n');return;}
  const names=candidate.assets.map(a=>a.name);if(names.includes('HypeProof-Studio-darwin-arm64.zip')&&names.some(n=>/win32-x64.*\.zip$/.test(n))&&names.some(n=>/UserSetup.*\.exe$/.test(n))&&names.some(n=>/^(?!.*User).*Setup.*\.exe$/.test(n)))return;
  if(attempt<150)await sleep(60000);
 }throw Error('BLOCKED: both OS packages did not arrive in 150 attempts; no retry');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){try{const file=process.argv[2];await waitForCandidate({identity:JSON.parse(fs.readFileSync(file,'utf8')),tag:process.env.TAG,temporary:process.env.RUNNER_TEMP});}catch{console.error('BLOCKED: candidate API command envelope unavailable/exhausted; no fresh retry');process.exitCode=2;}}
