// Actual runtime routing with synthetic transports and an isolated fake CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req=createRequire(root+'/package.json');
const {build}=req('esbuild');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'refusal-routing-'));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
// Each fake CLI emits exactly ONE refusal signal, so removing either arm of the local client fails.
const fakeCli=(name,events)=>{const file=path.join(scratch,name);fs.writeFileSync(file,`#!${process.execPath}\nif(process.argv[2]==='auth'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));}else{process.stdin.resume();process.stdin.on('end',()=>{for(const e of ${JSON.stringify(events)})console.log(JSON.stringify(e));});}\n`,{mode:0o700});return file;};
const ok={type:'result',subtype:'success',stop_reason:'end_turn',result:''};
const exes={
 both:fakeCli('fake-claude',[{type:'system',subtype:'model_refusal_no_fallback'},{type:'result',subtype:'success',stop_reason:'end_turn',result:''}]),
 'result-only':fakeCli('fake-claude-result',[{type:'result',subtype:'success',stop_reason:'refusal',result:''}]),
 'system-only':fakeCli('fake-claude-system',[{type:'system',subtype:'model_refusal_no_fallback'},ok]),
 none:fakeCli('fake-claude-none',[{type:'result',subtype:'success',stop_reason:'end_turn',result:'ok'}]),
};
const exe=exes.both;
async function load(){
const bundle=await build({stdin:{contents:"export {ChatPanelProvider} from './src/chatPanelProvider';export {runSdkCoach} from './src/sdkCoach';export {runLocalCoach} from './src/localRuntime/index';export {runInstructorTurn} from './src/chalk/instructorTurn';",resolveDir:root},bundle:true,platform:'node',format:'cjs',external:['vscode','@anthropic-ai/claude-agent-sdk','zod'],write:false,logLevel:'silent'});
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>(id==='os'||id==='node:os')?{...req(id),homedir:()=>scratch}:id==='vscode'?{workspace:{getConfiguration:()=>({get:(_k,f)=>f})},window:{},Uri:{file:p=>({fsPath:p})}}:req(id),process:{...process,env:{...process.env,APPDATA:scratch}},console,Buffer,URL,Error,crypto:globalThis.crypto,AbortController,AbortSignal,DOMException,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,fetch:async()=>new Response('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'refusal'}]})+'\n\ndata: [DONE]\n\n')});
return module.exports;
}
async function check(api,kind){let calls=0;const base={cwd:scratch,history:[],userText:'synthetic',signal:new AbortController().signal,onDelta:()=>{},onRefusal:()=>calls++,requestApproval:async()=>false};
if(kind==='sdk')await api.runSdkCoach({...base,sdk:{query:()=> (async function*(){yield {type:'result',subtype:'success',stop_reason:'refusal'};})()},binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',model:'test-model',profile:{sdk_tools:{}},systemPrompt:'',stallTimeoutMs:0});
if(kind==='browser'){const h={isCurriculumRuntimeEnabled:()=>true,mcpBrowser:{crNewTurn(){},dispose(){}},crBrowserOptions:()=>({}),cachedProfile:{},liveServer:{currentUrl:()=>undefined},proxyUsageRecorder:()=>()=>{}};await api.ChatPanelProvider.prototype.runBrowserLoop.call(h,{...base,proxyUrl:'https://example.test',model:'test',streamId:'synthetic',coachName:'coach',coachPersonality:'',onCitations:()=>{}});}
const config={provider:'claude',executable:exe,model:'sonnet'};
if(kind==='local')await api.runLocalCoach({...base,config,profile:{sdk_tools:{}}});
if(kind==='local-result-only')await api.runLocalCoach({...base,config:{...config,executable:exes['result-only']},profile:{sdk_tools:{}}});
if(kind==='local-system-only')await api.runLocalCoach({...base,config:{...config,executable:exes['system-only']},profile:{sdk_tools:{}}});
if(kind==='local-none')await api.runLocalCoach({...base,config:{...config,executable:exes.none},profile:{sdk_tools:{}}});
if(kind==='instructor')await api.runInstructorTurn({...base,local:config,brief:'Synthetic instructor',chalkCtx:undefined});
assert.equal(calls,kind==='local-none'?0:1,kind+' refusal callback');}
const api=await load();for(const kind of ['sdk','browser','local','local-result-only','local-system-only','local-none','instructor']){await check(api,kind);console.log('GREEN',kind);}
console.log('PASS explicit refusal routes');
