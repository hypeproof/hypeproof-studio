/** Explicit DEV App-owned receiving. Scheduling grants no transport, file or model authority. */
import type {CompanionHostTurn} from './companionHostSession.ts';
export type CompanionReceivingState = 'stopped' | 'listening' | 'processing' | 'awaiting-approval' | 'needs-check' | 'closed';
export type CompanionReceivingReason = 'explicit_stop' | 'expired' | 'empty_limit' | 'uncertain' | 'owner_closed' | 'unavailable';
export interface CompanionReceivingView {
  state: CompanionReceivingState;
  deadline?: number;
  emptyTurns: number;
  reason?: CompanionReceivingReason;
}
export interface CompanionReceivingPorts {
  /** Remaining wall-clock authority lifetime captured once, never a renewable deadline. */
  remainingMs(): number;
  gate(): 'ready' | 'busy' | 'closed' | 'needs-check';
  receive(signal: AbortSignal): Promise<CompanionHostTurn & {needsCheck?: boolean}>;
  changed?(view: Readonly<CompanionReceivingView>): void;
  clock?: {now(): number; setTimer(callback: () => void, ms: number): unknown; clearTimer(timer: unknown): void};
}
export const COMPANION_RECEIVING_MAX_MS = 600_000;
export const COMPANION_RECEIVING_EMPTY_LIMIT = 60;
export const COMPANION_RECEIVING_IDLE_MS = 10_000;

export class CompanionReceivingLifetime {
  private readonly ports: CompanionReceivingPorts;
  private readonly clock: NonNullable<CompanionReceivingPorts['clock']>;
  private state: CompanionReceivingView = {state:'stopped',emptyTurns:0};
  private lifetime?: AbortController;
  private deadlineTimer?: unknown;
  private idleTimer?: unknown;
  private wake?: () => void;
  private lastNow = -Infinity;
  private draining = false;
  constructor(ports: CompanionReceivingPorts) {
    this.ports=ports;
    this.clock=ports.clock??{now:()=>performance.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:t=>clearTimeout(t as ReturnType<typeof setTimeout>)};
  }
  view(): Readonly<CompanionReceivingView> { return Object.freeze({...this.state}); }
  private publish(patch: Partial<CompanionReceivingView>): void {
    this.state={...this.state,...patch};
    try { this.ports.changed?.(this.view()); } catch { /* Native status cannot authorize or restart work. */ }
  }
  private now(): number {
    const n=this.clock.now();
    if(!Number.isFinite(n)||n<this.lastNow)throw Error('companion_receiving_clock');
    this.lastNow=n;return n;
  }
  /** Only an explicit native gesture calls start; repeated Start never renews this lifetime. */
  start(): boolean {
    if(this.lifetime||this.draining||this.state.state==='closed'||this.state.state==='needs-check')return false;
    const remaining=this.ports.remainingMs(),gate=this.ports.gate();
    if(!Number.isFinite(remaining)||remaining<=0||gate==='closed'||gate==='needs-check')return false;
    const deadline=this.now()+Math.min(remaining,COMPANION_RECEIVING_MAX_MS),controller=new AbortController();
    this.lifetime=controller;
    this.publish({state:'listening',deadline,emptyTurns:0,reason:undefined});
    this.deadlineTimer=this.clock.setTimer(()=>this.stop('expired'),Math.max(0,deadline-this.now()));
    this.draining=true;
    void this.loop(controller).catch(()=>{if(this.lifetime===controller)this.stop('unavailable');}).finally(()=>{this.draining=false;});
    return true;
  }
  /** A truthful phase from the existing native approval, never inferred from elapsed time. */
  approval(waiting: boolean): void {
    if(this.lifetime&&['processing','awaiting-approval'].includes(this.state.state))this.publish({state:waiting?'awaiting-approval':'processing'});
  }
  stop(reason: CompanionReceivingReason = 'explicit_stop'): void {
    if(this.state.state==='closed'||(this.state.state==='needs-check'&&reason!=='owner_closed'))return;
    const prior=this.lifetime;this.lifetime=undefined;
    if(this.deadlineTimer!==undefined)this.clock.clearTimer(this.deadlineTimer);
    if(this.idleTimer!==undefined)this.clock.clearTimer(this.idleTimer);
    this.deadlineTimer=this.idleTimer=undefined;
    this.wake?.();this.wake=undefined;
    this.publish({state:reason==='owner_closed'?'closed':['uncertain','unavailable'].includes(reason)?'needs-check':'stopped',reason});
    prior?.abort();
  }
  close(): void { this.stop('owner_closed'); }
  private live(controller: AbortController): boolean {
    if(this.lifetime!==controller||controller.signal.aborted)return false;
    if(this.now()>=this.state.deadline!){this.stop('expired');return false;}
    return true;
  }
  private async idle(controller: AbortController): Promise<void> {
    if(!this.live(controller))return;
    await new Promise<void>(resolve=>{
      this.wake=resolve;
      this.idleTimer=this.clock.setTimer(()=>{this.idleTimer=undefined;this.wake=undefined;resolve();},Math.min(COMPANION_RECEIVING_IDLE_MS,this.state.deadline!-this.now()));
    });
  }
  private async loop(controller: AbortController): Promise<void> {
    while(this.live(controller)) {
      const gate=this.ports.gate();
      if(gate==='closed'){this.close();return;}
      if(gate==='needs-check'){this.stop('uncertain');return;}
      if(gate==='busy'){await this.idle(controller);continue;}
      this.publish({state:'processing'});
      const result=await this.ports.receive(controller.signal);
      if(!this.live(controller))return;
      if(result.state==='closed'){this.close();return;}
      if(result.needsCheck||result.state==='waiting'||result.pending>0){this.stop('uncertain');return;}
      this.publish({state:'listening'});
      if(result.state==='idle'){
        this.publish({emptyTurns:this.state.emptyTurns+1});
        if(this.state.emptyTurns>=COMPANION_RECEIVING_EMPTY_LIMIT){this.stop('empty_limit');return;}
        await this.idle(controller);
      }
    }
  }
}
