import fs from 'node:fs';
import path from 'node:path';
import {digest} from '../engine/core.mjs';
import {hashBytes, identity, requireThat} from './provider.mjs';
const hash = /^[a-f0-9]{64}$/;
const roles = ['mac-zip','win-portable','win-user','win-system'];
function boundedBytes(file, expectedSize, maxBytes) {
  requireThat(Number.isSafeInteger(expectedSize)&&expectedSize>0&&expectedSize<=maxBytes,'file byte limit exceeded');
  const fd=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat=fs.fstatSync(fd); requireThat(stat.isFile()&&stat.size===expectedSize,'file size changed');
    const bytes=Buffer.alloc(expectedSize+1);let offset=0;
    while(offset<bytes.length) { const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!count)break;offset+=count; }
    requireThat(offset===expectedSize,'file bytes changed during read'); return bytes.subarray(0,offset);
  } finally {fs.closeSync(fd);}
}

const rolePatterns = {'mac-zip':/^HypeProof-Studio-darwin-arm64\.zip$/, 'win-portable':/win32-x64[^/\\]*\.zip$/, 'win-user':/UserSetup-x64[^/\\]*\.exe$/, 'win-system':/(?<!User)Setup-x64[^/\\]*\.exe$/};
export function collectAssets(observation, receipts, downloaded, {now=Date.now(), maxAgeMs=300000}={}) {
  identity(observation.identity);
  requireThat(Number.isFinite(Date.parse(observation.observedAt)) && now-Date.parse(observation.observedAt)>=0 && now-Date.parse(observation.observedAt)<=maxAgeMs,'stale/future provider observation');
  requireThat(observation.builds.length===2 && observation.builds.every(r=>r.status==='completed'&&r.conclusion==='success'),'both exact builds must succeed');
  requireThat(receipts.length===2 && new Set(receipts.map(r=>r.platform)).size===2,'both unique platform receipts required');
  const result=[];
  for(const receipt of receipts) {
    const platform=receipt.platform;
    requireThat(['darwin-arm64','win32-x64'].includes(platform),'unknown receipt platform');
    const run=observation.builds.find(r=>r.workflow===(platform==='darwin-arm64'?'build-mac.yml':'build-windows.yml'));
    requireThat(receipt.schema==='hps-draft-build/1' && receipt.sourceSha===observation.identity.sourceSha && receipt.publicationTagObject===observation.identity.tagObject && receipt.publicationTag===observation.identity.rcTag && receipt.releaseVersion===observation.identity.version.slice(1) && receipt.managedDraft===true && receipt.autoAcceptance===false && receipt.acceptance==='NOT_RUN' && receipt.promotion==='NOT_AUTHORIZED','receipt build contract mismatch');
    // Workflow-authenticated attachment; existing inventory alone has no run identity.
    requireThat(receipt.provider?.repositoryId===observation.identity.repositoryId && receipt.provider?.repository===observation.identity.repository && receipt.provider.runId===run.id && receipt.provider.runAttempt===run.attempt,'receipt provider runID/runAttempt mismatch');
    const expected=platform==='darwin-arm64'?['mac-zip']:['win-portable','win-user','win-system'];
    requireThat(Array.isArray(receipt.assets)&&receipt.assets.length===expected.length&&expected.every(role=>receipt.assets.filter(a=>a.id===role).length===1),'incomplete receipt assets');
    for(const asset of receipt.assets) {
      requireThat(expected.includes(asset.id)&&rolePatterns[asset.id].test(asset.name)&&hash.test(asset.sha256)&&Number.isSafeInteger(asset.size)&&asset.size>0,'invalid immutable asset');
      const local=downloaded[asset.id]; requireThat(local && Buffer.isBuffer(local.bytes) && local.bytes.length===asset.size && hashBytes(local.bytes)===asset.sha256,'download digest/size mismatch');
      const matches=observation.assets.filter(a=>a.size===asset.size&&a.digest===`sha256:${asset.sha256}`);
      requireThat(matches.length===1 && matches[0].id===local.assetId && matches[0].state==='uploaded','missing/ambiguous immutable provider asset');
      result.push({...asset,platform,assetId:local.assetId,releaseId:observation.releaseId,runId:run.id,runAttempt:run.attempt});
    }
  }
  requireThat(roles.every(role=>result.filter(a=>a.id===role).length===1)&&new Set(result.map(a=>a.assetId)).size===4,'four distinct package assets required');
  return {schema:'hps-cloud-collection/1',identity:observation.identity,releaseId:observation.releaseId,assets:result,acceptance:'NOT_RUN',promotion:'NOT_AUTHORIZED'};
}
// A trusted collector owns these byte observations. Caller JSON cannot grant trust.
export function fileVerifier({root, files, source, now=Date.now, maxAgeMs=300000, maxBytes=64*1024*1024}) {
  identity(source);
  const base=fs.realpathSync(root), observed=new Map();
  for(const entry of files) {
    requireThat(entry.sourceSha===source.sourceSha && entry.repositoryId===source.repositoryId && entry.tagObject===source.tagObject && Object.values(source.runs ?? {}).some(run=>run.id===entry.runId&&run.attempt===entry.runAttempt) && hash.test(entry.sha256) && entry.size>0 && entry.size<=maxBytes,'file observation identity/size missing');
    const current=typeof now==='function'?now():now; const age=current-Date.parse(entry.observedAt); requireThat(Number.isFinite(age)&&age>=0&&age<=maxAgeMs,'stale/future file observation');
    requireThat(typeof entry.uri==='string'&&!path.isAbsolute(entry.uri)&&!entry.uri.split(/[\\/]/).includes('..'),'unsafe observation path');
    const file=fs.realpathSync(path.join(base,entry.uri)); requireThat(file.startsWith(base+path.sep),'file escapes trusted root');
    const stat=fs.statSync(file); requireThat(stat.isFile()&&stat.size===entry.size,'file size changed');
    const bytes=boundedBytes(file,entry.size,maxBytes); requireThat(hashBytes(bytes)===entry.sha256,'file bytes changed');
    requireThat(!observed.has(entry.uri),'duplicate file observation'); observed.set(entry.uri,{...entry,file}); observed.set(file,{...entry,file});
  }
  return claim=>{
    const claimPath=claim.uri ?? claim.path;
    const entry=observed.get(claimPath) ?? (typeof claim.path==='string' && fs.existsSync(claim.path) ? observed.get(fs.realpathSync(claim.path)) : undefined);
    requireThat(entry && claim.sha256===entry.sha256 && claim.size===entry.size,'untrusted file claim');
    const current=typeof now==='function'?now():now; requireThat(current-Date.parse(entry.observedAt)>=0&&current-Date.parse(entry.observedAt)<=maxAgeMs,'trusted file observation expired');
    const stat=fs.statSync(entry.file); requireThat(stat.size===entry.size&&hashBytes(boundedBytes(entry.file,entry.size,maxBytes))===entry.sha256,'trusted bytes changed after observation');
    return true;
  };
}
export function installedPlan(policy, collection, pins) {
  requireThat(policy.requiredTests?.length===8 && new Set(policy.requiredTests.map(t=>t.id)).size===8,'required installed eight-test policy required');
  requireThat(['serviceSha','testRevision','rubricRevision'].every(k=>/^[a-f0-9]{40}$/.test(pins[k])),'pinned Service/test/rubric required');
  const role={mac:'mac-zip','win-user':'win-user','win-system':'win-system'};
  return {schema:'hps-installed-plan/1',identity:collection.identity,pins,checks:policy.requiredTests.map(test=>{
    const artifact=collection.assets.find(a=>a.id===role[test.artifactId]); requireThat(artifact&&test.environment==='installed-app','missing installed artifact contract');
    return {...test,artifact,verdict:'NOT_RUN',expected:test.expected,observed:'No installed execution evidence collected'};
  }),smoke:{runner:'scripts/release/smoke/smoke.mjs',ids:['S1','S2','S3','S4','S5','S6'],verdict:'NOT_RUN'},optionalUx:{verdict:'NOT_RUN'},promotion:'NOT_AUTHORIZED'};
}
export async function runInstalledPlan(plan, runner) {
  const checks=[];
  for(const check of plan.checks) {
    if(!runner) {checks.push(check);continue;}
    let report; try {report=await runner(check,plan);} catch {checks.push({...check,verdict:'BLOCKED',observed:'Installed runner unavailable or failed'});continue;}
    requireThat(['PASS','FAIL','BLOCKED','NOT_RUN'].includes(report?.verdict),'invalid runner verdict');
    requireThat(report.sourceSha===plan.identity.sourceSha && report.requirementId===check.requirementId && report.expected===check.expected && report.testId===check.id && report.artifactDigest===check.artifact.sha256 && report.environment?.kind==='installed-app' && report.environment.target===check.artifact.platform && typeof report.environment.runnerId==='string' && report.environment.runnerId.length>0,'installed evidence identity mismatch');
    requireThat(['serviceSha','testRevision','rubricRevision'].every(k=>report[k]===plan.pins[k]),'installed evidence revision mismatch');
    requireThat(report.file?.uri&&hash.test(report.file.sha256)&&report.file.size>0&&typeof report.observed==='string'&&report.observed.length>0,'installed evidence bytes/observation required');
    checks.push({...check,...report});
  }
  return {...plan,checks,verdict:checks.some(c=>c.verdict==='FAIL')?'FAIL':checks.some(c=>c.verdict==='BLOCKED')?'BLOCKED':checks.some(c=>c.verdict==='NOT_RUN')?'NOT_RUN':'PASS',promotion:'NOT_AUTHORIZED'};
}
export function cacheIdentity(inputs) {
  requireThat(inputs && ['platform','architecture','nodeVersion','sdkVersion'].every(k=>typeof inputs[k]==='string'&&inputs[k].length>0),'explicit cache runtime/SDK required');
  requireThat(['sourceSha','serviceSha'].every(k=>/^[a-f0-9]{40}$/.test(inputs[k])) && ['lockDigest','seedScriptDigest','buildContractDigest'].every(k=>hash.test(inputs[k])),'cache source/digests required');
  return {schema:'hps-source-cache/1',key:`hps-${digest(inputs)}`,inputs};
}
