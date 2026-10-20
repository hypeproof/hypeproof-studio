// REQ-STUDIO-JOIN-LINK (CGP-SHELL-R-005, DES-SHELL-04) — the built start page in a real browser.
// The host state a join link produces (`joinLink: {classId, seq}`) opens the class code form with
// the class named above an empty, focused code field; a refresh does not close it; 링크 닫기 asks
// the host to drop it; nothing is sent to the host by the link itself. Screenshots at 390 and 1280.
// Needs `npm run build` in extensions/hypeproof-chat/webview-ui first.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dist=path.join(repo,'extensions/hypeproof-chat/webview-ui/dist');
const out=path.resolve(process.env.HPS_START_PAGE_OUT||path.join(repo,'e2e/test-results/start-page'));await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(name.includes('..'))throw Error();let body=await fs.readFile(path.join(dist,name));if(name==='index.html')body=Buffer.from(body.toString().replace('<html','<html data-surface="start"'));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try {
 const p=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>{window.sent.push(m);if(m.type==='startReady')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{checking:false,version:'test'}}})),0);},getState:()=>undefined,setState:()=>{throw Error('credential state persistence forbidden');}});});
 await p.goto(`http://127.0.0.1:${server.address().port}`);await p.getByRole('heading',{name:'어떻게 시작할까요?'}).waitFor();
 const state=async s=>p.evaluate(s=>window.dispatchEvent(new MessageEvent('message',{data:{type:'startState',state:{version:'test',checking:false,...s}}})),s);
 const sentTypes=()=>p.evaluate(()=>window.sent.map(m=>m.type));
 // Negative control: without a link the choice list stays, and no class is named anywhere.
 assert.equal(await p.getByText('참여 링크로 연 수업').count(),0);

 // A link for a learner who already has an activity (the hardest case: a refresh would close the form).
 const profile={id:'adult-test',name:'성인 홈페이지 제작 실습',coach:'코치',series:'1 / 5',workspace:'~/Practice'};
 await state({profile,joinLink:{classId:'dental-0729',seq:1}});
 await p.getByRole('heading',{name:'수업에 참여하기'}).waitFor();
 await p.getByText('참여 링크로 연 수업').waitFor();
 assert.equal(await p.locator('.studio-join-class strong').innerText(),'dental-0729');
 const field=p.locator('#course-code');
 assert.equal(await field.inputValue(),'','the code field is empty');
 assert.equal(await field.getAttribute('type'),'password');
 assert.equal(await p.evaluate(()=>document.activeElement?.id),'course-code','the code field has focus');
 assert.match(await field.getAttribute('aria-describedby'),/join-link-note/);
 assert.equal(await p.getByRole('button',{name:'코드 확인하기'}).isDisabled(),true,'nothing to send until the learner types');
 assert.deepEqual(await sentTypes(),['startReady'],'the link itself sends nothing');
 // A second state (e.g. products loaded) does not close the form.
 await state({profile,joinLink:{classId:'dental-0729',seq:1},purchase:{available:false}});
 await p.waitForTimeout(50);
 assert.equal(await p.getByText('참여 링크로 연 수업').count(),1,'a refresh keeps the join form open');
 for(const width of [390,1280]){await p.setViewportSize({width,height:900});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal scroll at ${width}`);await p.screenshot({path:path.join(out,`join-link-form-${width}.png`),fullPage:true});}
 await p.setViewportSize({width:1280,height:900});

 // The learner's own code goes through the ordinary path; the class id never travels with it.
 await field.fill('synthetic-learner-code');await p.getByRole('button',{name:'코드 확인하기'}).click();
 const connect=await p.evaluate(()=>window.sent.filter(m=>m.type==='connectCourse'));
 assert.equal(connect.length,1);assert.deepEqual(Object.keys(connect[0]).sort(),['joinClass','token','type']);assert.equal(connect[0].joinClass,'dental-0729','the link form says which class it shows; never anything else');
 await state({profile,joinLink:{classId:'dental-0729',seq:1},error:'이 참여 코드는 링크로 연 수업의 코드가 아니에요. 선생님께 받은 코드를 다시 확인해 주세요.'});
 await p.getByRole('alert').waitFor();
 assert.equal(await field.inputValue(),'','a refused code is not kept in the field');
 await p.screenshot({path:path.join(out,'join-link-mismatch-1280.png'),fullPage:true});

 // 링크 닫기 asks the host to drop the link.
 await p.getByRole('button',{name:'링크 닫기'}).click();
 assert.equal((await sentTypes()).at(-1),'joinLinkDismiss');
 // The host drops it; a learner with an activity is back on that activity's card.
 await state({profile});
 await p.getByRole('heading',{name:'이어서 시작할까요?'}).waitFor();
 assert.equal(await p.getByText('참여 링크로 연 수업').count(),0);

 // A second press of the link (new seq) reopens the form from the activity card.
 await state({profile,joinLink:{classId:'dental-0729',seq:2}});
 await p.getByText('참여 링크로 연 수업').waitFor();
 assert.equal(await p.evaluate(()=>document.activeElement?.id),'course-code');
 // F1 — leaving the link's form by any path asks the host to drop the link, and a code from another form
 // carries no class.
 const dismisses=async()=>(await sentTypes()).filter(t=>t==='joinLinkDismiss').length;
 let before=await dismisses();
 await p.getByRole('button',{name:'시작 방법 다시 선택'}).click();
 assert.equal(await dismisses(),before+1,'시작 방법 다시 선택 drops the link');
 await p.getByRole('button',{name:'AI 체험하기',exact:true}).click();
 await p.locator('#course-code').fill('synthetic-trial-code');await p.getByRole('button',{name:'코드 확인하기'}).click();
 const trial=(await p.evaluate(()=>window.sent.filter(m=>m.type==='connectCourse'))).at(-1);
 assert.deepEqual(Object.keys(trial).sort(),['token','type'],'a code from the trial form carries no class');
 await state({profile,joinLink:{classId:'dental-0729',seq:3}});await p.getByText('참여 링크로 연 수업').waitFor();
 before=await dismisses();
 await p.getByRole('button',{name:'기존 활동으로 돌아가기'}).click();
 assert.equal(await dismisses(),before+1,'기존 활동으로 돌아가기 drops the link');
 assert.deepEqual(errors,[]);
 console.log('PASS join-link start page: class named, empty focused code field, refresh-stable, dismiss, re-press; screenshots in '+out);
} finally { await browser.close(); server.close(); }
