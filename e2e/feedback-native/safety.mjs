import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
export const sha256=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceScopes=['extensions/hypeproof-chat','scripts/studio-dev.py','config/service-packages.json'];
export function sourceSnapshot(source){
 const git=(...args)=>execFileSync('git',args,{cwd:source});
 const sha=git('rev-parse','HEAD').toString().trim(),status=git('status','--porcelain=v1','-z','--untracked-files=no'),untracked=git('ls-files','-z','--others','--exclude-standard','--',...sourceScopes);
 const names=[...new Set(git('ls-files','-z','--cached','--others','--exclude-standard','--',...sourceScopes).toString('utf8').split('\0').filter(Boolean))].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
 let symlinks=false;
 const entries=names.map(name=>{const file=path.join(source,name);let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return[name,'missing',''];throw error;}if(stat.isSymbolicLink()){symlinks=true;return[name,'symlink',fs.readlinkSync(file)];}if(!stat.isFile())throw Error('Cannot bind non-file source input: '+name);return[name,'file',sha256(file)];});
 return {format:'hps-studio-source/1',sha,dirty:!!(status.length||untracked.length),scopes:sourceScopes,inputs_sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),file_count:entries.length,has_symlinks:symlinks,status_sha256:createHash('sha256').update(status).update(Buffer.from([0])).update(untracked).digest('hex')};
}
export function loopback(value){const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Only an explicit credential-free loopback HTTP endpoint is allowed');return url.origin;}
export function within(child,parent){const rel=path.relative(path.resolve(parent),path.resolve(child));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
export function validateConfig(c){
 if(c?.schema!=='hps-feedback-native/1'||!c.candidate?.app||!c.candidate?.receipt||!c.service?.manifest||!c.workspace?.a||!c.workspace?.b||!c.evidence)throw Error('Missing explicit candidate/Service/workspace/evidence config');
 loopback(c.service.origin);if(c.cdp)loopback(c.cdp);
 for(const p of [c.candidate.app,c.candidate.receipt,c.workspace.a,c.workspace.b,c.evidence,c.userDataDir,c.service.manifest,c.service.tokenAFile])if(typeof p!=='string'||!path.isAbsolute(p))throw Error('All local paths must be explicit absolute paths');
 if(path.resolve(c.workspace.a)===path.resolve(c.workspace.b))throw Error('A and B must be different real folders');
 if(within(c.userDataDir,c.candidate.app)||within(c.workspace.a,c.candidate.app)||within(c.workspace.b,c.candidate.app)||within(c.evidence,c.candidate.app))throw Error('User data, work and evidence must remain outside the application');
 if(c.secretStorage!=='os-keychain'&&c.secretStorage!=='inmemory')throw Error('Declare secretStorage os-keychain or inmemory; the latter cannot prove process restart credential persistence');
 return c;
}
export function candidateProof(c){
 const app=fs.realpathSync(c.candidate.app),receipt=JSON.parse(fs.readFileSync(c.candidate.receipt,'utf8'));
 if(receipt.format!=='hps-studio-dev/1'||receipt.official_app_unchanged!==true||fs.realpathSync(receipt.app)!==app)throw Error('A studio-dev.py isolated-copy receipt is required; installed application is not an acceptance target');
 const resources=path.join(app,process.platform==='darwin'?'Contents/Resources/app':'resources/app'),extension=path.join(resources,'extensions/hypeproof-chat');
 const actual=sha256(path.join(extension,'dist/extension.js'));
 if(actual!==receipt.extension_sha256)throw Error('Candidate extension bytes differ from the preparation receipt');
 const source=fs.realpathSync(receipt.source),binding=sourceSnapshot(source),sourceSha=binding.sha;
 if(!/^[a-f0-9]{40}$/.test(receipt.source_sha??'')||receipt.source_sha!==sourceSha)throw Error('Preparation receipt source SHA is missing or stale; reprepare this exact checkout');
 if(receipt.source_dirty!==false||receipt.source_binding?.dirty!==false||binding.dirty)throw Error('Candidate source changed or was dirty at preparation; commit/reprepare before acceptance');
 if(receipt.source_binding?.format!=='hps-studio-source/1'||receipt.source_binding.has_symlinks!==false||binding.has_symlinks||!isDeepStrictEqual(receipt.source_binding,binding))throw Error('Preparation receipt source input binding is missing or changed');
 if(c.candidate.sourceSha&&c.candidate.sourceSha!==sourceSha)throw Error('Candidate source SHA is stale');
 if(sha256(path.join(path.dirname(c.candidate.receipt),'build/extension.js'))!==actual)throw Error('Preparation stage build output differs from injected candidate');
 const product=JSON.parse(fs.readFileSync(path.join(resources,'product.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(extension,'package.json'),'utf8'));
 return {level:'prepared-injected-native-candidate',source_sha:receipt.source_sha,source_binding:binding,prepared_at:receipt.prepared_at,app,extension_sha256:actual,shell:{name:product.nameLong,version:product.version,commit:product.commit},extension_version:pkg.version,commandTitles:Object.fromEntries(pkg.contributes.commands.map(x=>[x.command,x.title])),commands:pkg.contributes.commands.map(x=>x.command),source_dirty:false,public_release:false};
}
export function sanitize(text,secrets=[]){let result=String(text);for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))result=result.split(secret).join('[REDACTED]');return result.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]');}
export function assertNoBackdoors(userDataDir,launchEnv){
 const testKeys=Object.keys(launchEnv).filter(key=>key.startsWith('HPS_TEST_'));
 if(testKeys.some(key=>!['HPS_TEST_E2E','HPS_TEST_REAL_WORKSPACE'].includes(key))||testKeys.length&&(launchEnv.HPS_TEST_E2E!=='1'||launchEnv.HPS_TEST_REAL_WORKSPACE!=='1'))throw Error('Only paired analytics isolation + explicit production workspace routing is accepted; no token/history backdoors');
 if(fs.existsSync(path.join(userDataDir,'User/hps-test-state.json')))throw Error('A test-state backdoor file prevents production-routing acceptance');
}
// Config/environment cannot opt a user's desktop into input. Only an explicit invocation flag can.
export const foregroundAllowed=args=>args.includes('--allow-foreground')&&!args.includes('--preflight');
