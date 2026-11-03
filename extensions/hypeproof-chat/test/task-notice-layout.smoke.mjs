// DES-CGP-AGENT-47: shell DOM with a controlled expiry clock.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const source=fileURLToPath(new URL('../../../scripts/patches/core/notice-src/vs/workbench/contrib/hpsNotice/browser/hpsNoticeToast.ts',import.meta.url));
const bundle=await build({entryPoints:[source],bundle:true,write:false,format:'iife',globalName:'Notice',platform:'browser'});
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN: no Chromium');process.exit(0);}
const b=await launch(bin),e=process.env.TASK_NOTICE_EVIDENCE;if(e)mkdirSync(e,{recursive:true});
try{
 for(const dark of [false,true])for(const width of [320,800,1420]){
  await b.load(`<body style="margin:0"><main id="shell" style="position:relative;width:100vw;height:100vh;--vscode-notifications-background:${dark?'#202020':'#fff'};--vscode-notifications-foreground:${dark?'#eee':'#222'};--vscode-notifications-border:#777;--vscode-button-background:#005a9e;--vscode-button-foreground:#fff;--vscode-focusBorder:#007acc"><textarea id="draft">작성 중인 초안</textarea></main><script>${bundle.outputFiles[0].text}</script>`,{width,height:800,dark});
  const m=await b.evaluate(`(()=>{window.results=[];window.clock=[];document.getElementById('draft').focus();document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{data:'한'}));window.toast=Notice.hpsMountNotice(document.getElementById('shell'),'browserApproval',v=>results.push(v),(fn,ms)=>{clock.push({fn,ms});return 1},()=>{});const el=document.querySelector('.hps-task-notice'),button=el.querySelector('button'),r=el.getBoundingClientRect();return {focus:document.activeElement.id,live:el.querySelector('[role=status]').getAttribute('aria-live'),text:el.textContent,x:r.x,right:innerWidth-r.right,bottom:innerHeight-r.bottom,w:r.width,bw:button.getBoundingClientRect().width,bh:button.getBoundingClientRect().height,font:getComputedStyle(button).fontSize,animation:getComputedStyle(el).animationName,ms:clock[0].ms,draft:document.getElementById('draft').value}})()`);
  assert.equal(m.focus,'draft');assert.equal(m.draft,'작성 중인 초안');assert.equal(m.live,'polite');assert.ok(m.text.includes('미리보기 열기 허락'));assert.equal(m.ms,5000);assert.ok(m.x>=0&&m.w<=width-32);assert.equal(m.right,16);assert.equal(m.bottom,32);assert.ok(m.bw>=44&&m.bh>=44);assert.equal(m.font,'14px');assert.equal(m.animation,'none');
  if(e){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${e}/${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
  assert.deepEqual(await b.evaluate(`(()=>{clock[0].fn();return [!!document.querySelector('.hps-task-notice'),results,document.activeElement.id]})()`),[false,[false],'draft']);
 }
 await b.evaluate(`window.clock=[];window.results=[];window.toast=Notice.hpsMountNotice(document.getElementById('shell'),'done',v=>results.push(v),(fn,ms)=>{clock.push({fn,ms});return 1},()=>{});document.querySelector('.hps-task-notice button').focus();clock[0].fn()`);
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-task-notice')`),true);
 assert.equal(await b.evaluate(`getComputedStyle(document.activeElement).outlineWidth`),'2px');
 await b.evaluate(`document.querySelector('.hps-task-notice button').click();document.getElementById('draft').focus()`);assert.deepEqual(await b.evaluate(`results`),[true]);
 await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await b.evaluate(`window.toast=Notice.hpsMountNotice(document.getElementById('shell'),'done',()=>{},()=>1,()=>{});document.querySelector('.hps-task-notice button').focus()`);
 const forced=await b.evaluate(`(()=>{const el=document.querySelector('.hps-task-notice'),button=el.querySelector('button');return {outline:getComputedStyle(button).outlineWidth,animation:getComputedStyle(el).animationName,colour:getComputedStyle(button).color,bg:getComputedStyle(button).backgroundColor}})()`);
 assert.equal(forced.outline,'2px');assert.equal(forced.animation,'none');assert.notEqual(forced.colour,forced.bg);
 assert.equal(await b.evaluate(`Notice.hpsNoticeRequest({id:'bad',task:'bad',kind:'constructor'})`),null);
 console.log('PASS 6 shell toast layouts, expiry, focus and composition draft preservation, polite text and hostile request');
}finally{await b.close();}
