// Official source releases are readable with this repository's contents-read job
// token. The private mirror is not an auth fallback or an extra permission grant.
import {execFileSync} from 'node:child_process';
export const OFFICIAL_SHELL_REPOSITORY='hypeproof/hypeproof-studio';
const TAG=/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const STABLE_TAG=/^v[0-9]+\.[0-9]+\.[0-9]+$/;
const PLATFORMS=new Set(['darwin-arm64','win32-x64']);
function portableAssets(release,platform){
 if(!PLATFORMS.has(platform))throw Error('Unsupported official shell platform');
 const name=new RegExp('^HypeProof(?:-|\\.)Studio-'+platform+'(?:-[0-9]+\\.[0-9]+\\.[0-9]+)?\\.zip$');
 return release.assets.filter(asset=>typeof asset?.name==='string'&&name.test(asset.name));
}
export function portableShellAsset(release,platform){
 const assets=portableAssets(release,platform);
 if(assets.length!==1)throw Error('Expected exactly one official portable shell: tag='+release.tag_name+' platform='+platform+' matches='+assets.length);
 const asset=assets[0],sha=typeof asset.digest==='string'&&asset.digest.startsWith('sha256:');
 if(sha&&!/^sha256:[a-f0-9]{64}$/.test(asset.digest))throw Error('Invalid official shell digest: tag='+release.tag_name+' platform='+platform);
 if(!sha&&!release.assets.some(a=>a?.name==='unified-acceptance.json'))throw Error('BLOCKED official shell lacks digest or acceptance hashes: tag='+release.tag_name+' platform='+platform);
 return asset;
}
function stable(release){return release?.draft===false&&release.prerelease===false&&STABLE_TAG.test(release.tag_name??'')&&Array.isArray(release.assets);}
export function selectPlatformRelease(releases,platform){
 if(!PLATFORMS.has(platform))throw Error('Unsupported official shell platform');
 if(!Array.isArray(releases)||releases.length>1000)throw Error('Invalid or oversized official release catalog');
 const published=releases.filter(stable);
 if(published.some(release=>typeof release.published_at!=='string'||!Number.isFinite(Date.parse(release.published_at))))throw Error('Invalid official release publication time');
 published.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)||b.tag_name.localeCompare(a.tag_name));
 for(const release of published){if(!portableAssets(release,platform).length)continue;portableShellAsset(release,platform);return release;}
 throw Error('BLOCKED no published stable official portable shell for '+platform);
}
export function runtimeEnvironment(env){
 return Object.fromEntries(Object.entries(env).filter(([key])=>!/(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PAT|KEY)(?:_|$)/i.test(key)));
}
/** Injected execution is for background-safe transport tests, never native proof. */
export function hostedCommands(cwd,env=process.env,execute=execFileSync){
 const runtimeEnv=runtimeEnvironment(env);
 const releaseEnv={...runtimeEnv,...(env.GH_TOKEN?{GH_TOKEN:env.GH_TOKEN}:{})};
 return {
  runtimeEnv,
  run(exe,argv){return execute(exe,argv,{cwd,stdio:'inherit',env:runtimeEnv});},
  release(platform,tag=''){
   if(!PLATFORMS.has(platform))throw Error('Unsupported official shell platform');
   if(tag&&!TAG.test(tag))throw Error('Invalid official app tag');
   let metadata;
   try{metadata=JSON.parse(execute('gh',tag?['api',`repos/${OFFICIAL_SHELL_REPOSITORY}/releases/tags/${tag}`]:['api','--paginate','--slurp',`repos/${OFFICIAL_SHELL_REPOSITORY}/releases?per_page=100`],{cwd,encoding:'utf8',env:releaseEnv,timeout:30000,maxBuffer:8*1024*1024}));}
   catch{throw Error('BLOCKED: official Studio release metadata unavailable; current-repository contents-read access and a published stable shell are required');}
   if(tag){
    if(!stable(metadata)||metadata.tag_name!==tag)throw Error('Only the exact published stable official shell tag is accepted');
    portableShellAsset(metadata,platform);return metadata;
   }
   if(!Array.isArray(metadata)||metadata.some(page=>!Array.isArray(page)))throw Error('Invalid official release catalog pages');
   return selectPlatformRelease(metadata.flat(),platform);
  },
  download(tag,name,directory){
   if(!TAG.test(tag)||typeof name!=='string'||!name||/[\\/\x00]/.test(name)||name==='.'||name==='..')throw Error('Invalid official shell asset identity');
   return execute('gh',['release','download',tag,'--repo',OFFICIAL_SHELL_REPOSITORY,'--pattern',name,'--dir',directory],{cwd,stdio:'inherit',env:releaseEnv});
  },
 };
}
