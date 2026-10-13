import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chatConfig } from './sx-screen-fixtures.mjs';
const e2eRequire=createRequire(new URL('../../../e2e/package.json',import.meta.url));
const {chromium}=e2eRequire('@playwright/test');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{App}from'./src/App';import './src/styles.css';window.__posts=[];window.acquireVsCodeApi=()=>({postMessage(message){window.__posts.push(message)},getState(){},setState(){}});import('./src/vscode').then(()=>{createRoot(document.getElementById('root')).render(<App/>)});`,loader:'tsx',resolveDir:fileURLToPath(new URL('../webview-ui/',import.meta.url))},bundle:true,platform:'browser',format:'iife',write:false,outfile:'app.js',loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"test"'}});
// The API must exist before the static App import evaluates its bridge module.
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const bootstrap=`window.__posts=[];window.acquireVsCodeApi=()=>({postMessage(message){window.__posts.push(message)},getState(){},setState(){}});`;
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<html><head><style>body{margin:0;background:#202020;color:#ddd;font-family:Arial,sans-serif;height:100vh}#root{height:100vh}${css}</style></head><body><div id="root"></div><script>${bootstrap}</script><script>${js.replaceAll('</script>','<\\/script>')}</script></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:950,height:1100}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
const emit=message=>page.evaluate(message=>window.dispatchEvent(new MessageEvent('message',{data:message})),message);
const activityId='a'.repeat(64);const config=chatConfig(3,{activity:{...chatConfig().activity,id:activityId,name:'업무 자동화'},profile:{...chatConfig().profile,lesson:undefined,welcome:{greeting_md:'어떤 업무를 자동화할까요?',example_prompts:[]},automations:{enabled:true,provider:'gmail'}}});
const question=async q=>{await emit({type:'automationQuestion',question:q,activityId});await page.locator(`[data-testid="user-question-card"][data-question-id="${q.id}"]`).waitFor();};
try{
await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__posts.some(m=>m.type==='ready'));
await emit({type:'config',config});await emit({type:'history',messages:[],activityId});
await question({id:'sheet-1',kind:'sheet',title:'명단이 있는 시트 주소를 알려 주세요.',private:true});
const sheet='https://docs.google.com/spreadsheets/d/private-example-123456789';
await page.getByLabel('내 Google Sheets 주소').fill(sheet);await page.getByRole('button',{name:'답변 보내기',exact:true}).click();
await page.waitForFunction(()=>window.__posts.some(m=>m.type==='automationAnswer'));
assert.equal((await page.evaluate(()=>window.__posts.filter(m=>m.type==='automationAnswer'))).length,1);
assert.equal(await page.getByRole('button',{name:'답변 확인 중…'}).isDisabled(),true);
assert.equal(await page.locator('.hps-input textarea').getAttribute('readonly'),'');
let posts=await page.evaluate(()=>window.__posts);assert.equal(posts.some(m=>m.type==='sendMessage'),false);assert.equal(posts.find(m=>m.type==='automationAnswer').text,sheet);
await question({id:'choice-2',kind:'choice',title:'어떤 방식으로 진행할까요?',choices:[{id:'template',label:'기존 양식 쓰기'},{id:'new',label:'새로 만들기'}],allowFreeText:true,private:false});
assert.equal(await page.getByTestId('user-question-card').count(),1);assert.equal(await page.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled(),true);
await page.getByLabel('직접 설명할게요').check();await page.getByLabel('내 답변',{exact:true}).fill('마감 안내를 정중하게 보내고 싶어요.');await page.locator('.hps-user-question textarea').press('Control+Enter');
posts=await page.evaluate(()=>window.__posts);const choiceAnswer=posts.filter(m=>m.type==='automationAnswer').at(-1);assert.equal(choiceAnswer.questionId,'choice-2');assert.equal(choiceAnswer.choiceId,undefined);assert.equal(choiceAnswer.text,'마감 안내를 정중하게 보내고 싶어요.');
await question({id:'preview-3',kind:'preview',title:'이대로 보낼까요?',private:true,preview:{id:'preview',createdAt:1,messages:[{id:'1',to:'one@example.test',subject:'자료 <script> 안내',body:'첫 번째 메일 전체 내용'}, {id:'2',to:'two@example.test',subject:'두 번째 자료 요청',body:'마지막 줄까지 확인해야 하는 두 번째 본문'}]}});
await page.getByText('마지막 줄까지 확인해야 하는 두 번째 본문',{exact:true}).waitFor();assert.equal(await page.getByText('마지막 줄까지 확인해야 하는 두 번째 본문',{exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'2명에게 보내기'}).isDisabled(),true);assert.equal(await page.locator('.hps-question-mail script').count(),0);
if(process.env.HPS_QUESTION_SCREENSHOT){await page.getByTestId('user-question-card').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.HPS_QUESTION_SCREENSHOT});}
await page.getByLabel('받는 주소와 모든 메일 내용을 확인했어요.').check();await page.getByRole('button',{name:'2명에게 보내기'}).click();
posts=await page.evaluate(()=>window.__posts);const approved=posts.filter(m=>m.type==='automationAnswer').at(-1);assert.equal(approved.approved,true);assert.equal(approved.text,undefined);assert.equal(JSON.stringify(posts.filter(m=>m.type==='sendMessage')).includes('example.test'),false);
await emit({type:'automationQuestion',question:null,activityId});await page.getByTestId('user-question-card').waitFor({state:'detached'});assert.equal(await page.locator('.hps-input textarea').getAttribute('readonly'),null);
await page.locator('.hps-input textarea').fill('다음 업무도 정리해 보자');await page.locator('.hps-input textarea').press('Enter');await page.waitForFunction(()=>window.__posts.some(m=>m.type==='sendMessage'));
const normalPosts=await page.evaluate(()=>window.__posts.filter(m=>m.type==='sendMessage'));assert.equal(normalPosts.length,1);assert.equal(normalPosts[0].text,'다음 업무도 정리해 보자');assert.equal(JSON.stringify(normalPosts).includes(sheet),false);
await question({id:'cancel-4',kind:'connect',title:'Google 계정을 연결할까요?',private:true});await page.getByRole('button',{name:'지금은 그만하기'}).click();assert.equal((await page.evaluate(()=>window.__posts.filter(m=>m.type==='automationAnswer').at(-1))).cancelled,true);
await emit({type:'config',config:{...config,profile:{...config.profile,automations:{enabled:false,provider:'gmail'}}}});await emit({type:'automationQuestion',question:{id:'denied',kind:'text',title:'보이면 안 됨',private:true},activityId});await page.getByTestId('user-question-card').waitFor({state:'detached'});assert.equal(await page.getByTestId('user-question-card').count(),0);
assert.deepEqual(errors,[]);console.log('PASS conversation UI: real App private routing, single question, explicit choice/free text, full preview, approval, cancellation and opt-in gate');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
