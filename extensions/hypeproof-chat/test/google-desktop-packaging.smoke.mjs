import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { packageGoogleDesktopClient } from '../../../scripts/package-google-desktop-client.mjs';
import { loadPackagedGoogleDesktopClient } from '../src/googleDesktopClient.ts';
import { parseGoogleDesktopSource } from '../src/googleDesktopClientSchema.mjs';
const clientId='synthetic-desktop.apps.googleusercontent.com';
const secret='synthetic-desktop-client-identity';
const input={installed:{client_id:clientId,client_secret:secret,redirect_uris:['http://localhost'],token_uri:'https://oauth2.googleapis.com/token'}};
async function fixture(){
 const root=await fs.mkdtemp(path.join(tmpdir(),'hps-package-google-'));
 const source=path.join(root,'protected','desktop.json');const extension=path.join(root,'app','extensions','hypeproof-chat');
 await fs.mkdir(path.dirname(source),{recursive:true,mode:0o700});await fs.mkdir(extension,{recursive:true,mode:0o755});
 await fs.writeFile(source,JSON.stringify(input),{mode:0o600});await fs.writeFile(path.join(extension,'package.json'),JSON.stringify({name:'hypeproof-chat',publisher:'hypeproof'}));
 return{root,source,extension,args:{credentialFile:source,extensionDirectory:extension},resource:path.join(extension,'oauth','google-desktop-client.json')};
}

test('explicit external staging includes only native app identity and binds the Service client ID', {skip:process.platform==='win32'},async()=>{
 const f=await fixture();try{
  assert.equal(await loadPackagedGoogleDesktopClient(f.extension,clientId),undefined);
  assert.deepEqual(await packageGoogleDesktopClient(f.args),{packaged:true});
  assert.deepEqual(JSON.parse(await fs.readFile(f.resource,'utf8')),{schema:'hps-google-desktop/1',clientId,clientSecret:secret});
  assert.equal(await loadPackagedGoogleDesktopClient(f.extension,clientId),secret);
  await assert.rejects(loadPackagedGoogleDesktopClient(f.extension,'another.apps.googleusercontent.com'),error=>!error.message.includes(secret)&&!error.message.includes(f.root));
  await assert.rejects(packageGoogleDesktopClient(f.args));assert.equal(await loadPackagedGoogleDesktopClient(f.extension,clientId),secret,'existing credential must not be overwritten or removed');
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('web credentials, user tokens and changed endpoints are rejected before any package write', {skip:process.platform==='win32'},async()=>{
 for(const invalid of [{web:input.installed},{...input,refresh_token:'synthetic-user-token'},{installed:{...input.installed,refresh_token:'synthetic-user-token'}},{installed:{...input.installed,access_token:'synthetic-user-token'}},{installed:{...input.installed,token_uri:'https://other.invalid/token'}},{installed:{...input.installed,redirect_uris:['https://other.invalid/callback']}}]){
  const f=await fixture();try{await fs.writeFile(f.source,JSON.stringify(invalid));await assert.rejects(packageGoogleDesktopClient(f.args),error=>!error.message.includes(f.root)&&!error.message.includes(secret));await assert.rejects(fs.stat(f.resource));}finally{await fs.rm(f.root,{recursive:true,force:true});}
 }
 assert.throws(()=>parseGoogleDesktopSource('{synthetic-private-parse-error'),error=>!error.message.includes('synthetic-private'));
});

test('symlinks and writable/unprotected inputs fail closed; no workspace output is used', {skip:process.platform==='win32'},async()=>{
 const f=await fixture();try{
  await fs.chmod(f.source,0o644);await assert.rejects(packageGoogleDesktopClient(f.args));await fs.chmod(f.source,0o600);
  const link=path.join(f.root,'source-link');await fs.symlink(f.source,link);await assert.rejects(packageGoogleDesktopClient({...f.args,credentialFile:link}));
  await assert.rejects(packageGoogleDesktopClient({...f.args,extensionDirectory:path.resolve('..','hypeproof-chat')}));
  await packageGoogleDesktopClient(f.args);await fs.chmod(f.resource,0o666);await assert.rejects(loadPackagedGoogleDesktopClient(f.extension,clientId));await fs.chmod(f.resource,0o644);
  const saved=path.join(f.root,'saved-resource');await fs.rename(f.resource,saved);await fs.symlink(saved,f.resource);await assert.rejects(loadPackagedGoogleDesktopClient(f.extension,clientId));
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
