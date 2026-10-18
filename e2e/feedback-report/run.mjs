import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=resolve(process.argv[2]||'');assert(process.argv[2]&&existsSync(resolve(root,'report.html')),'Supply generated report directory');
const out=resolve(root,'wp7/browser');mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage();const errors=[],network=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
try{
 for(const filename of ['report.html','manual/index.html','manual/learner.html','manual/owner.html','manual/operator.html','manual/developer.html']){
  await page.goto(pathToFileURL(resolve(root,filename)).href);
  assert(await page.locator('h1').count()===1);
  for(const href of await page.locator('a[href]').evaluateAll(links=>links.map(a=>a.href))){
   if(!href.startsWith('file:'))continue;
   const path=fileURLToPath(href.split('#')[0]);assert(!relative(root,path).startsWith('..')&&existsSync(path),'missing or escaped link '+href);
  }
  for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),filename+' overflow');
   await page.screenshot({path:resolve(out,filename.replaceAll('/','-')+'-'+width+'.png'),fullPage:true});
  }
  if(filename==='report.html'){
   assert.equal(await page.locator('article').count(),30);
   await page.locator('#search').fill('T01');assert.equal(await page.locator('article:visible').count(),1);
   await page.locator('#search').fill('');await page.locator('#status').selectOption('BLOCKED');
   assert((await page.locator('article:visible').allTextContents()).every(t=>t.includes('BLOCKED')));
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'PASS',scope:'local-file-browser',checks:['six HTML pages','relative files exist','390/1280 no overflow','status and text filters','no network request','no page error'],human_acceptance:'HUMAN_PENDING'},null,2));
 console.log('PASS portable report/manual local file links, responsive layout, filters and offline execution');
}finally{await browser.close();}
