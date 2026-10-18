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
 let relative='unrecognized-script-url',comparison=null;
 try{const parsed=new URL(url),expected=new URL(target.url);if(parsed.protocol==='file:'&&!parsed.host&&!parsed.search&&!parsed.hash){
  const file=fileURLToPath(parsed,{windows}),candidate=paths.relative(paths.dirname(target.file),file);
  relative=candidate&&!paths.isAbsolute(candidate)&&candidate!=='..'&&!candidate.startsWith('..'+paths.sep)?candidate:'outside-fixture';
  // Booleans/indices distinguish URI spelling from path case without disclosing a path.
  // In particular path.win32.relative is case-insensitive: basename equality is NOT admission.
  const actual=paths.normalize(file),wanted=paths.normalize(target.file),drive=value=>windows?value.replace(/^[a-z]:/,v=>v.toUpperCase()):value;
  const a=actual.split(paths.sep),b=wanted.split(paths.sep);
  const casePositions=a.length===b.length?a.flatMap((value,index)=>value!==b[index]&&value.toLowerCase()===b[index].toLowerCase()?[index]:[]):[];
  comparison={serialized_url_equal:parsed.href===expected.href,decoded_path_equal:actual===wanted,drive_only_equal:drive(actual)===drive(wanted),casefold_path_equal:actual.toLowerCase()===wanted.toLowerCase(),unicode_nfc_path_equal:actual.normalize('NFC')===wanted.normalize('NFC'),case_difference_positions:casePositions.slice(0,16),case_difference_count:casePositions.length,physical_path_equal:null};
  // Only inspect an already-known candidate spelling, never search other files/roots.
  if(relative===paths.basename(target.file)&&windows===(process.platform==='win32')){
   try{comparison.physical_path_equal=fs.realpathSync(file)===target.file;}catch{}
  }
 }}catch{}
 // Only disclose the known fixture filename; other paths remain hashes.
 if(relative!==paths.basename(target.file)&&relative!=='outside-fixture'&&relative!=='unrecognized-script-url')relative='other-file-within-fixture';
 return {relative_fixture:relative,url_sha256:digest(String(url)),matches_expected_pattern:new RegExp(target.urlPattern??breakpointUrlPattern(target.url)).test(url),comparison};
}
// Match only encodings of the trusted path, never arbitrary path segments.
const regexEscape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const percentPattern=value=>encodeURIComponent(value).replace(/%[0-9A-F]{2}/g,part=>part.split('').map(c=>/[A-F]/.test(c)?'['+c.toLowerCase()+c+']':c).join(''));
export function breakpointUrlPattern(url){
 const parsed=new URL(url);assert(parsed.protocol==='file:'&&!parsed.host&&!parsed.search&&!parsed.hash,'Trusted file URL required');
 const pathname=decodeURIComponent(parsed.pathname);
 return '^file://'+[...pathname].map((c,i)=>{
  if(c==='/')return '/';
  if(i===1&&/^\/[A-Za-z]:\//.test(pathname))return '['+c.toLowerCase()+c.toUpperCase()+']';
  if(c===':')return ':';
  const encoded=percentPattern(c),literal=regexEscape(c);
  // encodeURIComponent leaves unreserved ASCII literal; explicitly permit its percent form.
  const bytes=encoded===c?[...Buffer.from(c)].map(byte=>'%'+byte.toString(16).padStart(2,'0').split('').map(x=>/[a-f]/.test(x)?'['+x+x.toUpperCase()+']':x).join('')).join(''):encoded;
  return /[%?#\\\x00-\x20\x7f]/.test(c)?(c===' '? '(?: |%20)':bytes):'(?:'+literal+'|'+bytes+')';
 }).join('')+'$';
}
export function canonicalScriptPath(url,target,{windows=/^[A-Za-z]:[\\/]/.test(target.file)}={}){
 assert(typeof url==='string'&&url.startsWith('file:///')&&!/[?#\\\x00-\x1f\x7f]/.test(url),'Unsafe script URL syntax');
 const raw=url.slice('file://'.length);
 assert(!/%(?:2f|5c)/i.test(raw),'Encoded path separator refused');
 const decoded=decodeURIComponent(raw);
 assert(!/%[0-9a-f]{2}/i.test(decoded),'Ambiguous second decoding refused');
 assert(!decoded.split('/').some(segment=>segment==='.'||segment==='..'),'Path traversal refused');
 const parsed=new URL(url);assert(!parsed.host&&!parsed.search&&!parsed.hash,'Script URL authority/query/fragment refused');
 assert.equal(decodeURIComponent(parsed.pathname),decoded,'URL parsing changed path spelling');
 const file=fileURLToPath(parsed,{windows});
 const drive=value=>windows?value.replace(/^[a-z]:/,letter=>letter.toUpperCase()):value;
 assert.equal(drive(file),drive(target.file),'Canonical script path mismatch');
 return file;
}
// Windows realpath preserves caller drive spelling; no other path byte varies.
export function samePhysicalScriptPath(actual,expected){
 if(typeof actual!=='string'||typeof expected!=='string')return false;
 const windows=/^[A-Za-z]:[\\/]/.test(expected),drive=value=>windows?value.replace(/^[a-z]:/,letter=>letter.toUpperCase()):value;
 return drive(actual)===drive(expected);
}
export function assertPhysicalScript(url,target){
 const file=canonicalScriptPath(url,target);
 assert(samePhysicalScriptPath(fs.realpathSync(file),target.file),'Physical script path mismatch');
 const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'Regular candidate script required');
 return file;
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
// Numeric bounded diagnostics only. A later sample can never authorize admission.
export function ownershipDiagnostic({pids,parents,timing},root){
 const chains=pids.slice(0,8).map(listener=>{
  const chain=[],seen=new Set();let pid=listener,reason='depth_limit';
  for(let i=0;i<20;i++){
   if(!Number.isSafeInteger(pid)||pid<=1){reason='no_owned_root';break;}
   if(seen.has(pid)){reason='cycle';break;}seen.add(pid);
   const parent=parents.get(pid);chain.push({pid,parent:Number.isSafeInteger(parent)?parent:null});
   if(!Number.isSafeInteger(parent)){reason='missing_parent_row';break;}
   if(parent===root){reason='owned_root_reached';break;}pid=parent;
  }
  return {listener_pid:Number.isSafeInteger(listener)?listener:null,listener_is_root:listener===root,chain,reason};
 });
 return {root_pid:root,listener_count:pids.length,chains,timing};
}
export function ownedListener(port,root,platform=process.platform,execute=execFileSync){
 const [command,args]=listenerCommand(port,platform);
 const read=(timeoutMs=10000)=>{
  const timing={listener_started_at:new Date().toISOString()};let output;
  try{output=execute(command,args,{encoding:'utf8',timeout:timeoutMs,stdio:['ignore','pipe','ignore']});}catch(error){if(platform==='darwin'&&error.status===1)return {pids:[],parents:new Map(),timing:{...timing,listener_finished_at:new Date().toISOString()}};throw Error('Cannot establish inspector listener ownership');}
  timing.listener_finished_at=new Date().toISOString();let pids,parents;
  if(platform==='darwin'){
   pids=[...new Set(String(output).split('\n').filter(x=>/^p\d+$/.test(x)).map(x=>Number(x.slice(1))))];
   timing.parents_started_at=new Date().toISOString();
   const rows=execute('ps',['-axo','pid=,ppid='],{encoding:'utf8',timeout:timeoutMs,stdio:['ignore','pipe','ignore']});
   timing.parents_finished_at=new Date().toISOString();parents=new Map(String(rows).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)));
  }else{const data=JSON.parse(output);pids=[...new Set(data.listeners??[])];parents=new Map((data.parents??[]).map(x=>[x.ProcessId,x.ParentProcessId]));}
  return {pids,parents,timing};
 };
 const sample=read(),{pids,parents}=sample;if(!pids.length)return null;
 try{assert.equal(pids.length,1,'Ambiguous inspector listener');assert(descendant(pids[0],root,parents),'Inspector listener is not an owned App descendant');}
 catch(error){
  error.ownership_refusal={initial:ownershipDiagnostic(sample,root),resample_diagnostic_only:true};
  try{error.ownership_refusal.resample=ownershipDiagnostic(read(1500),root);}catch{error.ownership_refusal.resample={status:'UNAVAILABLE'};}
  throw error; // No retry, attach, resume or acceptance based on the resample.
 }
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
 assertPhysicalScript(scripts.get(frame.location.scriptId),target);
 assert.equal(digest(Buffer.from(source)),target.sha256,'Inspector loaded source differs from candidate bundle');
 assert.equal(frame.location.lineNumber,target.lineNumber,'Breakpoint moved to another statement');
 assert(sameDisplayedWorkspace(root,expectedRoot),'Paused destination workspace mismatch');return frame;
}
export class OwnedExtensionGate{
 constructor({port,appPid,target,initialRoot,onProgress=()=>{},observeListener=ownedListener}){
  this.port=port;this.appPid=appPid;this.target=target;this.onProgress=onProgress;this.observeListener=observeListener;this.seen=new Set();this.abort=new AbortController();this.initial=deferred();this.phase={label:'initial-startup',root:initialRoot,holdMs:0,result:this.initial,deadline:Date.now()+45000};this.events=[];this.protocolDiagnostics={event_counts:{},candidate_scripts:[],last_pause:null,breakpoint_locations:[]};
 }
 progress(value){const item={at:new Date().toISOString(),...value};this.events.push(item);assert(this.events.length<=400,'Inspector progress limit');this.onProgress(item);}
 fail(error){if(!this.failure){this.failure=error;this.initial.reject(error);this.phase?.result.reject(error);this.progress({phase:'gate-failed',message:error.message,...(error.ownership_refusal?{ownership_refusal:{...error.ownership_refusal,phase_label:this.phase?.label??null,previous_host_pid:this.previousPid??null,current_peer_pid:this.peer?.listenerPid??null}}:{})});}}
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
  peer.listenerPid=pid;this.peer=peer;await peer.connect();await peer.send('Runtime.enable');await peer.send('Debugger.enable');
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
