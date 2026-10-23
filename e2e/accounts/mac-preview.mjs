// Actual isolated macOS app and bundled source. Synthetic identity/Service only; no model or payment.
import {_electron as electron} from '@playwright/test';
import {macWindow} from '../classroom/mac-window.mjs';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import { launchStudio } from '../../scripts/lib/studio-launcher.mjs';
const state=process.env.HPS_ACCOUNT_DEV_STATE;
const out=process.env.HPS_ACCOUNT_EVIDENCE;
if(!state||!out)throw Error('Set HPS_ACCOUNT_DEV_STATE and HPS_ACCOUNT_EVIDENCE to isolated owned paths');
const receipt=JSON.parse(readFileSync(path.join(state,'receipt.json'),'utf8'));
if(!receipt.official_app_unchanged||receipt.app.startsWith('/Applications/'))throw Error('Prepared isolated app required');
mkdirSync(out,{recursive:true});
const app=await launchStudio(electron, {executablePath:path.join(receipt.app,'Contents/MacOS/HypeProof Studio'),args:['--user-data-dir='+path.join(state,'user-data'),'--extensions-dir='+path.join(state,'extensions'),'--use-inmemory-secretstorage','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=9393','--folder-uri',new URL('file://'+path.join(state,'workspace')).href],env:{...process.env,VSCODE_CLI:'1',HPS_TEST_E2E:'1'},timeout:45000}, { label: 'account-preview', secretStorage: 'inmemory', quiet: 'caller' });
await app.evaluate(({app, BrowserWindow, shell})=>{
 app.dock?.hide();
 globalThis.__accountPreviewRevealed=false;
 const stash=w=>{if(globalThis.__accountPreviewRevealed)return;w.setFocusable(false);w.setPosition(-4000,-4000);w.showInactive();};
 const wire=w=>{stash(w);w.on('show',()=>stash(w));w.once('ready-to-show',()=>stash(w));};
 for(const w of BrowserWindow.getAllWindows())wire(w);
 app.on('browser-window-created',(_e,w)=>wire(w));
 globalThis.__accountPreviewLinks=[];
 globalThis.__accountPreviewOriginalOpenExternal=shell.openExternal;
 shell.openExternal=async url=>{globalThis.__accountPreviewLinks.push(url);};
});
const driver=macWindow({debugPort:9393,realFetch:fetch,out});
const window=await driver.attach();
await window.setViewportSize({width:1440,height:1000});
await window.keyboard.press('Escape');
const frame=await driver.frame('.studio-start');
const shot=async name=>{await window.waitForTimeout(350);await window.screenshot({path:path.join(out,name+'.png')});};
await shot('01-start-google');
await driver.press(frame,'.studio-account .studio-primary','Google sign-in');
await driver.wait(()=>frame.evaluate("document.body.textContent.includes('브라우저에서 연결을 승인해 주세요')"),'device approval waiting',30000);
await shot('02-device-approval-waiting');
const links=await app.evaluate(()=>globalThis.__accountPreviewLinks);
writeFileSync(path.join(out,'device-link.json'),JSON.stringify({url:links.at(-1),cdp:'http://127.0.0.1:9393',evidence:'actual prepared Mac app, in-memory SecretStorage'},null,2));
console.log('APP_READY_APPROVAL',links.at(-1));
await driver.wait(()=>frame.evaluate("document.body.textContent.includes('내 이용권')"),'browser approved device',900000);
await shot('03-signed-in-passes');console.log('APP_SIGNED_IN',await frame.evaluate("document.querySelector('.studio-account').innerText"));
await driver.wait(()=>frame.evaluate("!!document.querySelector('.studio-account-pass .studio-choice:not(:disabled)')"),'paid account pass',900000);
await driver.press(frame,'.studio-account-pass .studio-choice:not(:disabled)','Activate own pass');
await driver.wait(()=>frame.evaluate("document.body.textContent.includes('이 활동 시작하기')"),'pass activity preview',30000);
await shot('04-pass-activity-preview');console.log('APP_PASS_PREVIEW_READY');
await app.evaluate(({shell})=>{shell.openExternal=globalThis.__accountPreviewOriginalOpenExternal;});
console.log('APP_LEFT_RUNNING',await app.process().pid);
// The customer preview remains alive until its owned stop file is created.
let revealed=false;
while(!existsSync(path.join(state,'stop-preview'))){
 if(!revealed&&existsSync(path.join(state,'reveal-preview'))){
  await app.evaluate(({app,BrowserWindow})=>{globalThis.__accountPreviewRevealed=true;app.dock?.show();for(const w of BrowserWindow.getAllWindows()){w.setFocusable(true);w.center();w.show();w.focus();}});
  revealed=true;console.log('APP_REVEALED_FOR_CUSTOMER');
 }
 await new Promise(r=>setTimeout(r,1000));
}
await app.close();
