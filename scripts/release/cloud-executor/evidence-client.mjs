import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {engineRequest,workflowCaller} from './workflow-gate.mjs';
const require=(ok,message)=>{if(!ok)throw Error('BLOCKED evidence: '+message);};
export async function evidenceContext(identity,options={}) {
 const caller=workflowCaller(options.env),context=await engineRequest('/v1/evidence/context',{identity,caller},{...options,audience:'hypeproof-release-verifier'});
 require(context?.candidateId&&/^[a-f0-9]{64}$/.test(context.manifestDigest)&&context.reporterId&&context.testRevision===caller.workflowSha&&context.policy&&/^[a-f0-9]{40}$/.test(context.serviceSha)&&/^[a-f0-9]{40}$/.test(context.rubricRevision),'canonical verification context unavailable');return context;
}
export function canonicalReport(raw,context,target,env=process.env) {
 const caller=workflowCaller(env);const artifactId=Number(env.HPS_EVIDENCE_ARTIFACT_ID);require(Number.isSafeInteger(artifactId)&&artifactId>0,'immutable uploaded artifact ID unavailable');require(raw.testRevision===context.testRevision&&raw.serviceSha===context.serviceSha&&raw.rubricRevision===context.rubricRevision,'pinned test/service/rubric changed');
 require(raw.file&&/^[a-f0-9]{64}$/.test(raw.file.sha256)&&Number.isSafeInteger(raw.file.size)&&raw.file.size>0&&['PASS','FAIL','BLOCKED','NOT_RUN'].includes(raw.verdict)&&raw.startedAt&&raw.endedAt,'observed report incomplete');
 const name=path.basename(raw.file.path);require(name===raw.testId+'.json'&&/^[A-Za-z0-9._-]+$/.test(name),'report path invalid');
 return {...raw,schema:'hps-black-box-evidence/1',candidateId:context.candidateId,manifestDigest:context.manifestDigest,reporterId:context.reporterId,execution:'observed',provider:{repository:caller.repository,repositoryId:caller.repositoryId,runId:caller.runId,runAttempt:caller.runAttempt,artifactId},file:{...raw.file,path:`github-run:${caller.repositoryId}:${caller.runId}:${caller.runAttempt}/artifact-${artifactId}/${name}`}};
}
export async function submitEvidence({reports,context,target},options={}) {
 const records=[];for(const raw of reports){const report=canonicalReport(raw,context,target,options.env);const result=await engineRequest('/v1/evidence',{report},{...options,audience:'hypeproof-release-verifier'});require(result?.envelope?.body?.file?.sha256===report.file.sha256&&result.envelope.signature,'signed record unavailable');records.push(result);}return records;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 try {
  const [mode,input,contextPath,target]=process.argv.slice(2);
  if(mode==='context'){const collection=JSON.parse(fs.readFileSync(input,'utf8'));fs.writeFileSync(contextPath,JSON.stringify(await evidenceContext({...collection.identity,target}),null,2));}
  else if(mode==='submit'){const reports=JSON.parse(fs.readFileSync(input,'utf8')).reports,context=JSON.parse(fs.readFileSync(contextPath,'utf8'));const records=await submitEvidence({reports,context,target});fs.writeFileSync(path.join(path.dirname(input),'signed-records.json'),JSON.stringify(records,null,2));}
  else throw Error('unknown evidence command');
 }catch(error){console.error(error.message.startsWith('BLOCKED')?error.message:'BLOCKED evidence context or observed report unavailable');process.exitCode=1;}
}
