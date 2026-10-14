// Public-App compatibility must run the immutable Service deployment candidate.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function deploymentServicePin(studioRoot) {
 const text=fs.readFileSync(path.join(studioRoot,'.github/workflows/deploy-worker.yml'),'utf8');
 const pins=[...text.matchAll(/repository:\s*hypeproof\/hypeproof-service\s*\r?\n\s*ref:\s*([a-f0-9]{40})\s*(?:\r?\n|$)/g)];
 if(pins.length!==1)throw Error('Candidate Service requires one immutable deployment pin');
 return pins[0][1];
}
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
export function candidateServiceSource(studioRoot,candidateRoot) {
 if(!candidateRoot)throw Error('Candidate Service checkout required; packaged testkit is not candidate evidence');
 const root=fs.realpathSync(candidateRoot),sha=deploymentServicePin(studioRoot);
 if(git(root,'rev-parse','HEAD')!==sha)throw Error('Candidate Service checkout does not match deployment pin');
 // Git status may conceal changed bytes behind local index flags. Reject those
 // flags before the first snapshot; never label a hidden mutation as pinned.
 const entries=execFileSync('git',['ls-files','-v','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
 if(entries.some(entry=>entry[0]==='S'||/^[a-z]$/.test(entry[0])))throw Error('Candidate Service index conceals worktree changes');
 if(git(root,'status','--porcelain','--untracked-files=normal'))throw Error('Candidate Service checkout is modified');
 const loader=path.join(root,'worker/test/harness/loader.mjs'),server=path.join(root,'worker/test/native-trial-live-server.mjs');
 for(const file of [loader,server])if(!fs.statSync(file).isFile())throw Error('Candidate Service harness missing');
 const hash=createHash('sha256');
 // Include all tracked bytes, including harness/prompts/data, not just the router.
 const files=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean).sort();
 for(const file of files)hash.update(file+'\0').update(fs.readFileSync(path.join(root,file)));
 return {root,loader,server,repository:'hypeproof/hypeproof-service',commit:sha,source_sha256:hash.digest('hex'),scope:'Clean immutable deployment-candidate checkout; tracked source and harness bytes'};
}
export function candidateGatewayLaunch(source) {
 return {args:['--experimental-strip-types','--import',pathToFileURL(source.loader).href,source.server],cwd:path.join(source.root,'worker')};
}
export function assertCandidateServiceUnchanged(studioRoot,source) {
 const current=candidateServiceSource(studioRoot,source.root);
 if(current.commit!==source.commit||current.source_sha256!==source.source_sha256)throw Error('Candidate Service changed during acceptance');
 return true;
}
export function assertCandidateServiceReceipt(receipt,expectedCommit) {
 if(receipt?.schema!=='hps-service-compatibility/1'||receipt.status!=='PASS'||receipt.candidateService?.repository!=='hypeproof/hypeproof-service'||receipt.candidateService?.commit!==expectedCommit||!/^([a-f0-9]{64})$/.test(receipt.candidateService?.source_sha256??''))throw Error('Candidate Service receipt provenance mismatch');
 if(receipt.activities?.length!==2||!['trial','classroom'].every(kind=>receipt.activities.some(row=>row.kind===kind&&row.serviceSha===expectedCommit&&row.result?.status==='PASS')))throw Error('Candidate Service activity provenance mismatch');
 return true;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv[2]!=='pin')throw Error('Usage: candidate-service.mjs pin [STUDIO_ROOT]');console.log(deploymentServicePin(process.argv[3]??fileURLToPath(new URL('../..',import.meta.url))));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
