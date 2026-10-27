/** Data-only receipt. Transport acknowledgement and draft import never mean execution. */
import type { CompanionAuthoringOutcome } from './companionAuthoringHost';
export interface CompanionAuthoringResult {
  schema:'hps-companion-authoring-result/1'; requestId:string; requestHash:string;
  outcome: CompanionAuthoringOutcome;
}
export function parseCompanionAuthoringResult(text:string,requestId:string,requestHash:string): CompanionAuthoringResult | null {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>2032)return null;
  let value:unknown;try{value=JSON.parse(text);}catch{return null;}
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as CompanionAuthoringResult;
  if(Object.keys(v).length!==4||v.schema!=='hps-companion-authoring-result/1'||v.requestId!==requestId||v.requestHash!==requestHash
    ||!/^[a-f0-9]{64}$/.test(v.requestHash)||!v.outcome||typeof v.outcome!=='object'||Array.isArray(v.outcome))return null;
  const o=v.outcome;
  if(!Object.keys(o).every(k=>['state','code','requestId','executionAuthorized'].includes(k))||o.executionAuthorized!==false
    ||!['imported_draft','cancelled','denied','outcome_unknown'].includes(o.state)||typeof o.code!=='string'||!/^[a-z0-9_]{1,96}$/.test(o.code)
    ||(o.requestId!==undefined&&o.requestId!==requestId))return null;
  return v;
}
