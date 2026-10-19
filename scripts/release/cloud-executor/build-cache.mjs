// Cache only npm content-addressed downloads, never private Service source or node_modules.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest} from '../engine/core.mjs';
import {hashBytes} from './provider.mjs';
export function buildCacheInputs({read=fs.readFileSync, platform=process.platform, architecture=process.arch, nodeVersion=process.version, abi=process.versions.modules, git=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}={}) {
  const files=['package-lock.json','extensions/hypeproof-chat/package-lock.json','extensions/hypeproof-chat/webview-ui/package-lock.json','scripts/seed-sdk-binary.sh','scripts/seed-sdk-binary.ps1','scripts/release/build-contract.mjs'];
  const hashes=Object.fromEntries(files.map(file=>[file,hashBytes(read(file))]));
  return {schema:'hps-npm-download-cache/1',platform,architecture,nodeVersion,abi,sourceSha:git(),hashes};
}
export function publicTarballKeys(locks) {
 const urls=new Set();
 for(const lock of locks)for(const entry of Object.values(lock.packages??{})) {
  let url;try{url=new URL(entry.resolved);}catch{continue;}
  if(url.protocol==='https:'&&url.hostname==='registry.npmjs.org'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.endsWith('.tgz')&&/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity??''))urls.add(url.href);
 }
 return [...urls].map(url=>`make-fetch-happen:request-cache:${url}`);
}
export async function copyPublicCache({from,to,keys,cacache,integrities}) {
 let copied=0;
 for(const key of keys) {
  let item;try{item=await cacache.get(from,key);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  // Preserve only public response metadata. Never copy request Authorization,
  // npm configuration, logs, local file tarballs or private Service archives.
  if(integrities && integrities[key]!==item.integrity)throw Error('Public npm cache integrity differs from pinned lock');
  const url=key.slice('make-fetch-happen:request-cache:'.length);
  const metadata={time:Date.now(),url,reqHeaders:{},resHeaders:{'content-type':'application/octet-stream','cache-control':'public, max-age=31557600, immutable','content-length':String(item.data.length)}};
  await cacache.put(to,key,item.data,{integrity:item.integrity,metadata});copied++;
 }
 return copied;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 if(['import','export'].includes(process.argv[2])) {
  const npmRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
  const cacache=createRequire(path.join(npmRoot,'npm/package.json'))('cacache');
  const locks=['package-lock.json','extensions/hypeproof-chat/package-lock.json','extensions/hypeproof-chat/webview-ui/package-lock.json'].map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
  const systemCache=execFileSync('npm',['config','get','cache'],{encoding:'utf8'}).trim();
  const publicCache=path.join(process.env.RUNNER_TEMP,'hps-public-npm-cache');
  const [from,to]=process.argv[2]==='import'?[publicCache,path.join(systemCache,'_cacache')]:[path.join(systemCache,'_cacache'),publicCache];
  const integrities=Object.fromEntries(locks.flatMap(lock=>Object.values(lock.packages??{}).filter(entry=>entry.resolved).map(entry=>[`make-fetch-happen:request-cache:${entry.resolved}`,entry.integrity])));
  const copied=await copyPublicCache({from,to,keys:publicTarballKeys(locks),cacache,integrities});
  if(process.argv[2]==='export') {
   const metricsFile=path.join(process.env.RUNNER_TEMP,'hps-build-cache.json');
   const metrics=JSON.parse(fs.readFileSync(metricsFile,'utf8'));
   const finishedAt=new Date().toISOString();
   fs.writeFileSync(metricsFile,JSON.stringify({...metrics,finishedAt,elapsedMs:Date.parse(finishedAt)-Date.parse(metrics.startedAt),cacheHit:process.env.HPS_PUBLIC_CACHE_HIT==='true',publicTarballsExported:copied,measurement:'whole job through cache export; native cold/warm comparison NOT_RUN'},null,2));
  }
  console.log(`Public immutable npm tarballs copied: ${copied}`);
 } else {
 const inputs=buildCacheInputs(); const key=digest(inputs);
 fs.appendFileSync(process.env.GITHUB_OUTPUT,`identity=${key}\n`);
 // Public inputs/digests only; no auth configuration, paths or private source.
 fs.writeFileSync(`${process.env.RUNNER_TEMP}/hps-build-cache.json`,JSON.stringify({inputs,key,startedAt:new Date().toISOString()},null,2));
}
}
