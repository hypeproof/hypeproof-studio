import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
import {sdkToolToActionRequest} from '../src/sdkCoachHelpers.ts';
import {describeCommandForApproval,shellApprovalFor} from '../src/shellPolicy.ts';
import {commandApprovalPurposeFor} from '../src/commandApprovalPrompt.ts';
// The prompt exactly as resolveActionApproval builds it from the SDK request (description is `Bash: <command>`).
const hostPrompt=(id,command)=>{const req=sdkToolToActionRequest({toolName:'Bash',input:{command}});const {destructive}=shellApprovalFor(req.payload.command,req.destructive===true);return {id,purpose:commandApprovalPurposeFor(req.payload,destructive),command:describeCommandForApproval(req.payload.command),destructive,rememberAllowed:!destructive};};
// After focus lands on the initial button: the purpose stays within two lines and the first line of the command is on screen.
const START=`(()=>{const d=document.querySelector('.hps-command-approval'),h=d.querySelector('h2'),p=d.querySelector('pre'),hr=h.getBoundingClientRect(),pr=p.getBoundingClientRect(),lh=parseFloat(getComputedStyle(h).lineHeight)||parseFloat(getComputedStyle(h).fontSize)*1.5,line=parseFloat(getComputedStyle(p).lineHeight)||parseFloat(getComputedStyle(p).fontSize)*1.5,dr=d.getBoundingClientRect();return {headingLines:Math.round(hr.height/lh),heading:h.textContent,preTop:pr.top,firstLineBottom:pr.top+line,dialogTop:dr.top,dialogBottom:dr.bottom,innerHeight,preScrollTop:p.scrollTop,preScrollLeft:p.scrollLeft,focused:document.activeElement?.textContent}})()`;
const startVisible=(v,label)=>{assert.ok(v.headingLines<=2,`${label}: purpose within two lines (${v.headingLines})`);assert.ok(!/Bash|rm -rf/.test(v.heading),`${label}: heading never repeats the tool or command`);assert.ok(v.preTop>=Math.max(0,v.dialogTop)-.5&&v.firstLineBottom<=Math.min(v.innerHeight,v.dialogBottom)+.5,`${label}: first command line in view with focus on ${v.focused} ${JSON.stringify(v)}`);assert.equal(v.preScrollTop,0);assert.equal(v.preScrollLeft,0);};
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN command approval layout');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'}});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin);let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const themeName of ['Dark+','Light+'])for(const width of [320,800,1420])for(const destructive of [false,true]){
  const theme=THEMES[themeName],dark=theme.kind==='dark';const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.send('Page.navigate',{url:'about:blank'});
  await browser.load(`<!doctype html><html class="${KIND_CLASS[theme.kind]}" style="${vars};--vscode-editor-foreground:${theme.foreground};--vscode-errorForeground:${dark?'#f48771':'#a1260d'};--vscode-editor-font-family:monospace"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>window.errors=[];window.addEventListener("error",e=>errors.push(e.message));window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){},setState(){}});${js.replaceAll('</script','<\\/script')}</script></body></html>`,{width,height:900,dark});
  const config={proxyUrl:'http://controlled.invalid/v1',model:'sonnet',hasToken:true,coach:{name:'코치',personality:'',configured:true},activity:{id:'activity',name:'작업',kind:seat,workspace:'/synthetic',verified:true},taskWorkspace:seat==='personal'?{scope:'s',revision:1,tasks:[{id:'task',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],activeTaskId:'task',sourceSelection:null}:undefined,profile:{profile_id:'synthetic',activity_kind:seat,observation:null,lesson:null,rehearsal:null,welcome:{greeting_md:'안녕하세요'},model_selection:null,ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize:'base'};
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}))`);
  const prompt=hostPrompt('request',destructive?'rm -rf ./build/'+'very_long_directory_name/'.repeat(40)+' ~/project-backup':'echo '+'long_argument_'.repeat(90)+'\nls -la');assert.equal(prompt.destructive,destructive);
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'commandApprovalPrompt',prompt:${JSON.stringify(prompt)}}}))`);
  await new Promise(r=>setTimeout(r,200));
  const m=await browser.evaluate(`(()=>{const d=document.querySelector('.hps-command-approval');if(!d)return null;const r=d.getBoundingClientRect(),p=d.querySelector('pre');return {open:d.open,left:r.left,right:r.right,width:r.width,purpose:getComputedStyle(d.querySelector('h2')).fontSize,font:getComputedStyle(p).fontFamily,overflow:getComputedStyle(p).overflowX,scroll:p.scrollWidth>p.clientWidth,command:p.textContent,focused:document.activeElement?.textContent,buttons:[...d.querySelectorAll('button')].map(b=>({label:b.textContent,height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width})),foreground:getComputedStyle(d.querySelector('h2')).color,background:getComputedStyle(d).backgroundColor,border:getComputedStyle(d).borderTopColor,warning:!!d.querySelector('.hps-command-warning'),pageOverflow:document.documentElement.scrollWidth>innerWidth}})()`);
  if(!m?.open)console.log(await browser.evaluate('({errors,body:document.body.innerText, messages})'));
  assert.ok(m?.open,`${seat}/${themeName}/${width}: actual App opens modal`);assert.equal(m.purpose,'16px');assert.ok(m.font.includes('monospace'));assert.equal(m.overflow,'auto');assert.equal(m.scroll,true);assert.equal(m.command,'$ '+prompt.command);assert.ok(m.left>=0&&m.right<=width+.5);assert.equal(m.pageOverflow,false);assert.equal(m.focused,destructive?'거절':'허락');assert.equal(m.buttons.length,destructive?2:3);startVisible(await browser.evaluate(START),`${seat}/${themeName}/${width}/${destructive}`);assert.equal(m.warning,destructive);for(const b of m.buttons)assert.ok(b.height>=44&&b.width>=44,JSON.stringify(b));
  const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
  const luminances=[luminance(m.foreground),luminance(m.background)].sort((a,b)=>b-a);assert.ok((luminances[0]+.05)/(luminances[1]+.05)>=4.5,'purpose text contrast >=4.5:1');
  if(destructive)assert.equal(m.border,dark?'rgb(244, 135, 113)':'rgb(161, 38, 13)');
  const ring=await browser.focusVisibleStyle('[data-command-deny]');assert.equal(ring['outline-width'],'2px');
  const codeRing=await browser.focusVisibleStyle('.hps-command-code');assert.equal(codeRing['outline-width'],'2px');assert.equal(codeRing['outline-offset'],'-2px','scrollable command keeps the focus ring inside');
  if(width===320&&destructive){
   // A tall destructive command (a heredoc) scrolls inside its own block; focus on 거절 does not push its first line off screen.
   const tall=hostPrompt('tall','rm -rf ./generated && cat <<EOF > notes.txt\n'+Array.from({length:60},(_,i)=>`line ${i} `+'x'.repeat(30)).join('\n')+'\nEOF');
   await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'commandApprovalPrompt',prompt:${JSON.stringify(tall)}}}))`);await new Promise(r=>setTimeout(r,200));
   const t=await browser.evaluate(START);assert.equal(t.focused,'거절');startVisible(t,`${seat}/${themeName}/320/tall`);
   if(process.env.COMMAND_SCREENSHOTS){mkdirSync(process.env.COMMAND_SCREENSHOTS,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.COMMAND_SCREENSHOTS}/${seat}-${theme.kind}-320-destructive-tall.png`,Buffer.from(png.data,'base64'));}
   await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'commandApprovalPrompt',prompt:${JSON.stringify(prompt)}}}))`);await new Promise(r=>setTimeout(r,200));
  }
  if(process.env.COMMAND_SCREENSHOTS){mkdirSync(process.env.COMMAND_SCREENSHOTS,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.COMMAND_SCREENSHOTS}/${seat}-${theme.kind}-${width}-${destructive?'destructive':'normal'}.png`,Buffer.from(png.data,'base64'));}
  if(width===800&&destructive){
   await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify({...config,textSize:'xlarge'})}}}))`);await new Promise(r=>setTimeout(r,50));
   assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.hps-command-approval h2')).fontSize"),'20px');
   assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.hps-command-approval pre')).fontSize"),'18px');
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   const fc=await browser.evaluate("(()=>{const e=document.createElement('i');e.style.color='CanvasText';document.body.append(e);const color=getComputedStyle(e).color;e.remove();return {color,border:getComputedStyle(document.querySelector('.hps-command-approval')).borderTopColor,warning:getComputedStyle(document.querySelector('.hps-command-warning')).color}})()");assert.equal(fc.border,fc.color);assert.equal(fc.warning,fc.color);
  }
  await browser.evaluate(`document.querySelector('.hps-command-approval').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await new Promise(r=>setTimeout(r,220));assert.deepEqual(await browser.evaluate("messages.filter(m=>m.type==='commandApprovalAnswer').map(m=>({id:m.id,choice:m.choice}))"),[{id:'request',choice:'deny'}]);cases++;
 }
 console.log(`PASS command approval actual App: ${cases} seat/theme/width/destructive cases from the real SDK request shape; fixed two-line purpose, command start visible with initial focus (incl. tall destructive), 16px purpose, full monospace horizontal scroll, default focus, Esc, 44px buttons, red border, 320px containment, xlarge and forced colours`);
}finally{await browser.close();}
