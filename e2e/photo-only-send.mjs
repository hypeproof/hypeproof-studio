// Stateful React boundary regression. Actual Windows App/AI/Pages is recorded separately.
import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chatPanelProps} from '../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ext=path.join(root,'extensions/hypeproof-chat');
const temp=await mkdtemp(path.join(os.tmpdir(),'hps-photo-send-'));
const out=path.join(root,'e2e/test-results/photo-only-send');await mkdir(out,{recursive:true});
const fixture=chatPanelProps();fixture.config.profile.input={image_files:true};
fixture.config.profile.classroom_panels={help_request:false,artifact_approval:false};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from ${JSON.stringify(path.join(ext,'webview-ui/src/ChatPanel.tsx'))};const root=createRoot(document.getElementById('root'));const props=${JSON.stringify(fixture)};window.baseConfig=props.config;props.onSend=(...args)=>window.sends.push(args);window.render=(over={})=>root.render(<ChatPanel {...props} {...over}/>);window.render();`,resolveDir:path.join(ext,'webview-ui'),loader:'tsx'},bundle:true,loader:{'.svg':'dataurl','.css':'empty'},platform:'browser',jsx:'automatic',outfile:path.join(temp,'ui.js')});
const server=createServer(async(req,res)=>{res.setHeader('content-type',req.url==='/ui.js'?'text/javascript':'text/html');res.end(req.url==='/ui.js'?await readFile(path.join(temp,'ui.js')):'<div id="root"></div><script src="/ui.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
try {
 const p=await browser.newPage();await p.setContent('<body style="background:green">owned fixture</body>');const photo=await p.screenshot();
 await p.addInitScript(()=>{window.sends=[];window.hostEvents=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.hostEvents.push(m),getState:()=>undefined,setState:()=>{}})});
 await p.goto('http://127.0.0.1:'+server.address().port);const send=p.getByRole('button',{name:'Send',exact:true});const input=p.locator('.hps-input textarea');
 const ack=async(stage,type='imageStagedByHost')=>p.evaluate(({stage,type})=>window.dispatchEvent(new MessageEvent('message',{data:{type,stageId:stage.stageId,name:stage.name,reason:'test refusal'}})),{stage,type});
 async function drop(){const n=await p.evaluate(()=>window.hostEvents.filter(x=>x.type==='stageImage').length);const dt=await p.evaluateHandle(b64=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'sample.png',{type:'image/png'}));return d},photo.toString('base64'));await p.locator('.hps-shell').dispatchEvent('drop',{dataTransfer:dt});await p.waitForFunction(n=>window.hostEvents.filter(x=>x.type==='stageImage').length>n,n);return p.evaluate(()=>window.hostEvents.filter(x=>x.type==='stageImage').at(-1));}
 const first=await drop();await p.locator('.hps-attachment-file img').waitFor();await expect(send).toBeDisabled();await input.press('Enter');assert.equal(await p.evaluate(()=>window.sends.length),0,'no send before host staging acknowledgement');
 await ack(first);await expect(send).toBeEnabled();await send.click();assert.equal(await p.evaluate(()=>window.sends.length),1,'photo-only button sends');
 const second=await drop();await ack(second);await expect(send).toBeEnabled();await input.press('Enter');assert.equal(await p.evaluate(()=>window.sends.length),2,'photo-only Enter sends');
 const last=await p.evaluate(()=>window.sends.at(-1));assert.equal(last[0],'');assert.equal(last[1],undefined);assert.equal(last[3][0].id,second.stageId,'file paths travel as attachments, not vision images');
 const refused=await drop();await ack(refused,'imageStageRefused');await expect(p.locator('.hps-attachment-file')).toHaveCount(0);await expect(send).toBeDisabled();
 const removed=await drop();await p.getByRole('button',{name:'sample.png 빼기',exact:true}).click();await ack(removed);await expect(p.locator('.hps-attachment-file')).toHaveCount(0);
 const locked=await drop();await ack(locked);await p.evaluate(()=>window.render({sendLocked:true}));await expect(send).toBeDisabled();await input.press('Enter');assert.equal(await p.evaluate(()=>window.sends.length),2,'instructor lock retained');
 await p.evaluate(()=>window.render({config:{...window.baseConfig,activity:{id:'unverified',verified:false}}}));await expect(send).toBeDisabled();await input.press('Enter');assert.equal(await p.evaluate(()=>window.sends.length),2,'unverified activity cannot send');
 await p.evaluate(()=>window.render({streaming:true}));await p.getByRole('button',{name:'Stop',exact:true}).waitFor();await input.press('Enter');assert.equal(await p.evaluate(()=>window.sends.length),2,'no second photo-only turn while streaming');
 await p.evaluate(()=>window.render({}));await expect(send).toBeEnabled();await p.screenshot({path:path.join(out,'ready-photo.png')});
 await writeFile(path.join(out,'result.json'),JSON.stringify({pass:true,scope:'actual ChatPanel React with controlled host',checks:['host acknowledgement required','photo-only Send','photo-only Enter','file attachment not vision','refusal','late ack after remove','instructor lock','unavailable activity','streaming']},null,2));console.log('PASS photo-only Send/Enter, staging acknowledgement, refusal, removal, locks and streaming');
}finally{await browser.close();server.close();await rm(temp,{recursive:true,force:true});}
