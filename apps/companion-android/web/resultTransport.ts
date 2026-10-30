/** Same-live-cipher metadata demux. It never selects or sends a new user request. */
import type {CompanionSelectionReceiver,CompanionSelectionMessage,CompanionSelectionAccepted} from '../../../extensions/hypeproof-chat/src/companionSelection';
import type {CompanionSessionPorts} from '../../../extensions/hypeproof-chat/webview-ui/src/companionSessionController';
import type {CompanionHostRequest} from '../../../extensions/hypeproof-chat/src/companionHostDispatch';
import {CompanionPreviewResultReceiver} from '../../../extensions/hypeproof-chat/src/companionPreviewResult.ts';
type Transport=CompanionSessionPorts['transport'];
type Message={message_id:string;text:string};
interface Relay {receive():Promise<readonly CompanionSelectionMessage[]>}
type Held=Extract<CompanionSelectionAccepted,{request:unknown}>;
interface Options {relay:Relay;selection:Pick<CompanionSelectionReceiver,'accept'|'close'>;initialRevision:number;
 onHeld(value:Readonly<{revision:number;requestId:string}>):void;onInvalid():void;
 /** Accept only an exact pending authored request receipt from this verified relay. */
 validateAuthoringResult?(message:Readonly<Message>):boolean;
 onAuthoringResult?(message:Readonly<Message>):void;
 /** Separate measured execution schema; never routed to preview or import parsers. */
 validateExecutionResult?(message:Readonly<Message>):boolean;
 onExecutionResult?(message:Readonly<Message>):void}
