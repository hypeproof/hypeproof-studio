// CGP-VOICE-R-018 (REQ-CGPV-22, VO-26) — the start and end sounds in the real App on the existing
// host/account/disk store (harness from voice-conversation-browser.smoke.mjs: oscillator microphone, fixture Service
// replies, device TTS callbacks). Earcons are counted by their glide targets (880 Hz start, 587 Hz end) on AudioParam.
// - 시작·끝 소리 off (the default): a dictation and a whole conversation make no sound;
// - on: one start and one end per dictation (start→cancel, also immediately) and per conversation session, however
//   many turns, captures and answers the session has; the coach's own read-aloud (in the conversation and from an
//   answer's 읽어 주기) never makes one; the visual and ARIA state is the same with the sounds on or off;
// - the settings row: off by default, its press writes setVoiceSounds, a 44px-or-more target, wraps at 320px.
// The window's 소리 끄기 has no mounted control on main (VoicePanel is not mounted), so it is covered by
// voice-sounds-host.smoke.mjs (pairs + player source), not here.
// Real App -> existing host/account/reflection/disk store, real Chromium MediaRecorder + analyser.
// Audio input is an oscillator, Service/provider responses and device TTS callbacks are fixtures.
// No hardware microphone, live provider, or physical Korean endpointing claim.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { personalEntryFixture } from './personal-entry-harness.mjs';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN voice conversation: Chromium unavailable');process.exit(0)}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'voice-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text, script=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const b=await launch(bin), hostMessages=[], calls=[], controls=[];let fixture,config,refusal=false,hold=false,held;
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await new Promise(r=>setTimeout(r,30))};
const posts=()=>b.evaluate('window.__posts.splice(0)');
const drain=async()=>{
 for(let i=0;i<12;i++) {
  const batch=await posts();
  for(const m of batch) {
   if(['voiceTranscribe','sendMessage','voiceDisclosureRead','voiceDisclosureAck','saveActivityDraft'].includes(m.type)) {
    calls.push({type:m.type,id:m.userMessageId??m.requestId,text:m.text});
    if(hold&&m.type==='voiceTranscribe'){held=m;continue}
    await fixture.send(m);
   }
  }
  while(hostMessages.length) await send(hostMessages.shift());
  if(!batch.length) break;
 }
};
const wait=async(test,label,ms=8000)=>{const end=Date.now()+ms;while(Date.now()<end){await drain();if(await test())return;await new Promise(r=>setTimeout(r,60))}throw Error('timeout: '+label+'; '+await b.evaluate('document.body.innerText.slice(-1800)'))};
const label=()=>b.evaluate(`document.querySelector('[aria-label="자동 음성 대화"]')?.textContent??''`);
const click=async name=>{
 const rect=await b.evaluate(`(()=>{const e=document.querySelector('button[aria-label='+JSON.stringify(${JSON.stringify(name)})+']');if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error('voice control obscured by '+hit?.outerHTML);if(r.width<44||r.height<44)throw Error('voice target below 44px');return{x,y}})()`);
 assert(rect,'enabled button '+name+'; '+await b.evaluate('document.body.innerText.slice(-3000)')+'; '+await b.evaluate('JSON.stringify([...document.querySelectorAll("button")].map(b=>({label:b.getAttribute("aria-label"),disabled:b.disabled,text:b.textContent})))'));
 await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await drain();
};
const spoken=()=>b.evaluate('window.__utterances.map(u=>u.text)');
// CGP-VOICE-R-030 — the task rail's marker: how many rows carry it, whether it sits on the active row, and that row's name.
const marker=()=>b.evaluate(`(()=>{const m=[...document.querySelectorAll('.tw-task [data-voice-live]')];const row=m[0]?.closest('.tw-task');const lum=c=>{const v=(c.match(/[\\d.]+/g)||[]).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};let bg=null;for(let n=m[0];n&&!bg;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c&&!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))bg=c}const fg=m[0]?getComputedStyle(m[0]).color:null;const L=fg&&bg?[lum(fg),lum(bg)].sort((x,y)=>y-x):null;
 return {count:m.length,active:row?.getAttribute('aria-current')==='page',name:row?.getAttribute('aria-label')??null,text:m[0]?.textContent??null,size:m[0]?parseFloat(getComputedStyle(m[0]).fontSize):null,contrast:L?(L[0]+.05)/(L[1]+.05):null}})()`);
