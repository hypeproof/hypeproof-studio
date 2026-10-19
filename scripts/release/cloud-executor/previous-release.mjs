// Read-only N−1 resolver/downloader. No latest alias and no package rebuild.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CloudExecutor,GitHubTransport,requireThat,hashBytes} from './provider.mjs';
const tuple=tag=>/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag)?.slice(1).map(Number);
const compare=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
export async function previousRelease(collection,directory,{transport=new GitHubTransport({maxBytes:1024*1024*1024})}={}) {
 const executor=new CloudExecutor({transport}); const base='/repos/hypeproof/hypeproof-studio';
 const candidates=(await executor.list(`${base}/releases`)).filter(r=>!r.draft&&!r.prerelease&&tuple(r.tag_name)&&compare(tuple(r.tag_name),tuple(collection.identity.version))<0).sort((a,b)=>compare(tuple(b.tag_name),tuple(a.tag_name)));
 requireThat(candidates.length>0,'no supported published previous version');const selected=candidates[0];
 requireThat(candidates.filter(r=>r.tag_name===selected.tag_name).length===1,'ambiguous previous release');
 requireThat(Number.isSafeInteger(selected.id)&&selected.id>0,'numeric previous release ID required');
 const release=await transport.request('GET',`${base}/releases/${selected.id}`);
 requireThat(release.id===selected.id&&!release.draft&&!release.prerelease&&release.tag_name===selected.tag_name,'previous release changed');
 const ref=await transport.request('GET',`${base}/git/ref/tags/${encodeURIComponent(release.tag_name)}`);
 let target=ref.object;
 if(target.type==='tag')target=(await transport.request('GET',`${base}/git/tags/${target.sha}`)).object;
 requireThat(target.type==='commit'&&/^[a-f0-9]{40}$/.test(target.sha),'previous source identity unavailable');
 const rows=await executor.list(`${base}/releases/${release.id}/assets`);
 const patterns={'mac-zip':/^HypeProof-Studio-darwin-arm64\.zip$/,'win-portable':/win32-x64[^/\\]*\.zip$/,'win-user':/UserSetup-x64[^/\\]*\.exe$/,'win-system':/(?<!User)Setup-x64[^/\\]*\.exe$/};
 const assets=[];fs.mkdirSync(directory,{recursive:true});
 for(const [id,pattern]of Object.entries(patterns)) {
  const matches=rows.filter(a=>pattern.test(a.name));requireThat(matches.length===1,'missing/ambiguous previous package');const asset=matches[0];
  requireThat(asset.state==='uploaded'&&/^sha256:[a-f0-9]{64}$/.test(asset.digest)&&asset.size>0,'previous package digest unavailable');
  const bytes=await transport.downloadAsset(asset.id); requireThat(bytes.length===asset.size&&`sha256:${hashBytes(bytes)}`===asset.digest,'previous package bytes changed');
  requireThat(path.basename(asset.name)===asset.name&&!asset.name.includes('\\'),'unsafe previous asset name');
  fs.writeFileSync(path.join(directory,asset.name),bytes);assets.push({id,name:asset.name,sha256:hashBytes(bytes),size:bytes.length,assetId:asset.id});
 }
 const observedAgain=await transport.request('GET',`${base}/git/ref/tags/${encodeURIComponent(release.tag_name)}`);
 requireThat(observedAgain.object?.sha===ref.object.sha&&observedAgain.object?.type===ref.object.type,'previous source tag changed during downloads');
 const result={releaseId:release.id,sourceSha:target.sha,tagObject:ref.object.sha,version:release.tag_name.slice(1),assets};
 fs.writeFileSync(path.join(directory,'previous.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 try {const [input,directory]=process.argv.slice(2);await previousRelease(JSON.parse(fs.readFileSync(input,'utf8')),directory);}
 catch {console.error('BLOCKED: exact N−1 package/source bytes unavailable');process.exitCode=2;}
}
