// Official source releases are readable with this repository's contents-read job
// token. The private mirror is not an auth fallback or an extra permission grant.
import {execFileSync} from 'node:child_process';
export const OFFICIAL_SHELL_REPOSITORY='hypeproof/hypeproof-studio';
const TAG=/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
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
  release(tag=''){
   if(tag&&!TAG.test(tag))throw Error('Invalid official app tag');
   let release;
   try{release=JSON.parse(execute('gh',['api',`repos/${OFFICIAL_SHELL_REPOSITORY}/releases/${tag?'tags/'+tag:'latest'}`],{cwd,encoding:'utf8',env:releaseEnv}));}
   catch{throw Error('BLOCKED: official Studio release metadata unavailable; current-repository contents-read access and a published stable shell are required');}
   if(!release||release.draft!==false||release.prerelease!==false||!TAG.test(release.tag_name??'')||!Array.isArray(release.assets))throw Error('Only a published stable official shell is accepted by this hosted slice');
   return release;
  },
  download(tag,name,directory){
   if(!TAG.test(tag)||typeof name!=='string'||!name||/[\\/\x00]/.test(name)||name==='.'||name==='..')throw Error('Invalid official shell asset identity');
   return execute('gh',['release','download',tag,'--repo',OFFICIAL_SHELL_REPOSITORY,'--pattern',name,'--dir',directory],{cwd,stdio:'inherit',env:releaseEnv});
  },
 };
}
