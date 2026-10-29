// Source/DOM controls, not installed native focus acceptance.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bundled = await build({entryPoints:['webview-ui/src/retainedComposerFocus.ts'],bundle:true,platform:'browser',format:'iife',globalName:'retained',write:false});
const source = bundled.outputFiles[0].text;
function fixture(code=source, initialComposer=true) {
 const listeners = new Map(), frames = new Map(); let seq=0, focuses=0, live=true, foreground=true, modal=false;
 const target = label => ({addEventListener(type,fn){const k=label+type; if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(type,fn){listeners.get(label+type)?.delete(fn);}});
 const win={...target('w'),requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame(id){frames.delete(id);}};
 const body={},other={},doc={...target('d'),body,documentElement:{},defaultView:win,visibilityState:'visible',hasFocus:()=>foreground,querySelectorAll:()=>modal?[{getClientRects:()=>[{}]}]:[]};
 const input={ownerDocument:doc,isConnected:true,disabled:false,readOnly:false,value:'한글 draft',selectionStart:2,selectionEnd:4,getClientRects:()=>[{}],focus(options){assert.equal(options.preventScroll,true);focuses++;doc.activeElement=input;}};
 doc.activeElement=initialComposer?input:other;let owner={},captured=owner;
 const c=vm.createContext({});vm.runInContext(code,c);
 const stop=c.retained.bindRetainedComposerFocus(input,()=>live&&owner===captured);
 const emit=(owner,type,event={})=>{for(const fn of [...(listeners.get(owner+type)??[])])fn(event);};
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const f of pending)f();};
 const blur=()=>{foreground=false;emit('w','blur');};
 const returned=()=>{foreground=true;emit('w','focus');};
 return {doc,input,other,body,emit,flush,blur,returned,stop,frames,listeners,replaceOwner(){owner={};},get focuses(){return focuses;},set live(v){live=v;},set modal(v){modal=v;}};
}
function twoStage(f){f.blur();f.returned();f.flush();f.doc.activeElement=f.body;f.emit('d','focusout',{target:f.input,relatedTarget:null});f.blur();f.returned();f.flush();}
assert.equal(source.split('input.focus({ preventScroll: true });').length,2,'missing-recovery mutant must match once');
const baseline=fixture(source.replace('input.focus({ preventScroll: true });','void input;'));twoStage(baseline);assert.equal(baseline.focuses,0,'reproduced missing retained recovery');baseline.stop();
let f=fixture();twoStage(f);assert.equal(f.focuses,1,'second native return restores same last composer');assert.equal(f.input.value,'한글 draft');assert.equal(f.input.selectionStart,2);assert.equal(f.input.selectionEnd,4);f.stop();
for(const kind of ['other','pointer','tab','escape','modal','readonly','disabled','detached','hidden','stale','blur','dispose']){
 f=fixture();f.blur();f.doc.activeElement=f.body;f.returned();
 if(kind==='other'){f.doc.activeElement=f.other;f.emit('d','focusin',{target:f.other});}
 if(kind==='pointer')f.emit('d','pointerdown',{target:f.other});
 if(kind==='tab'||kind==='escape')f.emit('d','keydown',{key:kind==='tab'?'Tab':'Escape'});
 if(kind==='modal')f.modal=true;
 if(kind==='readonly')f.input.readOnly=true;
 if(kind==='disabled')f.input.disabled=true;
 if(kind==='detached')f.input.isConnected=false;
 if(kind==='hidden')f.doc.visibilityState='hidden';
 if(kind==='stale')f.live=false;
 if(kind==='blur')f.blur();
 if(kind==='dispose')f.stop();
 f.flush();assert.equal(f.focuses,0,kind+' must not restore');f.stop();assert([...f.listeners.values()].every(s=>!s.size));assert.equal(f.frames.size,0);
}
f=fixture();f.doc.activeElement=f.other;f.emit('d','focusin',{target:f.other});f.blur();f.doc.activeElement=f.body;f.returned();f.flush();assert.equal(f.focuses,0,'last noncomposer control is never replaced');f.stop();
f=fixture();f.blur();f.doc.activeElement=f.body;f.returned();f.replaceOwner();f.replaceOwner();f.flush();assert.equal(f.focuses,0,'ABA owner replacement invalidates old frame');f.stop();
f=fixture(source,false);f.doc.activeElement=f.body;f.blur();f.returned();f.flush();assert.equal(f.focuses,0,'background mount never claims a composer');f.stop();
const browser=await launch(assert.ok(findChromium(),'required headless browser missing')||findChromium());
try {
 await browser.load('<textarea id="draft">한글 draft</textarea><button id="other">Other</button><dialog id="modal"><button>Cancel</button></dialog>');
 await browser.evaluate(source);
 await browser.evaluate(`(()=>{window.input=document.querySelector('textarea');input.focus();input.setSelectionRange(2,4);window.live=true;window.stop=retained.bindRetainedComposerFocus(input,()=>live);window.returned=()=>window.dispatchEvent(new Event('focus'));input.blur();window.dispatchEvent(new Event('blur'));returned();})()`);
 await browser.send('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true});
 assert.deepEqual(await browser.evaluate('({focused:document.activeElement===input,text:input.value,start:input.selectionStart,end:input.selectionEnd})'),{focused:true,text:'한글 draft',start:2,end:4});
 await browser.send('Input.insertText',{text:'입력'});assert.equal(await browser.evaluate('input.value'),'한글입력raft','subsequent typing reaches restored caret');
 await browser.evaluate("document.querySelector('#other').focus();window.dispatchEvent(new Event('blur'));returned();");
 await browser.send('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(r))',awaitPromise:true});
 assert.equal(await browser.evaluate("document.activeElement.id"),'other');
 await browser.evaluate("input.focus();input.blur();window.dispatchEvent(new Event('blur'));returned();document.querySelector('dialog').showModal();");
 await browser.send('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(r))',awaitPromise:true});
 assert.equal(await browser.evaluate("document.activeElement.closest('dialog')?.id"),'modal');
 await browser.evaluate('stop()');
} finally {await browser.close();}
console.log('PASS retained composer: missing-recovery negative, double return,12 stale/user/dialog guards, noncomposer preservation, real DOM caret/typing/dialog; native OS focus NOT RUN');
