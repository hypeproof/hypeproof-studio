import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chatConfig } from './sx-screen-fixtures.mjs';
const e2eRequire=createRequire(new URL('../../../e2e/package.json',import.meta.url));
const {chromium}=e2eRequire('@playwright/test');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{App}from'./src/App';import './src/tokens.css';import './src/styles.css';window.__posts=[];window.acquireVsCodeApi=()=>({postMessage(message){window.__posts.push(message)},getState(){},setState(){}});import('./src/vscode').then(()=>{createRoot(document.getElementById('root')).render(<App/>)});`,loader:'tsx',resolveDir:fileURLToPath(new URL('../webview-ui/',import.meta.url))},bundle:true,platform:'browser',format:'iife',write:false,outfile:'app.js',loader:{'.svg':'dataurl'},define:{'process.env.NODE_ENV':'"test"'}});
// The API must exist before the static App import evaluates its bridge module.
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const bootstrap=`window.__posts=[];window.acquireVsCodeApi=()=>({postMessage(message){window.__posts.push(message)},getState(){},setState(){}});`;
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<html><head><style>body{margin:0;background:#202020;color:#ddd;font-family:Arial,sans-serif;height:100vh}#root{height:100vh}${css}</style></head><body><div id="root"></div><script>${bootstrap}</script><script>${js.replaceAll('</script>','<\\/script>')}</script></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:300,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
const emit=message=>page.evaluate(message=>window.dispatchEvent(new MessageEvent('message',{data:message})),message);
const activityId='a'.repeat(64);const config=chatConfig(3,{activity:{...chatConfig().activity,id:activityId,name:'업무 자동화'},profile:{...chatConfig().profile,lesson:undefined,welcome:{greeting_md:'어떤 업무를 자동화할까요?',example_prompts:[]},automations:{enabled:true,provider:'gmail'}}});
const question=async q=>{await emit({type:'automationQuestion',question:q,activityId});await page.locator(`[data-testid="user-question-card"][data-question-id="${q.id}"]`).waitFor();};
try{
await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__posts.some(m=>m.type==='ready'));
await emit({type:'config',config});await emit({type:'history',messages:[],activityId});
assert.equal(await page.getByRole('button',{name:'활동 변경',exact:true}).isVisible(),false);
await page.getByLabel('대화 메뉴').click();
assert.equal(await page.getByRole('button',{name:'활동 변경',exact:true}).isVisible(),true);
await page.getByLabel('대화 메뉴').press('Escape');
assert.equal(await page.locator('.hps-conversation-actions').getAttribute('open'),null,'Escape closes the menu');
await page.getByLabel('대화 메뉴').click();
await page.locator('.hps-input textarea').click();
assert.equal(await page.locator('.hps-conversation-actions').getAttribute('open'),null,'outside click closes the menu');
await page.getByLabel('대화 메뉴').click();
await page.getByRole('button',{name:'대화 지우기',exact:true}).click();
assert.equal(await page.locator('.hps-conversation-actions').getAttribute('open'),null,'choosing an enabled menu item closes the menu');
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
for(const close of [false,true]){
 await question({id:'preview-only-'+close,kind:'preview_review',title:'Google에서 만든 메일을 확인해 주세요',private:true,preview:{id:'preview-only',createdAt:1,messages:[{id:'1',to:'preview@example.test',subject:'미리보기 전용 제목',body:'발송하지 않는 전체 본문'}]}});
 const card=page.getByTestId('user-question-card');
 assert.equal(await card.getByText('preview@example.test',{exact:true}).isVisible(),true);
 assert.equal(await card.getByText('발송하지 않는 전체 본문',{exact:true}).isVisible(),true);
 assert.equal(await card.getByRole('button',{name:/보내기/}).count(),0,'preview alone never offers sending');
 assert.equal(await card.getByRole('checkbox').count(),0,'read-only acknowledgement is not send consent');
 await card.getByRole('button',{name:close?'닫기':'확인했어요',exact:true}).click();
 const answer=await page.evaluate(()=>window.__posts.filter(m=>m.type==='automationAnswer').at(-1));
 assert.equal(close?answer.cancelled:answer.approved,true);
 assert.equal(JSON.stringify(answer).includes('preview@example.test'),false);
}
await question({id:'preview-3',kind:'preview',title:'이대로 보낼까요?',private:true,preview:{id:'preview',createdAt:1,messages:[{id:'1',to:'one@example.test',subject:'자료 <script> 안내',body:'첫 번째 메일 전체 내용'}, {id:'2',to:'two@example.test',subject:'두 번째 자료 요청',body:'마지막 줄까지 확인해야 하는 두 번째 본문'}]}});
await page.getByText('마지막 줄까지 확인해야 하는 두 번째 본문',{exact:true}).waitFor();assert.equal(await page.getByText('마지막 줄까지 확인해야 하는 두 번째 본문',{exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'2명에게 보내기'}).isDisabled(),true);assert.equal(await page.locator('.hps-question-mail script').count(),0);
if(process.env.HPS_QUESTION_SCREENSHOT){await page.getByTestId('user-question-card').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.HPS_QUESTION_SCREENSHOT});}
await page.getByLabel('받는 주소와 모든 메일 내용을 확인했어요.').check();await page.getByRole('button',{name:'2명에게 보내기'}).click();
posts=await page.evaluate(()=>window.__posts);const approved=posts.filter(m=>m.type==='automationAnswer').at(-1);assert.equal(approved.approved,true);assert.equal(approved.text,undefined);assert.equal(JSON.stringify(posts.filter(m=>m.type==='sendMessage')).includes('example.test'),false);
await emit({type:'automationQuestion',question:null,activityId});await page.getByTestId('user-question-card').waitFor({state:'detached'});assert.equal(await page.locator('.hps-input textarea').getAttribute('readonly'),null);
await page.locator('.hps-input textarea').fill('다음 업무도 정리해 보자');await page.locator('.hps-input textarea').press('Enter');await page.waitForFunction(()=>window.__posts.some(m=>m.type==='sendMessage'));
const normalPosts=await page.evaluate(()=>window.__posts.filter(m=>m.type==='sendMessage'));assert.equal(normalPosts.length,1);assert.equal(normalPosts[0].text,'다음 업무도 정리해 보자');assert.equal(JSON.stringify(normalPosts).includes(sheet),false);
// A duplicate native click returns only the extra draft; it must not end the
// actual response or flush the participant's parked message.
await emit({type:'streamStart',streamId:'duplicate-guard',messageId:'duplicate-reply',activityId});
await emit({type:'inputRejected',text:'추가 입력 보존',images:[],notice:'이미 요청을 처리하고 있어요. 추가 입력은 초안에 보관했어요.',activityId});
await page.waitForFunction(()=>document.querySelector('.hps-input textarea').value==='추가 입력 보존');
assert.equal(await page.locator('.hps-input textarea').inputValue(),'추가 입력 보존');
assert.equal(await page.getByRole('button',{name:'중지',exact:true}).isVisible(),true);
assert.equal(await page.getByText('이미 요청을 처리하고 있어요. 추가 입력은 초안에 보관했어요.',{exact:true}).isVisible(),true);
await emit({type:'streamEnd',streamId:'duplicate-guard',activityId});
await question({id:'withdraw-review',kind:'unpublish',title:'자료 요청 (버전 1) 게시물을 내릴까요?',description:'새 다운로드는 중지되고 이미 설치한 복사본과 Google 연결은 남아요.',private:true});
const withdrawButton=page.getByRole('button',{name:'이 게시물 내리기',exact:true});
assert.equal(await withdrawButton.isEnabled(),false);
await page.getByRole('checkbox',{name:'이 게시물을 스토어에서 내리고, 이미 설치한 복사본은 남는다는 점을 확인했어요.'}).check();
await withdrawButton.click();
assert.deepEqual(await page.evaluate(()=>window.__posts.filter(m=>m.type==='automationAnswer'&&m.questionId==='withdraw-review')),[{type:'automationAnswer',questionId:'withdraw-review',approved:true,activityId}]);
await emit({type:'automationQuestion',question:null,activityId});
await question({id:'script-review',kind:'script',title:'이 코드를 Google에 저장할까요?',private:true,script:{action:'upload',digest:'a'.repeat(64),files:[{name:'Code',source:'function example() { return "<script>unsafe</script>"; }'}],scopes:['https://www.googleapis.com/auth/script.projects']}});
assert.equal(await page.getByRole('button',{name:'확인한 코드를 Google에 저장'}).isDisabled(),true);
await page.getByText('코드와 요청 권한 확인',{exact:true}).click();
assert.equal(await page.locator('.hps-question-skill script').count(),0);
await page.getByLabel('작업 내용과 Google 접근 권한을 확인했어요.').check();
await page.getByRole('button',{name:'확인한 코드를 Google에 저장'}).click();
assert.equal((await page.evaluate(()=>window.__posts.filter(m=>m.type==='automationAnswer').at(-1))).approved,true);
assert.equal(JSON.stringify(await page.evaluate(()=>window.__posts.filter(m=>m.type==='sendMessage'))).includes('function example'),false);
await question({id:'cancel-4',kind:'connect',title:'Google 계정을 연결할까요?',private:true});await page.getByRole('button',{name:'지금은 그만하기'}).click();assert.equal((await page.evaluate(()=>window.__posts.filter(m=>m.type==='automationAnswer').at(-1))).cancelled,true);
// Reproduce the real sidebar: long history, classroom rails and an expanded access block.
await emit({type:'automationQuestion',question:null,activityId});
await emit({type:'config',config:{...config,access:{status:'unknown',notice:'이용권 조회를 다시 확인해 주세요.'}}});
await emit({type:'helpState',help:{generation:1,draft_key:'synthetic',availability:{state:'unknown'},seat:null,draft:{question:'',turnId:null,duration:30,updated_at:0},turns:[],envelope:null,current:[],history:[],refresh:{state:'never',at:null},note:null},activityId});
await page.locator('.hps-conversation-settings > summary').click();
assert.equal(await page.locator('.hps-access-embedded').isVisible(),true,'usage is reachable with one settings disclosure');
await emit({type:'history',messages:Array.from({length:12},(_,i)=>({id:'history-'+i,role:'assistant',content:'앞서 나눈 합성 업무 대화입니다. '.repeat(8),createdAt:i})),activityId});
// A short Windows sidebar must retain a usable conversation before a question exists.
await page.setViewportSize({width:360,height:540});
await page.waitForTimeout(400);
const layout = await page.locator('.hps-messages').evaluate(el => {
 const r=el.getBoundingClientRect(), footer=document.querySelector('.hps-input-area').getBoundingClientRect();
 const messages=[...el.querySelectorAll('.hps-msg')].map(m=>({box:m.getBoundingClientRect(),height:m.scrollHeight}));
 return {height:r.height,bottom:r.bottom,footerTop:footer.top,footerBottom:footer.bottom,
  compressed:messages.some(m=>m.box.height+2<m.height),viewport:innerHeight};
});
if(process.env.HPS_LAYOUT_SCREENSHOT)await page.screenshot({path:process.env.HPS_LAYOUT_SCREENSHOT});
assert.ok(layout.height>=180 && layout.bottom<=layout.footerTop+1 && layout.footerBottom<=layout.viewport+1 && !layout.compressed,
 'short sidebar reserves at least one third for conversation even with settings open, without overlap: '+JSON.stringify(layout));
await page.setViewportSize({width:300,height:900});
await question({id:'narrow-connect',kind:'connect',title:'Google 계정을 연결할까요?',description:'만든 스킬에서 사용할 계정을 연결해 주세요.',private:true});
await emit({type:'streamStart',streamId:'narrow-stream',messageId:'narrow-reply',activityId});
await emit({type:'streamEnd',streamId:'narrow-stream',activityId});
await page.waitForTimeout(400);
const inChatViewport=selector=>page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),v=document.querySelector('.hps-messages').getBoundingClientRect();return r.top>=v.top&&r.bottom<=v.bottom&&r.left>=0&&r.right<=innerWidth;});
assert.equal(await inChatViewport('.hps-user-question h3'),true,'new question heading stays in the narrow chat viewport');
assert.equal(await inChatViewport('.hps-question-submit'),true,'connect action is reachable without losing the question heading');
assert.equal(await page.locator('.hps-access').getAttribute('open'),null,'an incoming question collapses optional usage details');
assert.equal(await page.locator('.hps-conversation-settings').getAttribute('open'),null,'question closes optional settings');
assert.equal(await page.locator('[data-artifact-approval]').isVisible(),false);
await page.locator('.hps-messages').evaluate(element=>{element.scrollTop=element.scrollHeight;});
await question({id:'narrow-sheet',kind:'sheet',title:'어떤 시트를 사용할까요?',private:true});
await page.waitForTimeout(400);
assert.equal(await inChatViewport('.hps-user-question h3'),true,'next question resets the scroll to its own beginning');
assert.equal(await inChatViewport('.hps-question-submit'),true,'next question answer button remains reachable');
if(process.env.HPS_NARROW_QUESTION_SCREENSHOT)await page.screenshot({path:process.env.HPS_NARROW_QUESTION_SCREENSHOT});
await emit({type:'automationQuestion',question:null,activityId});
assert.equal(await page.locator('[data-artifact-approval]').isVisible(),false,'optional classroom controls stay folded after answering');
await page.locator('.hps-conversation-support > summary').click();
assert.equal(await page.locator('[data-artifact-approval]').isVisible(),true,'classroom controls remain available on demand');
await page.locator('.hps-conversation-support > summary').click();
await page.setViewportSize({width:360,height:540});
await page.locator('.hps-input textarea').fill('다음 자동화도 만들자');
await page.locator('.hps-input textarea').press('Enter');
for(const message of [
 {type:'streamStart',streamId:'layout-stream',messageId:'layout-reply',activityId},
 {type:'streamChunk',streamId:'layout-stream',delta:'확인할 내용을 정리합니다.',activityId},
 {type:'streamEnd',streamId:'layout-stream',activityId},
]) {
 await emit(message); await page.waitForTimeout(50);
 const box=await page.locator('.hps-messages').boundingBox();
 assert.ok(box.height>=200,'sending, answering and idle all retain a readable conversation');
 assert.equal(await page.locator('.hp-help').isVisible(),false,'help stays folded across the turn');
 assert.equal(await page.locator('.hps-input textarea').isVisible(),true);
}
await question({id:'layout-final',kind:'text',title:'언제까지 자료를 받을까요?',description:'업무 방식만 알려 주세요. 실제 이름·이메일·계정·시트 주소는 비공개 설정에서 입력해요.',private:false});
assert.equal(await page.locator('.hps-input textarea').isVisible(),false,'no permanent read-only composer below an active question');
await page.waitForTimeout(200);
assert.equal(await page.locator('.hps-user-question').getByText('언제까지 자료를 받을까요?',{exact:true}).count(),1,'question title is rendered once');
assert.equal(await page.locator('.hps-question-description').count(),0,'generic privacy is not repeated as a description');
assert.equal(await page.locator('.hps-question-privacy').count(),1,'one privacy reminder remains');
assert.equal(await inChatViewport('.hps-question-submit'),true,'short viewport keeps the answer action visible');
assert.equal(await inChatViewport('.hps-question-cancel'),true,'short viewport keeps cancellation visible');
assert.equal(await page.getByRole('button',{name:'답변할 질문으로 이동 ↑'}).count(),0,'no duplicate question navigation while the question is visible');
await page.locator('.hps-messages').evaluate(element=>{element.scrollTop=0;});
await page.getByRole('button',{name:'답변할 질문으로 이동 ↑'}).click();
assert.equal(await inChatViewport('.hps-user-question h3'),true);
await emit({type:'automationQuestion',question:null,activityId});
await page.getByRole('button',{name:'답변할 질문으로 이동 ↑'}).waitFor({state:'detached'});
assert.equal(await page.getByRole('button',{name:'답변할 질문으로 이동 ↑'}).count(),0);
assert.equal(await page.locator('.hps-input textarea').isVisible(),true);
// Required selection opens the settings instead of silently choosing funding.
const fundingConfig={...config,access:{status:'ready',selected:null,view:{configured:true,required:true,as_of:0,choices:[{id:'class',label:'시험 수업',active:true,available:true,state:'ready',source_kind:'cohort',resources:[],allowed:{models:[]},ends_at:1900000000000}]}}};
await emit({type:'config',config:fundingConfig});
await page.getByRole('combobox',{name:'이번 작업의 이용권'}).waitFor({state:'visible'});
assert.equal(await page.getByRole('combobox',{name:'이번 작업의 이용권'}).getAttribute('disabled'),null);
await page.getByRole('combobox',{name:'이번 작업의 이용권'}).selectOption('class');
assert.equal((await page.evaluate(()=>window.__posts.filter(m=>m.type==='selectFunding').at(-1))).id,'class');
// A host-confirmed local subscription does not require the Service funding selector.
await emit({type:'config',config:{...fundingConfig,localSubscription:true}});
await page.locator('.hps-conversation-settings:not([open])').waitFor();
assert.equal(await page.getByRole('combobox',{name:'이번 작업의 이용권'}).count(),0);
await page.locator('.hps-conversation-settings > summary').click();
assert.equal(await page.getByText('이 대화의 AI 사용량은 연결한 로컬 계정의 구독에 적용돼요. 서버 이용권은 사용하지 않아요.',{exact:true}).isVisible(),true);
// Returning to the actual Service route restores required selection and its controls.
await emit({type:'config',config:{...fundingConfig,localSubscription:false}});
await page.getByRole('combobox',{name:'이번 작업의 이용권'}).waitFor({state:'visible'});
assert.equal(await page.locator('.hps-conversation-settings').getAttribute('open'),'');
await emit({type:'config',config});
await page.locator('.hps-conversation-settings:not([open])').waitFor();
await emit({type:'config',config:{...config,profile:{...config.profile,automations:{enabled:false,provider:'gmail'}}}});await emit({type:'automationQuestion',question:{id:'denied',kind:'text',title:'보이면 안 됨',private:true},activityId});await page.getByTestId('user-question-card').waitFor({state:'detached'});assert.equal(await page.getByTestId('user-question-card').count(),0);
assert.deepEqual(errors,[]);console.log('PASS conversation UI: real App private routing, single question, explicit choice/free text, full preview, approval, cancellation, 300px sidebar question visibility and opt-in gate');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
