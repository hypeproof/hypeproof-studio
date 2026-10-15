// Separate extension-host processes must never consume the same rotating refresh token twice.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-lock-'));
try{
 const b=await build({stdin:{contents:"export * from './src/accountLock.ts';export * from './src/accountSession.ts';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'cjs',write:false});
 fs.writeFileSync(path.join(dir,'host.cjs'),b.outputFiles[0].text);
 fs.writeFileSync(path.join(dir,'credential.json'),JSON.stringify({service:'http://127.0.0.1:8793/v1',accessToken:'old-access',refreshToken:'old-refresh',sessionId:'session-one',expiresAt:1}));
 fs.writeFileSync(path.join(dir,'account-session.owner.2147483647.crashed-before-publish'),'');
 fs.mkdirSync(path.join(dir,'account-session.recovery.2147483647.crashed-owner'));
 fs.writeFileSync(path.join(dir,'account-session.lock'),JSON.stringify({pid:2147483647,nonce:'dead-host'}));
 fs.writeFileSync(path.join(dir,'child.cjs'),`
 const fs=require('node:fs'),path=require('node:path');
 const {accountLock,AccountSession}=require('./host.cjs');
 const credential=path.join(__dirname,'credential.json');
 const secrets={get:async()=>fs.readFileSync(credential,'utf8'),store:async(_k,v)=>fs.writeFileSync(credential,v),delete:async()=>fs.unlinkSync(credential)};
 const client=new AccountSession({service:'http://127.0.0.1:8793/v1',site:'http://localhost:3193',label:'process',secrets,openBrowser:async()=>true,lock:accountLock(__dirname),fetch:async(_url,init)=>{
   if(JSON.parse(init.body).refresh_token!=='old-refresh')throw Error('unexpected refresh');
   fs.writeFileSync(path.join(__dirname,'critical'),'',{flag:'wx'});
   await new Promise(r=>setTimeout(r,80));
   fs.appendFileSync(path.join(__dirname,'rotations'),'one\\n');
   fs.unlinkSync(path.join(__dirname,'critical'));
   return new Response(JSON.stringify({access_token:'new-access',refresh_token:'new-refresh',session_id:'session-one',expires_in:3600}),{status:200});
 }});
 client.accessToken().then(token=>{if(token!=='new-access')throw Error('stale runtime credential');client.dispose()}).catch(e=>{console.error(e.message);process.exitCode=1});
 `);
 await Promise.all(Array.from({length:6},()=>promisify(execFile)(process.execPath,[path.join(dir,'child.cjs')])));
 assert.equal(fs.readFileSync(path.join(dir,'rotations'),'utf8'),'one\n');
 assert.equal(fs.existsSync(path.join(dir,'account-session.lock')),false);
 assert.equal(fs.readdirSync(dir).some(p=>p.startsWith('account-session.recovery.')),false,'a crash immediately after barrier mkdir cannot brick future hosts');
 console.log('PASS six processes recover a dead host and its abandoned barrier, then rotate one refresh token exactly once');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
