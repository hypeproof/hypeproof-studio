/** Optional, content-free product observations. Never an approval or execution authority. */
import type { ApprovalIdentity } from './memberApproval';
import { validQuestionKey } from './accountCards';
export type ProductRoute = 'consent' | 'events' | 'trigger';
export type QuestionFocus = 'goal' | 'method' | 'decision';
export interface TeamProductView { available: boolean; granted: boolean; busy: boolean; binding?: string; pendingFocus?: QuestionFocus; notice?: string; message?: string }
interface FocusIntent { id: string; choice: QuestionFocus }
interface ProductEvent { id: string; journey_id: string; journey: 'question'; type: 'question.presented' | 'question.answered' | 'question.skipped'; platform: 'desktop'; app_version: string }
const same = (a?: ApprovalIdentity,b?: ApprovalIdentity) => !!a && !!b && a.accountID === b.accountID && a.sessionID === b.sessionID;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$(?![\s\S])/.test(v);
export class TeamProductLoop {
  private epoch = 0;
  private identity?: ApprovalIdentity;
  private queue: Promise<void> = Promise.resolve();
  private state: TeamProductView = {available:false,granted:false,busy:false};
  constructor(private readonly options: {
    identity(): Promise<ApprovalIdentity | undefined>;
    request(identity: ApprovalIdentity,route: ProductRoute,body?: unknown): Promise<any>;
    load(account: string): Promise<unknown>; save(account: string,events: ProductEvent[]): Promise<void>;
    paused(account: string): Promise<boolean>; pause(account: string,paused: boolean): Promise<void>;
    pendingFocus(account: string): Promise<unknown>; saveFocus(account: string,intent: FocusIntent | undefined): Promise<void>;
    changed(): void; questionsChanged(): Promise<void>; uuid(): string; version: string;
  }) {}
  view() { return {...this.state}; }
  invalidate() { this.epoch++; this.identity=undefined;this.state={available:false,granted:false,busy:false};this.options.changed(); }
  private async current(epoch: number, identity: ApprovalIdentity) { return epoch === this.epoch && same(identity,await this.options.identity()) && epoch === this.epoch; }
  async refresh() {
    const epoch=++this.epoch;
    try {
      const identity=await this.options.identity(); if(epoch!==this.epoch)return;
      if(!identity){this.invalidate();return;}
      const result=await this.options.request(identity,'consent');
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      if(result?.schema!=='hps-product-consent/1'||result.notice_version!=='team-ux/1'||typeof result.notice!=='string'||result.notice.length>4000)throw Error('Invalid consent');
      const paused=await this.options.paused(identity.accountID);
      const pending=await this.options.pendingFocus(identity.accountID);
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      this.identity=identity;
      this.state={available:true,granted:!paused&&result.preference?.notice_version==='team-ux/1'&&result.preference?.granted===1,busy:false,binding:this.options.uuid(),notice:result.notice,...(this.focusIntent(pending)?{pendingFocus:pending.choice}:{})};
      if(!this.state.granted)await this.options.save(identity.accountID,[]);
    }catch{if(epoch===this.epoch)this.state={available:false,granted:false,busy:false};}
    if(epoch===this.epoch)this.options.changed();
  }
  async consent(binding: string,granted: boolean) {
    const identity=this.identity,epoch=this.epoch;
    if(!identity||binding!==this.state.binding||!this.state.available||this.state.busy||typeof granted!=='boolean')return;
    this.state={...this.state,granted:false,busy:true,message:undefined};this.options.changed();
    try {
      // Opt-out locally first. A failed network write must never restart collection.
      await this.options.pause(identity.accountID,true);
      if(!granted){await this.queue;await this.options.save(identity.accountID,[]);}
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      const result=await this.options.request(identity,'consent',{notice_version:'team-ux/1',granted});
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      if(result?.ok!==true)throw Error('Invalid consent receipt');
      await this.options.pause(identity.accountID,!granted);
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      this.state={...this.state,granted,message:granted?'사용 경험 개선에 참여하고 있어요.':'이 기기의 수집을 중지했어요.'};
    }catch{if(epoch===this.epoch)this.state={...this.state,granted:false,message:'설정을 서버에 저장하지 못했어요. 이 기기에서는 수집하지 않아요.'};}
    if(epoch===this.epoch){this.state={...this.state,busy:false};this.options.changed();}
  }
  async focus(binding: string,choice: QuestionFocus) {
    const identity=this.identity,epoch=this.epoch;
    if(!identity||binding!==this.state.binding||!this.state.available||this.state.busy||!['goal','method','decision'].includes(choice))return;
    this.state={...this.state,busy:true,message:undefined};this.options.changed();
    try {
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      const pending=await this.options.pendingFocus(identity.accountID);
      if(pending!==undefined&&!this.focusIntent(pending))throw Error('Unreadable pending focus');
      if(this.focusIntent(pending)&&pending.choice!==choice)throw Error('Pending focus must be reconciled first');
      const id=this.focusIntent(pending)?pending.id:this.options.uuid();
      await this.options.saveFocus(identity.accountID,{id,choice});
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      this.state={...this.state,pendingFocus:choice};
      const result=await this.options.request(identity,'trigger',{schema:'hps-question-trigger/1',id,kind:'choice',source_id:id,source_revision:1,choice});
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      if(result?.schema!=='hps-question-trigger/1'||result.model_calls!==0||result.policy!=='team-question/1'
        ||!validQuestionKey(result.key)||!result.key.startsWith('growth:')||typeof result.created!=='boolean'
        ||result.source?.kind!=='choice'||result.source?.id!==id||result.source?.revision!==1
        ||result.reentry?.method!=='GET'||result.reentry?.path!=='/v1/me/cards')throw Error('Invalid trigger receipt');
      await this.options.saveFocus(identity.accountID,undefined);
      if(!await this.current(epoch,identity)){if(epoch===this.epoch)this.invalidate();return;}
      this.state={...this.state,pendingFocus:undefined};
      await this.options.questionsChanged();
    }catch{if(epoch===this.epoch)this.state={...this.state,message:'질문 준비 결과를 확인하지 못했어요. 질문을 다시 조회해 주세요.'};}
    if(epoch===this.epoch){this.state={...this.state,busy:false};this.options.changed();}
  }
  private focusIntent(value: unknown): value is FocusIntent { const v=value as FocusIntent|undefined; return !!v&&typeof v==='object'&&Object.keys(v).sort().join(',')==='choice,id'&&uuid(v.id)&&['goal','method','decision'].includes(v.choice); }
  observe(type: ProductEvent['type'],journeyID: string): Promise<void> {
    const identity=this.identity,epoch=this.epoch;
    if(!identity||!this.state.granted||!uuid(journeyID)||!['question.presented','question.answered','question.skipped'].includes(type))return Promise.resolve();
    const event:ProductEvent={id:this.options.uuid(),journey_id:journeyID,journey:'question',type,platform:'desktop',app_version:this.options.version};
    this.queue=this.queue.then(async()=>{
      if(!this.state.granted||!await this.current(epoch,identity)||!this.state.granted)return;
      const stored=await this.options.load(identity.accountID);
      // Only the exact locally generated metadata shape is eligible to leave this host.
      const valid=(v:any):v is ProductEvent=>!!v&&typeof v==='object'&&Object.keys(v).sort().join(',')==='app_version,id,journey,journey_id,platform,type'&&uuid(v.id)&&uuid(v.journey_id)&&v.journey==='question'&&v.platform==='desktop'&&['question.presented','question.answered','question.skipped'].includes(v.type)&&typeof v.app_version==='string'&&/^[0-9]{1,4}\.[0-9]{1,6}\.[0-9]{1,6}(?:[-+][a-z0-9.]{1,32})?$(?![\s\S])/.test(v.app_version);
      if(!valid(event))return;
      const events:ProductEvent[]=(Array.isArray(stored)?stored.filter(valid):[]).slice(-49);
      events.push(event);
      if(!this.state.granted||!await this.current(epoch,identity)||!this.state.granted)return;
      await this.options.save(identity.accountID,events);
      if(!this.state.granted||!await this.current(epoch,identity)||!this.state.granted)return;
      const batch=events.slice(0,20),result=await this.options.request(identity,'events',{schema:'hps-product-events/1',events:batch});
      if(!this.state.granted||!await this.current(epoch,identity)||!this.state.granted)return;
      if(result?.schema!=='hps-product-events/1'||!Array.isArray(result.accepted)||!result.accepted.every((id:unknown)=>batch.some(e=>e.id===id)))return;
      await this.options.save(identity.accountID,events.filter(e=>!result.accepted.includes(e.id)));
    }).catch(()=>{}); // Product use is never held up by analytics.
    return this.queue;
  }
}
