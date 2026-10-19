// Provider effects stay outside the signed engine. No retries, publishing or signing.
import {buildTagMessage, assertManagedCandidateSupport} from '../build-contract.mjs';
import {digest} from '../engine/core.mjs';
import {createHash} from 'node:crypto';
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export const requireThat = (ok, message) => { if (!ok) throw Error(`Cloud executor: ${message}`); };
const sha = /^[a-f0-9]{40}$/;
export function identity(value) {
  requireThat(value?.repository === 'hypeproof/hypeproof-studio' && Number.isSafeInteger(value.repositoryId) && value.repositoryId > 0, 'canonical repository identity required');
  requireThat(sha.test(value.sourceSha) && sha.test(value.tagObject), 'exact source and annotated tag object required');
  buildTagMessage({candidate:value.sourceSha, rcTag:value.rcTag, version:value.version}, {managedDraft:true});
  return value;
}
const integer = n => Number.isSafeInteger(n) && n > 0;
export class GitHubTransport {
  constructor({token = process.env.GH_TOKEN, fetchImpl = fetch, maxBytes = 64 * 1024 * 1024} = {}) { this.token = token; this.fetch = fetchImpl; this.maxBytes = maxBytes; }
  async downloadAsset(assetId) {
    requireThat(Number.isSafeInteger(assetId)&&assetId>0,'numeric asset ID required');
    const headers={Accept:'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'};
    if(this.token)headers.Authorization=`Bearer ${this.token}`;
    let response;
    try {response=await this.fetch(`https://api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/${assetId}`,{headers,redirect:'manual',signal:AbortSignal.timeout(30000)});} catch {throw Error('asset transport unavailable');}
    // GitHub uses a short-lived signed URL on a dedicated asset origin. Never
    // forward Authorization across the redirect, or accept arbitrary origins.
    if([301,302,303,307,308].includes(response.status)) {
      const target=new URL(response.headers.get('location'));
      requireThat(target.protocol==='https:'&&(!target.port||target.port==='443')&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname)&&!target.username&&!target.password,'untrusted asset redirect');
      try {response=await this.fetch(target,{redirect:'error',signal:AbortSignal.timeout(120000)});} catch {throw Error('asset download unavailable');}
    }
    requireThat(response.ok,'asset download refused');
    const chunks=[];let size=0;
    for await(const chunk of response.body??[]) {size+=chunk.length;requireThat(size<=this.maxBytes,'asset byte limit exceeded');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  async request(method, endpoint, body) {
    requireThat(/^\/repos\/hypeproof\/hypeproof-studio(?:\/|$)/.test(endpoint) && !endpoint.includes('..'), 'endpoint outside canonical source repository');
    const url = new URL(endpoint, 'https://api.github.com');
    requireThat(url.origin === 'https://api.github.com', 'unexpected provider origin');
    const headers = {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await this.fetch(url, {method,headers,body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'}); }
    catch { throw Error('provider transport failed; response unknown'); }
    requireThat(response.ok, `provider HTTP ${response.status}`);
    const chunks = []; let length = 0;
    for await (const chunk of response.body ?? []) { length += chunk.length; requireThat(length <= this.maxBytes, 'provider response exceeds byte limit'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    return bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
  }
}
export class CloudExecutor {
  constructor({transport, authorize, reserve, journal, now = Date.now, maxPages = 20}) {
    this.transport=transport; this.authorize=authorize; this.reserve=reserve; this.journal=journal; this.now=now; this.maxPages=maxPages;
  }
  async list(endpoint) {
    const rows=[];
    for(let page=1;page<=this.maxPages;page++) {
      const result=await this.transport.request('GET',`${endpoint}${endpoint.includes('?')?'&':'?'}per_page=100&page=${page}`);
      const batch=Array.isArray(result)?result:result.workflow_runs;
      requireThat(Array.isArray(batch), 'invalid paginated response'); rows.push(...batch);
      if(batch.length<100)return rows;
    }
    throw Error('Cloud executor: provider pagination truncated; observation BLOCKED');
  }
  async observe(input) {
    const id=identity(input), base=`/repos/${id.repository}`;
    const repo=await this.transport.request('GET',base);
    requireThat(repo.id===id.repositoryId && repo.full_name===id.repository, 'repository ID/name mismatch');
    const ref=await this.transport.request('GET',`${base}/git/ref/tags/${encodeURIComponent(id.rcTag)}`);
    requireThat(ref.object?.type==='tag' && ref.object.sha===id.tagObject, 'annotated tag identity mismatch');
    const tag=await this.transport.request('GET',`${base}/git/tags/${id.tagObject}`);
    requireThat(tag.object?.type==='commit' && tag.object.sha===id.sourceSha && tag.tag===id.rcTag && tag.message.trimEnd()===buildTagMessage({candidate:id.sourceSha,rcTag:id.rcTag,version:id.version},{managedDraft:true}), 'managed tag source/marker mismatch');
    const releases=(await this.list(`${base}/releases`)).filter(row=>row.tag_name===id.rcTag);
    requireThat(releases.length===1, 'missing or ambiguous same-tag releases (including empty drafts)');
    const release=releases[0];
    requireThat(integer(release.id) && release.draft===true, 'numeric draft release identity required');
    if(id.releaseId!==undefined)requireThat(release.id===id.releaseId,'draft release ID changed');
    const runs=(await this.list(`${base}/actions/runs?head_sha=${id.sourceSha}`)).filter(row=>row.head_sha===id.sourceSha && ['.github/workflows/build-mac.yml','.github/workflows/build-windows.yml'].includes(row.path));
    const builds=['build-mac.yml','build-windows.yml'].map(workflow=>{
      const matches=runs.filter(r=>r.path===`.github/workflows/${workflow}` && r.head_branch===id.rcTag);
      requireThat(matches.length===1,`missing or duplicate ${workflow} builds`);
      const run=matches[0]; requireThat(integer(run.id)&&integer(run.run_attempt)&&run.repository?.id===id.repositoryId,'run identity mismatch');
      requireThat(run.event==='push','managed build must be tag push, never tag plus dispatch');
      if(id.runs?.[workflow]) requireThat(run.id===id.runs[workflow].id && run.run_attempt===id.runs[workflow].attempt,'runID/runAttempt mismatch');
      return {workflow,id:run.id,attempt:run.run_attempt,status:run.status,conclusion:run.conclusion};
    });
    const assets=await this.list(`${base}/releases/${release.id}/assets`);
    requireThat(new Set(assets.map(a=>a.id)).size===assets.length && new Set(assets.map(a=>a.name)).size===assets.length,'ambiguous asset identity');
    return {schema:'hps-cloud-observation/1',identity:id,releaseId:release.id,builds,assets,observedAt:new Date(this.now()).toISOString()};
  }
  async mutate(input) {
    const request=structuredClone(input);
    requireThat(this.authorize && this.reserve && this.journal, 'mutation requires current authorization, reservation and durable journal');
    requireThat(['managed-tag','retry-build','upload-support'].includes(request.kind),'unsupported mutation; publishing/signing forbidden');
    identity(request.identity);
    requireThat(typeof request.operationId==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(request.operationId),'stable operation ID required');
    if(request.kind==='retry-build') requireThat(integer(request.runId)&&integer(request.runAttempt)&&Object.values(request.identity.runs??{}).some(run=>run.id===request.runId&&run.attempt===request.runAttempt),'retry must bind exact observed run attempt');
    if(request.kind==='upload-support') requireThat(integer(request.releaseId)&&typeof request.asset?.name==='string'&&/^[A-Za-z0-9._-]+\.(json|md|html|txt|pdf)$/.test(request.asset.name)&&/^[a-f0-9]{64}$/.test(request.asset.sha256)&&integer(request.asset.size),'exclusive support asset identity required');
    if(request.kind==='managed-tag') requireThat(request.tagMessage===buildTagMessage({candidate:request.identity.sourceSha,rcTag:request.identity.rcTag,version:request.identity.version},{managedDraft:true}),'managed tag request marker mismatch');
    const key=digest(request), operationKey=`${request.identity.repositoryId}:${request.operationId}`, previous=await this.journal.get(operationKey);
    if(previous) { requireThat(previous.key===key,'operation ID reused with changed request'); requireThat(previous.status==='DONE','UNKNOWN operation: observe before any recovery, no blind retry'); return previous; }
    requireThat(await this.authorize(request,key,this.now())===true,'current authorization denied');
    requireThat(await this.reserve(request,key)===true,'current reservation denied');
    if(request.kind==='managed-tag') assertManagedCandidateSupport(request.identity.sourceSha);
    // Persist before dispatch: losing the response (or failing to persist DONE) is UNKNOWN.
    await this.journal.put(operationKey,{status:'UNKNOWN',key,kind:request.kind});
    try {
      requireThat(typeof this.transport.execute==='function','mutation transport unavailable');
      requireThat(await this.authorize(request,key,this.now())===true,'operation fence/lease expired immediately before write');
      await this.transport.execute(request);
      const done={status:'DONE',key,kind:request.kind}; await this.journal.put(operationKey,done); return done;
    } catch { return {status:'UNKNOWN',key,kind:request.kind,next:'read-only observe; authorized recovery requires a new bounded reservation'}; }
  }
}
