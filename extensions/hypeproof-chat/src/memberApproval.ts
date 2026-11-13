/** Private member decisions: host custody, durable intent before POST, GET-only reconciliation. */
export type ApprovalChoice = 'approve' | 'reject' | 'question';
export interface ApprovalIdentity { accountID: string; sessionID: string }
export interface ApprovalCard {
  id: string; request_digest: string;
  source: { repo: string; pr: number; head: string; base: string; policy_digest: string; evidence_digest: string; context_digest: string };
  reviewer: string; brief: { authored: string[]; verified: string[] };
  state: string; created_at: number; expires_at: number; can_decide: boolean; lease_expires_at: number;
  unavailable_reason: string | null; decision: { id: string; choice: ApprovalChoice; status: string; created_at: number } | null;
  review: { html_url: string; state: 'APPROVED'; commit_id: string; user: {login: string}; id: number } | null;
}
export interface ApprovalPending extends ApprovalIdentity { cardID: string; request_digest: string; id: string; choice: ApprovalChoice }
export interface ApprovalView {
  entryVisible: boolean;
  status: 'signedOut' | 'loading' | 'ready' | 'not_enrolled' | 'unavailable' | 'error';
  cards: ApprovalCard[]; pending: Pick<ApprovalPending, 'cardID' | 'id' | 'choice'>[]; busy: boolean; message?: string;
}
export interface ApprovalOptions {
  identity(): Promise<ApprovalIdentity | undefined>;
  request(identity: ApprovalIdentity, id?: string, decision?: {id: string; request_digest: string; choice: ApprovalChoice}): Promise<unknown>;
  load(accountID: string): Promise<ApprovalPending[]>;
  save(accountID: string, pending: ApprovalPending[]): Promise<void>;
  remove(accountID: string, decisionID: string): Promise<void>;
  changed(view: ApprovalView): void; uuid(): string; now?: () => number;
}
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: any, max = 200) => {
  if (typeof v!=='string' || !v || [...v].length>max || v.includes('\0')) return false;
  try { encodeURIComponent(v); return true; } catch { return false; }
};
const digest = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$(?![\s\S])/.test(v);
const id = (v: any) => typeof v === 'string' && v!=='.' && v!=='..' && /^[A-Za-z0-9._:-]{1,128}$(?![\s\S])/.test(v);
export const approvalChoice = (v: unknown): v is ApprovalChoice => ['approve','reject','question'].includes(v as string);
export function parseApprovalCard(value: unknown): ApprovalCard {
  const c: any = value, s = c?.source;
  if (!object(c) || !id(c.id) || !digest(c.request_digest) || !object(s)
      || !/^hypeproof\/[A-Za-z0-9._-]+$(?![\s\S])/.test(s.repo) || !Number.isSafeInteger(s.pr) || s.pr < 1
      || !/^[a-f0-9]{40}$(?![\s\S])/.test(s.head) || !/^[a-f0-9]{40}$(?![\s\S])/.test(s.base)
      || ![s.policy_digest,s.evidence_digest,s.context_digest].every(digest)
      || !text(c.reviewer, 100) || !object(c.brief)
      || ![c.brief.authored,c.brief.verified].every(a => Array.isArray(a) && a.length > 0 && a.length <= 30 && a.every((v: any) => text(v, 2000)))
      || !['pending','delivered','questioned','declined','superseded','expired','submitting','submitted','unknown'].includes(c.state) || ![c.created_at,c.expires_at,c.lease_expires_at].every(Number.isFinite)
      || typeof c.can_decide !== 'boolean' || !(c.unavailable_reason === null || text(c.unavailable_reason, 500))) throw new Error('invalid approval card');
  if (c.decision !== null && (!object(c.decision) || !id(c.decision.id) || !approvalChoice(c.decision.choice) || !['awaiting_processing','needs_fresh_confirmation','submitted','declined','questioned','superseded','expired','unknown'].includes(c.decision.status) || !Number.isFinite(c.decision.created_at))) throw new Error('invalid decision');
  let review: ApprovalCard['review'] = null;
  if (c.review !== null) {
    const r = c.review;
    if (!object(r) || !Number.isSafeInteger(r.id) || r.id < 1 || r.state !== 'APPROVED' || !object(r.user) || r.user.login !== c.reviewer || r.commit_id !== s.head
        || r.html_url !== `https://github.com/${s.repo}/pull/${s.pr}#pullrequestreview-${r.id}`) throw new Error('invalid review');
    review = {id:r.id,html_url:r.html_url,state:'APPROVED',user:{login:r.user.login},commit_id:r.commit_id};
  }
  return {id:c.id,request_digest:c.request_digest,source:{repo:s.repo,pr:s.pr,head:s.head,base:s.base,policy_digest:s.policy_digest,evidence_digest:s.evidence_digest,context_digest:s.context_digest},
    reviewer:c.reviewer,brief:{authored:[...c.brief.authored],verified:[...c.brief.verified]},state:c.state,created_at:c.created_at,expires_at:c.expires_at,
    can_decide:c.can_decide,lease_expires_at:c.lease_expires_at,unavailable_reason:c.unavailable_reason,
    decision:c.decision === null ? null : {id:c.decision.id,choice:c.decision.choice,status:c.decision.status,created_at:c.decision.created_at},review};
}
export function approvalCanDecide(c: ApprovalCard, now: number): boolean {
  return c.can_decide && ['pending','delivered'].includes(c.state) && !c.decision && !c.review && c.expires_at > now && c.lease_expires_at > now && c.lease_expires_at <= now + 60;
}
const same = (a?: ApprovalIdentity, b?: ApprovalIdentity) => !!a && !!b && a.accountID === b.accountID && a.sessionID === b.sessionID;
export class MemberApprovalController {
  private epoch = 0;
  private identity?: ApprovalIdentity;
  private enrolled?: ApprovalIdentity;
  private state: Omit<ApprovalView, 'entryVisible'> = {status:'signedOut',cards:[],pending:[],busy:false};
  constructor(private readonly options: ApprovalOptions) {}
  private pending: ApprovalPending[] = [];
  view(): ApprovalView { return structuredClone({...this.state, entryVisible:!!this.enrolled, pending:this.pending.map(({cardID,id,choice})=>({cardID,id,choice}))}); }
  private emit() { this.options.changed(this.view()); }
  invalidate() { this.enrolled=undefined; this.dismiss(); }
  dismiss() { this.epoch++; this.identity = undefined; this.pending=[]; this.state={status:'signedOut',cards:[],pending:[],busy:false}; this.emit(); }
  private async current(epoch: number, identity: ApprovalIdentity) { return epoch === this.epoch && same(identity, await this.options.identity()) && epoch === this.epoch; }
  async discover() { await this.refresh(true); }
  async refresh(quiet = false) {
    if (this.state.busy) return;
    let listRead = false;
    const epoch = ++this.epoch; this.state={...this.state,status:'loading',busy:true,message:undefined,cards:[]}; this.emit();
    try {
      const identity = await this.options.identity(); if (epoch !== this.epoch) return;
      if (!identity) { this.invalidate(); return; }
      this.identity = identity;
      if (!same(this.enrolled,identity)) this.enrolled=undefined;
      const result: any = await this.options.request(identity);
      if (!await this.current(epoch, identity)) { if (epoch===this.epoch) this.invalidate(); return; }
      if (!object(result) || result.schema !== 'hps-member-approval-inbox/1' || !['ready','not_enrolled','unavailable'].includes(result.availability) || !Array.isArray(result.cards) || result.cards.length>50) throw new Error('invalid inbox');
      const checked: ApprovalCard[] = result.cards.map(parseApprovalCard);
      if (new Set(checked.map(c=>c.id)).size !== checked.length) throw new Error('duplicate cards');
      listRead = true;
      this.enrolled=result.availability==='ready'?identity:undefined;
      const pending = !quiet && this.enrolled ? await this.options.load(identity.accountID) : [];
      if (!await this.current(epoch,identity)) { if(epoch===this.epoch)this.invalidate(); return; }
      const cards: ApprovalCard[] = !quiet && this.enrolled ? checked : [];
      const retained: ApprovalPending[] = [];
      for (const local of pending) {
        const resolved = parseApprovalCard(await this.options.request(identity,local.cardID));
        if (!await this.current(epoch,identity)) { if(epoch===this.epoch)this.invalidate(); return; }
        if (resolved.id!==local.cardID || resolved.request_digest!==local.request_digest) throw new Error('changed binding');
        const i=cards.findIndex(c=>c.id===resolved.id); if(i>=0)cards[i]=resolved; else cards.push(resolved);
        if (approvalTerminal(resolved)) await this.options.remove(identity.accountID,local.id); else retained.push(local);
        if (!await this.current(epoch,identity)) { if(epoch===this.epoch)this.invalidate(); return; }
      }
      if (new Set(cards.map((c: ApprovalCard) => c.id)).size !== cards.length) throw new Error('duplicate cards');
      this.pending=retained; this.state={status:result.availability,cards,pending:[],busy:false};
    } catch (error) { if (epoch===this.epoch) { const code=(error as any)?.code; const unavailable=!listRead && ['approval_inbox_unavailable','http_404','http_503'].includes(code); if(unavailable || ['unauthorized','account_inactive','session_revoked','http_401','http_403'].includes(code)) this.enrolled=undefined; this.state={status:unavailable?'unavailable':'error',cards:[],pending:[],busy:false,message:unavailable?'지금은 확인 요청함을 이용할 수 없어요.':'요청함을 확인하지 못했어요. 다시 확인해 주세요.'}; } }
    if (epoch===this.epoch) this.emit();
  }
  async decide(cardID: string, expectedDigest: string, choice: ApprovalChoice) {
    if (this.pending.length>=50 || this.state.status!=='ready' || this.state.busy || !approvalChoice(choice) || !this.identity) return;
    const card = this.state.cards.find(c => c.id===cardID), identity = this.identity, epoch=this.epoch;
    if (!card || card.request_digest!==expectedDigest || !approvalCanDecide(card,(this.options.now?.() ?? Date.now()/1000)) || this.pending.some(p=>p.cardID===cardID)) return;
    this.state={...this.state,busy:true,message:undefined}; this.emit();
    let stored = false;
    try {
      if (!await this.current(epoch,identity)) { if(epoch===this.epoch)this.invalidate(); return; }
      const pending: ApprovalPending={...identity,cardID,request_digest:expectedDigest,id:this.options.uuid(),choice};
      const all=[...this.pending,pending];
      await this.options.save(identity.accountID,all); stored=true;
      if (!await this.current(epoch,identity)) { if(epoch===this.epoch)this.invalidate(); return; }
      this.pending=all;
      if (!approvalCanDecide(card,(this.options.now?.() ?? Date.now()/1000))) throw new Error('expired before dispatch');
      const returned=parseApprovalCard(await this.options.request(identity,cardID,{id:pending.id,request_digest:expectedDigest,choice}));
      if (!await this.current(epoch,identity)) { if(epoch===this.epoch)this.invalidate(); return; }
      if (returned.id!==cardID || returned.request_digest!==expectedDigest) throw new Error('changed binding');
      this.state={...this.state,cards:this.state.cards.map(c=>c.id===cardID?returned:c),message:'선택을 전달했어요. 실제 처리 결과를 확인해 주세요.'};
    } catch { if(epoch===this.epoch)this.state={...this.state,cards:[],status:'error',message:stored ? '처리 결과를 확인하지 못했어요. 같은 요청을 다시 조회해 주세요. 자동으로 다시 보내지 않아요.' : '선택을 안전하게 저장하지 못했어요. 전송하지 않았어요.'}; }
    if(epoch===this.epoch) { this.state={...this.state,busy:false}; this.emit(); }
  }
}

