// CGP-DS-R-025: real served pages, synthetic issuance responses, and a deferred clipboard only.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import {findChromium,launch} from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
const {default:app}=await import('../src/index.ts');
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN Chalk copy feedback: no Chromium');process.exit(0);}
const prelude=`<script>{const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()}};Object.defineProperty(window,'localStorage',{value:storage(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:storage(),configurable:true});window.fetch=async()=>new Response('{}');window.__copyTestPending=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>new Promise((resolve,reject)=>window.__copyTestPending.push({text,resolve,reject}))}});if(!crypto.randomUUID)crypto.randomUUID=()=> 'synthetic-copy-id';window.feedbackTimers=[];const original=setTimeout;window.setTimeout=(fn,delay,...args)=>{if(delay>=1000&&delay<=10000){feedbackTimers.push(()=>fn(...args));return feedbackTimers.length+100000}return original(fn,delay,...args)};}</script>`;
const evidence=process.env.COPY_FEEDBACK_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const scenes=[
 ['console',`api=async path=>path.endsWith('/lab-tokens')?{board:{students:[{handle:'student',token:'SYNTHETIC-LAB'}]}}:{token:'SYNTHETIC-STUDENT'};renderMinter({cohort:'synthetic'},{profiles:[{id:'p',display_name:'테스트'}]});document.getElementById('mu-synthetic').value='student';document.getElementById('mb-synthetic').click();renderLabTokens({cohort:'synthetic'});document.querySelector('[data-load-lab-tokens]').click();`,['.tok-copy','#copyall-synthetic','[data-copy-lab]']],
 ['issuer',`window.fetch=async()=>new Response(JSON.stringify({token:'SYNTHETIC-ISSUED',exp:2000000000,jti:'synthetic'}));for(const [id,value]of Object.entries({issuer:'synthetic.signature',u:'student',c:'class',p:'p',hours:'1'}))document.getElementById(id).value=value;document.getElementById('mint').click();`,['#copy-token']],
 ['authoring',`document.getElementById('student-token').value='SYNTHETIC-DELIVERY';document.getElementById('rehearsal-token').value='SYNTHETIC-REHEARSAL';`,['#copy-student','#rehearsal-copy']],
 ['manage',`cohort='synthetic';setConnected(true);`,['#join-copy']],
 ['learn',`window.fetch=async()=>new Response(JSON.stringify({lesson:{course_id:'c',version:'v1',content:{title:'수업',objective:'목표',audience:'학생',duration_minutes:10,starter:'시작',steps:[{title:'과제',instructions:'새 작업',acceptance:'확인'}]}}}));document.getElementById('token').value='SYNTHETIC';document.getElementById('connect').requestSubmit();`,['#lesson article button']],
];
for(const [route,prepare,selectors]of scenes){
 const b=await launch(bin);const act=async js=>{await b.evaluate(js);await new Promise(r=>setTimeout(r,40))};
 try{
  const response=await app.fetch(new Request('https://chalk.test/'+route),{ENVIRONMENT:'test'});assert.equal(response.status,200);
  const raw=await response.text();const html=raw.replace(/<head\b[^>]*>/i.test(raw)?/<head\b[^>]*>/i:/<html\b[^>]*>/i,head=>head+prelude);
  await b.load(html);assert.equal(await b.evaluate('typeof window.chalkCopyFeedback'),'function','served page wires shared feedback');await act(prepare);
  for(const selector of selectors){
   // These are synthetic post-issuance states; no Service or real token is accessed.
   await act(`{const button=document.querySelector('${selector}');if(!button)throw Error('missing ${selector}');button.disabled=false;button.onclick();}`);
   assert.ok(await b.evaluate('window.__copyTestPending.length>0'),`${route}/${selector} clipboard requested`);
   const note=selector==='#join-copy'?"document.getElementById('join-copied')":`document.querySelector('${selector}').nextElementSibling`;
   assert.equal(await b.evaluate(`${note}.textContent`),'','never claims copy before completion');
   await act('window.__copyTestPending.at(-1).resolve()');assert.equal(await b.evaluate(`${note}.getAttribute('role')`),'status');assert.match(await b.evaluate(`${note}.textContent`),/복사/);
   await act('feedbackTimers.splice(0).forEach(fn=>fn())');assert.match(await b.evaluate(`${note}.textContent`),/복사/,'confirmation persists beyond timer callbacks');
   await act(`document.querySelector('${selector}').onclick()`);await act("window.__copyTestPending.at(-1).reject(new Error('denied'))");assert.equal(await b.evaluate(`${note}.getAttribute('role')`),'alert');
   await act('feedbackTimers.splice(0).forEach(fn=>fn())');assert.match(await b.evaluate(`${note}.textContent`),/못했|못했습니다/,'error persists');
   await act(`document.querySelector('${selector}').onclick();window.__copyTestOld=window.__copyTestPending.at(-1);document.querySelector('${selector}').onclick()`);await act("window.__copyTestPending.at(-1).reject(new Error('latest'));window.__copyTestOld.resolve()");assert.equal(await b.evaluate(`${note}.getAttribute('role')`),'alert','stale completion does not erase latest failure');
  }
  if(route==='authoring'){
   await act("document.getElementById('copy-student').onclick();window.__copyTestStale=window.__copyTestPending.at(-1);document.getElementById('student-token').value='OTHER-SYNTHETIC'");await act('window.__copyTestStale.resolve()');assert.equal(await b.evaluate("document.getElementById('copy-student').nextElementSibling.textContent"),'','changed credential invalidates old result');
   await act("document.getElementById('copy-student').onclick()");await act('window.__copyTestPending.at(-1).resolve()');await act("document.getElementById('clear-student').onclick()");assert.equal(await b.evaluate("document.getElementById('copy-student').nextElementSibling.textContent"),'','explicit credential clear dismisses its feedback');
  }
  if(evidence)for(const width of [800,1420])for(const dark of [true,false]){
   await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   await b.evaluate(`document.documentElement.setAttribute('data-theme','${dark?'dark':'light'}')`);
   const visible=await b.evaluate(`(()=>{const e=[...document.querySelectorAll('.chalk-copy-feedback[role="alert"],#join-copied[role="alert"]')].at(-1);if(!e)return false;for(let a=e.parentElement;a;a=a.parentElement)if(a.tagName==='DETAILS')a.open=true;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.height>0&&r.width>0&&r.left>=0&&r.right<=innerWidth})()`);
   assert.equal(visible,true,route+' visible copy failure');
   const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/chalk-${route}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));
  }
  console.log(`PASS ${route}: ${selectors.length} copy paths, live roles, confirmation/persistent failure and race isolation`);
 }finally{await b.close()}
}
