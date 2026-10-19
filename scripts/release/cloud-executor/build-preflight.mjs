import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {engineEnabled} from './workflow-gate.mjs';
const require=(ok,message)=>{if(!ok)throw Error('BLOCKED build preflight: '+message);};
export function finalPromotion({message,tag,sourceSha,tagObjectType}) {
 if(!message.startsWith('hps-same-byte-promotion/1'))return false;
 require(message.startsWith('hps-same-byte-promotion/1\n'),'malformed final promotion marker');
 const body=JSON.parse(message.slice(message.indexOf('\n')+1));
 require(tagObjectType==='tag'&&/^v\d+\.\d+\.\d+$/.test(tag)&&Object.keys(body).sort().join(',')==='candidate,intentDigest,releaseId'&&body.candidate===sourceSha&&/^[a-f0-9]{40}$/.test(body.candidate)&&/^[a-f0-9]{64}$/.test(body.intentDigest)&&Number.isSafeInteger(body.releaseId)&&body.releaseId>0,'invalid final promotion identity');return true;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 try {
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();const ref=process.env.GITHUB_REF??'',tag=ref.startsWith('refs/tags/')?ref.slice(10):'';
  const sourceSha=git('rev-parse','HEAD^{commit}'),tagObjectType=tag?git('cat-file','-t',ref):'',message=tagObjectType==='tag'?git('for-each-ref','--format=%(contents)',ref):'';
  const skip=finalPromotion({message,tag,sourceSha,tagObjectType});
  if(!skip&&engineEnabled())require(message.startsWith('hps-managed-draft/1\n'),'engine mode refuses unmanaged/manual/hotfix build');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`skip_build=${skip}\n`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
