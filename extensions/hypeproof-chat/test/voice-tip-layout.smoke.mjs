// CGP-VOICE-R-029 (REQ-CGPV-42 / DES-CGPV-42) — the voice tip on the real App in headless Chromium, the host's
// answers played by the test: asked only at the start of a task where voice can start (never mid-task, never for an
// instructor, never where voice is not served); drawn in the flow right under the 음성 대화 button with its pointer
// on the button; at most two lines at 320px in base and xlarge text; a 44px close; no focus taken; no animation;
// forced colours; any hide after it was drawn tells the host it is closed for good.
//   FOCUS_REQUIRE_BROWSER=1 node --experimental-strip-types test/voice-tip-layout.smoke.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {THEMES,KIND_CLASS} from './lib/vscode-default-themes.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN voice tip layout');process.exit(0);}
const built=await build({entryPoints:['webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',platform:'browser',loader:{'.svg':'dataurl','.png':'dataurl'},logLevel:'silent'});
const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text,js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const TEXT='음성 대화를 누르면 말로 코치와 이야기할 수 있어요.';
const page=(theme)=>{const vars=Object.entries(theme).filter(([k,v])=>!['kind','file'].includes(k)&&v!==null).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 return `<!doctype html><html style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>if(!crypto.randomUUID)crypto.randomUUID=()=>'u-'+Math.random().toString(16).slice(2);window.messages=[];
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak(){},cancel(){},addEventListener(){},removeEventListener(){}}});
 window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){return undefined},setState(){}});${js.replaceAll('</script','<\\/script')}</script></body></html>`;};
const VOICE={dictation:true,read_aloud:true,policy_version:'hps-voice-policy/1'};
const configFor=({voice=VOICE,textSize='base',instructor=false}={})=>({hasToken:true,isInstructor:instructor,coach:{name:'코치',configured:true},activity:{id:'a1',name:'작업',kind:'personal',workspace:'/synthetic',verified:true},taskWorkspace:{scope:'s',revision:1,tasks:[],sourceSelection:null},profile:{profile_id:'synthetic',activity_kind:'personal',lesson:null,voice,welcome:{greeting_md:''},ux:{coach:{naming_mode:'fixed',fallback_name:'코치'},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false},roll_input_button:{enabled:false}},retry_button:{enabled:false}}},textSize});
const browser=await launch(bin);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const send=async(msg)=>{await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`);await wait(120);};
const posted=async()=>JSON.parse(await browser.evaluate('JSON.stringify(messages)'));
const tipCount=()=>browser.evaluate(`document.querySelectorAll('[data-testid="voice-tip"]').length`);
// The host's answer: `show` for every request the webview posted since the last answer.
const answer=async(show)=>{for(const m of await posted())if(m.type==='voiceTipRequest'&&!m.__answered){await send({type:'voiceTip',requestId:m.requestId,show});}
 await browser.evaluate(`messages.forEach(m=>{if(m.type==='voiceTipRequest')m.__answered=true})`);};
const open=async({theme=THEMES['Dark+'],width=800,forcedColors=false,history=[],...cfg}={})=>{await browser.send('Page.navigate',{url:'about:blank'});
 await browser.load(page(theme),{width,height:900,dark:theme.kind==='dark',forcedColors,appReady:true});await send({type:'config',config:configFor(cfg)});await send({type:'history',messages:history});};
const shot=()=>browser.evaluate(`(()=>{const tip=document.querySelector('[data-testid="voice-tip"]');const btn=document.querySelector('.hps-voice-note .hps-voice-primary');if(!tip||!btn)return null;
 const t=tip.getBoundingClientRect(),b=btn.getBoundingClientRect(),text=tip.querySelector('.hps-voice-tip-text'),q=text.getBoundingClientRect(),close=tip.querySelector('.hps-voice-tip-close').getBoundingClientRect();
 const cs=getComputedStyle(text),before=getComputedStyle(tip,'::before'),lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.5;
 const caretLeft=t.left+parseFloat(before.left),caretW=parseFloat(before.borderLeftWidth)*2;
 const note=btn.closest('.hps-voice-note').getBoundingClientRect();
 return {tipTop:t.top,tipLeft:t.left,tipRight:t.right,noteBottom:note.bottom,btnLeft:b.left,btnRight:b.right,caretMid:caretLeft+caretW/2,caretBottom:t.top,caretTop:t.top-parseFloat(before.borderBottomWidth),
  textH:q.height,lh,fontPx:parseFloat(cs.fontSize),closeW:close.width,closeH:close.height,vw:document.documentElement.clientWidth,scrollW:document.documentElement.scrollWidth,
  anims:tip.getAnimations({subtree:true}).length,transition:getComputedStyle(tip).transitionDuration,role:tip.getAttribute('role'),
  focusInside:tip.contains(document.activeElement),border:getComputedStyle(tip).borderTopColor,fg:getComputedStyle(tip).color,caretColor:before.borderBottomColor,text:text.textContent,label:tip.querySelector('button').getAttribute('aria-label')};})()`);
let cases=0;
try{
 // Asked once at the start of a task where voice can start; the host says yes: drawn, recorded as shown, focus untouched.
 await open();
 let req=(await posted()).filter(m=>m.type==='voiceTipRequest');
 assert.equal(req.length,1,'one request at the start of an empty task: '+JSON.stringify(req));assert.equal(req[0].taskEmpty,true);
 assert.equal(await tipCount(),0,'nothing drawn before the host answers');
 const focusBefore=await browser.evaluate('document.activeElement?.className??""');
 await answer(true);
 assert.equal(await tipCount(),1,'drawn when due');
 assert.equal((await posted()).filter(m=>m.type==='voiceTipShown').length,1,'the host is told it was drawn');
 let L=await shot();assert.ok(L,'tip and button both drawn');
 assert.equal(L.text,TEXT);assert.equal(L.label,'음성 대화 팁 닫기');assert.equal(L.role,'note','a note, not a dialog');
 assert.equal(L.focusInside,false,'no focus grab');assert.equal(await browser.evaluate('document.activeElement?.className??""'),focusBefore,'focus did not move');
 assert.equal(L.anims,0,'no animation');assert.match(L.transition,/^0s(, 0s)*$/,'no transition');cases++;
 // The host says no (seen, tips off, no seat): nothing.
 await open();await answer(false);assert.equal(await tipCount(),0,'not due: nothing drawn');
 assert.equal((await posted()).filter(m=>m.type==='voiceTipShown').length,0);cases++;
 // Before the task's history arrives, an empty message list means nothing: not asked yet.
 await browser.send('Page.navigate',{url:'about:blank'});await browser.load(page(THEMES['Dark+']),{width:800,height:900,dark:true,appReady:true});await send({type:'config',config:configFor()});
 assert.equal((await posted()).filter(m=>m.type==='voiceTipRequest').length,0,'config alone (history not arrived): not asked');
 await send({type:'history',messages:[]});assert.equal((await posted()).filter(m=>m.type==='voiceTipRequest').length,1,'asked once the empty history arrived');cases++;
 // Mid-task: never asked, never drawn.
 await open({history:[{id:'u1',role:'user',content:'안녕'},{id:'a1',role:'assistant',content:'안녕하세요'}]});
 assert.equal((await posted()).filter(m=>m.type==='voiceTipRequest').length,0,'mid-task: not asked');await answer(true);assert.equal(await tipCount(),0);cases++;
 // Voice not served: the button is not there, the tip is never asked for.
 await open({voice:null});assert.equal(await browser.evaluate(`!!document.querySelector('.hps-voice-note .hps-voice-primary')`),false,'control negative: no voice button without voice');
 assert.equal((await posted()).filter(m=>m.type==='voiceTipRequest').length,0,'no voice: not asked');cases++;
 // Instructor console: never asked.
 await open({instructor:true});assert.equal((await posted()).filter(m=>m.type==='voiceTipRequest').length,0,'instructor: not asked');cases++;
 // Close: gone, the host told; it is not asked for again in this view.
 await open();await answer(true);assert.equal(await tipCount(),1);
 await browser.evaluate(`document.querySelector('.hps-voice-tip-close').click()`);await wait(120);
 assert.equal(await tipCount(),0,'closed');assert.equal((await posted()).filter(m=>m.type==='voiceTipDismiss').length,1,'the host is told it is closed');
 await answer(true);assert.equal(await tipCount(),0,'not back after closing');cases++;
 // Drawn, then the task gets its first message: hidden and closed for good.
 await open();await answer(true);assert.equal(await tipCount(),1);
 await send({type:'history',messages:[{id:'u1',role:'user',content:'질문'}]});
 assert.equal(await tipCount(),0,'hidden once the task has a message');assert.equal((await posted()).filter(m=>m.type==='voiceTipDismiss').length,1,'counted as closed');cases++;
 // Geometry: under the button in the flow, pointer on the button, two lines at most, 44px close, 14px text, no page scroll.
 for(const [name,theme] of Object.entries(THEMES))for(const width of [320,800])for(const textSize of ['base','xlarge']){
  await open({theme,width,textSize});await answer(true);L=await shot();const tag=`${name} ${width}px ${textSize}`;
  assert.ok(L,`${tag}: drawn`);
  assert.ok(L.tipTop>=L.noteBottom-0.5,`${tag}: below the voice control, not over it (${L.tipTop} >= ${L.noteBottom})`);
  assert.ok(L.caretTop>=L.noteBottom-1,`${tag}: the pointer sits in the gap and does not cover the control (${L.caretTop} >= ${L.noteBottom})`);
  assert.ok(L.caretMid>=L.btnLeft&&L.caretMid<=L.btnRight,`${tag}: pointer aims at the 음성 대화 button (${L.caretMid} in ${L.btnLeft}..${L.btnRight})`);
  assert.ok(L.textH<=2*L.lh+1,`${tag}: at most two lines (${L.textH} <= 2x${L.lh})`);
  assert.ok(L.fontPx>=14,`${tag}: text at least 14px (${L.fontPx})`);
  assert.ok(L.closeW>=44&&L.closeH>=44,`${tag}: close at least 44px (${L.closeW}x${L.closeH})`);
  assert.ok(L.tipLeft>=0&&L.tipRight<=L.vw+0.5,`${tag}: inside the column`);assert.ok(L.scrollW<=L.vw,`${tag}: no horizontal scroll (${L.scrollW} > ${L.vw})`);
  cases++;
 }
 // Forced colours: system colours for the box, the pointer and the text.
 await open({forcedColors:true});await answer(true);L=await shot();
 assert.equal(L.border,L.fg,'forced colours: border is the text colour (CanvasText)');assert.equal(L.caretColor,L.fg,'forced colours: the pointer too');cases++;
}finally{await browser.close?.();}
console.log(`PASS voice tip layout (${cases} cases)`);
