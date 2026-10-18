// Real macOS protocol dispatch and original-window focus. Synthetic local account approval only.
import assert from 'node:assert/strict';
import {_electron as electron} from '@playwright/test';
import {macWindow} from '../classroom/mac-window.mjs';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
assert.equal(process.platform,'darwin','This acceptance requires macOS');
const state=process.env.HPS_ACCOUNT_DEV_STATE,out=process.env.HPS_ACCOUNT_EVIDENCE,configPath=process.env.HPS_ACCOUNT_CONFIG;
assert(state&&out&&configPath,'Explicit owned app, evidence and local synthetic config paths required');
assert(!existsSync(out),'Preserve earlier evidence');mkdirSync(out,{recursive:true});
const receipt=JSON.parse(readFileSync(path.join(state,'receipt.json'),'utf8'));
assert(receipt.official_app_unchanged&&!receipt.app.startsWith('/Applications/'),'Only prepared isolated app allowed');
assert.equal(receipt.source_dirty,false,'Acceptance requires committed source');
const config=JSON.parse(readFileSync(configPath,'utf8')),bridge={'x-hps-account-key':config.bridge};
const result={schema:'studio-account-native-return/1',status:'RUNNING',candidate:receipt,os:process.platform,checks:[],scope:'Real isolated Mac app, URI dispatch and focus; synthetic local Service approval; no real Google, billing or release acceptance'};
const save=()=>writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));save();
const call=async(endpoint,body)=>{const response=await fetch('http://127.0.0.1:8793/v1'+endpoint,{method:'POST',headers:{...bridge,'content-type':'application/json','cf-connecting-ip':'198.51.100.42'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,endpoint+' succeeds');return response.json();};
let app,identity;
try{
 const uid=randomUUID();identity=await call('/internal/accounts/upsert',{provider:'google',subject:'synthetic-native-return-'+uid,email:'native-'+uid+'@example.invalid',email_verified:true,display_name:'기기 복귀 검수',age_band:'14+',consents:['terms','privacy','overseas_transfer'].map(kind=>({kind,version:'2026-10-15',granted:true})),session_label:'Native return acceptance'});
 execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',receipt.app]);
 app=await electron.launch({executablePath:path.join(receipt.app,'Contents/MacOS/HypeProof Studio'),args:['--user-data-dir='+path.join(state,'user-data'),'--extensions-dir='+path.join(state,'extensions'),'--use-inmemory-secretstorage','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-background-timer-throttling','--remote-debugging-port=9394','--folder-uri',pathToFileURL(path.join(state,'workspace')).href],env:{...process.env,VSCODE_CLI:'1',HPS_TEST_E2E:'1'},timeout:45000});
 await app.evaluate(({shell})=>{globalThis.__accountReturnLinks=[];const original=shell.openExternal.bind(shell);shell.openExternal=async(url,...rest)=>{if(url.startsWith('http://localhost:3193/studio/connect')){globalThis.__accountReturnLinks.push(url);return;}return original(url,...rest);};});
 const driver=macWindow({debugPort:9394,realFetch:fetch,out}),first=await driver.attach();
 await first.keyboard.press('Escape');const frame=await driver.frame('.studio-account');
 const firstNative=await app.evaluateHandle(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('workbench'))),firstId=await firstNative.evaluate(w=>w.id);
 assert.equal(await frame.evaluate("!!document.querySelector('.studio-account .studio-primary svg')"),true,'Google entry has visible brand mark');
 await first.screenshot({path:path.join(out,'01-google-entry.png')});
 // A second genuine Studio workbench makes last-window activation an observable failure.
 await first.keyboard.press('Meta+Shift+N');
 await driver.wait(()=>driver.workbenches().length>=2,'second Studio workbench',45000);
 const secondNative=await app.evaluateHandle(({BrowserWindow},original)=>BrowserWindow.getAllWindows().find(w=>w.id!==original&&w.webContents.getURL().includes('workbench')),firstId),secondId=await secondNative.evaluate(w=>w.id);
 assert.notEqual(firstId,secondId);
 const focused=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getFocusedWindow()?.id??null);
 for(const mode of ['poll-without-browser-return','browser-protocol-return']){
  await firstNative.evaluate(w=>{w.show();w.focus();});
  await driver.press(frame,'.studio-account .studio-primary','Google start');
  await driver.wait(()=>frame.evaluate("document.body.textContent.includes('브라우저에서 연결을 승인해 주세요')"),'pending device');
  const link=await app.evaluate(()=>globalThis.__accountReturnLinks.at(-1)),code=new URL(link).searchParams.get('code');assert(code);
  await secondNative.evaluate(w=>{w.show();w.focus();});await driver.wait(async()=>await focused()===secondId,'other workbench focused');
  const approval=await call('/internal/accounts/device/approve',{user_code:code,account_id:identity.account.id,approve:true});
  const uri=new URL(approval.return_uri);assert.equal(uri.hostname,'hypeproof.hypeproof-chat');assert.equal(uri.pathname,'/account-return');assert.equal(Number(uri.searchParams.get('windowId')),firstId);
  assert.deepEqual([...uri.searchParams.keys()].sort(),['state','windowId']);
  if(mode==='browser-protocol-return')execFileSync('/usr/bin/open',[approval.return_uri]);
  await driver.wait(()=>frame.evaluate("document.body.textContent.includes('내 이용권')"),'signed in account',30000);
  await driver.wait(async()=>await focused()===firstId,'original Studio window foreground',30000);
  await first.screenshot({path:path.join(out,mode+'.png')});
  result.checks.push({mode,status:'PASS',originating_window:firstId,other_window:secondId,focused_window:await focused(),credentials_in_uri:false});save();
  // Background account refresh must not later steal focus from the other workbench.
  await secondNative.evaluate(w=>w.focus());await new Promise(r=>setTimeout(r,16000));assert.equal(await focused(),secondId);
  result.checks.push({mode:mode+'-no-repeat-focus',status:'PASS'});save();
  await firstNative.evaluate(w=>w.focus());await driver.press(frame,'.studio-account .studio-course-actions button:last-child','Sign out');
  await driver.wait(()=>frame.evaluate("!!document.querySelector('.studio-account .studio-primary')"),'signed out');
 }
 result.status='PASS';
}catch(error){result.status='FAIL';result.error=String(error?.message??error);process.exitCode=1;}
finally{
 if(app)await app.close();
 if(identity?.access_token)await fetch('http://127.0.0.1:8793/v1/me',{method:'DELETE',headers:{authorization:'Bearer '+identity.access_token,'content-type':'application/json'},body:JSON.stringify({confirmation:'DELETE'})}).catch(()=>{});
 save();console.log(JSON.stringify({status:result.status,checks:result.checks,error:result.error,evidence:out}));
}
