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
const setup=async()=>{
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
 config={...base,profile:{...base.profile,...fixture.profile,ux:{...base.profile.ux,...fixture.profile.ux},lesson:null},activity:{id:fixture.current.connections.current.id,name:'내 질문',kind:'personal',workspace:fixture.work,verified:true},taskWorkspace:store.getView()};
 hostMessages.length=0;
 const harness=`window.__posts=[];window.__streams=[];window.__utterances=[];window.__contexts=[];
 if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0')}
 window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],speak:u=>window.__utterances.push(u),cancel(){}}});
 if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{}});
 navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext(),osc=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();gain.gain.value=0;osc.connect(gain);gain.connect(dest);osc.start();window.__gain=gain;window.__contexts.push(context);window.__streams.push(dest.stream);return dest.stream};`;
 await b.load(`<html><style>${css}</style><body><div id="root"></div><script>${harness}</script><script>${script}</script></body></html>`,{width:800,height:900});
 await send({type:'config',config});await send({type:'history',messages:store.getHistory()});await drain();
 await fixture.send({type:'voiceDisclosureAck',policyVersion:'hps-voice-policy/1',activityId:config.activity.id,taskId:store.getView().activeTaskId});
 assert(fixture.posts.some(m=>m.type==='voiceDisclosureState'&&m.acknowledged.includes('hps-voice-policy/1')),'real host persisted the prior policy acknowledgement');await drain();
 return store;
};
try {
 const store=await setup();
 assert(await b.evaluate("document.querySelectorAll('.tw-task').length>0"),'the real task rail is drawn');
 await noMarker('before any voice session');
 await click('자동 음성 대화 시작');
 assert.equal(await b.evaluate('!!document.querySelector(".hps-voice-disclosure")'),false,'existing acknowledgement adds no recurring mode gate');
 controls.push('one deliberate start with inline behavior and no redundant acknowledgement');
 await wait(async()=>await live()===1,'capture before IME Escape');
 {const m=await marker();assert.equal(m.count,1,'one row is marked while capture is live');assert.equal(m.active,true,'the marked row is the active task');assert.equal(m.text,'음성 대화 중');assert.match(m.name??'',/, 음성 대화 중$/,'the row name ends with the marker words');assert(m.size>=14,'marker text at the 14px floor '+m.size);assert(m.contrast>=4.5,'marker text contrast >= 4.5:1, got '+m.contrast);}
 controls.push('the active task row is marked 음성 대화 중 while capture is live');
 // Exercise the native listener itself; document's IME host barrier is separate protection.
 for (const flags of [{isComposing:true,keyCode:27},{isComposing:false,keyCode:229}]) {
  const prevented=await b.evaluate(`(()=>{const event=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,...${JSON.stringify(flags)}});window.dispatchEvent(event);return event.defaultPrevented})()`);
  await drain();assert.equal(prevented,false,'composing Escape stays with the IME');
  assert.equal(await live(),1,'composing Escape retains the active conversation');
  assert(await b.evaluate(`!!document.querySelector('button[aria-label="음성 대화 중지"]')`),'conversation remains active');
 }
 const prevented=await b.evaluate(`(()=>{const event=new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true,cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})()`);
 await drain();assert.equal(prevented,true,'ordinary Escape is handled');assert.equal(await live(),0,'ordinary Escape stops capture');
 await noMarker('Escape stopped the session and released the microphone');
 controls.push('composing Escape and legacy 229 retain capture; ordinary Escape stops');
 await click('자동 음성 대화 시작');
 // Silence alone cannot dispatch; the analyser and recorder are real, no fake end-turn event.
 await new Promise(r=>setTimeout(r,1100));await drain();assert.equal(calls.filter(c=>c.type==='voiceTranscribe').length,0);assert.equal(await live(),1);
 await b.evaluate('window.__gain.gain.value=0.0001');await new Promise(r=>setTimeout(r,500));await b.evaluate('window.__gain.gain.value=0');await new Promise(r=>setTimeout(r,900));await drain();assert.equal(calls.filter(c=>c.type==='voiceTranscribe').length,0,'below-floor audio never creates a paid turn');
 for(let turn=1;turn<=2;turn++) {
  await speech();await wait(async()=>(await spoken()).length===turn,'spoken answer '+turn);
  assert.equal(await live(),0,'half duplex closes capture before transcription/reply/TTS');
  assert.equal((await marker()).count,1,'the marker stays while the answer plays (the session is live)');
  assert.equal(calls.filter(c=>c.type==='sendMessage').length,turn);
  const request=calls.filter(c=>c.type==='sendMessage').at(-1);assert(store.getHistory().some(m=>m.id===request.id&&m.role==='user'));assert(store.getHistory().some(m=>m.id===request.id+'-answer'&&m.role==='assistant'),'real host persisted the matching response');
  await b.evaluate('window.__utterances.at(-1).onend()');await wait(async()=>await live()===1,'next capture');
 }
 controls.push('two automatic observed-audio turns through actual host/account/disk store');
 await click('음성 대화 중지');assert.equal(await live(),0);
 await noMarker('Stop released the microphone');controls.push('Stop removes the marker after the microphone is released');
 await b.evaluate('window.__utterances.at(-1).onend()');await new Promise(r=>setTimeout(r,150));assert.equal(await live(),0);controls.push('Stop fences late playback completion');
 // Actual mounted App uses the same hub for automatic playback and the answer's manual recovery.
 await click('자동 음성 대화 시작');await speech();
 await wait(async()=>(await spoken()).length===3,'automatic answer before autoplay refusal');
 assert.equal(await live(),0);
 await b.evaluate("window.__utterances.at(-1).onerror({error:'not-allowed'})");await drain();
 await wait(()=>b.evaluate('!!document.querySelector(".hps-voice-resume")'),'manual blocked-playback recovery');
 assert(await b.evaluate(`!!document.querySelector('button[aria-label="자동 음성 대화 시작"]')`),'blocked reading stops the automatic conversation');await noMarker('blocked playback stopped the session');
 const blockedSends=calls.filter(c=>c.type==='sendMessage').length;
 const resumePoint=await b.evaluate('(()=>{const e=document.querySelector(".hps-voice-resume"),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error("resume obscured");return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await b.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...resumePoint});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...resumePoint});await drain();
 assert.equal((await spoken()).length,4,'one deliberate manual resume plays the blocked answer');
 assert.equal(await b.evaluate('!!document.querySelector(".hps-voice-resume")'),false);
 await b.evaluate('window.__utterances.at(-1).onend()');await new Promise(r=>setTimeout(r,150));await drain();
 assert.equal(await live(),0,'manual playback completion never restarts the microphone');assert.equal(calls.filter(c=>c.type==='sendMessage').length,blockedSends);
 controls.push('autoplay refusal stops continuous voice; actual answer recovery press reads without auto-listen or resend');
 const before=calls.filter(c=>c.type==='sendMessage').length;
 hold=true;await click('자동 음성 대화 시작');await speech();await wait(async()=>!!held,'held transcription');assert.equal(await live(),0);
 await send({type:'config',config:{...config,activity:{...config.activity,id:'other-account-activity'}}});
 await send({type:'voiceTranscribeResult',requestId:held.requestId,ok:true,text:'늦은 전사'});await drain();assert.equal(calls.filter(c=>c.type==='sendMessage').length,before);assert.equal(await live(),0);await noMarker('scope switch stopped the session');controls.push('scope switch fences stale transcription without send');
 hold=false;held=null;await send({type:'config',config});await drain();refusal=true;
 await click('자동 음성 대화 시작');await speech();await wait(async()=>/한도/.test(await label()),'authoritative refusal');assert.equal(await live(),0);assert.equal(calls.filter(c=>c.type==='sendMessage').length,before);await noMarker('the cap refusal stopped the session');controls.push('Service cap refusal stops with zero automatic retry');
 const unack={...config,profile:{...config.profile,profile_id:'unacknowledged-internal-profile'}};
 fixture.current.h.cachedProfile=unack.profile;
 await send({type:'config',config:unack});await drain();await click('자동 음성 대화 시작');
 assert.equal(await live(),0,'existing policy disclosure gates capture');
 assert.match(await b.evaluate('document.querySelector(".hps-voice-disclosure").innerText'),/자동으로 보내요/);
 await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await drain();
 await wait(()=>b.evaluate('!document.querySelector(".hps-voice-disclosure")'),'existing policy sheet closed');
 assert.equal(await live(),0);controls.push('unacknowledged existing policy shows accurate automatic copy; cancel opens no capture');
 await b.evaluate('document.querySelector(".hps-input textarea").focus()');await b.send('Input.insertText',{text:'보관할 초안'});await drain();
 assert.equal(await b.evaluate(`document.querySelector('button[aria-label="자동 음성 대화 시작"]').disabled`),true,'unrelated draft blocks the loop');
 assert.equal(await b.evaluate('document.querySelector(".hps-input textarea").value'),'보관할 초안');assert.equal(calls.filter(c=>c.type==='sendMessage').length,before);controls.push('unrelated manual draft retained with no automatic send');
 // Voice not served: no conversation control and never a marker, even right after a session was live.
 refusal=false;fixture.current.h.cachedProfile=config.profile;await send({type:'config',config});await drain();
 await b.evaluate(`(()=>{const t=document.querySelector('.hps-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);await drain();
 await click('자동 음성 대화 시작');await wait(async()=>(await marker()).count===1,'marked again before unserving');
 const unserved={...config,profile:{...config.profile,voice:undefined}};fixture.current.h.cachedProfile=unserved.profile;
 await send({type:'config',config:unserved});await drain();
 assert.equal(await live(),0,'unserving voice stops capture');await noMarker('voice is not served');
 assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="자동 음성 대화"]')`),false,'no voice conversation control when voice is not served');
 controls.push('voice not served: no control, no marker');
 const screenshot=await b.send('Page.captureScreenshot',{format:'png'});
 if(process.env.VOICE_EVIDENCE){mkdirSync(process.env.VOICE_EVIDENCE,{recursive:true});writeFileSync(process.env.VOICE_EVIDENCE+'/voice-conversation.png',Buffer.from(screenshot.data,'base64'));writeFileSync(process.env.VOICE_EVIDENCE+'/result.json',JSON.stringify({controls,provider_calls:0,hardware_microphone:false,actual_recorder:true,actual_analyser:true,actual_host_store:true,calls},null,2)+'\n')}
 console.log('PASS '+JSON.stringify(controls));
} catch(error) {
 if(process.env.VOICE_EVIDENCE){mkdirSync(process.env.VOICE_EVIDENCE,{recursive:true});writeFileSync(process.env.VOICE_EVIDENCE+'/failure.json',JSON.stringify({controls,error:String(error),body:await b.evaluate('document.body.innerText'),posts:await b.evaluate('window.__posts'),calls},null,2)+'\n');const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(process.env.VOICE_EVIDENCE+'/failure.png',Buffer.from(shot.data,'base64'));}
 throw error;
} finally {if(fixture)fixture.close();await b.close()}
