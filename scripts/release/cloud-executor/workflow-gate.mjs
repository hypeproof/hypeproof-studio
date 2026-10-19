import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../engine/core.mjs';
const require=(ok,message)=>{if(!ok)throw Error('BLOCKED release engine: '+message);};
export function engineEnabled(env=process.env) {
 require(!env.RELEASE_ENGINE_ENABLED||['true','false'].includes(env.RELEASE_ENGINE_ENABLED),'invalid mode');
 return env.RELEASE_ENGINE_ENABLED==='true'||!!env.RELEASE_ENGINE_URL;
}
export function workflowCaller(env=process.env) {
 const value={repository:env.GITHUB_REPOSITORY,repositoryId:Number(env.GITHUB_REPOSITORY_ID),runId:Number(env.GITHUB_RUN_ID),runAttempt:Number(env.GITHUB_RUN_ATTEMPT),sourceSha:env.GITHUB_SHA,workflowRef:env.GITHUB_WORKFLOW_REF,workflowSha:env.GITHUB_WORKFLOW_SHA};
 require(env.GITHUB_ACTIONS==='true'&&value.repository==='hypeproof/hypeproof-studio'&&value.repositoryId===1239447574&&Number.isSafeInteger(value.runId)&&value.runId>0&&Number.isSafeInteger(value.runAttempt)&&value.runAttempt>0&&/^[a-f0-9]{40}$/.test(value.sourceSha)&&/^[a-f0-9]{40}$/.test(value.workflowSha)&&typeof value.workflowRef==='string'&&value.workflowRef.startsWith(value.repository+'/.github/workflows/'),'untrusted workflow caller');return value;
}
export async function workflowToken(audience,{env=process.env,fetchImpl=fetch}={}) {
 require(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN&&env.ACTIONS_ID_TOKEN_REQUEST_URL,'workflow OIDC unavailable');
 const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);require(url.protocol==='https:'&&url.hostname.endsWith('.actions.githubusercontent.com')&&!url.username&&!url.password,'OIDC request origin rejected');url.searchParams.set('audience',audience);
 const response=await fetchImpl(url,{headers:{authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},redirect:'error',signal:AbortSignal.timeout(15000)});require(response.ok,'OIDC unavailable');const token=(await response.json()).value;require(typeof token==='string'&&token.length>0,'OIDC token missing');return token;
}
export async function engineRequest(endpoint,body,{audience='hypeproof-release-executor',env=process.env,fetchImpl=fetch}={}) {
 require(engineEnabled(env)&&env.RELEASE_ENGINE_URL,'engine endpoint unconfigured');
 const origin=new URL(env.RELEASE_ENGINE_URL);require(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash,'engine origin rejected');
 const token=await workflowToken(audience,{env,fetchImpl});
 const response=await fetchImpl(new URL(endpoint,origin),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(120000)});
 require(response.ok,'engine refused or result UNKNOWN; reconcile before retry');return response.json();
}
export async function authorizeExecution(body,options={}) {
 body=structuredClone(body);const expected=digest(body);
 const result=await engineRequest('/v1/execution/authorize',body,options),now=(options.clock??Date.now)();
 require(result?.status==='AUTHORIZED'&&result.requestDigest===expected&&Number.isSafeInteger(result.fence)&&result.fence>0&&typeof result.operationId==='string'&&result.operationId.length>0&&Date.parse(result.expiresAt)>now&&Date.parse(result.expiresAt)<=now+300000,'missing/stale execution authorization');return result;
}
export async function guardedEffect({body,command,args=[],managed=false,perform=false},{env=process.env,fetchImpl=fetch,run=execFileSync,clock=Date.now}={}) {
 body=structuredClone(body);
 if(!engineEnabled(env)) {require(!managed,'managed execution requires configured engine');return run(command,args,{stdio:'inherit',env});}
 const authorization=await authorizeExecution(body,{env,fetchImpl,clock});
 if(perform) {
  // No GitHub mutation runs locally in controlled mode. The Service resolves
  // this reference to its CURRENT claim, repeats gates and journals each effect.
  const result=await engineRequest('/v1/execution/perform',{...body,authorizationRef:{operationId:authorization.operationId,fence:authorization.fence,requestDigest:authorization.requestDigest}},{env,fetchImpl});
  require(result?.status==='SUCCEEDED'&&result.requestDigest===digest(body),'effect result UNKNOWN; reconcile before retry');return result;
 }
 require(Date.parse(authorization.expiresAt)>clock(),'execution lease expired');return run(command,args,{stdio:'inherit',env});
}
export function executionBody({path:effectPath,identity,effect},env=process.env) {return {path:effectPath,identity,caller:workflowCaller(env),effect};}
function git(...args){return execFileSync('git',args,{encoding:'utf8'}).trim();}
export function workflowIdentity(env=process.env) {
 const tag=env.TAG||env.GITHUB_REF_NAME;require(/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag??''),'candidate tag required');
 const sourceSha=git('rev-parse',`${tag}^{commit}`),tagObject=git('rev-parse',`refs/tags/${tag}`),message=git('for-each-ref','--format=%(contents)',`refs/tags/${tag}`);let version=tag;
 if(message.startsWith('hps-managed-draft/1\n'))version=JSON.parse(message.slice(message.indexOf('\n')+1)).releaseVersion;
 return {repository:env.GITHUB_REPOSITORY,repositoryId:Number(env.GITHUB_REPOSITORY_ID),sourceSha,rcTag:tag,tagObject,version};
}
export function fileInventory(directory) {
 return fs.readdirSync(directory).sort().map(name=>{require(!name.includes('/')&&!name.includes('\\'),'asset name invalid');const file=path.join(directory,name),stat=fs.lstatSync(file);require(stat.isFile()&&stat.size>0,'asset must be nonempty regular file');return {name,size:stat.size,sha256:execFileSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';import {createHash} from 'node:crypto';const h=createHash('sha256');for await(const c of fs.createReadStream(process.argv[1]))h.update(c);process.stdout.write(h.digest('hex'));",file],{encoding:'utf8'}).trim()};});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 const [mode,effectPath,kind,...command]=process.argv.slice(2);
 try {
  const enabled=engineEnabled(),managed=process.env.HPS_MANAGED_DRAFT==='true';
  // Legacy-only calls deliberately refuse under controlled mode. They can never
  // reuse a preflight token as a publication capability.
  if(mode==='legacy-only'){require(!enabled,'legacy mutation disabled; use Service publisher');process.exit(0);}
  if(!enabled){if(command.length)execFileSync(command[0],command.slice(1),{stdio:'inherit'});process.exit(0);}
  const stored=process.env.HPS_ENGINE_IDENTITY_FILE?JSON.parse(fs.readFileSync(process.env.HPS_ENGINE_IDENTITY_FILE,'utf8')):null;
  const baseIdentity=stored?(stored.identity??stored):workflowIdentity();
  const identity={...baseIdentity,...(process.env.TARGET?{target:process.env.TARGET}:{})};
  const effect={kind,...(stored?.releaseId?{releaseId:stored.releaseId}:{}),...(process.env.HPS_ENGINE_ASSET_DIR?{assets:fileInventory(process.env.HPS_ENGINE_ASSET_DIR),artifactName:process.env.HPS_ENGINE_ARTIFACT_NAME}:{})};
  const body=executionBody({path:effectPath,identity,effect});
  if(mode==='authorize')await authorizeExecution(body);
  else if(mode==='perform')await guardedEffect({body,managed,perform:true});
  else throw Error('unknown gate command');
 }catch(error){console.error(error.message.startsWith('BLOCKED')?error.message:'BLOCKED release engine request/identity unavailable');process.exitCode=1;}
}