const noMarker=async why=>{const m=await marker();assert.equal(m.count,0,'no voice marker: '+why+' '+JSON.stringify(m))};
const live=()=>b.evaluate('window.__streams.filter(s=>s.getTracks().some(t=>t.readyState==="live")).length');
const speech=async()=>{
 await wait(async()=>/듣고 있어요/.test(await label()),'listening');
 await b.evaluate('window.__gain.gain.value=0.08');await new Promise(r=>setTimeout(r,800));await b.evaluate('window.__gain.gain.value=0');
};
const setup=async(extra={})=>{
 fixture=await personalEntryFixture({publish:m=>hostMessages.push(m),responseFor:async(route,options)=>{
  if(route.endsWith('/voice/transcribe')) {
   assert.equal(options.method,'POST');assert.match(options.headers.authorization,/^Bearer /);assert.equal(options.headers['content-type'],'audio/webm');assert(options.body.byteLength>100);assert(options.body.byteLength<2*1024*1024);
   return refusal?Response.json({error:{code:'voice_cap_reached',message:'음성 사용 한도에 도달했어요.',retry:false}},{status:429}):Response.json({text:'함께 질문을 만들어 보고 싶어요.'});
  }
  if(route.endsWith('/me/reflection/turns')) {
   const request=JSON.parse(options.body);const state=fixture.snapshot.state;
   state.messages.push({id:request.id,role:'user',content:request.text,created_at:Date.now()},{id:request.id+'-answer',role:'assistant',content:'어떤 질문이 마음에 남았나요?',created_at:Date.now()+1});state.revision++;
   state.turn={id:request.id,text:request.text,status:'completed',updated_at:Date.now()};
   return Response.json({...fixture.snapshot,acknowledged_id:request.id});
  }
 }});
 fixture.profile.voice={dictation:true,read_aloud:true,policy_version:'hps-voice-policy/1'};
 await fixture.current.page.openPersonalReflectionEntry();await fixture.login();fixture.useChatSurface();
 fixture.current.h.cachedProfile=fixture.profile;
 const store=fixture.current.h.currentTaskStore();assert(store);
 const base=chatConfig();
 config={...base,profile:{...base.profile,...fixture.profile,ux:{...base.profile.ux,...fixture.profile.ux},lesson:null},activity:{id:fixture.current.connections.current.id,name:'내 질문',kind:'personal',workspace:fixture.work,verified:true},taskWorkspace:store.getView(),...extra};
 hostMessages.length=0;
 const harness=`if(!window.__earconSpy){window.__earconSpy=true;AudioParam.prototype.linearRampToValueAtTime=(orig=>function(v,t){if(v===880||v===587)window.__earcons.push(v===880?'start':'stop');return orig.call(this,v,t)})(AudioParam.prototype.linearRampToValueAtTime);}window.__earcons=[];window.__posts=[];window.__streams=[];window.__utterances=[];window.__contexts=[];
 if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0')}
 window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:u=>window.__utterances.push(u),cancel(){}}});
 if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{}});
 navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();gain.gain.value=0;osc.connect(gain);gain.connect(dest);osc.start();window.__gain=gain;window.__contexts.push(context);window.__streams.push(dest.stream);return dest.stream};`;
 await b.load(`<html><style>${css}</style><body><div id="root"></div><script>${harness}</script><script>${script}</script></body></html>`,{width:800,height:900,appReady:true});
 await send({type:'config',config});await send({type:'history',messages:store.getHistory()});await drain();
 await fixture.send({type:'voiceDisclosureAck',policyVersion:'hps-voice-policy/1',activityId:config.activity.id,taskId:store.getView().activeTaskId});
 assert(fixture.posts.some(m=>m.type==='voiceDisclosureState'&&m.acknowledged.includes('hps-voice-policy/1')),'real host persisted the prior policy acknowledgement');await drain();
 return store;
};

