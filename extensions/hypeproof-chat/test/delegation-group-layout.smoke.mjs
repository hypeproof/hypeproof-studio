import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN delegation panel layout');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin);let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const themeName of ['Dark+','Light+'])for(const width of [320,800,1420])for(const long of [false,true]){
  const theme=THEMES[themeName],dark=theme.kind==='dark';const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.send('Page.navigate',{url:'about:blank'});
  await browser.load(`<!doctype html><html class="${KIND_CLASS[theme.kind]}" style="${vars};--vscode-editor-foreground:${theme.foreground};--vscode-errorForeground:${dark?'#f48771':'#a1260d'};--vscode-editor-font-family:monospace"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>window.errors=[];window.addEventListener("error",e=>errors.push(e.message));window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){},setState(){}});${js.replaceAll('</script','<\\/script')}</script></body></html>`,{width,height:900,dark});
  const config={proxyUrl:'http://controlled.invalid/v1',model:'sonnet',hasToken:true,coach:{name:'코치',personality:'',configured:true},activity:{id:'activity',name:'작업',kind:seat,workspace:'/synthetic',verified:true},taskWorkspace:seat==='personal'?{scope:'s',revision:1,tasks:[{id:'task',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],activeTaskId:'task',sourceSelection:null}:undefined,profile:{profile_id:'synthetic',activity_kind:seat,observation:null,lesson:null,rehearsal:null,welcome:{greeting_md:'안녕하세요'},model_selection:null,ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize:'base'};
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}))`);

  const helper=long?'W'.repeat(30):'코드리뷰어',task=long?'긴작업이름'.repeat(12):'코드 확인';
  const messages=[{id:'u1',role:'user',content:'검토해 줘',createdAt:1},{id:'delegate-one@s1',role:'tool',content:'',createdAt:2,tool:{icon:'🤝',label:helper+' · '+task+'\n\n검토 결과입니다.',state:'done'}},{id:'delegate-two@s1',role:'tool',content:'',createdAt:3,tool:{icon:'🤝',label:'리서처 · 근거 확인',state:'running'}},{id:'delegate-one~child',role:'tool',content:'',createdAt:4,tool:{icon:'🔧',label:'Read(index.html)',state:'done'}}];
  for(const msg of [{type:'history',messages},{type:'streamStart',streamId:'s1',messageId:'a1'}])await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`);
  await new Promise(r=>setTimeout(r,80));
  assert.equal(await browser.evaluate("document.querySelector('.hps-delegation-toggle')?.textContent"),'도우미 2명 · 1명 끝남','actual App roll-up');
  assert.equal(await browser.evaluate("document.querySelectorAll('.hps-delegation-panel').length"),0);
  await browser.evaluate("document.querySelector('.hps-delegation-toggle').focus();document.querySelector('.hps-delegation-toggle').click()");
  await new Promise(r=>setTimeout(r,200));
  await browser.evaluate("document.querySelector('.hps-delegation-summary').click()");
  const m=await browser.evaluate(`(()=>{const d=document.querySelector('.hps-delegation-panel');if(!d)return null;const r=d.getBoundingClientRect();return {open:d.open,left:r.left,right:r.right,bottom:r.bottom,width:r.width,rows:d.querySelectorAll('.hps-delegation').length,body:d.textContent,focused:document.activeElement?.textContent,buttons:[...d.querySelectorAll('button,summary')].map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width})),overflow:d.scrollWidth>d.clientWidth,foreground:getComputedStyle(d.querySelector('h2')).color,background:getComputedStyle(d).backgroundColor,font:getComputedStyle(d.querySelector('h2')).fontSize,pageOverflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.ok(m?.open);assert.equal(m.rows,2);assert.ok(m.body.includes(helper)&&m.body.includes(task)&&m.body.includes('검토 결과입니다.')&&m.body.includes('결과 보기'));assert.ok(m.left>=0&&m.right<=width+.5);assert.equal(m.overflow,false,'dialog no horizontal overflow');assert.equal(m.pageOverflow,false);assert.equal(m.focused,'닫기');assert.ok(parseFloat(m.font)>=14);for(const b of m.buttons)assert.ok(b.height>=44&&b.width>=44,JSON.stringify(b));if(width===320){assert.equal(m.width,320);assert.ok(Math.abs(m.bottom-900)<1,'320px bottom sheet');}
  const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
  const luminances=[luminance(m.foreground),luminance(m.background)].sort((a,b)=>b-a);assert.ok((luminances[0]+.05)/(luminances[1]+.05)>=4.5,'purpose text contrast >=4.5:1');

  const ring=await browser.focusVisibleStyle('[data-delegation-close]');assert.equal(ring['outline-width'],'2px');
  if(process.env.DELEGATION_SCREENSHOTS){mkdirSync(process.env.DELEGATION_SCREENSHOTS,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.DELEGATION_SCREENSHOTS}/${seat}-${theme.kind}-${width}-${long?'long':'normal'}.png`,Buffer.from(png.data,'base64'));}
  await browser.evaluate("document.querySelector('.hps-delegation-stop').click();document.querySelector('.hps-delegation-stop').click()");
  await new Promise(r=>setTimeout(r,40));
  const sent=await browser.evaluate("messages.filter(m=>m.type==='stopDelegations').map(m=>m.streamId)");assert.deepEqual(sent,['s1']);
  assert.equal(await browser.evaluate("document.querySelector('.hps-delegation-stop').textContent"),'멈추는 중…');
  for(const state of ['unconfirmed','confirmed']){
   await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'delegationStopState',streamId:'s1',state:'${state}'}}))`);
   await new Promise(r=>setTimeout(r,30));assert.equal(await browser.evaluate("document.querySelector('.hps-delegation-stop').textContent"),state==='confirmed'?'멈춤 확인':'멈춤 확인 안 됨');
  }

  await browser.evaluate("window.dispatchEvent(new MessageEvent('message',{data:{type:'delegationStopState',streamId:'foreign',state:'pending'}}))");await new Promise(r=>setTimeout(r,20));assert.equal(await browser.evaluate("document.querySelector('.hps-delegation-stop').textContent"),'멈춤 확인');
  if(width===800&&long){
   await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify({...config,textSize:'xlarge'})}}}))`);await new Promise(r=>setTimeout(r,40));
   assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.hps-delegation-panel h2')).fontSize"),'18px');
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   const fc=await browser.focusVisibleStyle('[data-delegation-close]');assert.equal(fc['outline-width'],'2px');
  }
  await browser.evaluate("document.querySelector('.hps-delegation-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await new Promise(r=>setTimeout(r,220));
  assert.equal(await browser.evaluate("document.querySelectorAll('.hps-delegation-panel').length"),0);
  assert.equal(await browser.evaluate("document.activeElement?.className"),'hps-delegation-toggle');
  const moved={...config,activity:{...config.activity,id:'other'}};
  for(const msg of [{type:'config',config:moved},{type:'history',messages},{type:'delegationStopState',streamId:'s1',state:'confirmed'}])await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`);
  await new Promise(r=>setTimeout(r,60));await browser.evaluate("document.querySelector('.hps-delegation-toggle').click()");await new Promise(r=>setTimeout(r,60));
  assert.equal(await browser.evaluate("document.querySelectorAll('.hps-delegation-stop').length"),0,'old stop confirmation cannot enter another activity');
  cases++;
 }

 console.log(`PASS delegation actual App: ${cases} seat/theme/width/long-name cases; roll-up, results, counts, stop request once and pending/unknown/confirmed, 44px targets, contrast, focus/return and 320px bottom sheet`);
}finally{await browser.close();}
