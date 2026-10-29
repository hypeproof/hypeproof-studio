import {draftCanonical,draftHash,parseCompanionDraftRecord,validateCompanionDraftValue,sameDraftSelection,type CompanionDraftRecord,type CompanionDraftValue} from '../../../extensions/hypeproof-chat/webview-ui/src/companionDraftRecord';
import type {CompanionHostRequest} from '../../../extensions/hypeproof-chat/src/companionHostDispatch';
export interface DraftPort {call(request:Record<string,unknown>):Promise<unknown>}
export interface DraftView {status:'loading'|'empty'|'editing'|'detached'|'unknown'|'foreign'|'corrupt'|'error';text:string;saved:boolean;busy:boolean;error:boolean;record?:CompanionDraftRecord}
/** Data persistence only. Loading/recovering never invokes the relay or allocates a request ID. */
export class AndroidDraftRecovery {
 private view:DraftView={status:'loading',text:'',saved:false,busy:false,error:false};
 private generation='';private version:string|null=null;private closed=false;private selected?:CompanionHostRequest;
 private pending?:CompanionDraftValue;private flight?:Promise<void>;private locked=false;
 constructor(private port:DraftPort,private accountId:string,private changed:(v:DraftView)=>void){}
 snapshot(){return structuredClone(this.view);}
 private publish(patch:Partial<DraftView>){if(this.closed)return;this.view={...this.view,...patch};this.changed(this.snapshot());}
 private check(){if(this.closed)throw Error('draft_owner_closed');}
 private async response(raw:unknown):Promise<{state:string;record?:CompanionDraftRecord}> {
  this.check();const v=raw as any;
  if(!v||!['empty','record','foreign','corrupt'].includes(v.state)||typeof v.generation!=='string'||!v.generation
   ||(v.version!==null&&(typeof v.version!=='string'||!/^[a-f0-9]{64}$/.test(v.version))))throw Error('draft_reply_invalid');
  const record=v.state==='record'?await parseCompanionDraftRecord(v.record,this.accountId):undefined;this.check();
  if(v.state==='record'&&!record||v.state==='empty'&&v.version!==null)throw Error('draft_reply_invalid');
  this.generation=v.generation;this.version=v.version;return{state:v.state,record};
 }
 async load(){this.check();this.locked=true;try{const r=await this.response(await this.port.call({kind:'draft.read'}));this.selected=undefined;
  this.publish({status:r.record?(r.record.phase==='editing'?'detached':'unknown'):r.state as DraftView['status'],record:r.record,text:r.record?.text??'',saved:!!r.record,busy:false,error:false});
 }catch{this.publish({status:'error',error:true});}finally{this.locked=false;}}
 edit(text:string,selection:CompanionHostRequest){
  this.check();if(this.locked||!['empty','editing'].includes(this.view.status))throw Error('draft_not_editable');
  if(this.selected&&!sameDraftSelection(this.selected,selection))throw Error('draft_scope_changed');
  this.selected=structuredClone(selection);this.pending={phase:'editing',selection:structuredClone(selection),text};
  this.publish({status:'editing',text,saved:false,error:false});this.pump();
 }
 private pump(){if(this.flight||!this.pending||this.closed)return;
  this.flight=(async()=>{while(this.pending&&!this.closed){const value=this.pending;this.pending=undefined;this.publish({busy:true});
   try{await this.replace(value);this.publish({record:this.view.record,saved:!this.pending&&this.view.text===value.text,error:false});}
   catch{this.pending=undefined;this.publish({error:true,saved:false});break;}
  }})().finally(()=>{this.flight=undefined;this.publish({busy:false});});
 }
 private async replace(value:CompanionDraftValue){
  await validateCompanionDraftValue(value);this.check();const generation=this.generation,previousRevision=this.view.record?.revision??0;
  const r=await this.response(await this.port.call({kind:'draft.replace',generation,expectedVersion:this.version,value}));
  if(generation!==this.generation||!r.record||r.record.revision!==previousRevision+1)throw Error('draft_write_unconfirmed');
  const {schema,accountId,service,revision,createdAt,updatedAt,...saved}=r.record;
  if(draftCanonical(saved)!==draftCanonical(value))throw Error('draft_write_unconfirmed');
  this.publish({record:r.record});
 }
 async flush(){while(this.flight)await this.flight;this.check();if(this.view.error||this.pending||!this.view.saved)throw Error('draft_not_saved');}
 async recover(selection:CompanionHostRequest,reassociate=false){
  this.check();if(this.locked||this.view.status!=='detached'||!this.view.record||this.view.record.phase!=='editing')throw Error('draft_not_recoverable');
  if(!reassociate&&!sameDraftSelection(this.view.record.selection,selection))throw Error('draft_scope_changed');
  this.publish({status:'editing',saved:false});this.selected=undefined;this.edit(this.view.text,selection);await this.flush();
 }
 detach(){if(this.view.status==='editing'){this.selected=undefined;this.publish({status:'detached'});}}
 async attempt(packet:string){
  this.check();if(this.locked||this.view.status!=='editing')throw Error('draft_attempt_blocked');this.locked=true;
  try{await this.flush();const intent=JSON.parse(packet);const value:CompanionDraftValue={phase:'attempted_unknown',selection:intent.selection,text:intent.text,packet,requestId:intent.requestId,requestHash:await draftHash(packet)};
   await validateCompanionDraftValue(value);this.check();
   if(this.view.text!==value.text||!this.selected||draftCanonical(this.selected)!==draftCanonical(value.selection))throw Error('draft_scope_changed');
   // From here a missing ACK is unknown even if the native write did not happen. Never retry this transition automatically.
   this.publish({status:'unknown',busy:true,saved:false});await this.replace(value);this.publish({saved:true,busy:false});
  }catch(error){this.publish({error:true,busy:false});throw error;}finally{this.locked=false;}
 }
 async erase(){
  this.check();if(this.locked||['foreign','loading','error'].includes(this.view.status))throw Error('draft_erase_blocked');this.locked=true;this.pending=undefined;
  try{if(this.flight)await this.flight;this.check();this.publish({busy:true});
   const r=await this.response(await this.port.call({kind:'draft.erase',generation:this.generation,expectedVersion:this.version}));
   if(r.state!=='empty')throw Error('draft_erase_unconfirmed');this.selected=undefined;this.publish({status:'empty',text:'',record:undefined,saved:false,busy:false,error:false});
  }catch(error){this.publish({error:true,busy:false});throw error;}finally{this.locked=false;}
 }
 close(){this.closed=true;this.pending=undefined;}
}