const earcons=()=>b.evaluate('window.__earcons.slice()');
const clear=()=>b.evaluate('window.__earcons.length=0');
const ariaState=()=>b.evaluate(`JSON.stringify([...document.querySelectorAll('.hps-voice-note button, button.hps-voice-mic')].map(e=>[e.getAttribute('aria-label'),e.getAttribute('aria-pressed'),e.disabled]))`);
const dictate=async(fast=false)=>{
 await b.evaluate(`document.querySelector('button.hps-voice-mic').click()`);
 await wait(async()=>await b.evaluate(`!!document.querySelector('.hps-voice-recording, .hps-voice-explain, .hps-voice-disclosure')`),'dictation started or asked first');
 if (await b.evaluate(`!!document.querySelector('.hps-voice-explain')`)) await b.evaluate(`document.querySelector('.hps-voice-explain .hps-voice-primary').click()`);
 await wait(async()=>await b.evaluate(`!!document.querySelector('.hps-voice-recording')`),'dictation recording');
 if(!fast) await new Promise(r=>setTimeout(r,300));
 await b.evaluate(`[...document.querySelectorAll('.hps-voice-recording button')].find(x=>x.textContent==='취소').click()`);
 await wait(async()=>!(await b.evaluate(`!!document.querySelector('.hps-voice-recording')`))&&await live()===0,'dictation cancelled, microphone closed');
 await new Promise(r=>setTimeout(r,100));
};
const converse=async()=>{
 await click('자동 음성 대화 시작');
 for(let turn=1;turn<=2;turn++){const n=(await spoken()).length;await speech();await wait(async()=>(await spoken()).length===n+1,'spoken answer '+turn);
  await b.evaluate('window.__utterances.at(-1).onend()');await wait(async()=>await live()===1,'next capture');}
 await click('음성 대화 중지');await wait(async()=>await live()===0,'stopped');await new Promise(r=>setTimeout(r,100));
};
let cases=0;
try {
 // Off (the default): nothing sounds.
 await setup();
 const offAria=await ariaState();
 await dictate();await converse();
 assert.deepEqual(await earcons(),[],'off: a dictation and a conversation make no sound');cases++;
 // The row: off, its press writes setVoiceSounds (host-owned; the page only asks).
 // Personal chat: 설정 sits in the 대화 메뉴 and opens 대화 설정 (as learner-nickname-browser does).
 await b.evaluate(`document.querySelector('.tw-chat-menu button[aria-haspopup]').click()`);await new Promise(r=>setTimeout(r,200));
 await b.evaluate(`[...document.querySelectorAll('button[role=menuitem]')].find(x=>x.textContent.trim()==='설정').click()`);await new Promise(r=>setTimeout(r,300));
 const row=await b.evaluate(`(()=>{const f=document.querySelector('.hps-voice-sounds-setting');if(!f)return null;const i=f.querySelector('input'),l=f.querySelector('label').getBoundingClientRect();return {checked:i.checked,h:l.height,w:l.width,legend:f.querySelector('legend').textContent,hint:f.querySelector('p').textContent,described:i.getAttribute('aria-describedby')}})()`);
 assert.ok(row,'the settings dialog has the 시작·끝 소리 내기 row: '+await b.evaluate(`JSON.stringify({dialog:[...document.querySelectorAll('dialog,[role=dialog]')].map(d=>({open:d.open,cls:d.className,mic:!!d.querySelector('.hps-mic-setting, select'),text:d.innerText.slice(0,300)})),buttons:[...document.querySelectorAll('button')].map(e=>(e.getAttribute('aria-label')||'')+'|'+e.textContent.trim().slice(0,20)+'|'+(e.getAttribute('data-hp-tooltip')||'')).filter(t=>/설정|settings|더 보기|메뉴/i.test(t))})`));
 assert.equal(row.checked,false,'off by default');assert.equal(row.legend,'시작·끝 소리 내기');assert.equal(row.described,'hps-voice-sounds-setting-hint');
 assert.ok(row.h>=44,'the row label is a 44px target: '+row.h);
 await b.evaluate(`window.__posts.length=0;document.querySelector('.hps-voice-sounds-setting input').click()`);
 assert.deepEqual((await b.evaluate('window.__posts.filter(m=>m.type==="setVoiceSounds")')).map(m=>m.on),[true],'the press asks the host to turn them on');
 // 320px: the hint wraps inside the dialog.
 await b.send('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,200));
 {const g=await b.evaluate(`(()=>{const p=document.querySelector('.hps-voice-sounds-setting-hint');if(!p)return null;const r=p.getBoundingClientRect();return {right:r.right,vw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,font:parseFloat(getComputedStyle(p).fontSize)}})()`);
  assert.ok(g&&g.right<=g.vw+0.5&&g.sw<=g.vw,'320px: the hint stays inside, no sideways scroll '+JSON.stringify(g));assert.ok(g.font>=14,'hint at least 14px');}
 await b.send('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});
 cases++;
 // On: one start and one end per dictation and per conversation session; TTS never sounds.
 await setup({voiceSounds:true});await clear();
 const onAria=await ariaState();assert.equal(onAria,offAria,'visual and ARIA state are the same with the sounds on or off');
 await dictate();assert.deepEqual(await earcons(),['start','stop'],'one dictation: one start, one end');await clear();
 await dictate(true);assert.deepEqual(await earcons(),['start','stop'],'start then an immediate cancel: at most one start and one end');await clear();
 await converse();assert.deepEqual(await earcons(),['start','stop'],'a two-turn conversation with two read answers: one start, one end');await clear();
 cases++;
 // The coach's read-aloud from an answer: no sound.
 await b.evaluate(`window.__utterances.length=0;[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')?.startsWith('읽어 주기')||x.textContent.trim()==='읽어 주기')?.click()`);
 await wait(async()=>(await spoken()).length>=1,'read-aloud started');
 await b.evaluate('window.__utterances.at(-1).onend()');await new Promise(r=>setTimeout(r,200));
 assert.deepEqual(await earcons(),[],'the coach\'s read-aloud start and end never sound');cases++;
}finally{if(fixture)fixture.close();await b.close();}
console.log(`PASS voice earcons browser (${cases} cases)`);