const stop=()=>Error('android_result_owner_closed');
const metadata=(text:string):boolean=>{
 const value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('android_message_invalid');
 return (typeof value.schema==='string'&&value.schema.startsWith('hps-companion-selection/'))
  || ['revision','pairingId','invitationDigest','claimDigest'].some(key=>Object.hasOwn(value,key));
};
export class CompanionAndroidResultTransport {
 private readonly captured=new Map<string,Readonly<CompanionSelectionMessage>>();
 private held:Readonly<Held>|null=null;
 private closed=false;
 private transport:Transport|undefined;
 private active:Promise<readonly Message[]>|null=null;
 private revision:number;
 private notifiedRevision:number;
 private readonly retired=new Map<string,CompanionPreviewResultReceiver>();
 private adopting=false;
 private probing=false;
 private bound:Transport|undefined;
 private probe:{requestId:string;receiver:CompanionPreviewResultReceiver}|null=null;
 private readonly original:Relay['receive'];
 private readonly wrapped:Relay['receive'];
 private readonly options:Options;
 constructor(options:Options) {
  this.options=options;
  if(!Number.isSafeInteger(options.initialRevision)||options.initialRevision<1||options.initialRevision>64)throw Error('android_selection_revision');
  this.revision=options.initialRevision;this.notifiedRevision=options.initialRevision;
  this.original=options.relay.receive.bind(options.relay);
  this.wrapped=async()=>{
   this.check();const messages=await this.original();this.check();
   try{
    if(!Array.isArray(messages)||messages.length>8)throw Error('batch');
    for(const item of messages){
     if(!item||typeof item.message_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(item.message_id)||typeof item.text!=='string'||new TextEncoder().encode(item.text).length>2032)throw Error('message');
     if(!metadata(item.text))continue;
     if(!/^[a-f0-9]{64}$/.test(item.message_hash))throw Error('provenance');
     const prior=this.captured.get(item.message_id);
     if(prior&&(prior.text!==item.text||prior.message_hash!==item.message_hash))throw Error('conflict');
     if(!prior&&this.captured.size>=64)throw Error('bound');
     this.captured.set(item.message_id,Object.freeze({message_id:item.message_id,message_hash:item.message_hash,text:item.text}));
    }
   }catch{this.invalid();}
   return messages;
  };
  options.relay.receive=this.wrapped;
 }
 get progress():Readonly<{heldSelections:number;capturedMetadata:number}>{return Object.freeze({heldSelections:this.held?1:0,capturedMetadata:this.captured.size});}
 /** Only a verified and successfully ACKed newer declaration can be explicitly adopted. */
 get heldSelection():Readonly<Held>|null{return this.held&&!this.captured.has(this.held.messageId)&&this.held.revision>this.revision?this.held:null;}
 async adoptHeld(expected:Readonly<{revision:number;requestId:string}>,previous:Readonly<CompanionHostRequest>,signal:AbortSignal,adopt:(next:Readonly<CompanionHostRequest>)=>Promise<void>):Promise<Readonly<Held>>{
  this.check(signal);const held=this.heldSelection;
  if(this.active||this.adopting||this.probing||!held||held.revision!==expected.revision||held.request.requestId!==expected.requestId||this.retired.size>=63||this.retired.has(held.request.requestId)||held.request.requestId===previous.requestId)throw Error('android_selection_not_ready');
  this.adopting=true;
  try{await adopt(held.request);this.check(signal);
   this.retired.set(previous.requestId,new CompanionPreviewResultReceiver(previous));this.revision=held.revision;this.held=null;this.probe?.receiver.discard();this.probe=null;
   return held;
  }finally{this.adopting=false;}
 }
 /** Explicit metadata check after the current preview settled. Late results remain request/hash checked, never rendered. */
 async checkSelections(expected:Readonly<CompanionHostRequest>,signal:AbortSignal):Promise<void>{
  this.check(signal);if(!this.bound||this.probing)throw Error('android_result_not_bound');
  if(!this.probe||this.probe.requestId!==expected.requestId){this.probe?.receiver.discard();this.probe={requestId:expected.requestId,receiver:new CompanionPreviewResultReceiver(expected)};}
  const probe=this.probe,reading=this.bound.receive(signal);this.probing=true;
  try{const messages=await reading;this.check(signal);for(const message of messages){
   try{const outcome=await probe.receiver.accept(message.text);if(outcome&&!['completed','denied','failed','desktop_handoff'].includes(outcome.state))probe.receiver.reset();}
   catch{this.check(signal);this.invalid();}
   await this.acknowledgeLateResult(this.bound,message.message_id,signal);
  }}finally{this.probing=false;}
 }
 /** Attach only after capture is installed, so the existing adapter retains every authenticated byte. */
 bind(transport:Transport):Transport {
  this.check();if(this.transport)throw Error('android_result_already_bound');this.transport=transport;
  this.bound={
   prepare:async(text,id,signal)=>{this.check(signal);return transport.prepare(text,id,signal);},
   send:async(id,signal)=>{this.check(signal);return transport.send(id,signal);},
   acknowledge:async(id,signal)=>{this.check(signal);return transport.acknowledge(id,signal);},
   receive:signal=>{
    try{this.check(signal);}catch(error){return Promise.reject(error);}
    if(this.active||this.adopting||this.probing)return Promise.reject(Error('android_result_busy'));
    const work=this.receive(signal).finally(()=>{if(this.active===work)this.active=null;});this.active=work;return work;
   },
  };return this.bound;
 }
 private check(signal?:AbortSignal):void{if(this.closed||signal?.aborted)throw stop();}
 private invalid():never{this.close();try{this.options.onInvalid();}catch{/* UI observers cannot reopen this owner. */}throw Error('android_selection_invalid');}
 /** Expired retained bytes cannot become an impossible manual retry ahead of a new selection. */
 private async acknowledgeLateResult(transport:Transport,id:string,signal:AbortSignal):Promise<void>{
  this.check(signal);
  try{await transport.acknowledge(id,signal);}
  catch(error){if(this.closed||signal.aborted)throw stop();if(error instanceof Error&&error.message==='relay_message_expired')this.invalid();throw error;}
  this.check(signal);
 }
 private async receive(signal:AbortSignal):Promise<readonly Message[]> {
  const transport=this.transport!;
  const messages=await transport.receive(signal);this.check(signal);
  if(!Array.isArray(messages)||messages.length>64)this.invalid();
  const results:Message[]=[];
  for(const message of messages){
   this.check(signal);
   let isMetadata=false,isAuthoring=false,isExecution=false;try{const value=JSON.parse(message.text);isAuthoring=typeof value?.schema==='string'&&value.schema.startsWith('hps-companion-authoring-result/');isExecution=typeof value?.schema==='string'&&value.schema.startsWith('hps-companion-execution-result/');isMetadata=metadata(message.text);}catch{this.invalid();}
   if(isAuthoring||isExecution){
    const validate=isExecution?this.options.validateExecutionResult:this.options.validateAuthoringResult;
    const publish=isExecution?this.options.onExecutionResult:this.options.onAuthoringResult;
    let accepted=false;try{accepted=validate?.(Object.freeze({...message}))===true;}catch{/* Invalid receipts are never ACKed. */}
    this.check(signal);if(!accepted)this.invalid();
    try{await transport.acknowledge(message.message_id,signal);}
    catch(error){if(this.closed||signal.aborted)throw stop();if(error instanceof Error&&error.message==='relay_message_expired')this.invalid();throw error;}
    this.check(signal);
    try{publish?.(Object.freeze({...message}));}catch{/* A UI observer cannot undo a verified and acknowledged receipt. */}
    continue;
   }
   if(!isMetadata){
    const value=JSON.parse(message.text),retired=this.retired.get(value.requestId);
    if(retired){
     try{const outcome=await retired.accept(message.text);if(outcome&&!['completed','denied','failed','desktop_handoff'].includes(outcome.state))retired.reset();}
     catch{this.check(signal);this.invalid();}
     await this.acknowledgeLateResult(transport,message.message_id,signal);continue;
    }
    results.push(message);continue;
   }
   const original=this.captured.get(message.message_id);
   if(!original||original.text!==message.text)this.invalid();
   let accepted:CompanionSelectionAccepted|null=null;
   try{accepted=await this.options.selection.accept(original);}
   catch(error){if(this.closed||signal.aborted)throw stop();this.invalid();}
   this.check(signal);if(!accepted)this.invalid();
   if(accepted.kind!=='stale'&&accepted.revision>this.revision&&(!this.held||accepted.revision>this.held.revision)){
    const value=accepted;
    this.held=Object.freeze({...value,request:Object.freeze({...value.request})});
   }
   this.check(signal);
   // ACK only through the existing adapter and its SAME budget. Failed ACK leaves its inbox/provenance for explicit retry.
   try{await transport.acknowledge(message.message_id,signal);}
   catch(error){
    if(this.closed||signal.aborted)throw stop();
    if(error instanceof Error&&error.message==='relay_message_expired')this.invalid();
    throw error;
   }
   this.check(signal);this.captured.delete(message.message_id);
   if(this.heldSelection&&this.heldSelection.revision>this.notifiedRevision){
    this.notifiedRevision=this.heldSelection.revision;
    try{this.options.onHeld(Object.freeze({revision:this.heldSelection.revision,requestId:this.heldSelection.request.requestId}));}catch{/* Metadata never selects or requests a preview. */}
   }
  }
  return Object.freeze(results);
 }
 close():void {
  if(this.closed)return;this.closed=true;this.captured.clear();this.held=null;this.transport=undefined;this.bound=undefined;this.probe?.receiver.discard();this.probe=null;for(const receiver of this.retired.values())receiver.discard();this.retired.clear();
  this.options.selection.close();
  if(this.options.relay.receive===this.wrapped)this.options.relay.receive=this.original;
 }
}
