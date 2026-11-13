import type { SharedText } from './mobileConversation';
export interface ReflectionSnapshot {
  state:{id:'personal-reflection';revision:number;messages:SharedText[];has_earlier:boolean;turn:null|{id:string;text:string;status:string;updated_at:number}};
  opening:string;hint:string;acknowledged_id?:string;
}
export function readReflection(value:unknown):ReflectionSnapshot {
  const v=value as ReflectionSnapshot,s=v?.state;
  if(!s||s.id!=='personal-reflection'||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.messages)||s.messages.length>80
    ||typeof s.has_earlier!=='boolean'||typeof v.opening!=='string'||v.opening.length>500||typeof v.hint!=='string'||v.hint.length>1000
    ||s.messages.some(m=>!m||typeof m.id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(m.id)||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>32000||!Number.isSafeInteger(m.created_at))
    ||(v.acknowledged_id!==undefined&&(typeof v.acknowledged_id!=='string'||!/^[A-Za-z0-9._:-]{1,120}$/.test(v.acknowledged_id)))
    ||new Set(s.messages.map(m=>m.id)).size!==s.messages.length
    ||(s.turn!==null&&(!s.turn||typeof s.turn.id!=='string'||typeof s.turn.text!=='string'||!['pending','running','completed','failed','unknown','cancelled'].includes(s.turn.status)||!Number.isFinite(s.turn.updated_at)))) {
    throw Error('계정의 질문 대화를 확인하지 못했어요. 현재 기록은 그대로 남아 있어요.');
  }
  return v;
}
export interface ReflectionBinding { session:string;activity:string;workspace:string;task:string;revision:number;pending?:{id:string;text:string;revision:number;awaitingRefresh?:boolean} }
export const REFLECTION_BINDING_KEY='hps.personalReflection.v1';
export function reflectionFailure(error:unknown):string {
  const code=(error as {code?:string})?.code;
  if(code==='reflection_access_required')return '이 계정의 AI 이용 권한을 확인해 주세요. 보낸 이야기는 남아 있어요.';
  if(code==='reflection_monthly_limit')return '이번 달 이용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다.';
  if(code==='reflection_budget_limit')return 'AI 이용 한도에 도달했어요. 기록은 그대로 남아 있어요.';
  if(code==='reflection_admission_unavailable')return 'AI 이용 상태를 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요. 보낸 이야기와 기록은 남아 있어요.';
  if(code==='reflection_changed')return '다른 기기에서 대화가 바뀌었어요. 최신 내용을 확인한 뒤 다시 보내 주세요.';
  if(code==='reflection_busy')return '다른 기기에서 답변을 받고 있어요. 잠시 뒤 같은 대화를 확인해 주세요.';
  return '질문 대화를 확인하지 못했어요. 연결 상태를 확인해 주세요. 자동으로 다시 보내지 않아요.';
}
