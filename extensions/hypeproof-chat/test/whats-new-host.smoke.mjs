// CGP-SHELL-R-035 — the real ChatPanelProvider host for "새로운 기능": the panel is due once per
// notes id, stays through a panel remount in the same window, never returns after a reload once
// drawn, a close (or a late "shown" after it) cannot bring it back, the instructor console gets
// none, and a fresh install vs an updated profile is told apart by the activation baseline.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
const vscode={env:{appName:'HypeProof Studio'},workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}};
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortController,AbortSignal,URL,TextEncoder,TextDecoder,crypto:webcrypto});
const proto=module.exports.ChatPanelProvider.prototype;
const model=await build({entryPoints:[new URL('../src/whatsNew.ts',import.meta.url).pathname,new URL('../src/learnerReleaseNotes.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,outdir:'x',logLevel:'silent'});
const load=async f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'));
const {recordWhatsNewBaseline,learnerNotes,WHATS_NEW_KEY}=await load(model.outputFiles.find(f=>f.path.endsWith('whatsNew.js')));
const {LEARNER_RELEASE_NOTES}=await load(model.outputFiles.find(f=>f.path.endsWith('learnerReleaseNotes.js')));
const notes=learnerNotes(LEARNER_RELEASE_NOTES);assert.ok(notes,'shipped notes are valid');
const memento=(seed={})=>{const data=new Map(Object.entries(seed));return {data,get:k=>data.get(k),update:async(k,v)=>{data.set(k,v);},keys:()=>[...data.keys()]};};
// One host = one window's extension host. `state` is the shared globalState.
function host(state,instructor=false){
 const posts=[];const h=Object.create(proto);
 const fields={context:{globalState:state,globalStorageUri:{fsPath:'/nonexistent'},secrets:{get:async()=>undefined},workspaceState:{get:()=>undefined}},
  _instructorMode:{isInstructor:instructor},post:async m=>{posts.push(m);}};
 for(const [k,v] of Object.entries(fields))Object.defineProperty(h,k,{value:v,writable:true,configurable:true});
 let n=0;const ask=async()=>{const requestId='r'+(++n);await h.handleMessage({type:'whatsNewRequest',requestId});const m=posts.findLast(p=>p.type==='whatsNew');assert.equal(m.requestId,requestId);return m;};
 return {h,posts,ask};
}
// An updated profile (prior state, no record): due once.
const state=memento({'hps.other':1});await recordWhatsNewBaseline(state,notes);
let w=host(state);let view=await w.ask();
assert.equal(view.show,true,'updated profile: the panel is due');assert.equal(JSON.stringify(view.notes),JSON.stringify(notes),'lines come from the host');
// The webview draws it and says so; a remount in the same window still shows it.
await w.h.handleMessage({type:'whatsNewShown',notesId:notes.id});
assert.equal(JSON.stringify(state.data.get(WHATS_NEW_KEY)),JSON.stringify({seen:notes.id}),'drawing it records it');
assert.equal((await w.ask()).show,true,'panel remount in the same window keeps it until closed');
// A reload (new extension host, same globalState) does not bring it back.
assert.equal((await host(state).ask()).show,false,'after a reload it is not shown again');
// Close: hidden, the webview is told to re-read, and a late "shown" cannot reopen it.
await w.h.handleMessage({type:'whatsNewDismiss',notesId:'wrong'});assert.equal((await w.ask()).show,true,'a wrong id closes nothing');
await w.h.handleMessage({type:'whatsNewDismiss',notesId:notes.id});
assert.ok(w.posts.some(p=>p.type==='whatsNewChanged'),'webview told to re-read');
assert.equal((await w.ask()).show,false,'closed');
await w.h.handleMessage({type:'whatsNewShown',notesId:notes.id});
assert.equal((await w.ask()).show,false,'a late shown after the close does not reopen it');
// Not drawn yet (e.g. a turn was running the whole time): still due on the next launch.
const pending=memento({[WHATS_NEW_KEY]:{seen:'older'}});
assert.equal((await host(pending).ask()).show,true);
assert.equal((await host(pending).ask()).show,true,'never drawn: still due next launch');
// A shown message with a stale id records nothing.
const s2=memento({[WHATS_NEW_KEY]:{seen:'older'}});w=host(s2);await w.h.handleMessage({type:'whatsNewShown',notesId:'older-2'});
assert.equal(JSON.stringify(s2.data.get(WHATS_NEW_KEY)),JSON.stringify({seen:'older'}));
// Instructor console: never due, and its "shown" (if any) records nothing.
const s3=memento({[WHATS_NEW_KEY]:{seen:'older'}});w=host(s3,true);
assert.equal((await w.ask()).show,false,'instructor console: no panel');
await w.h.handleMessage({type:'whatsNewShown',notesId:notes.id});assert.equal(JSON.stringify(s3.data.get(WHATS_NEW_KEY)),JSON.stringify({seen:'older'}));
// Instructor mode not resolved yet (null) counts as a learner, like the accuracy card.
assert.equal((await host(memento({[WHATS_NEW_KEY]:{seen:'older'}}),null).ask()).show,true);
// Fresh install: nothing is new.
const fresh=memento();await recordWhatsNewBaseline(fresh,notes);
assert.equal((await host(fresh).ask()).show,false,'fresh install: no panel');
// A failing store never throws into the webview: no panel.
const broken={get(){throw Error('io');},update:async()=>{throw Error('io');},keys:()=>[]};
assert.equal((await host(broken).ask()).show,false,'unreadable store: no panel');
// A store that reads but cannot write: the close still holds for this window.
const readOnly={get:()=>({seen:'older'}),update:async()=>{throw Error('disk full');},keys:()=>['x']};
w=host(readOnly);assert.equal((await w.ask()).show,true);
await w.h.handleMessage({type:'whatsNewShown',notesId:notes.id});
await w.h.handleMessage({type:'whatsNewDismiss',notesId:notes.id});
assert.equal((await w.ask()).show,false,'closed in this window even when the record cannot be written');
// Oversized request ids are ignored.
w=host(state);await w.h.handleMessage({type:'whatsNewRequest',requestId:'x'.repeat(101)});assert.equal(w.posts.length,0);
console.log('PASS whats-new host: once per notes id, remount keeps it, reload/close/late-shown do not, instructor none, fresh install none');
