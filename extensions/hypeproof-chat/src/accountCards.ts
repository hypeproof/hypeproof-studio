/** Existing Service hps-card/1 contract. Questions never grant GitHub approval authority. */
import type { ApprovalIdentity } from './memberApproval';
export interface QuestionCard {
  schema: 'hps-card/1'; key: string; kind: string; attempt: number;
  urgency: 'low' | 'normal' | 'high'; expires_at: number | null; deliver_via: string[];
  title: string | null; preface: string | null; prompt: string;
  segments: { kind: 'text' | 'own_words' | 'ai_summary'; label: string | null; text: string }[];
  choices: { id: string; label: string }[]; select: 'tap' | 'pick';
  text: { label: string; placeholder: string; max: number; value: string | null } | null;
  actions: { id: string; label: string; primary: boolean; needs_answer: boolean }[];
  skip: string | null; note: string | null;
}
export type CardAction = 'shown' | 'answer' | 'skip';
export interface QuestionView { status: 'idle' | 'loading' | 'ready' | 'error'; card: QuestionCard | null; binding?: string; busy: boolean; message?: string }
export interface CardAnswer { action?: string; choice?: string; text?: string }
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max = 4000): v is string => typeof v === 'string' && v.length <= max;
const nullable = (v: unknown, max = 4000): v is string | null => v === null || string(v, max);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,64}$(?![\s\S])/.test(v) && !v.includes('..');
export const validQuestionKey = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9:.-]{1,63}$(?![\s\S])/.test(v) && !v.includes('..');
const same = (a?: ApprovalIdentity, b?: ApprovalIdentity) => !!a && !!b && a.accountID === b.accountID && a.sessionID === b.sessionID;
export function parseQuestionCard(v: unknown): QuestionCard {
  if (!object(v) || v.schema !== 'hps-card/1' || !validQuestionKey(v.key) || !string(v.kind, 128)
      || !Number.isInteger(v.attempt) || v.attempt < 1 || v.attempt > 100 || !['low','normal','high'].includes(v.urgency)
      || !(v.expires_at === null || (Number.isSafeInteger(v.expires_at) && v.expires_at > 0))
      || !Array.isArray(v.deliver_via) || v.deliver_via.length > 2 || !v.deliver_via.every((x: unknown) => x === 'in_app' || x === 'push')
      || !nullable(v.title) || !nullable(v.preface) || !string(v.prompt) || !v.prompt
      || !nullable(v.skip) || !nullable(v.note) || !['tap','pick'].includes(v.select)
      || !Array.isArray(v.segments) || v.segments.length > 20 || !Array.isArray(v.choices) || v.choices.length > 20
      || !Array.isArray(v.actions) || v.actions.length > 10) throw new Error('Invalid question card');
  const segments = v.segments.map((s: any) => { if (!object(s) || !['text','own_words','ai_summary'].includes(s.kind) || !nullable(s.label) || !string(s.text)) throw new Error('Invalid segment'); return {kind:s.kind,label:s.label,text:s.text}; });
  const choices: QuestionCard['choices'] = v.choices.map((c: any) => { if (!object(c) || !id(c.id) || !string(c.label, 500)) throw new Error('Invalid choice'); return {id:c.id,label:c.label}; });
  const actions: QuestionCard['actions'] = v.actions.map((a: any) => { if (!object(a) || !id(a.id) || !string(a.label, 500) || typeof a.primary !== 'boolean' || typeof a.needs_answer !== 'boolean') throw new Error('Invalid action'); return {id:a.id,label:a.label,primary:a.primary,needs_answer:a.needs_answer}; });
  if (new Set(choices.map(c => c.id)).size !== choices.length || new Set(actions.map(a => a.id)).size !== actions.length || (v.select === 'tap' && actions.length)) throw new Error('Ambiguous actions');
  let text: QuestionCard['text'] = null;
  if (v.text !== null) { const t = v.text; if (!object(t) || !string(t.label, 500) || !string(t.placeholder, 500) || !Number.isInteger(t.max) || t.max < 1 || t.max > 2000 || !nullable(t.value, t.max)) throw new Error('Invalid text field'); text = {label:t.label,placeholder:t.placeholder,max:t.max,value:t.value}; }
  return {schema:'hps-card/1',key:v.key,kind:v.kind,attempt:v.attempt,urgency:v.urgency,expires_at:v.expires_at,deliver_via:[...v.deliver_via],title:v.title,preface:v.preface,prompt:v.prompt,segments,choices,select:v.select,text,actions,skip:v.skip,note:v.note};
}
export class AccountCardsController {
  private epoch = 0;
  private identity?: ApprovalIdentity;
  private shown = false;
  private state: QuestionView = {status:'idle',card:null,busy:false};
  constructor(private readonly options: {
    identity(): Promise<ApprovalIdentity | undefined>;
    request(identity: ApprovalIdentity, key?: string, action?: CardAction, answer?: CardAnswer): Promise<unknown>;
    changed(): void; uuid(): string; now?(): number;
    observed?(type: 'question.presented' | 'question.answered' | 'question.skipped', journeyID: string): void;
  }) {}
  view(): QuestionView { return structuredClone(this.state); }
  private emit() { this.options.changed(); }
  invalidate() { this.epoch++; this.identity = undefined; this.shown = false; this.state = {status:'idle',card:null,busy:false}; this.emit(); }
  private async current(epoch: number, identity: ApprovalIdentity) { return epoch === this.epoch && same(identity, await this.options.identity()) && epoch === this.epoch; }
  async refresh() {
    if (this.state.busy) return;
    const epoch = ++this.epoch; this.state = {...this.state,status:'loading',busy:true,message:undefined}; this.emit();
    try {
      const identity = await this.options.identity(); if (epoch !== this.epoch) return;
      if (!identity) { this.invalidate(); return; }
      const result = await this.options.request(identity);
      if (!await this.current(epoch, identity)) { if (epoch === this.epoch) this.invalidate(); return; }
      if (!object(result) || !('card' in result)) throw new Error('Invalid cards response');
      const card = result.card === null ? null : parseQuestionCard(result.card);
      if (card?.expires_at && card.expires_at <= (this.options.now?.() ?? Date.now())) throw new Error('Expired card');
      // Preserve an unsent answer through an ordinary refresh of the identical card.
      const unchanged = same(this.identity, identity) && JSON.stringify(card) === JSON.stringify(this.state.card);
      this.identity = identity; this.shown = unchanged && this.shown;
      this.state = {status:'ready',card,binding:unchanged ? this.state.binding : this.options.uuid(),busy:false};
    } catch { if (epoch === this.epoch) this.state = {status:'error',card:null,busy:false,message:'질문을 불러오지 못했어요. 대화는 계속할 수 있어요.'}; }
    if (epoch === this.epoch) this.emit();
  }
  async act(binding: string, key: string, action: CardAction, answer: CardAnswer = {}) {
    if (!['shown','answer','skip'].includes(action)) return;
    const {card} = this.state, identity = this.identity, epoch = this.epoch;
    if (!identity || this.state.busy || binding !== this.state.binding || !card || card.key !== key || (card.expires_at !== null && card.expires_at <= (this.options.now?.() ?? Date.now()))) return;
    if (action === 'shown' && this.shown) return;
    if (action === 'skip' && card.skip === null) return;
    if (action === 'answer') {
      if (!object(answer) || Object.keys(answer).some(k => !['choice','action','text'].includes(k))) return;
      if (answer.choice !== undefined && !card.choices.some(c => c.id === answer.choice)) return;
      if (answer.text !== undefined && (!card.text || !string(answer.text, card.text.max))) return;
      if (card.select === 'tap') { if (!answer.choice || answer.action !== undefined) return; }
      else { const chosen = card.actions.find(a => a.id === answer.action); if (!chosen || (chosen.needs_answer && !answer.choice && !answer.text?.trim())) return; }
    }
    this.state = {...this.state,busy:true,message:undefined}; this.emit();
    try {
      if (!await this.current(epoch, identity)) { if (epoch === this.epoch) this.invalidate(); return; }
      const response = await this.options.request(identity, key, action, answer);
      if (!await this.current(epoch, identity)) { if (epoch === this.epoch) this.invalidate(); return; }
      if (!object(response) || response.ok !== true) throw new Error('Invalid action response');
      if (action === 'shown') this.shown = true;
      else {
        const message = action === 'answer' ? response.thanks : response.message;
        if (!string(message)) throw new Error('Invalid receipt');
        this.state = {status:'ready',card:null,busy:false,message};
      }
      this.options.observed?.(action === 'shown' ? 'question.presented' : action === 'answer' ? 'question.answered' : 'question.skipped', binding);
    } catch { if (epoch === this.epoch) {
      if (action === 'shown') this.shown = true; // Do not loop an uncertain delivery acknowledgment.
      else this.state = {status:'error',card:null,busy:false,message:'처리 결과를 확인하지 못했어요. 다시 조회해 주세요. 선택은 자동으로 다시 보내지 않아요.'};
    } }
    if (epoch === this.epoch) { this.state = {...this.state,busy:false}; this.emit(); }
  }
}
