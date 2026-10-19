// Resolve candidate identity from trusted workflow context and annotated git tag.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {buildTagMessage} from '../build-contract.mjs';
import {requireThat} from './provider.mjs';
const tag=process.env.TAG;
requireThat(/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag),'invalid candidate tag');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const sourceSha=git('rev-parse',`${tag}^{commit}`),tagObject=git('rev-parse',`refs/tags/${tag}`);
const message=git('for-each-ref','--format=%(contents)',`refs/tags/${tag}`);
let managed=false,version=tag;
if(message.startsWith('hps-managed-draft/1\n')) {
 const marker=JSON.parse(message.slice(message.indexOf('\n')+1));version=marker.releaseVersion;
 requireThat(message===buildTagMessage({candidate:sourceSha,rcTag:tag,version},{managedDraft:true}),'candidate marker differs');managed=true;
}
const input={repository:process.env.GITHUB_REPOSITORY,repositoryId:Number(process.env.GITHUB_REPOSITORY_ID),sourceSha,tagObject,rcTag:tag,version};
fs.writeFileSync(process.env.HPS_CANDIDATE_INPUT,JSON.stringify(input,null,2));
fs.appendFileSync(process.env.GITHUB_OUTPUT,`sha=${sourceSha}\nmanaged=${managed}\nversion=${version.slice(1)}\n`);
