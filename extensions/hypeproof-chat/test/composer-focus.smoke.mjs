// Synthetic webview message/animation-frame controls; not native focus proof.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
const bundle=await build({entryPoints:['webview-ui/src/composerFocus.ts'],bundle:true,platform:'browser',format:'iife',globalName:'composerFocus',write:false});
const listeners=new Set(),frames=new Map();let nextFrame=0,focuses=0;
const context={window:{addEventListener:(type,listener)=>{assert.equal(type,'message');listeners.add(listener);},removeEventListener:(_type,listener)=>listeners.delete(listener)},console,
 requestAnimationFrame:callback=>{const id=++nextFrame;frames.set(id,callback);return id;},cancelAnimationFrame:id=>frames.delete(id)};
vm.createContext(context);vm.runInContext(bundle.outputFiles[0].text,context);
const message=data=>{for(const listener of listeners)listener({data});};
const flush=()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();};
const input={isConnected:true,disabled:false,value:'saved A draft',selectionStart:5,selectionEnd:5,focus(){focuses++;}};
const bind=()=>context.composerFocus.bindComposerFocus(()=>input,'activity-A');
let dispose=bind();message({type:'config',config:{activity:{id:'activity-A'}}});flush();assert.equal(focuses,0,'background configuration/restore cannot steal focus');
for(const request of[{type:'focusInput',activityId:'activity-B'},{type:'focusInput'},{type:'activityFreeze',activityId:'activity-A'}])message(request);
flush();assert.equal(focuses,0,'another activity, absent scope and unrelated messages cannot focus');
message({type:'focusInput',activityId:'activity-A'});assert.equal(focuses,0,'focus waits for editor reveal frame');flush();assert.equal(focuses,1);
assert.equal(input.value,'saved A draft');assert.equal(input.selectionStart,5);assert.equal(input.selectionEnd,5);
message({type:'focusInput',activityId:'activity-A'});message({type:'focusInput',activityId:'activity-A'});assert.equal(frames.size,1,'coalesces only pending explicit requests');flush();assert.equal(focuses,2);
for(const unavailable of['disabled','detached']){input.disabled=unavailable==='disabled';input.isConnected=unavailable!=='detached';message({type:'focusInput',activityId:'activity-A'});flush();assert.equal(focuses,2);}
input.disabled=false;input.isConnected=true;message({type:'focusInput',activityId:'activity-A'});dispose();flush();assert.equal(focuses,2,'unmount cancels pending request');assert.equal(listeners.size,0);
dispose=bind();message({type:'focusInput',activityId:'activity-A'});dispose();message({type:'config',config:{activity:{id:'activity-B'}}});flush();assert.equal(focuses,2,'activity switch removes old focus callback');
console.log('PASS explicit composer focus: exact activity, animation frame, no passive steal, unchanged draft/selection, disabled/detached refusal and lifecycle cleanup');
