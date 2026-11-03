// Browser-only comparison panel check. No Studio, image provider or visual-quality verdict.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { imageEditComparisonHtml } from '../../extensions/hypeproof-chat/src/imageEditAssets.ts';
import { png } from '../../extensions/hypeproof-chat/test/fixtures/image-edit/png.mjs';
const dir=resolve(process.argv[2]??'artifacts/image-edit-comparison');await mkdir(dir,{recursive:true});
const original=png(96,64,(x,y)=>x>12&&x<84&&y>16&&y<50?[30,50,80,255]:[230,230,220,255]);
const edited=png(96,64,(x,y)=>x>12&&x<84&&y>16&&y<50?[30,50,80,255]:[0,0,0,0]);
const uri=b=>`data:image/png;base64,${b.toString('base64')}`;
const html=imageEditComparisonHtml({originalUri:uri(original),editedUri:uri(edited),originalPath:'images/original.png',editedPath:'images/edited/candidate.png',nonce:'synthetic-comparison-nonce-123',source:'https://synthetic.invalid'});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.addInitScript(()=>{window.selectionMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.selectionMessages.push(m)})});
 await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);await page.locator('img').evaluateAll(async images=>Promise.all(images.map(i=>i.decode())));
 for(const background of ['checker','white','black']){await page.locator('select').selectOption(background);if(background!=='checker')assert.equal(await page.locator('.frame').first().evaluate(e=>e.style.background),background);await page.screenshot({path:join(dir,background+'.png')});}
 await page.getByRole('button',{name:'편집 결과 사용',exact:true}).click();await page.getByRole('button',{name:'원본 사용으로 되돌리기',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.selectionMessages),[{type:'imageEditSelection',action:'adopt'},{type:'imageEditSelection',action:'restore'}]);assert.deepEqual(errors,[]);
 await writeFile(join(dir,'result.json'),JSON.stringify({status:'PASS',scope:'isolated-synthetic-chromium',checks:['two decoded images','checker/light/dark comparison backgrounds','actual adopt and restore button messages'],limitations:['No Studio host callback, image provider, semantic preservation or human acceptance was run.'],evidence:['checker.png','white.png','black.png']},null,2)+'\n');
 console.log('PASS isolated comparison UI: decoded before/after, checker/light/dark backgrounds, adopt and restore actual clicks; no visual quality claim');
}finally{await browser.close()}
