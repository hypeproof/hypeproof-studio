#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validatePacket,validatePatch,scratchCheckout,run,modelJson} from './runner.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export async function prepareDraft(packet,{expectedDigest,output,harness,env=process.env}) {
 validatePacket(packet,expectedDigest);const receipt=JSON.parse(await fs.readFile(path.join(output,'receipt.json'),'utf8')),patch=await fs.readFile(path.join(output,'repair.patch'),'utf8');
 check(receipt.packetDigest===expectedDigest&&receipt.status==='PATCH_TESTED'&&receipt.tests.length===packet.tests.length&&receipt.tests.every(test=>test.status==='PASS')&&receipt.patchSha256===createHash('sha256').update(patch).digest('hex'),'TESTED_REPAIR_RECEIPT_REQUIRED');validatePatch(patch,packet.allowedPaths);
 const prepared={schema:'hps-repair-pr-packet/1',operationId:packet.operationId,issue:packet.issueUrl,sourceSha:packet.sourceSha,patchSha256:receipt.patchSha256,tests:receipt.tests,status:'BLOCKED',humanApproval:false};
 await fs.writeFile(path.join(output,'draft-pr-packet.json'),JSON.stringify(prepared,null,2)+'\n',{mode:0o600});
 if(packet.createDraftPr!==true||env.HPS_REPAIR_DRAFT_PR_AUTHORIZED!=='true'||!env.GH_TOKEN||!harness){prepared.reason='EXPLICIT_BOT_PR_AUTHORIZATION_OR_CREDENTIALS_MISSING';await fs.writeFile(path.join(output,'draft-pr-packet.json'),JSON.stringify(prepared,null,2)+'\n',{mode:0o600});return prepared;}
 check(env.GITHUB_RUN_ATTEMPT==='1','ONE_RUN_ATTEMPT_ONLY');
 const work=await scratchCheckout(packet,output);check(run('git',['rev-parse','HEAD'],harness,work.env).trim()===packet.harnessSha,'PINNED_HARNESS_REQUIRED');
 run('git',['apply','--index',path.join(output,'repair.patch')],work.scratch,work.env);
 run('git',['config','user.name','HypeProof Release Repair Bot'],work.scratch,work.env);run('git',['config','user.email','release-repair@hypeproof.local'],work.scratch,work.env);
 const branch='repair/'+packet.failureId;run('git',['checkout','-b',branch],work.scratch,work.env);run('git',['commit','-m','fix: bounded release repair '+packet.failureId],work.scratch,work.env);
 run('git',['fetch','--depth=1','origin','main'],work.scratch,work.env);run('git',['branch','main','FETCH_HEAD'],work.scratch,work.env);
 const cli=path.join(harness,'scripts/hype-pr/pr.py'),report=path.join(output,'pr-inspect.json'),assessment=path.join(output,'pr-assessment.json'),preparation=path.join(output,'pr-preparation.json');
 const auth={...work.env,GH_TOKEN:env.GH_TOKEN,HYPEPROOF_HARNESS:harness};
 run('python3',[cli,'inspect','--repo',packet.repository,'--checkout',work.scratch,'--base','main','--output',report],work.scratch,auth);
 const counters={calls:receipt.modelCalls,usage:receipt.modelUsage??[]};
 const answer=await modelJson(packet,'Return an honest hype-pr agent assessment JSON for this exact inspect report. Preserve fingerprint and node IDs; assess every task and unmapped path. Do not invent validation or human approval. Fixed tests actually passed as recorded.\n'+JSON.stringify({inspect:JSON.parse(await fs.readFile(report,'utf8')),tests:receipt.tests,issue:packet.issueUrl,patch}),env,counters);
 await fs.writeFile(assessment,JSON.stringify(answer)+'\n',{mode:0o600});
 run('python3',[cli,'prepare','--repo',packet.repository,'--checkout',work.scratch,'--base','main','--assessment',assessment,'--output',preparation],work.scratch,auth);
 const bodyFile=path.join(output,'pr-body.md');await fs.writeFile(bodyFile,`Repairs the classified product failure without changing release policy or tests.\n\nFixes ${packet.issueUrl}\n\nValidation: the configured fixed commands passed against source ${packet.sourceSha}. Installed release acceptance remains NOT_RUN.\n`,{mode:0o600});
 const askpass=path.join(work.home,'askpass.sh');await fs.writeFile(askpass,'#!/bin/sh\ncase "$1" in *Username*) printf "%s" x-access-token;; *) printf "%s" "$GH_TOKEN";; esac\n',{mode:0o700});
 // Persist uncertainty before either external mutation. Never retry this job or
 // replace an existing branch/PR after a lost provider response.
 prepared.status='UNKNOWN';prepared.branch=branch;await fs.writeFile(path.join(output,'draft-pr-packet.json'),JSON.stringify(prepared,null,2)+'\n',{mode:0o600});
 run('git',['push','origin',`HEAD:refs/heads/${branch}`],work.scratch,{...auth,GIT_ASKPASS:askpass});
 const result=run('python3',[cli,'create','--repo',packet.repository,'--checkout',work.scratch,'--head',branch,'--base','main','--author',packet.botAuthor,'--issue',packet.issueUrl.split('/').at(-1),'--title','fix: bounded product release repair','--body-file',bodyFile,'--draft','--preparation',preparation,'--apply'],work.scratch,auth);
 prepared.status='DRAFT_PR_SUBMITTED';prepared.providerResult=JSON.parse(result);prepared.modelCalls=counters.calls;await fs.writeFile(path.join(output,'draft-pr-packet.json'),JSON.stringify(prepared,null,2)+'\n',{mode:0o600});return prepared;
}
async function main(){const [packetFile,expectedDigest,output,harness]=process.argv.slice(2);const result=await prepareDraft(JSON.parse(await fs.readFile(packetFile,'utf8')),{expectedDigest,output:path.resolve(output),harness:harness&&path.resolve(harness)});process.stdout.write(JSON.stringify({status:result.status,operationId:result.operationId})+'\n');if(result.status==='BLOCKED')process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write('BLOCKED_OR_UNKNOWN: '+error.message+'; reconcile persisted branch/PR before any new write.\n');process.exitCode=2;});
