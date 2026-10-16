// Hosted test instrumentation only. Never imports, calls or changes a product function/store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {sameDisplayedWorkspace} from './native-ui.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return {promise,resolve,reject};};
// Diagnostics only: never used to admit a script, PID, breakpoint or workspace.
export function inspectorScriptDiagnostic(url,target){
 const windows=/^[A-Za-z]:[\\/]/.test(target.file),paths=windows?path.win32:path.posix;
 let relative='unrecognized-script-url';
 try{const parsed=new URL(url);if(parsed.protocol==='file:'&&!parsed.host&&!parsed.search&&!parsed.hash){
  const file=fileURLToPath(parsed,{windows}),candidate=paths.relative(paths.dirname(target.file),file);
  relative=candidate&&!paths.isAbsolute(candidate)&&candidate!=='..'&&!candidate.startsWith('..'+paths.sep)?candidate:'outside-fixture';
 }}catch{}
 // Only disclose the known fixture filename; other paths remain hashes.
 if(relative!==paths.basename(target.file)&&relative!=='outside-fixture'&&relative!=='unrecognized-script-url')relative='other-file-within-fixture';
 return {relative_fixture:relative,url_sha256:digest(String(url)),matches_expected_pattern:new RegExp(target.urlPattern??breakpointUrlPattern(target.url)).test(url)};
}
export function breakpointUrlPattern(url){
 const escaped=url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 // Only drive-letter spelling varies. All other path bytes remain exact.
 return '^'+escaped.replace(/^(file:\/\/\/)([A-Za-z]):/,(all,prefix,drive)=>prefix+'['+drive.toLowerCase()+drive.toUpperCase()+']:')+'$';
}
export function activationBreakpoint(file,expectedHash){
 assert(path.isAbsolute(file)&&fs.realpathSync(file)===file,'Exact regular candidate bundle path required');
 const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());
 const source=fs.readFileSync(file,'utf8');assert.equal(digest(Buffer.from(source)),expectedHash,'Candidate bundle changed');
 const lines=source.split('\n'),calls=lines.flatMap((line,index)=>line.includes('const resumeStatus = await consumeActivityResume(')?[index]:[]);
 assert.equal(calls.length,1,'Exactly one production resume invocation required');
 // Break on the preceding statement: activationRoot exists and consume has not been called.
 const line=calls[0]-1;assert(/^\s*const activationService = /.test(lines[line]),'Unrecognized production activation boundary');
 const url=pathToFileURL(file).href;
 return {file,url,urlPattern:breakpointUrlPattern(url),sha256:expectedHash,lineNumber:line,columnNumber:lines[line].indexOf('const activationService'),consumeLineNumber:calls[0]};
}
export function descendant(pid,root,parents){
 if(!Number.isSafeInteger(pid)||pid<=1||!Number.isSafeInteger(root)||root<=1||pid===root)return false;
 const seen=new Set();for(let i=0;i<20&&pid>1&&!seen.has(pid);i++){seen.add(pid);pid=parents.get(pid);if(pid===root)return true;}return false;
}
export function listenerCommand(port,platform=process.platform){
 assert(Number.isInteger(port)&&port>=1024&&port<=65535);
 if(platform==='darwin')return ['lsof',['-nP','-iTCP:'+port,'-sTCP:LISTEN','-Fp']];
 if(platform==='win32')return ['powershell.exe',['-NoProfile','-NonInteractive','-Command',`$pids=@(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique);$rows=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId);@{listeners=$pids;parents=$rows}|ConvertTo-Json -Compress -Depth 4`]];
 throw Error('Inspector listener ownership supports only hosted Mac/Windows');
}
export function ownedListener(port,root,platform=process.platform,execute=execFileSync){
 const [command,args]=listenerCommand(port,platform);let output;
 try{output=execute(command,args,{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']});}catch(error){if(platform==='darwin'&&error.status===1)return null;throw Error('Cannot establish inspector listener ownership');}
 let pids,parents;
 if(platform==='darwin'){
  pids=[...new Set(String(output).split('\n').filter(x=>/^p\d+$/.test(x)).map(x=>Number(x.slice(1))))];
  const rows=execute('ps',['-axo','pid=,ppid='],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore']});
  parents=new Map(String(rows).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)));
 }else{const data=JSON.parse(output);pids=[...new Set(data.listeners??[])];parents=new Map((data.parents??[]).map(x=>[x.ProcessId,x.ParentProcessId]));}
 if(!pids.length)return null;
 assert.equal(pids.length,1,'Ambiguous inspector listener');assert(descendant(pids[0],root,parents),'Inspector listener is not an owned App descendant');
 return pids[0];
}
export async function freeInspectorPort(port){
 assert(Number.isInteger(port)&&port>=1024&&port<=65535);
 await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error('Inspector port already occupied')));server.listen(port,'127.0.0.1',()=>server.close(resolve));});
}
export function inspectorTarget(list,port){
 assert(Array.isArray(list)&&list.length===1&&list[0].type==='node','Exactly one Node inspector target required');
 const target=list[0],url=new URL(target.webSocketDebuggerUrl);
 assert(url.protocol==='ws:'&&url.hostname==='127.0.0.1'&&url.port===String(port)&&!url.username&&!url.password&&!url.search&&!url.hash,'Inspector endpoint escaped owned loopback port');
 assert(typeof target.id==='string'&&url.pathname==='/'+target.id&&/^[a-f0-9-]{20,64}$/i.test(target.id),'Inspector target identity mismatch');return target;
}
export class InspectorPeer{
 constructor(url,onEvent,onClosed=()=>{}){this.url=url;this.onEvent=onEvent;this.onClosed=onClosed;this.sequence=0;this.pending=new Map();this.paused=false;this.ownedPause=false;}
 async connect(){
  this.ws=new WebSocket(this.url);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inspector connect timeout')),10000);this.ws.onopen=()=>{clearTimeout(timer);resolve();};this.ws.onerror=()=>{clearTimeout(timer);reject(Error('Inspector connection failed'));};});
  this.ws.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}
   const pending=this.pending.get(message.id);if(pending){this.pending.delete(message.id);message.error?pending.reject(Error('Inspector method refused: '+pending.method)):pending.resolve(message.result);}
   else if(message.method)this.onEvent(message);
  };
  this.ws.onclose=()=>{for(const item of this.pending.values())item.reject(Error('Inspector closed'));this.pending.clear();this.onClosed();};return this;
 }
 send(method,params={}){
  const methods=['Runtime.enable','Runtime.runIfWaitingForDebugger','Debugger.enable','Debugger.setBreakpointByUrl','Debugger.getScriptSource','Debugger.removeBreakpoint','Debugger.resume','Debugger.disable'];
  assert(methods.includes(method)||(method==='Runtime.evaluate'&&params.expression==='process.pid')||(method==='Debugger.evaluateOnCallFrame'&&params.expression==='activationRoot'),'Inspector expression/method not permitted');
  assert(this.ws?.readyState===WebSocket.OPEN,'Inspector socket not open');
  return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Inspector method timeout: '+method));},10000);
   const done=(fn,value)=>{clearTimeout(timer);fn(value);};this.pending.set(id,{method,resolve:v=>done(resolve,v),reject:e=>done(reject,e)});
   try{this.ws.send(JSON.stringify({id,method,params}));}catch{this.pending.delete(id);done(reject,Error('Inspector send failed'));}
  });
 }
 async close(){
  if(!this.ws||this.ws.readyState===WebSocket.CLOSED)return;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inspector socket did not close')),3000);const done=()=>{clearTimeout(timer);resolve();};this.ws.addEventListener('close',done,{once:true});this.ws.close();});
 }
}
export function assertPause({event,scripts,breakpoint,target,source,root,expectedRoot}){
 assert(event.params.hitBreakpoints?.includes(breakpoint),'Pause must hit this gate breakpoint');
 const frame=event.params.callFrames?.[0];assert(frame&&new RegExp(target.urlPattern??breakpointUrlPattern(target.url)).test(scripts.get(frame.location.scriptId)??''),'Paused script URL mismatch');
 assert.equal(digest(Buffer.from(source)),target.sha256,'Inspector loaded source differs from candidate bundle');
 assert.equal(frame.location.lineNumber,target.lineNumber,'Breakpoint moved to another statement');
 assert(sameDisplayedWorkspace(root,expectedRoot),'Paused destination workspace mismatch');return frame;
}
export class OwnedExtensionGate{
 constructor({port,appPid,target,initialRoot,onProgress=()=>{},observeListener=ownedListener}){
  this.port=port;this.appPid=appPid;this.target=target;this.onProgress=onProgress;this.observeListener=observeListener;this.seen=new Set();this.abort=new AbortController();this.initial=deferred();this.phase={label:'initial-startup',root:initialRoot,holdMs:0,result:this.initial,deadline:Date.now()+45000};this.events=[];this.protocolDiagnostics={event_counts:{},candidate_scripts:[],last_pause:null,breakpoint_locations:[]};
 }
 progress(value){const item={at:new Date().toISOString(),...value};this.events.push(item);assert(this.events.length<=400,'Inspector progress limit');this.onProgress(item);}
 fail(error){if(!this.failure){this.failure=error;this.initial.reject(error);this.phase?.result.reject(error);this.progress({phase:'gate-failed',message:error.message});}}
 start(){this.loop=this.watch();void this.loop.catch(error=>this.fail(error));return this;}
 async watch(){
  while(!this.stopped&&!this.failure){
   if(this.phase&&Date.now()>this.phase.deadline&&!this.phase.holding)throw Error('Destination inspector/activation missed startup deadline');
   if(!this.peer&&this.appPid()){
    const pid=this.observeListener(this.port,this.appPid());
    if(pid){
     let response;try{response=await fetch('http://127.0.0.1:'+this.port+'/json/list',{signal:AbortSignal.timeout(1500),redirect:'error'});}catch{}
     if(response?.ok){const target=inspectorTarget(await response.json(),this.port);if(!this.seen.has(target.id)){assert(this.phase,'Unexpected new extension host outside a declared transition');await this.attach(target,pid);}}
    }
   }
   await delay(100,undefined,{signal:this.abort.signal}).catch(error=>{if(!this.stopped)throw error;});
  }
 }
 async attach(info,pid){
  assert(pid!==this.previousPid,'Destination must have a new extension-host PID');this.seen.add(info.id);
  const scripts=new Map();let serial=Promise.resolve(),startup=false;const acquired=Date.now(),phase=this.phase;
  const peer=new InspectorPeer(info.webSocketDebuggerUrl,event=>{
   // Retain bounded structure, never protocol payloads, scopes or application text.
   const diagnostics=this.protocolDiagnostics,method=['Debugger.scriptParsed','Debugger.breakpointResolved','Debugger.paused','Debugger.resumed','Runtime.executionContextCreated'].includes(event.method)?event.method:'other';
   diagnostics.event_counts[method]=(diagnostics.event_counts[method]??0)+1;
   if(event.method==='Debugger.scriptParsed'&&typeof event.params.url==='string'){
    const name=event.params.url.replaceAll('\\','/').split('/').at(-1),expected=this.target.file.replaceAll('\\','/').split('/').at(-1);
    if(name?.toLowerCase()===expected?.toLowerCase()&&diagnostics.candidate_scripts.length<8)diagnostics.candidate_scripts.push(inspectorScriptDiagnostic(event.params.url,this.target));
   }
   if(event.method==='Debugger.scriptParsed')scripts.set(event.params.scriptId,event.params.url);
   if(event.method==='Debugger.paused'){
    diagnostics.last_pause={reason:['Break on start','other','exception','instrumentation'].includes(event.params.reason)?event.params.reason:'other-reason',hit_own_breakpoint:!!peer.breakpoint&&event.params.hitBreakpoints?.includes(peer.breakpoint)===true,script:event.params.callFrames?.[0]?inspectorScriptDiagnostic(scripts.get(event.params.callFrames[0].location.scriptId)??'',this.target):null};
    peer.paused=true;serial=serial.then(async()=>{
     if(event.params.reason==='Break on start'&&!startup){
      const observed=(await peer.send('Runtime.evaluate',{expression:'process.pid',returnByValue:true})).result?.value;
      assert.equal(observed,pid,'Inspector PID differs from owned listener');startup=true;peer.ownedPause=true;
      this.progress({phase:'owned-startup-break',pid,target_id:info.id});await peer.send('Debugger.resume');peer.paused=false;peer.ownedPause=false;return;
     }
     assert(startup,'Activation breakpoint occurred without controlled startup release');
     const frame=event.params.callFrames?.[0];assert(frame,'Missing activation call frame');
     const source=(await peer.send('Debugger.getScriptSource',{scriptId:frame.location.scriptId})).scriptSource;
     const read=await peer.send('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'activationRoot',returnByValue:true,throwOnSideEffect:true});
     assert(!read.exceptionDetails,'Destination root not readable without side effects');
     assertPause({event,scripts,breakpoint:peer.breakpoint,target:this.target,source,root:read.result?.value,expectedRoot:phase.root});peer.ownedPause=true;
     const startupMs=Date.now()-acquired;assert(startupMs<30000,'Startup/activation boundary exceeded safe handshake bound');
     phase.holding=true;const started=Date.now(),mono=process.hrtime.bigint();this.progress({phase:'pre-consumption-paused',label:phase.label,pid,target_id:info.id,startup_ms:startupMs,script_sha256:this.target.sha256,line_number:this.target.lineNumber,column_number:frame.location.columnNumber,hold_ms:phase.holdMs,handshake_evidence:'source-ordered post-Initialized activation boundary; IPC packet not intercepted'});
     const minimum=phase.holdMs?phase.holdMs+5:0;
     while(Number(process.hrtime.bigint()-mono)/1e6<minimum){await delay(Math.min(15000,Math.max(1,minimum-Number(process.hrtime.bigint()-mono)/1e6)),undefined,{signal:this.abort.signal});this.progress({phase:'hold-progress',label:phase.label,pid,elapsed_ms:Number(process.hrtime.bigint()-mono)/1e6});}
     const elapsed=Number(process.hrtime.bigint()-mono)/1e6,wall=Date.now()-started;assert(elapsed>=phase.holdMs&&wall>=phase.holdMs,'Real elapsed hold did not reach criterion');
     await peer.send('Debugger.removeBreakpoint',{breakpointId:peer.breakpoint});peer.breakpoint=null;await peer.send('Debugger.resume');peer.paused=false;peer.ownedPause=false;
     this.previousPid=pid;this.phase=null;const proof={label:phase.label,pid,target_id:info.id,previous_host_pid:phase.previousPid??null,bundle_sha256:this.target.sha256,break_line:this.target.lineNumber,consume_line:this.target.consumeLineNumber,startup_ms:startupMs,hold_monotonic_ms:elapsed,hold_wall_ms:wall,released_at_ms:Date.now(),debugger_only_resume:true};this.progress({phase:'activation-released',...proof});phase.result.resolve(proof);
    }).catch(error=>this.fail(error));
   }
  },()=>{if(!peer.intentionalClose&&!this.stopped)this.fail(Error('Owned inspector disconnected unexpectedly'));});
  this.peer=peer;await peer.connect();await peer.send('Runtime.enable');await peer.send('Debugger.enable');
  const point=await peer.send('Debugger.setBreakpointByUrl',{urlRegex:this.target.urlPattern,lineNumber:this.target.lineNumber,columnNumber:this.target.columnNumber});assert.equal(typeof point.breakpointId,'string');peer.breakpoint=point.breakpointId;
  this.protocolDiagnostics.breakpoint_locations=(point.locations??[]).slice(0,8).map(location=>({lineNumber:location.lineNumber,columnNumber:location.columnNumber}));
  for(const location of point.locations??[])assert.equal(location.lineNumber,this.target.lineNumber,'Resolved breakpoint moved');
  this.progress({phase:'owned-inspector-armed',label:phase.label,pid,target_id:info.id});await peer.send('Runtime.runIfWaitingForDebugger');
 }
 async releasePeer(){
  const peer=this.peer;if(!peer)return;let failure;
  try{if(peer.breakpoint){await peer.send('Debugger.removeBreakpoint',{breakpointId:peer.breakpoint});peer.breakpoint=null;}if(peer.paused){assert(peer.ownedPause,'Cannot resume an unverified pause');await peer.send('Debugger.resume');peer.paused=false;}await peer.send('Debugger.disable');}catch(error){failure=error;}
  peer.intentionalClose=true;try{await peer.close();}catch(error){failure??=error;}this.peer=null;if(failure)throw failure;
 }
 async prepareTransition(root,holdMs,label){
  if(this.failure)throw this.failure;assert(!this.phase,'Previous inspector phase unfinished');assert([0,2000,61000,610000].includes(holdMs),'Only reviewed hold durations allowed');
  await this.releasePeer();const result=deferred();this.phase={root,holdMs,label,result,previousPid:this.previousPid,deadline:Date.now()+45000};return {finished:result.promise};
 }
 async close(){
  if(this.closing)return this.closing;
  this.closing=(async()=>{this.stopped=true;this.phase?.result.reject(Error('Inspector gate closed before phase completed'));this.abort.abort();let failure;try{await this.releasePeer();}catch(error){failure=error;}await this.loop?.catch(()=>{});this.progress({phase:'inspector-cleanup',status:failure?'FAIL':'PASS'});if(failure)throw failure;})();return this.closing;
 }
}
