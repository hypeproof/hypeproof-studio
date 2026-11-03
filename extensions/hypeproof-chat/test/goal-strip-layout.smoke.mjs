import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN goal strip layout');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const lesson={course_id:'globalbuddy',version:'m1',sha256:'f'.repeat(64),content:JSON.parse(readFileSync('test/fixtures/session-design/week-3.json','utf8'))};
const goal={lesson:{course_id:lesson.course_id,version:lesson.version,sha256:lesson.sha256},activity:'a1',goal:'아주 긴 목표 '.repeat(25),criteria:['직접 확인'],revision:1,status:'active',saved_at:1};
const browser=await launch(bin);let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const themeName of ['Dark+','Light+'])for(const width of [320,800,1420]){
  const theme=THEMES[themeName],dark=theme.kind==='dark',vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.send('Page.navigate',{url:'about:blank'});
  await browser.load(`<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){},setState(){}});${js.replaceAll('</script','<\\/script')}</script></body></html>`,{width,height:900,dark});
  const config={hasToken:true,coach:{name:'코치',configured:true},activity:{id:'a1',name:'작업',kind:seat,workspace:'/synthetic',verified:true},taskWorkspace:seat==='personal'?{scope:'s',revision:1,tasks:[],sourceSelection:null}:undefined,profile:{profile_id:'synthetic',activity_kind:seat,lesson:seat==='classroom'?lesson:null,welcome:{greeting_md:''},ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},studentGoal:seat==='classroom'?goal:null,textSize:'base'};
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}))`);await new Promise(r=>setTimeout(r,200));
  const compact=await browser.evaluate(`(()=>{const e=document.querySelector('.hps-goal-strip');if(!e)return null;const r=e.getBoundingClientRect(),t=e.querySelector('.hps-goal-strip-text');return {expanded:e.getAttribute('aria-expanded'),h:r.height,left:r.left,right:r.right,bottom:r.bottom,compTop:document.querySelector('.hps-input').getBoundingClientRect().top,text:t.textContent,ellipsis:getComputedStyle(t).textOverflow,nowrap:getComputedStyle(t).whiteSpace,budget:e.textContent,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  if(seat==='personal')assert.equal(compact,null);
  else{
   assert.ok(compact,'actual App renders goal strip');assert.equal(compact.expanded,'false');assert.equal(compact.text,goal.goal);assert.equal(compact.ellipsis,'ellipsis');assert.equal(compact.nowrap,'nowrap');assert.ok(compact.h>=44);assert.ok(compact.left>=0&&compact.right<=width+.5);assert.ok(compact.bottom<=compact.compTop);assert.equal(compact.overflow,false);assert.ok(compact.budget.includes('확인 안 됨'));
   const ring=await browser.focusVisibleStyle('.hps-goal-strip');assert.equal(ring['outline-width'],'2px');
   if(process.env.BROWSER_SCREENSHOTS){mkdirSync(process.env.BROWSER_SCREENSHOTS,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.BROWSER_SCREENSHOTS}/${seat}-${theme.kind}-${width}-collapsed.png`,Buffer.from(png.data,'base64'));}
   await browser.evaluate("document.querySelector('.hps-goal-strip').click()");await new Promise(r=>setTimeout(r,50));
   assert.equal(await browser.evaluate("document.querySelector('.hps-goal-expanded textarea[name=goal]').value"),goal.goal);
   if(process.env.BROWSER_SCREENSHOTS){const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.BROWSER_SCREENSHOTS}/${seat}-${theme.kind}-${width}-expanded.png`,Buffer.from(png.data,'base64'));}
   await browser.evaluate("document.querySelector('.hps-goal-strip').click()");
   await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify({...config,textSize:'xlarge'})}}}))`);await new Promise(r=>setTimeout(r,50));
   assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.hps-goal-strip-text')).fontSize"),'18px');
  }
  cases++;
 }
 console.log(`PASS goal strip actual App: ${cases} seat/theme/width cases, long goal, disclosure, composer order, 44px target, focus, xlarge; personal without lesson has no strip. 40px design remains unresolved.`);
}finally{await browser.close();}
