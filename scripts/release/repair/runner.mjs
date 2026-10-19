#!/usr/bin/env node
// One bounded product-repair attempt. No credentials reach model-produced code.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonical,digest} from '../engine/core.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export const allowedProductPath=value=>typeof value==='string'&&/^(extensions\/[^/]+\/src|src)\/[A-Za-z0-9_./-]+\.(ts|tsx|js|mjs|css)$/.test(value)&&!value.includes('..')&&!/(test|spec|policy|criteria|rubric|workflow|approval|permission|auth|release.engine)/i.test(value);
export function validatePacket(packet,expectedDigest) {
 check(packet?.schema==='hps-release-repair/1'&&packet.repository==='hypeproof/hypeproof-studio'&&packet.repositoryId===1239447574&&digest(packet)===expectedDigest,'PINNED_REPAIR_PACKET_REQUIRED');
 check(/^work-[a-f0-9]{64}$/.test(packet.operationId)&&/^failure-[a-f0-9]{64}$/.test(packet.failureId)&&/^[a-f0-9]{40}$/.test(packet.sourceSha)&&/^https:\/\/github\.com\/hypeproof\/hypeproof-studio\/issues\/[1-9]\d*$/.test(packet.issueUrl),'REPAIR_IDENTITY_INVALID');
 check(Array.isArray(packet.allowedPaths)&&packet.allowedPaths.length>0&&packet.allowedPaths.every(allowedProductPath),'REPAIR_PRODUCT_SCOPE_REQUIRED');
 check(Array.isArray(packet.observations)&&new Set(packet.observations).size>=3&&packet.observations.every(value=>/^https:\/\/github\.com\/hypeproof\/hypeproof-studio\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*$/.test(value)),'THREE_PROVIDER_OBSERVATIONS_REQUIRED');
 check(Array.isArray(packet.tests)&&packet.tests.length>0&&packet.tests.every(args=>Array.isArray(args)&&args.length>=2&&['node','npm'].includes(args[0])&&args.every(arg=>typeof arg==='string'&&!/[\x00\r\n]/.test(arg))&&!args.some(arg=>/^(?:-e|-p|--eval|--print|--test-only|--test-skip-pattern|--test-name-pattern)(?:=|$)/.test(arg))),'FIXED_UNWEAKENED_TEST_COMMANDS_REQUIRED');
 check(/^(?:node|ghcr\.io\/hypeproof\/release-repair)@sha256:[a-f0-9]{64}$/.test(packet.testContainerImage??''),'PINNED_ISOLATED_TEST_IMAGE_REQUIRED');
 check(['gpt-6.1-sol','gpt-6-luna'].includes(packet.model?.name)&&packet.model.effort==='medium'&&packet.model.paidFallback===false&&Number.isSafeInteger(packet.model.maxCalls)&&packet.model.maxCalls>=1&&packet.model.maxCalls<=2&&Number.isSafeInteger(packet.model.maxInputBytes)&&packet.model.maxInputBytes>1024&&packet.model.maxInputBytes<=131072&&Number.isSafeInteger(packet.model.maxOutputTokens)&&packet.model.maxOutputTokens>0&&packet.model.maxOutputTokens<=16384,'FINITE_APPROVED_MODEL_REQUIRED');
 return packet;
}
export function verifyBudget(packet,_unused,origin) {
 check(origin==='https://release.hypeproof-ai.xyz','REPAIR_SERVICE_ORIGIN_UNCONFIGURED');
 check(packet.model.maxCalls<=2&&packet.model.paidFallback===false&&packet.modelBudget,'APPROVED_REPAIR_BUDGET_REQUIRED');
 // The Service checks the exact D1 fix grant, held core reservation, OIDC run,
 // current zero-incremental allowance and single-flight call before using its key.
 return packet.modelBudget;
}
export function validatePatch(diff,allowedPaths) {
 check(typeof diff==='string'&&Buffer.byteLength(diff)>0&&Buffer.byteLength(diff)<=1048576,'FINITE_PATCH_REQUIRED');
 check(!/^(?:old mode|new mode|new file mode|deleted file mode|rename from|rename to|copy from|copy to|GIT binary patch|Binary files)/m.test(diff),'REPAIR_FILE_OPERATION_DENIED');
 const headers=[...diff.matchAll(/^diff --git a\/([^\n ]+) b\/([^\n ]+)$/gm)];
 check(headers.length>0&&headers.every(([,a,b])=>a===b&&allowedProductPath(a)&&allowedPaths.includes(a)),'REPAIR_PATH_DENIED');
 const paths=new Set(headers.map(([,a])=>a));
 for(const match of diff.matchAll(/^(?:--- a\/|\+\+\+ b\/)([^\n]+)$/gm))check(paths.has(match[1]),'REPAIR_PATCH_HEADER_MISMATCH');
 check(!/^(?:---|\+\+\+) (?:\/dev\/null|[^ab])/m.test(diff),'REPAIR_NEW_OR_DELETED_FILE_DENIED');
 return [...paths];
}
export function cleanEnvironment(home) {return {PATH:process.env.PATH,HOME:home,TMPDIR:os.tmpdir(),CI:'true',NODE_ENV:'test',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};}
export function run(command,args,cwd,env,{timeout=120000}={}) {
 const result=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
 check(result.status===0,`COMMAND_FAILED:${command}:${result.status??'timeout'}`);return result.stdout;
}
export async function modelJson(packet,prompt,env,counters) {
 verifyBudget(packet,env.HPS_REPAIR_BUDGET_PUBLIC_KEY,env.HPS_REPAIR_MODEL_ORIGIN);
 check(typeof env.HPS_REPAIR_MODEL_TOKEN==='string'&&env.HPS_REPAIR_MODEL_TOKEN.length>=20,'MODEL_PROXY_AUTH_UNCONFIGURED');
 check(counters.calls<packet.model.maxCalls&&Buffer.byteLength(prompt)+1024<=packet.model.maxInputBytes,'MODEL_CALL_OR_INPUT_BUDGET_EXHAUSTED');counters.calls++;
 const response=await fetch(env.HPS_REPAIR_MODEL_ORIGIN+'/v1/repair/model',{method:'POST',redirect:'error',signal:AbortSignal.timeout(180000),headers:{authorization:'Bearer '+env.HPS_REPAIR_MODEL_TOKEN,'content-type':'application/json','x-hps-operation-id':packet.operationId},body:JSON.stringify({operationId:packet.operationId,packetDigest:digest(packet),call:counters.calls,input:prompt})});
 check(response.ok,'BOUNDED_MODEL_RESPONSE_UNAVAILABLE');const text=await response.text();check(Buffer.byteLength(text)<=2*1024*1024,'MODEL_RESPONSE_TOO_LARGE');const output=JSON.parse(text);
 check(output.status==='completed'&&output.model===packet.model.name,'MODEL_RESPONSE_INCOMPLETE_OR_CHANGED');
 const content=(output.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text).join('');
 counters.usage.push(output.usage??null);return JSON.parse(content);
}
export async function scratchCheckout(packet,output) {
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'hps-repair-')),home=path.join(scratch,'isolated-home');await fs.mkdir(home);const env=cleanEnvironment(home);
 run('git',['init','--quiet'],scratch,env);run('git',['config','core.hooksPath','/dev/null'],scratch,env);run('git',['remote','add','origin','https://github.com/hypeproof/hypeproof-studio.git'],scratch,env);run('git',['fetch','--depth=1','origin',packet.sourceSha],scratch,env);
 run('git',['checkout','--detach','FETCH_HEAD'],scratch,env);check(run('git',['rev-parse','HEAD'],scratch,env).trim()===packet.sourceSha,'SCRATCH_SOURCE_CHANGED');
 return {scratch,home,env};
}
export function isolatedTests(command,checkout,packet) {
 return run('docker',['run','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=2g','--cpus=2','--mount','type=bind,src='+checkout.scratch+',dst=/workspace,readonly','--mount','type=bind,src='+path.join(checkout.scratch,'.git')+',dst=/workspace/.git,readonly','--tmpfs','/tmp:rw,nosuid,size=512m','-e','CI=true','-e','NODE_ENV=test','-w','/workspace',packet.testContainerImage,...command],checkout.scratch,checkout.env,{timeout:300000});
}
export async function repair(packet,{expectedDigest,output,env=process.env,checkout=scratchCheckout,testExecutor=isolatedTests}) {
 validatePacket(packet,expectedDigest);verifyBudget(packet,env.HPS_REPAIR_BUDGET_PUBLIC_KEY,env.HPS_REPAIR_MODEL_ORIGIN);
 check(env.GITHUB_RUN_ATTEMPT==='1','ONE_RUN_ATTEMPT_ONLY');await fs.mkdir(output,{recursive:true});
 const counters={calls:0,usage:[]},receipt={schema:'hps-repair-receipt/1',operationId:packet.operationId,packetDigest:expectedDigest,sourceSha:packet.sourceSha,failureId:packet.failureId,issueUrl:packet.issueUrl,status:'BLOCKED',model:packet.model,tests:[],draftPr:{status:'NOT_RUN'}};
 try {
  const work=await checkout(packet,output),files=[];work.scratch=await fs.realpath(work.scratch);
  for(const file of packet.allowedPaths){const real=await fs.realpath(path.join(work.scratch,file));check(real.startsWith(work.scratch+path.sep),'REPAIR_SYMLINK_DENIED');files.push({path:file,content:await fs.readFile(real,'utf8')});}
  const prompt='Repair only the classified product defect. Return JSON {"diff":"git unified diff"}. Preserve policy, requirements, tests, approval and workflows. Never alter files outside allowedPaths. No shell/tool execution.\n'+JSON.stringify({failureId:packet.failureId,issueUrl:packet.issueUrl,observations:packet.observations,allowedPaths:packet.allowedPaths,tests:packet.tests,files});
  const answer=await modelJson(packet,prompt,env,counters),changed=validatePatch(answer.diff,packet.allowedPaths);await fs.writeFile(path.join(output,'repair.patch'),answer.diff,{mode:0o600});
  run('git',['apply','--check',path.join(output,'repair.patch')],work.scratch,work.env);run('git',['apply','--index',path.join(output,'repair.patch')],work.scratch,work.env);
  const actual=run('git',['diff','--cached','--name-only'],work.scratch,work.env).trim().split('\n');check(actual.length===changed.length&&actual.every(file=>changed.includes(file)),'APPLIED_REPAIR_SCOPE_CHANGED');
  for(const command of packet.tests){const start=Date.now();try{const log=await testExecutor(command,work,packet);const name='test-'+receipt.tests.length+'.log';await fs.writeFile(path.join(output,name),log,{mode:0o600});receipt.tests.push({command,status:'PASS',elapsedMs:Date.now()-start,log:name});}catch(error){receipt.tests.push({command,status:'FAIL',elapsedMs:Date.now()-start});throw error;}}
  run('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','diff','--exit-code'],work.scratch,work.env);
  receipt.status='PATCH_TESTED';receipt.changedPaths=changed;receipt.patchSha256=createHash('sha256').update(answer.diff).digest('hex');receipt.draftPr={status:packet.createDraftPr?'PENDING_AUTHORIZED_PUBLICATION':'NOT_AUTHORIZED'};
 }catch(error){receipt.status=receipt.tests.some(test=>test.status==='FAIL')?'FAIL':'BLOCKED';receipt.reason=error.message;}
 receipt.modelCalls=counters.calls;receipt.modelUsage=counters.usage;receipt.completedAt=new Date().toISOString();await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});return receipt;
}
async function main(){const [, ,packetFile,digestValue,out]=process.argv;check(packetFile&&digestValue&&out,'Usage: runner.mjs packet.json packet-digest output-dir');const receipt=await repair(JSON.parse(await fs.readFile(packetFile,'utf8')),{expectedDigest:digestValue,output:path.resolve(out)});process.stdout.write(JSON.stringify({status:receipt.status,operationId:receipt.operationId})+'\n');if(receipt.status!=='PATCH_TESTED')process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write('BLOCKED: '+error.message+'\n');process.exitCode=2;});
