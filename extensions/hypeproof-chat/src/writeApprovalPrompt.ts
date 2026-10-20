/** Request-bound presentation only. Path/permission checks remain in the existing host gate. */
export interface WriteApprovalPrompt { id: string; title: string; verb: string; files: string[] }
export class WriteApprovalRequest {
  generation=0;
  private observedScope?:string;
  private pending?: {id:string;scope:string;finish:(approved:boolean)=>void};
  private readonly ports:{scope():string;present(prompt:WriteApprovalPrompt|null):Promise<boolean|void>};
  private readonly timeoutMs:number;
  constructor(ports:{scope():string;present(prompt:WriteApprovalPrompt|null):Promise<boolean|void>}, timeoutMs=180_000) {this.ports=ports;this.timeoutMs=timeoutMs;}
  confirm(prompt:WriteApprovalPrompt):Promise<boolean> {
    this.invalidate();
    if(this.pending || !prompt.id || !prompt.files.length) return Promise.resolve(false);
    const frozen=structuredClone(prompt), scope=this.ports.scope();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.cancel(),this.timeoutMs);
      this.pending={id:frozen.id,scope,finish:approved=>{clearTimeout(timer);this.pending=undefined;void this.ports.present(null).catch(()=>{});resolve(approved);}};
      void this.ports.present(frozen).then(shown=>{if(shown!==true && this.pending?.id===frozen.id)this.cancel();}).catch(()=>{if(this.pending?.id===frozen.id)this.cancel();});
    });
  }
  respond(id:unknown,approved:unknown):void {
    if(!this.pending || id!==this.pending.id)return;
    this.pending.finish(approved===true && this.pending.scope===this.ports.scope());
  }
  invalidate():void {
    const scope=this.ports.scope();
    if(this.observedScope!==undefined && this.observedScope!==scope)this.cancel();
    this.observedScope=scope;
  }
  cancel():void {this.generation++;this.pending?.finish(false);}
}
