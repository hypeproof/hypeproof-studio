// Isolated synthetic Chromium check. Does not run Studio, a model, or a deployed Service.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { captureReferenceScreenshot } from '../../extensions/hypeproof-chat/src/referenceDesign.ts';
const fixture=fileURLToPath(new URL('../../extensions/hypeproof-chat/test/fixtures/reference-design/keyboard.html',import.meta.url));
const output=resolve(process.argv[2]??'artifacts/reference-design');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:960,height:720},deviceScaleFactor:1,reducedMotion:'reduce'});
const page=await context.newPage();const requests=[];page.on('request',r=>requests.push(r.url()));
const semantic=()=>page.evaluate(()=>{
 const keyboard=document.querySelector('[role="img"]'),box=document.querySelector('.box'),front=document.querySelector('.front'),shadow=document.querySelector('.shadow');
 const keys=keyboard?[...keyboard.querySelectorAll('.key')].map(k=>k.textContent):[];
 const visible=e=>!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;
 const problems=[];
 if(!visible(keyboard)||!keyboard.getAttribute('aria-label')?.includes('keyboard')||keys.length<30||keys.slice(0,10).join('')!=='QWERTYUIOP'||!keys.includes('Space'))problems.push('recognizable-keyboard-and-keys');
 if(!visible(box)||!visible(front)||Number(getComputedStyle(front).zIndex)<=Number(getComputedStyle(keyboard).zIndex))problems.push('box-front-occlusion');
 if(!visible(shadow)||getComputedStyle(keyboard).transform==='none'||getComputedStyle(keyboard).boxShadow==='none')problems.push('depth-angle-shadow');
 return {problems,keys:keys.length,progress:document.querySelector('main').dataset.progress,transform:getComputedStyle(keyboard).transform};
});
const result={scope:'synthetic-chromium',fixtureSha256:createHash('sha256').update(await readFile(fixture)).digest('hex'),viewport:{width:960,height:720,deviceScaleFactor:1},states:[],checks:[],limitations:['Structural and deterministic capture checks only; visual fidelity is not scored.','No model, SDK subprocess, Studio app, Service, original reference or human acceptance was run.']};
try{
 await page.goto(pathToFileURL(fixture).href);const cdp=await context.newCDPSession(page);
 for(const progress of [0,0.5,1,0.5]){
  await page.evaluate(p=>window.fixture.seek(p),progress);
  const check=await semantic();assert.deepEqual(check.problems,[]);
  const shot=await captureReferenceScreenshot(cdp);
  const name=`keyboard-${result.states.length}-${progress}.jpg`;await writeFile(join(output,name),Buffer.from(shot.data,'base64'));
  result.states.push({progress,semantic:check,capture:shot.metadata,screenshot:name});
 }
 assert.equal(result.states[1].capture.sha256,result.states[3].capture.sha256,'same sought state renders identical pixels');
 assert.equal(new Set(result.states.slice(0,3).map(s=>s.capture.sha256)).size,3,'start/middle/end pixels differ');
 result.checks.push({name:'deterministic-state-captures',status:'PASS'});
 await page.locator('button').click();assert.equal(await page.locator('output').textContent(),'Open');assert.equal((await semantic()).progress,'1');
 result.checks.push({name:'real-click-opens-keyboard',status:'PASS'});
 for(const [name,mutation,expected]of[
  ['generic-illustration',()=>document.querySelectorAll('.key').forEach(k=>k.remove()),'recognizable-keyboard-and-keys'],
  ['missing-front',()=>document.querySelector('.front').style.display='none','box-front-occlusion'],
  ['missing-shadow',()=>document.querySelector('.shadow').style.display='none','depth-angle-shadow'],
 ]){
  await page.reload();await page.evaluate(mutation);assert.ok((await semantic()).problems.includes(expected),`${name} planted failure must be rejected`);
  result.checks.push({name:`negative-control-${name}`,status:'PASS'});
 }
 assert.equal(requests.some(url=>/^https?:/.test(url)),false,'fixture has no remote assets');
 result.status='PASS';
}catch(e){result.status='FAIL';result.error=String(e);throw e;}
finally{await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:result.status,scope:result.scope,checks:result.checks.length,evidence:join(output,'result.json')}));
