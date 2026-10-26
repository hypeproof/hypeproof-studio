import { previewRecoveryView, previewActionFits, type PreviewSignals, type PreviewRecoveryAction } from './previewFailure.ts';
/** Binds a shell button to the exact measured tab and activity/task, never the latest tab. */
export class PreviewSurfaceRequests<T extends { readonly url: string }> {
 private pending = new Map<string, {tab:T; url:string; scope:string; epoch:number; action:PreviewRecoveryAction}>();
 private generation = 0;
 private epochs = new Map<string, number>();
 private readonly ports: {
  select(url:string):T|undefined; scope():string; id():string;
  measure(tab:T):Promise<PreviewSignals|null>;
  run(tab:T, action:PreviewRecoveryAction, current:()=>boolean):Promise<boolean>;
 };
 constructor(ports: PreviewSurfaceRequests<T>['ports']) {this.ports=ports;}
 async resolve(url:unknown) {
  if(typeof url!=='string') return null;
  const epoch=++this.generation;
  if(this.epochs.size>=32)this.epochs.clear();
  this.epochs.set(url,epoch);
  for(const [id,p] of this.pending) if(p.url===url)this.pending.delete(id);
  const tab=this.ports.select(url),scope=this.ports.scope();if(!tab)return null;
  const signals=await this.ports.measure(tab);
  if(this.epochs.get(url)!==epoch||this.ports.select(url)!==tab||tab.url!==url||scope!==this.ports.scope())return null;
  const view=previewRecoveryView(signals,true);if(!view)return null;
  const requestId=this.ports.id();
  if(this.pending.size>=32)this.pending.delete(this.pending.keys().next().value!);
  this.pending.set(requestId,{tab,url,scope,epoch,action:view.action});
  return {...view,requestId,url};
 }
 async act(id:unknown,url:unknown,action:unknown):Promise<boolean> {
  if(typeof id!=='string')return false;
  const p=this.pending.get(id);if(!p||p.url!==url||p.action!==action)return false;
  this.pending.delete(id);
  const current=()=>this.epochs.get(p.url)===p.epoch&&this.ports.select(p.url)===p.tab&&p.tab.url===p.url&&p.scope===this.ports.scope();
  if(!current())return false;
  const signals=await this.ports.measure(p.tab);
  if(!current()||!previewActionFits(action,signals))return false;
  return this.ports.run(p.tab,p.action,current);
 }
 clear(){this.pending.clear();this.epochs.clear();}
}
