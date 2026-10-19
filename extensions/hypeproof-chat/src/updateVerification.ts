// Explicit loopback fixture for release verification; never a production fallback.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {createHash} from 'node:crypto';
export type VerificationOptions = { verificationProfile?: string };
export interface VerificationContext { root: string; profile: string; installRoot: string; workspace: string; origin: string; manifestSha256: string; sourceSha: string; target: 'mac'|'win-user'|'win-system'; debugPort: number }
const ensure=(ok: unknown): void=>{if(!ok)throw new Error('Isolated verification feed configuration is invalid; production fallback refused');};
const contained=(root: string,value: string)=>{const rel=path.relative(root,value);return !!rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
export function verificationContext(options: VerificationOptions = {}, env: NodeJS.ProcessEnv = process.env, executable = process.execPath): VerificationContext | null {
 const enabled=Object.keys(env).some(k=>k.startsWith('HPS_RELEASE_VERIFY_')&&env[k]);if(!enabled)return null;
 ensure(env.HPS_RELEASE_VERIFY_MODE==='local-pinned-feed'&&options.verificationProfile&&env.HPS_RELEASE_VERIFY_ROOT&&env.HPS_RELEASE_VERIFY_FEED);
 const root=fs.realpathSync(env.HPS_RELEASE_VERIFY_ROOT!);ensure(path.basename(root).startsWith('hps-installed-')&&contained(fs.realpathSync(os.tmpdir()),root));
 const profile=fs.realpathSync(options.verificationProfile!);ensure(contained(root,profile)&&!fs.lstatSync(options.verificationProfile!).isSymbolicLink());
 const markerPath=path.join(profile,'.hps-release-verification.json');ensure(!fs.lstatSync(markerPath).isSymbolicLink());const marker=JSON.parse(fs.readFileSync(markerPath,'utf8'));
 ensure(marker.schema==='hps-release-verification/1'&&marker.profile===profile&&marker.root===root&&/^[a-f0-9]{64}$/.test(marker.manifestSha256)&&/^[a-f0-9]{40}$/.test(marker.sourceSha)&&Number.isSafeInteger(marker.expiresAt)&&Date.now()<marker.expiresAt&&marker.expiresAt<=Date.now()+3600000);
 const installRoot=fs.realpathSync(marker.installRoot),workspace=fs.realpathSync(marker.workspace);ensure(contained(root,installRoot)&&contained(root,workspace)&&contained(installRoot,fs.realpathSync(executable)));
 if(marker.target==='win-user'||marker.target==='win-system')ensure(JSON.parse(fs.readFileSync(path.join(installRoot,'resources/app/product.json'),'utf8')).target===marker.target.slice(4));
 ensure(['mac','win-user','win-system'].includes(marker.target)&&Number.isSafeInteger(marker.debugPort)&&marker.debugPort>1024&&marker.debugPort<65536);
 const origin=new URL(env.HPS_RELEASE_VERIFY_FEED!);ensure(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&!!origin.port&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash);
 return {root,profile,installRoot,workspace,origin:origin.origin,manifestSha256:marker.manifestSha256,sourceSha:marker.sourceSha,target:marker.target,debugPort:marker.debugPort};
}
export async function verificationManifest(context: VerificationContext) {
 const response=await fetch(context.origin+'/manifest',{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});ensure(response.ok&&response.body);
 const reader=response.body!.getReader();const parts: Uint8Array[]=[];let size=0;
 for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536){await reader.cancel();ensure(false);}parts.push(chunk.value);}
 const bytes=Buffer.concat(parts);ensure(createHash('sha256').update(bytes).digest('hex')===context.manifestSha256);const manifest=JSON.parse(bytes.toString('utf8'));
 ensure(manifest.schema==='hps-release-verification-feed/1'&&manifest.sourceSha===context.sourceSha&&/^v?\d+\.\d+\.\d+$/.test(manifest.version)&&Array.isArray(manifest.assets)&&manifest.assets.length>0&&manifest.assets.length<=4);
 const ids=new Set();for(const file of manifest.assets){ensure(/^[a-z0-9-]+$/.test(file.id)&&!ids.has(file.id)&&path.basename(file.name)===file.name&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=2*1024**3&&/^[a-f0-9]{64}$/.test(file.sha256));ids.add(file.id);}
 return manifest as {schema:string;sourceSha:string;version:string;assets:Array<{id:string;name:string;size:number;sha256:string}>};
}
export const verificationAssetUrl=(context: VerificationContext,id: string)=>context.origin+'/asset/'+id;
export function verificationProfileFromStorage(storagePath: string): string {
 let cursor=path.resolve(storagePath);while(path.dirname(cursor)!==cursor){if(path.basename(cursor)==='User')return path.dirname(cursor);cursor=path.dirname(cursor);}throw new Error('Cannot identify actual isolated profile');
}
