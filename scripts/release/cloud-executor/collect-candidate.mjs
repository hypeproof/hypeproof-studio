#!/usr/bin/env node
// Read-only candidate collector. Every download uses numeric release/asset IDs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CloudExecutor,GitHubTransport,requireThat,hashBytes} from './provider.mjs';
import {collectAssets} from './evidence.mjs';
export async function collectCandidate(input, directory, {transport=new GitHubTransport({maxBytes:1024*1024*1024}),now=Date.now}={}) {
 const executor=new CloudExecutor({transport,now});
 const observation=await executor.observe(input);
 const pinned={...input,releaseId:observation.releaseId,runs:Object.fromEntries(observation.builds.map(run=>[run.workflow,{id:run.id,attempt:run.attempt}]))};
 const receipts=[];
 for(const platform of ['darwin-arm64','win32-x64']) {
  const matches=observation.assets.filter(a=>a.name===`draft-build-${platform}.json`);
  requireThat(matches.length===1,'missing/ambiguous draft build receipt');
  requireThat(matches[0].size>0&&matches[0].size<=1024*1024,'receipt exceeds JSON limit');
  const bytes=await transport.downloadAsset(matches[0].id);
  requireThat(bytes.length===matches[0].size&&matches[0].digest===`sha256:${hashBytes(bytes)}`,'receipt bytes differ from numeric provider asset');
  requireThat(bytes.length<=1024*1024,'receipt exceeds JSON limit');
  receipts.push(JSON.parse(bytes.toString('utf8')));
 }
 const downloaded={};
 for(const receipt of receipts) for(const asset of receipt.assets??[]) {
  requireThat(['mac-zip','win-portable','win-user','win-system'].includes(asset.id)&&!downloaded[asset.id],'invalid/duplicate package role');
  const matches=observation.assets.filter(a=>a.size===asset.size&&a.digest===`sha256:${asset.sha256}`);
  requireThat(matches.length===1,'missing/ambiguous immutable package bytes');
  downloaded[asset.id]={assetId:matches[0].id,bytes:await transport.downloadAsset(matches[0].id)};
 }
 // Reread after downloads: tag/release/run attempts cannot drift while bytes arrive.
 const finalObservation=await executor.observe(pinned);
 const collection=collectAssets(finalObservation,receipts,downloaded,{now:now()});
 fs.mkdirSync(directory,{recursive:true});
 for(const asset of collection.assets) {
  requireThat(path.basename(asset.name)===asset.name&&!asset.name.includes('\\'),'unsafe receipt asset filename');
  fs.writeFileSync(path.join(directory,asset.name),downloaded[asset.id].bytes);
 }
 for(const receipt of receipts)fs.writeFileSync(path.join(directory,`draft-build-${receipt.platform}.json`),JSON.stringify(receipt,null,2));
 fs.writeFileSync(path.join(directory,'collection.json'),JSON.stringify(collection,null,2));
 return collection;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 try {const [input,directory]=process.argv.slice(2);await collectCandidate(JSON.parse(fs.readFileSync(input,'utf8')),directory);}
 catch {console.error('BLOCKED numeric candidate collection; source/release/run/bytes identity not established');process.exitCode=2;}
}
