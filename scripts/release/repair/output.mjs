#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validatePacket} from './runner.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export async function governOutput(packet,{expectedDigest,output,token,mode='authorize',artifactId,fetchImpl=fetch}){
 validatePacket(packet,expectedDigest);const config=packet.executionBudget?.output;if(config?.enabled!==true)return {status:'DISABLED'};
 check(typeof token==='string'&&token.length>20,'OUTPUT_OIDC_REQUIRED');let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{check(false,'OUTPUT_OIDC_INVALID');}
 check(claims.aud==='hypeproof-release-executor'&&String(claims.run_attempt)==='1'&&claims.repository===packet.repository&&claims.workflow_sha===packet.workflow.sha,'OUTPUT_WORKFLOW_CHANGED');
 const body={path:config.path,identity:{repository:packet.repository,repositoryId:packet.repositoryId,sourceSha:packet.sourceSha,rcTag:packet.rcTag,version:packet.version},caller:{repository:claims.repository,repositoryId:Number(claims.repository_id),runId:Number(claims.run_id),runAttempt:1,sourceSha:claims.sha,workflowRef:claims.workflow_ref,workflowSha:claims.workflow_sha},effect:{kind:'artifact-store',artifactName:'release-repair-output'}};
 const permitFile=path.join(output,'output-permit.json');
 if(mode==='authorize'){const sizes=await Promise.all(['repair.patch','receipt.json'].map(name=>fs.stat(path.join(output,name))));check(sizes.every(s=>s.isFile())&&sizes.reduce((n,s)=>n+s.size,0)<=config.maxBytes&&config.maxBytes<=2097152&&config.retentionDays>=1&&config.retentionDays<=7,'FINITE_OUTPUT_REQUIRED');}
 else{check(mode==='complete'&&/^[1-9]\d*$/.test(String(artifactId)),'IMMUTABLE_OUTPUT_ARTIFACT_REQUIRED');body.authorizationRef=JSON.parse(await fs.readFile(permitFile,'utf8'));body.receipt={artifactId:Number(artifactId)};}
 // The existing execution API authenticates OIDC and independently requires the
 // configured source contract, storage role, capacity and hard-cap proof.
 const response=await fetchImpl('https://release.hypeproof-ai.xyz/v1/execution/'+mode,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
 check(response.ok,'OUTPUT_PERMIT_OR_COMPLETION_BLOCKED');const result=await response.json();
 if(mode==='authorize'){check(result.status==='AUTHORIZED'&&Date.parse(result.expiresAt)>Date.now(),'CURRENT_OUTPUT_PERMIT_REQUIRED');await fs.writeFile(permitFile,JSON.stringify(result),{mode:0o600});}
 else check(result.status==='SUCCEEDED','OUTPUT_COMPLETION_UNKNOWN');return result;
}
async function main(){const [mode,packetFile,expectedDigest,output,artifactId]=process.argv.slice(2),packet=JSON.parse(await fs.readFile(packetFile,'utf8'));const result=await governOutput(packet,{expectedDigest,output,mode,artifactId,token:process.env.HPS_REPAIR_MODEL_TOKEN});if(mode==='authorize'&&result.status==='AUTHORIZED'&&process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`authorized=true\nretention=${packet.executionBudget.output.retentionDays}\n`);process.stdout.write(JSON.stringify({status:result.status})+'\n');}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write('OUTPUT_BLOCKED_OR_UNKNOWN: '+error.message+'; do not retry an uncertain upload.\n');process.exitCode=2;});
