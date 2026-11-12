import { createHash, randomUUID } from 'node:crypto';

export interface SharedText { id: string; role: 'user'|'assistant'; content: string; created_at: number }
export interface MobileScope { activity: string; workspace: string; task: string; title: string; ready: boolean; messages: SharedText[] }
export interface MobileBinding {
  version: 1; id: string; session: string; activity: string; workspace: string; task: string; title: string;
  created: boolean; uploaded: Record<string,string>; accepted?: string; disabled?: boolean;
}
export interface MobileConversationPorts {
  read(): MobileBinding|undefined;
  save(value: MobileBinding|undefined): PromiseLike<void>;
  scope(): MobileScope|undefined;
  session(): Promise<string|undefined>;
  request(session: string,path: string,body?: unknown,method?: 'GET'|'POST'|'DELETE'): Promise<any>;
  exclusive<T>(work:()=>Promise<T>): Promise<T>;
  execute(scope: MobileScope,request: {id:string;text:string}): Promise<boolean>;
  stop(): void;
  changed(message: string): void;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(b:MobileBinding,s:MobileScope|undefined)=>!!s&&b.activity===s.activity&&b.workspace===s.workspace&&b.task===s.task;
const opaque=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
/** Text projection only. Tool/artifact/attachment payloads and metadata never enter the relay. */
export function sharedTexts(messages: readonly any[]): SharedText[] {
  return messages.filter(m=>m&&opaque(m.id)&&['user','assistant'].includes(m.role)&&!m.tool&&typeof m.content==='string'&&m.content.trim()&&m.content.length<=32000&&!m.content.includes('\0')&&Number.isSafeInteger(m.createdAt))
    .map(m=>({id:m.id,role:m.role,content:m.content,created_at:m.createdAt}));
}
export function validMobileBinding(v:unknown): v is MobileBinding {
  if(!v||typeof v!=='object')return false;const b=v as MobileBinding;
  return b.version===1&&opaque(b.id)&&opaque(b.session)&&[b.activity,b.workspace,b.task,b.title].every(s=>typeof s==='string'&&s.length>0)
    &&typeof b.created==='boolean'&&!!b.uploaded&&typeof b.uploaded==='object'&&!Array.isArray(b.uploaded)
    &&Object.entries(b.uploaded).every(([id,digest])=>opaque(id)&&typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest))
    &&(b.accepted===undefined||opaque(b.accepted));
}
/** Coordinates the existing desktop store; persisted state contains identities/digests, no transcript copy. */
export class MobileConversation {
  private epoch=0;private polling=false;private executing=false;private disposed=false;
  private readonly ports: MobileConversationPorts;
  constructor(ports: MobileConversationPorts){ this.ports = ports; }
  private async check(b:MobileBinding,epoch:number):Promise<boolean>{
    return !this.disposed&&this.epoch===epoch&&!b.disabled&&same(b,this.ports.scope())&&(await this.ports.session())===b.session&&this.epoch===epoch;
  }
  async connect():Promise<void>{
    await this.ports.exclusive(async()=>{
      const scope=this.ports.scope(),session=await this.ports.session();
      if(!scope?.ready||!session)throw Error('개인 계정으로 로그인하고 실행 중이지 않은 개인 대화를 선택해 주세요.');
      const old=this.ports.read();if(old)throw Error('기존 iPhone 연결을 먼저 해제해 주세요.');
      const b:MobileBinding={version:1,id:randomUUID(),session,activity:scope.activity,workspace:scope.workspace,task:scope.task,title:scope.title.slice(0,160),created:false,uploaded:{}};
      await this.ports.save(b);
    });
    await this.tick();
  }
  invalidate():void{this.epoch++;if(this.executing)this.ports.stop();}
  dispose():void{this.disposed=true;this.invalidate();}
  async forgetLocal():Promise<void>{
    // Forget is not a stop command: keep the accepted request binding until a live turn settles.
    if(this.executing)throw Error('응답이 진행 중이에요. 먼저 연결 중지로 멈춘 뒤 다시 시도해 주세요.');
    await this.ports.exclusive(async()=>{
      if(this.executing)throw Error('응답이 진행 중이라 연결 정보를 지우지 않았어요.');
      this.invalidate();await this.ports.save(undefined);
      this.ports.changed('이 컴퓨터의 연결 정보만 지웠어요. 서버 사본과 컴퓨터 원본은 남아 있어요.');
    });
  }
  async disconnect(remove:boolean):Promise<void>{
    this.invalidate();
    await this.ports.exclusive(async()=>{
      const b=this.ports.read();if(!b)return;
      await this.ports.save({...b,disabled:true});
      if(remove){
        if(await this.ports.session()!==b.session)throw Error('원래 계정으로 로그인해야 서버 사본을 삭제할 수 있어요. 연결은 멈췄고 로컬 원본은 남아 있어요.');
        await this.ports.request(b.session,`/${b.id}`,undefined,'DELETE');
        await this.ports.save(undefined);
      }
      this.ports.changed(remove?'서버 대화 사본을 삭제했어요. 컴퓨터 원본은 그대로예요.':'연결을 멈췄어요. 서버 사본은 남아 있으며 이 메뉴에서 삭제할 수 있어요.');
    });
  }
  async tick():Promise<void>{
    if(this.polling||this.disposed)return;this.polling=true;
    try{await this.ports.exclusive(async()=>{
      const held=this.ports.read();if(!held)return;
      if(!validMobileBinding(held))throw Error('연결 정보를 읽지 못했어요. 원본을 보존하고 연결을 멈췄어요.');
      const b=structuredClone(held),epoch=this.epoch;
      if(b.disabled)return;
      if(await this.ports.session()!==b.session){this.invalidate();await this.ports.save({...b,disabled:true});this.ports.changed('로그인이 바뀌어 연결을 멈췄어요. 원래 계정에서 서버 사본을 관리해 주세요.');return;}
      if(!await this.check(b,epoch))return;
      if(!b.created){
        await this.ports.request(b.session,'',{id:b.id,title:b.title},'POST');
        if(!await this.check(b,epoch))return;b.created=true;await this.ports.save(b);
      }
      const upload=async()=>{
        const scope=this.ports.scope();if(!same(b,scope))throw Error('대화가 바뀌어 연결 작업을 멈췄어요.');
        for(const message of scope!.messages){
          if(!await this.check(b,epoch))throw Error('연결 상태가 바뀌었어요.');
          const digest=hash(message);if(b.uploaded[message.id]===digest)continue;
          await this.ports.request(b.session,`/${b.id}/events`,{client_event_id:hash([b.id,message]),message},'POST');
          if(!await this.check(b,epoch))throw Error('연결 상태가 바뀌었어요.');
          b.uploaded[message.id]=digest;await this.ports.save(b);
        }
      };
      await upload();
      if(!await this.check(b,epoch))return;
      const response=await this.ports.request(b.session,`/${b.id}/requests`);
      if(!Array.isArray(response.requests))throw Error('연결 응답을 확인하지 못했어요.');
      for(const request of response.requests){
        if(!await this.check(b,epoch))return;
        if(!opaque(request.id)||typeof request.text!=='string'||!request.text.trim()||request.text.length>4000||request.text.includes('\0'))continue;
        if(request.status==='running'||b.accepted===request.id){
          // This inter-window lock spans execution. A running request seen here is an interrupted turn.
          if(request.status==='running')await this.ports.request(b.session,`/${b.id}/requests/${request.id}/finish`,{status:'unknown'},'POST');
          if(b.accepted===request.id){delete b.accepted;await this.ports.save(b);}continue;
        }
        if(request.status!=='pending'||!this.ports.scope()?.ready)continue;
        let claim;
        try{claim=await this.ports.request(b.session,`/${b.id}/requests/${request.id}/claim`,{},'POST');}
        catch(error){
          if((error as {code?:string})?.code!=='conversation_request_origin_revoked')throw error;
          if(!await this.check(b,epoch))return;
          // Only this exact terminal origin failure can release the pending slot; other failures preserve it.
          await this.ports.request(b.session,`/${b.id}/requests/${request.id}/cancel`,{},'POST');
          continue;
        }
        if(claim.claimed!==true)continue;
        if(!await this.check(b,epoch))return;
        b.accepted=request.id;await this.ports.save(b);
        if(!await this.check(b,epoch))return;
        this.executing=true;
        const fence=setInterval(()=>{if(this.epoch!==epoch||!same(b,this.ports.scope()))this.invalidate();},200);
        let success=false;
        try{success=await this.ports.execute(this.ports.scope()!,{id:request.id,text:request.text});}
        finally{clearInterval(fence);this.executing=false;}
        if(!await this.check(b,epoch))return;
        await upload();
        await this.ports.request(b.session,`/${b.id}/requests/${request.id}/finish`,{status:success?'completed':'failed'},'POST');
        if(!await this.check(b,epoch))return;delete b.accepted;await this.ports.save(b);
      }
      this.ports.changed('iPhone 대화 연결 중 · 선택한 개인 대화의 글만 공유해요.');
    });}catch(error){this.ports.changed(error instanceof Error?error.message:'연결을 확인하지 못했어요. 로컬 원본은 남아 있어요.');}
    finally{this.polling=false;}
  }
}
