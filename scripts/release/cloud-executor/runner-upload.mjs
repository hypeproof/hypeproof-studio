// Original-runner transfer: archives never pass through Worker memory. The
// Service journals UNKNOWN before each permit and re-observes numeric assets.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {digest} from '../engine/core.mjs';
import {engineRequest,executionBody,workflowIdentity} from './workflow-gate.mjs';
const require=(ok,message)=>{if(!ok)throw Error('BLOCKED runner upload: '+message);};
async function inspect(file){const stat=fs.lstatSync(file);require(stat.isFile()&&stat.size>0,'nonempty original regular file required');const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return {name:path.basename(file),size:stat.size,sha256:hash.digest('hex')};}
const authorizationRef=authorization=>({operationId:authorization.operationId,fence:authorization.fence,requestDigest:authorization.requestDigest});
export async function transferDraft({identity,effectPath,directory,protocol={}},{env=process.env,fetchImpl=fetch,request=engineRequest,clock=Date.now}={}) {
 const invoke=(endpoint,body)=>request(endpoint,body,{env,fetchImpl});
 const repository=protocol.repository??'hypeproof/hypeproof-studio';require(['hypeproof/hypeproof-studio','hypeproof/hypeproof-studio-releases'].includes(repository),'target repository rejected');
 const create=executionBody({path:effectPath,identity,effect:{kind:protocol.createKind??'draft-release-create'}},env);
 const createAuth=await invoke('/v1/execution/authorize',create);let created;
 if(createAuth.status==='SUCCEEDED')created=createAuth;
 else {require(createAuth.status==='AUTHORIZED'&&createAuth.requestDigest===digest(create)&&Date.parse(createAuth.expiresAt)>clock(),'fresh draft authority required');created=await invoke('/v1/execution/perform',{...create,authorizationRef:authorizationRef(createAuth)});}
 require(created.status==='SUCCEEDED'&&created.requestDigest===digest(create)&&Number.isSafeInteger(created.receipt?.releaseId)&&created.receipt.releaseId>0,'numeric draft identity unavailable');
 const releaseId=created.receipt.releaseId,records=[];require(!created.receipt.repository||created.receipt.repository===repository,'target repository changed');if(protocol.prepareAssets)await protocol.prepareAssets(created.receipt);
 for(const name of fs.readdirSync(directory).sort()) {
  const file=path.join(directory,name),asset=await inspect(file);require(/^[A-Za-z0-9][A-Za-z0-9._+ -]{0,180}$/.test(name),'asset filename rejected');
  const body=executionBody({path:effectPath,identity,effect:{kind:protocol.uploadKind??'draft-asset-upload',releaseId,...asset,...(protocol.assetMetadata?.[asset.name]??{})}},env);let auth;
  try{auth=await invoke('/v1/execution/authorize',body);}catch(error){
   // A prior permit/write may have lost its response. Read-only reconciliation
   // requires fresh same-run OIDC; it never issues another upload permit.
   const observed=await invoke('/v1/execution/complete',body);require(observed.status==='SUCCEEDED'&&observed.requestDigest===digest(body),'previous upload remains UNKNOWN');records.push(observed.receipt);continue;
  }
  if(auth.status==='SUCCEEDED'){require(auth.requestDigest===digest(body),'prior upload identity changed');records.push(auth.receipt);continue;}
  require(auth.status==='AUTHORIZED'&&auth.requestDigest===digest(body)&&Date.parse(auth.expiresAt)>clock(),'fresh upload authority required');
  const reference=authorizationRef(auth),permit=await invoke('/v1/execution/perform',{...body,authorizationRef:reference});
  require(permit.status==='RUNNER_PERMITTED'&&permit.operationId===auth.operationId&&permit.fence===auth.fence&&permit.requestDigest===digest(body)&&permit.releaseId===releaseId&&(!permit.repository||permit.repository===repository)&&Date.parse(permit.expiresAt)>clock(),'immutable upload permit required');
  require(typeof env.GH_TOKEN==='string'&&env.GH_TOKEN.length>0,'runner GitHub credential unavailable');
  const hash=createHash('sha256');let sent=0;const stream=async function*(){for await(const chunk of fs.createReadStream(file)){sent+=chunk.length;require(sent<=asset.size,'file changed during transfer');hash.update(chunk);yield chunk;}};
  let receipt;
  try {
   const url=new URL(`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets`);url.searchParams.set('name',asset.name);
   const response=await fetchImpl(url,{method:'POST',headers:{authorization:`Bearer ${env.GH_TOKEN}`,accept:'application/vnd.github+json','content-type':'application/octet-stream','content-length':String(asset.size),'user-agent':'hypeproof-original-runner'},body:stream(),duplex:'half',redirect:'error',signal:AbortSignal.timeout(1800000)});
   require(sent===asset.size&&hash.digest('hex')===asset.sha256,'original bytes changed while uploading');require(response.ok,'upload response UNKNOWN; reconciliation required');
   const assetResult=await response.json();require(Number.isSafeInteger(assetResult.id)&&assetResult.id>0,'numeric uploaded asset unavailable');receipt={assetId:assetResult.id};
  }catch(error){
   // No retry: the accepted remote write may exist despite a transport failure.
   const observed=await invoke('/v1/execution/complete',{...body,authorizationRef:reference});require(observed.status==='SUCCEEDED'&&observed.requestDigest===digest(body),'upload remains UNKNOWN');records.push(observed.receipt);continue;
  }
  const completed=await invoke('/v1/execution/complete',{...body,authorizationRef:reference,receipt});require(completed.status==='SUCCEEDED'&&completed.requestDigest===digest(body),'uploaded bytes not independently confirmed');records.push(completed.receipt);
 }
 if(protocol.publishKind){const publication=executionBody({path:effectPath,identity,effect:{kind:protocol.publishKind,releaseId}},env),auth=await invoke('/v1/execution/authorize',publication);require(auth.status==='AUTHORIZED'&&auth.requestDigest===digest(publication)&&Date.parse(auth.expiresAt)>clock(),'fresh mirror publication authority required');const done=await invoke('/v1/execution/perform',{...publication,authorizationRef:authorizationRef(auth)});require(done.status==='SUCCEEDED'&&done.requestDigest===digest(publication),'mirror publication UNKNOWN');}
 return {releaseId,assets:records};
}
export async function transferMirror({identity,effectPath,directory},options={}) {
 const env=options.env??process.env,fetchImpl=options.fetchImpl??fetch;const metadata={};
 fs.mkdirSync(directory,{recursive:true});require(fs.readdirSync(directory).length===0,'mirror transfer needs an empty temporary directory');
 const protocol={repository:'hypeproof/hypeproof-studio-releases',createKind:'mirror-release-create',uploadKind:'mirror-asset-upload',publishKind:'mirror-publish',assetMetadata:metadata,prepareAssets:async context=>{
  require(context.repository==='hypeproof/hypeproof-studio-releases'&&Array.isArray(context.assets)&&context.assets.length>0&&context.assets.length<100,'approved mirror source inventory unavailable');
  for(const asset of context.assets){require(Number.isSafeInteger(asset.sourceAssetId)&&asset.sourceAssetId>0&&asset.name===path.basename(asset.name)&&/^[A-Za-z0-9][A-Za-z0-9._+ -]{0,180}$/.test(asset.name)&&Number.isSafeInteger(asset.size)&&asset.size>0&&/^[a-f0-9]{64}$/.test(asset.sha256),'approved source asset invalid');
   let response=await fetchImpl('https://api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/'+asset.sourceAssetId,{headers:{accept:'application/octet-stream',...(env.HPS_SOURCE_GITHUB_TOKEN?{authorization:`Bearer ${env.HPS_SOURCE_GITHUB_TOKEN}`}:{})},redirect:'manual',signal:AbortSignal.timeout(1800000)});
   if([301,302,303,307,308].includes(response.status)){const url=new URL(response.headers.get('location'));require(url.protocol==='https:'&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)&&!url.username&&!url.password,'source asset redirect rejected');response=await fetchImpl(url,{headers:{accept:'application/octet-stream'},redirect:'error',signal:AbortSignal.timeout(1800000)});}
   require(response.ok&&response.body,'approved source asset unavailable');let size=0;const hash=createHash('sha256'),verify=new Transform({transform(chunk,_encoding,done){size+=chunk.length;if(size>asset.size)return done(Error('source asset grew'));hash.update(chunk);done(null,chunk);}});
   const file=path.join(directory,asset.name);await pipeline(Readable.fromWeb(response.body),verify,fs.createWriteStream(file,{flags:'wx'}));require(size===asset.size&&hash.digest('hex')===asset.sha256,'approved source bytes changed');metadata[asset.name]={sourceAssetId:asset.sourceAssetId};
  }
 }};
 return transferDraft({identity,effectPath,directory,protocol},options);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 try{const [effectPath,directory,mode]=process.argv.slice(2);const transfer=mode==='mirror'?transferMirror:transferDraft;await transfer({identity:workflowIdentity(),effectPath,directory});}
 catch(error){console.error(error.message.startsWith('BLOCKED')?error.message:'BLOCKED original runner transfer; reconcile UNKNOWN before retry');process.exitCode=1;}
}
