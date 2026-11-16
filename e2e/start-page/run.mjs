import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dist=path.join(repo,'extensions/hypeproof-chat/webview-ui/dist');
const out=path.resolve(process.env.HPS_START_PAGE_OUT||path.join(repo,'e2e/test-results/start-page'));await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try {const url=new URL(req.url,'http://local');const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(name.includes('..'))throw Error();let body=await fs.readFile(path.join(dist,name));if(name==='index.html')body=Buffer.from(body.toString().replace('<html','<html data-surface="start"'));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try {
 const p=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>{window.sent.push(m);if(m.type==='startReady')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'test'}}})),0);},getState:()=>undefined,setState:()=>{throw Error('credential state persistence forbidden');}});});
 await p.goto(`http://127.0.0.1:${server.address().port}`);await p.getByRole('heading',{name:'어떻게 시작할까요?'}).waitFor();
 await p.getByRole('button',{name:'파일',exact:true}).click();assert.equal(await p.evaluate(()=>window.sent.at(-1).type),'openStudioFiles');
 // CGP-SHELL-R-014 — 설정 opens the learner sheet in the page; no settings-editor request is sent.
 await p.getByRole('button',{name:'설정',exact:true}).click();await p.getByRole('dialog',{name:'설정'}).waitFor();assert.equal(await p.evaluate(()=>window.sent.at(-1).type),'openStudioFiles');
 await p.getByRole('button',{name:'설정 닫기'}).click();await p.getByRole('dialog',{name:'설정'}).waitFor({state:'detached'});
 // #4193 — there is no trial-code choice. Without the free card the chooser says whether free start
 // is being checked or could not be confirmed, offers a re-check, and keeps 수업에 참여하기.
 const offerState=async check=>p.evaluate(c=>window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{version:'test',checking:false,...(c?{freeStartCheck:c}:{})}}})),check);
 assert.equal(await p.getByRole('button',{name:'AI 체험하기',exact:true}).count(),0,'no trial-code choice');
 assert.doesNotMatch(await p.locator('.studio-connect').innerText(),/체험/);
 await offerState('unavailable');
 const recheck=p.getByRole('button',{name:'무료 시작 다시 확인',exact:true});
 await recheck.waitFor();await p.getByText('지금은 무료로 시작할 수 있는지 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.',{exact:true}).waitFor();
 assert.doesNotMatch(await p.locator('.studio-connect').innerText(),/체험/);
 await recheck.click();assert.equal(await p.evaluate(()=>window.sent.at(-1).type),'freeStartRecheck');
 await offerState('checking');const checkingButton=p.getByRole('button',{name:'확인하는 중…',exact:true});await checkingButton.waitFor();assert.equal(await checkingButton.isDisabled(),true);
 await p.setViewportSize({width:390,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'free-start-check-390.png'),fullPage:true});await p.setViewportSize({width:1280,height:900});
 await offerState(undefined);assert.equal(await p.getByTestId('free-start-check').count(),0,'switched off: no re-check');
 await p.getByRole('button',{name:'수업에 참여하기',exact:true}).click();
 assert.equal(await p.getByText('나비',{exact:true}).count(),0);assert.equal(await p.locator('#course-code').getAttribute('type'),'password');
 const submit=p.getByRole('button',{name:'코드 확인하기'});assert.equal(await submit.isDisabled(),true);
 await p.locator('#course-code').fill('synthetic-not-a-secret');await submit.click();assert.equal(await p.locator('#course-code').inputValue(),'');
 assert.equal(await p.locator('#course-code').isDisabled(),true);assert.equal(await p.evaluate(()=>window.sent.filter(m=>m.type==='connectCourse').length),1);
 const state=async s=>p.evaluate(s=>window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{version:'test',checking:false,...s}}})),s);
 await state({error:'인증에 실패했습니다. 참여 코드를 다시 확인하세요.'});await p.getByRole('alert').waitFor();assert.equal(await p.locator('#course-code').isDisabled(),false);
 const profile={id:'adult-test',name:'성인 홈페이지 제작 실습',coach:'코치',series:'1 / 5',workspace:'~/Practice'};
 await state({profile});await p.getByRole('heading',{name:'이어서 시작할까요?'}).waitFor();assert.equal(await p.getByText(profile.name,{exact:true}).count(),1);
 await state({profile,candidate:true,previousConnected:true});await p.getByRole('heading',{name:'이 활동으로 시작할까요?'}).waitFor();
 await p.getByRole('button',{name:'선택 취소',exact:true}).click();assert.equal(await p.evaluate(()=>window.sent.at(-1).type),'cancelCandidate');
 await state({profile});
 await p.getByRole('button',{name:'다른 활동 선택'}).click();await p.getByRole('button',{name:'수업에 참여하기',exact:true}).click();await p.locator('#course-code').fill('second-attempt');await p.getByRole('button',{name:'코드 확인하기'}).click();
 await state({profile,error:'서버에 연결할 수 없습니다.'});await p.getByText('기존 활동 연결은 유지됩니다.').waitFor();await p.getByRole('button',{name:'기존 활동으로 돌아가기'}).click();
 await p.getByRole('button',{name:'이어서 하기'}).click();assert.equal(await p.evaluate(()=>window.sent.at(-1).type),'beginCourse');
 assert.equal(await p.getByRole('button',{name:'활동 여는 중…'}).isDisabled(),true);
 await state({profile,started:true});await p.getByRole('heading',{name:'코치와 작업을 시작하세요'}).waitFor();await p.getByRole('button',{name:'코치와 계속 작업하기'}).waitFor();
 // #4193 — a trial seat (code-issued, or a record saved by an older build) reads 개인 작업.
 await state({profile:{...profile,kind:'trial'}});await p.locator('.studio-verified').getByText('개인 작업',{exact:true}).waitFor();assert.doesNotMatch(await p.locator('.studio-connect').innerText(),/체험/);
 await state({profile:{...profile,kind:'personal'}});await p.getByText('개인 작업',{exact:true}).waitFor();
 await state({error:'개인 체험 시간이 끝났습니다.'});await p.getByRole('alert').waitFor();assert.equal(await p.getByRole('button',{name:'이어서 하기'}).count(),0);
 await state({profile:{...profile,id:'kids-test',name:'어린이 만들기 수업',coach:'직접 이름 짓는 코치'}});await p.getByText('어린이 만들기 수업',{exact:true}).waitFor();
 await p.getByRole('button',{name:'연결 해제',exact:true}).click();assert.equal(await p.evaluate(()=>window.sent.at(-1).type),'disconnectCourse');
 // TUX-SP-14 — a full free-start advertisement replaces the three peer choices with the age card
 // (deeper cases live in e2e/trial-ux).
 await state({trialOffer:{entry:'open',durationHours:24,requestLimit:10,claim:'/v1/free/claim',available:true},freeStart:{}});
 // The person had opened the code form earlier in this run; with free start it offers "돌아가기".
 await p.getByRole('heading',{name:'참여 코드로 시작하기'}).waitFor();await p.getByRole('button',{name:'돌아가기',exact:true}).click();
 await p.getByRole('heading',{name:'바로 시작할 수 있습니다'}).waitFor();await p.getByText('만 14세 이상인가요?',{exact:true}).waitFor();
 assert.equal(await p.getByRole('button',{name:'AI 체험하기',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'수업에 참여하기',exact:true}).count(),0);
 assert.doesNotMatch(await p.locator('.studio-connect').innerText(),/체험/);
 for(const width of [390,1280]){await p.setViewportSize({width,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,`free-start-${width}.png`),fullPage:true});}
 await p.setViewportSize({width:1280,height:900});
 await state({});
 for(const width of [390,768,1280]){await p.setViewportSize({width,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,`start-${width}.png`),fullPage:true});}
 const storage=await p.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}));assert.deepEqual(storage,{local:0,session:0});assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({scope:'built React UI with controlled host messages; real Mac auth evidence recorded separately',pass:true,widths:[390,768,1280],controls:['disconnected neutral state','password and no persistence','pending and retry','adult and child profiles','failed switch retains prior course','begin action'],errors},null,2));
 console.log('PASS start-page browser controls: empty/pending/error/retry/course switch; 390/768/1280; no credential persistence');
} finally {await browser.close();await new Promise(r=>server.close(r));}
