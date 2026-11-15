import { contentBytes, type OutboundConfirmation } from "./outboundConsent.ts";
import type { ResolvedProfile } from './protocol';
export interface AccessResource {meter:string;limit:number;remaining:number;shared:boolean;spent:number;held:number;overrun:number;unresolved:number}
export interface AccessChoiceView {id:string;label:string;mode:'included'|'byo';source_kind:string;active:boolean;available:boolean;state:string;ends_at:number;can_request:boolean;
  allowed:{models:string[];efforts:string[];features:string[];runtimes:string[]};resources:AccessResource[];pending_request?:{id:string;state:string;note:string;resolution?:string|null}|null;
  /** CGP-SHELL-R-030: what the request form may send (absent on a Service without it); null when the policy was malformed. */
  request_policy?:BudgetRequestPolicy|null}
/** CGP-SHELL-R-030: fixed reasons; `note` false on a minor seat (never free text); the next request is accepted from `cooldown_until`. */
export interface BudgetRequestPolicy {reasons:{id:string;label:string}[];note:boolean;note_max:number;cooldown_until:number|null}
const REASON_ID=/^[a-z][a-z0-9_]{0,39}$/;
function validPolicy(v:unknown):v is BudgetRequestPolicy{
  const p=v as BudgetRequestPolicy;
  return !!p&&typeof p==='object'&&Array.isArray(p.reasons)&&p.reasons.length>=1&&p.reasons.length<=8&&p.reasons.every(r=>!!r&&typeof r.id==='string'&&REASON_ID.test(r.id)&&typeof r.label==='string'&&r.label.length>0&&r.label.length<=60)
    &&typeof p.note==='boolean'&&Number.isSafeInteger(p.note_max)&&p.note_max>=1&&p.note_max<=280&&(p.cooldown_until===null||Number.isSafeInteger(p.cooldown_until));
}
export interface AccessView {schema:'hps-access-view/1';configured:boolean;required?:boolean;as_of:string;choices:AccessChoiceView[];truncated?:boolean}
export interface AccessState {status:'ready'|'unknown';view?:AccessView;selected?:string;pendingSelection?:string;notice?:string}
export const validFundingSource=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
export function parseAccessView(value:unknown):AccessView{
  const v=value as AccessView;
  if(!v||v.schema!=='hps-access-view/1'||typeof v.configured!=='boolean'||typeof v.as_of!=='string'||!Number.isFinite(Date.parse(v.as_of))||!Array.isArray(v.choices)||v.choices.length>100)throw Error('이용권 응답을 확인할 수 없습니다.');
  for(const c of v.choices){
    if(!validFundingSource(c.id)||typeof c.label!=='string'||!['included','byo'].includes(c.mode)||typeof c.active!=='boolean'||typeof c.available!=='boolean'||typeof c.state!=='string'||!Number.isSafeInteger(c.ends_at)||!c.allowed||!['models','efforts','features','runtimes'].every(k=>Array.isArray(c.allowed[k as keyof typeof c.allowed])&&c.allowed[k as keyof typeof c.allowed].every(x=>typeof x==='string'))||!Array.isArray(c.resources))throw Error('이용권 응답을 확인할 수 없습니다.');
    for(const r of c.resources)if(typeof r.meter!=='string'||!['limit','remaining','spent','held','overrun','unresolved'].every(k=>Number.isSafeInteger(r[k as keyof AccessResource])))throw Error('사용량을 확인할 수 없습니다.');
    // A malformed policy never falls back to the free-text form: the request is not offered.
    if('request_policy' in c&&c.request_policy!==undefined&&!validPolicy(c.request_policy))c.request_policy=null;
  }
  return v;
}
export async function fetchAccessView(proxyUrl:string,token:string):Promise<AccessView>{
  const r=await fetch(proxyUrl.replace(/\/$/,'')+'/access',{headers:{authorization:'Bearer '+token,'cache-control':'no-store'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('이용권을 확인하지 못했습니다.');return parseAccessView(await r.json());
}
/** What the learner sends with an allowance request: a picked reason id, their own note, both or neither. */
export interface BudgetRequestInput {reason?:string;note?:string}
/** The Service's answer, as a sentence the learner reads. */
const REQUEST_ERRORS:Record<string,string>={
  budget_request_cooldown:'방금 요청했어요. 10분이 지나면 다시 요청할 수 있어요.',
  budget_request_note_not_allowed:'이 수업에서는 이유를 골라서 보내요.',
  budget_request_reason_required:'요청 이유를 하나 골라 주세요.',
};
/**
 * REQ-KNOW-09: a note is the learner's own words to the funding owner, so it is listed (recipient, size) and confirmed;
 * a picked reason is listed as the fixed sentence it is. Returns false on Cancel.
 * CGP-SHELL-R-030: without a request policy (an older Service) a note is required, as before.
 */
export async function sendBudgetRequest(proxyUrl:string,token:string,source:string,input:BudgetRequestInput,confirm:OutboundConfirmation|undefined,fetchImpl:typeof fetch=fetch,policy?:BudgetRequestPolicy|null):Promise<boolean>{
  if(!validFundingSource(source))throw Error('요청할 이용권을 확인할 수 없습니다.');
  const note=typeof input.note==='string'&&input.note.trim()?input.note:undefined;
  if(policy===null)throw Error('지금은 추가 사용을 요청할 수 없어요.');
  const reason=policy?policy.reasons.find(r=>r.id===input.reason):undefined;
  if(input.reason!==undefined&&!reason)throw Error('요청 이유를 다시 골라 주세요.');
  if(policy){
    if(note!==undefined&&(!policy.note||note.length>policy.note_max))throw Error(policy.note?`하고 싶은 말을 ${policy.note_max}자 이내로 줄여 주세요.`:'이 수업에서는 이유를 골라서 보내요.');
    if(!policy.note&&!reason)throw Error('요청 이유를 하나 골라 주세요.');
  }else if(note===undefined||note.length>280)throw Error('요청 사유를 280자 이내로 입력해 주세요.');
  const body=JSON.stringify({source_id:source,...(reason?{reason:reason.id}:{}),...(note!==undefined?{note}:{})});
  const items=[...(reason?[{name:`고른 이유: ${reason.label}`,bytes:contentBytes(reason.id)}]:[]),...(note!==undefined?[{name:'추가 사용이 필요한 이유 (내가 쓴 글)',bytes:contentBytes(note)}]:[]),{name:'이용권 번호',bytes:contentBytes(source)}];
  if(!confirm||!await confirm({recipient:`이용권을 관리하는 강사 · ${new URL(proxyUrl).host}`,items}))return false;
  const r=await fetchImpl(proxyUrl.replace(/\/$/,'')+'/access/requests',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,signal:AbortSignal.timeout(15000)});
  if(!r.ok){let code='';try{code=String(((await r.json()) as {error?:{code?:unknown}}|null)?.error?.code??'');}catch{/* not JSON */}throw Error(REQUEST_ERRORS[code]??'추가 사용 요청을 보내지 못했습니다.');}
  return true;
}
/**
 * REQ-STUDIO-DENIAL-SOURCE — the feature keys (REQ-M38: read, write, shell, subagents,
 * browser, web_search) the selected access choice removed from a profile that granted them.
 * Kept under an enumerable symbol: object spread carries it along with the profile, JSON
 * and postMessage never see it.
 */
export const ACCESS_REMOVED_FEATURES:unique symbol=Symbol('hps.accessRemovedFeatures');
type AccessNarrowed=ResolvedProfile&{[ACCESS_REMOVED_FEATURES]?:readonly string[]};
/** What the access choice removed (empty for an un-narrowed profile): those denials are 이용권 선택, not 수업 설정. */
export function accessRemovedFeatures(profile:ResolvedProfile|null|undefined):ReadonlySet<string>{
  return new Set((profile as AccessNarrowed|null|undefined)?.[ACCESS_REMOVED_FEATURES]??[]);
}
/** UI/runtime narrowing only; the Service still authenticates every execution. */
export function accessProfile(profile:ResolvedProfile,choice:AccessChoiceView|undefined):ResolvedProfile{
  if(!choice)return profile;const allowed=new Set(choice.allowed.features);
  const t=profile.sdk_tools,removed:string[]=[];
  for(const k of ['read','write','shell','subagents'] as const)if(t?.[k]&&!allowed.has(k))removed.push(k);
  if((t?.browser||profile.browser_control?.enabled)&&!allowed.has('browser'))removed.push('browser');
  if(profile.tools?.web_search===true)removed.push('web_search');
  const narrowed:AccessNarrowed={...profile,sdk_tools:profile.sdk_tools?{...profile.sdk_tools,read:!!profile.sdk_tools.read&&allowed.has('read'),write:!!profile.sdk_tools.write&&allowed.has('write'),shell:!!profile.sdk_tools.shell&&allowed.has('shell'),subagents:!!profile.sdk_tools.subagents&&allowed.has('subagents'),browser:!!profile.sdk_tools.browser&&allowed.has('browser')}:undefined,
    tools:{...profile.tools,web_search:false},browser_control:profile.browser_control?{...profile.browser_control,enabled:profile.browser_control.enabled&&allowed.has('browser')}:undefined};
  narrowed[ACCESS_REMOVED_FEATURES]=removed;
  return narrowed;
}