export function parseApprovalPending(value: unknown, accountID: string): ApprovalPending[] {
  if (!Array.isArray(value) || value.length>50) throw new Error('unreadable decision journal');
  return value.map((p:any) => {
    if (!object(p) || p.accountID!==accountID || !id(p.sessionID) || !id(p.cardID) || !digest(p.request_digest)
        || typeof p.id!=='string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$(?![\s\S])/.test(p.id) || !approvalChoice(p.choice)) throw new Error('unreadable decision journal');
    return {accountID:p.accountID,sessionID:p.sessionID,cardID:p.cardID,request_digest:p.request_digest,id:p.id,choice:p.choice};
  });
}
export function approvalTerminal(c: ApprovalCard): boolean {
  return !c.can_decide && !['awaiting_processing','unknown'].includes(c.decision?.status ?? '') && (['declined','questioned','superseded','expired'].includes(c.state) || (c.state==='submitted' && !!c.review));
}
export function approvalStatus(c: ApprovalCard): string {
  if(c.review && c.state==='submitted') return 'GitHub 승인 반영됨';
  if(c.decision?.status==='needs_fresh_confirmation') return '확인 시간이 지났어요. 새 요청이 있는지 확인해 주세요.';
  const labels: Record<string,string>={pending:'확인을 기다려요',delivered:'확인을 기다려요',questioned:'설명을 요청했어요',declined:'보류했어요',superseded:'버전이 바뀌었어요',expired:'확인 시간이 지났어요',submitting:'승인 결과 확인 중',submitted:'처리 결과 확인 중',unknown:'처리 결과를 아직 확인하지 못했어요'};
  if(c.decision?.status==='awaiting_processing')return '선택을 전달했어요 · 처리 대기';
  return labels[c.state] ?? '다시 확인해 주세요';
}
