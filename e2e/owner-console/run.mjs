// Real Service route and Owner HTML with explicitly synthetic SQLite records.
// Requires an explicit Service checkout; never observes or mutates production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
const source=process.env.HPS_SERVICE_SOURCE;
assert(source,'HPS_SERVICE_SOURCE must name the candidate Service checkout');
await import(pathToFileURL(resolve(source,'worker/test/harness/loader.mjs')));
const {accessHarness}=await import(pathToFileURL(resolve(source,'worker/test/harness/access.mjs')));
const h=await accessHarness();
h.env.HPS_OWNER_SERVICE_SECRET='synthetic-owner-read-credential-000000000';
const insert=h.db.prepare('INSERT INTO usage_log(cohort_id,user_id,profile_id,model,tokens_in,tokens_out,cache_read,cache_write,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
const today=new Date().toISOString().slice(0,10)+' 00:00:00';
insert.run('class-a','=synthetic-injection','retired','model-a',10,2,3,4,200,today);
insert.run('class-b','<img src=x onerror=alert(1)>','retired','model-b',20,3,4,5,502,today);
insert.run('canary','synthetic-check','canary-sdk-contract','model-a',30,4,5,6,200,today);
let failed=false;const methods=[];
const server=createServer(async(req,res)=>{
 try{
  methods.push(req.method);
  if(failed&&req.url.includes('/usage')){res.writeHead(503,{'content-type':'application/json'}).end('{"error":"usage_unavailable"}');return;}
  const response=await h.request(req.url,{auth:'',headers:req.headers});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(response.text);
 }catch{res.writeHead(500).end('synthetic failure');}
});
let browser;
const out=process.env.HPS_OWNER_EVIDENCE_DIR||'test-results/owner-console';mkdirSync(out,{recursive:true});
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 browser=await chromium.launch();const page=await browser.newPage({acceptDownloads:true,extraHTTPHeaders:{'x-hps-owner-service-secret':h.env.HPS_OWNER_SERVICE_SECRET}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/admin/owner');
 await page.locator('#data').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#dispatch-coverage').textContent || document.querySelector('#notice').classList.contains('error'));
 assert.equal(await page.locator('#notice').getAttribute('class'),'notice',await page.locator('#notice').innerText());
 await page.getByText('집계 범위와 데이터 확인 상태',{exact:true}).click();
 assert.equal(await page.locator('#records').innerText(),'3');
 assert.equal(await page.locator('#cost').innerText(),'미확인');
 assert.match(await page.locator('#dispatch-coverage').innerText(),/추적 호출 0/);
 assert.equal(await page.locator('#rows img').count(),0);
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no viewport overflow');
  await page.screenshot({path:out+'/owner-'+width+'.png',fullPage:true});
 }
 const download=page.waitForEvent('download');await page.locator('#export').click();
 const csv=readFileSync(await (await download).path(),'utf8');
 assert(csv.includes("'=synthetic-injection"),'formula-like identifiers escaped in CSV');
 assert(csv.includes('전체 비용 및 청구 대조 미확인'));
 await page.locator('#kind').selectOption('test');assert.equal(await page.locator('#records').innerText(),'1');
 await page.locator('#kind').selectOption('all');
 for(const group of ['cohort','model','day','person']){
  await page.locator('[data-group="'+group+'"]').click();assert.equal(await page.locator('#records').innerText(),'3');
 }
 await page.locator('#search').fill('=synthetic-injection');assert.equal(await page.locator('#records').innerText(),'1');
 await page.locator('#rows button').click();assert(await page.locator('#selection').isVisible());
 await page.locator('#clear-person').click();await page.locator('#search').fill('');
 failed=true;await page.locator('#load').click();await page.getByText('조회 실패 · 이전 결과 제거됨').waitFor();
 assert(await page.locator('#data').isHidden());assert(await page.locator('#export').isHidden());
 assert.deepEqual(errors,[]);assert(methods.every(m=>m==='GET'));
 writeFileSync(out+'/result.json',JSON.stringify({status:'PASS',scope:'synthetic-real-browser',source,observations:['actual Service routing and Owner document','390/1280 no overflow','purpose/person/model/day filters','CSV formula escaping','stored markup escaped','failure clears stale result','GET only'],production:false},null,2));
 console.log('PASS Owner browser: real routes, responsive filters, CSV, XSS, unavailable-state clearing; synthetic only');
}finally{await browser?.close();await new Promise(r=>server.close(r));h.close();}
