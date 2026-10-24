/** A stop request is not evidence of a stopped SDK task. */
export type DelegationStopState = 'pending' | 'confirmed' | 'unconfirmed';
export class DelegationStop {
  requested = false;
  private ended = false;
  private timer?: ReturnType<typeof setTimeout>;
  private tools = new Set<string>();
  private tasks = new Map<string, {tool?: string; run?: string; terminal: boolean; sent: boolean}>();
  private publish: (state: DelegationStopState) => void;
  private stopTask: (id: string) => Promise<void>;
  private timeoutMs: number;
  constructor(stopTask: (id: string) => Promise<void>, publish: (state: DelegationStopState) => void, timeoutMs = 5000) {
    this.stopTask=stopTask;this.publish=publish;this.timeoutMs=timeoutMs;
  }
  tool(id: string, name: string): void {
    if(this.ended || (name!=='Task'&&name!=='Agent') || this.tools.has(id))return;
    this.tools.add(id);
    if(this.requested){this.publish('pending');if(!this.timer)this.arm();}
  }
  /** A denied permission cannot have launched this call. */
  refused(id:string):void { this.tools.delete(id);this.check(); }
  result(id: string): void { if(!this.requested)this.tools.delete(id); }
  observe(event: unknown): void {
    if(this.ended||!event||typeof event!=='object')return;
    const e=event as Record<string,unknown>;
    if(e.type!=='system'||typeof e.task_id!=='string'||!e.task_id)return;
    const id=e.task_id,run=typeof e.run_id==='string'?e.run_id:undefined,old=this.tasks.get(id);
    if(old?.run && (!run || run<old.run))return;
    if(e.subtype==='task_started'){
      if(e.task_type!=='local_agent' && !(typeof e.tool_use_id==='string'&&this.tools.has(e.tool_use_id)))return;
      if(old && old.run===run)return;
      this.tasks.set(id,{tool:typeof e.tool_use_id==='string'?e.tool_use_id:undefined,run,terminal:false,sent:false});
      if(this.requested){this.publish('pending');if(!this.timer)this.arm();this.send(id);this.check();}
    }else if(e.subtype==='task_notification'&&old&&['completed','failed','stopped'].includes(String(e.status))){
      if(old.run!==run)return;
      old.terminal=true;if(old.tool)this.tools.delete(old.tool);this.check();
    }
  }
  request(): void {
    if(this.requested||this.ended)return;
    this.requested=true;this.publish('pending');
    this.arm();
    for(const id of this.tasks.keys())this.send(id);
    this.check();
  }
  private arm():void{ this.timer=setTimeout(()=>{this.timer=undefined;if(!this.ended)this.publish('unconfirmed');},this.timeoutMs); }
  private send(id:string):void{
    const task=this.tasks.get(id)!;if(task.terminal||task.sent)return;task.sent=true;
    void this.stopTask(id).catch(()=>{if(!this.ended&&!task.terminal)this.publish('unconfirmed');});
  }
  private check():void{
    if(!this.requested||this.ended)return;
    if(this.tasks.size>0 && this.tools.size===0 && [...this.tasks.values()].every(t=>t.terminal)){
      clearTimeout(this.timer);this.timer=undefined;this.publish('confirmed');
    }
  }
  end():void{
    if(this.ended)return;
    clearTimeout(this.timer);
    if(this.requested&&(this.tools.size>0||this.tasks.size===0||[...this.tasks.values()].some(t=>!t.terminal)))this.publish('unconfirmed');
    this.ended=true;
  }
}
