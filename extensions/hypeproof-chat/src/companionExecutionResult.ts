/** Data-only measured execution receipt, distinct from draft import and transport ACK. */
export type CompanionExecutionResult = {
 schema:'hps-companion-execution-result/1'; requestId:string; requestHash:string;
} & ({state:'completed'|'failed';code:'normal_turn_measured';turnId:string;artifactVersion:string}
 | {state:'denied'|'outcome_unknown';code:string;turnId?:string;artifactVersion?:string});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function parseCompanionExecutionResult(text:string,requestId:string,requestHash:string):Readonly<CompanionExecutionResult>|null {
 if(typeof text!=='string'||new TextEncoder().encode(text).length>2032)return null;
 let raw:unknown;try{raw=JSON.parse(text);}catch{return null;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>,required=['schema','requestId','requestHash','state','code'];
 if(!required.every(key=>Object.hasOwn(value,key))||!Object.keys(value).every(key=>[...required,'turnId','artifactVersion'].includes(key))
  ||value.schema!=='hps-companion-execution-result/1'||value.requestId!==requestId||typeof value.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value.requestId)
  ||value.requestHash!==requestHash||!hash(value.requestHash)||!['denied','outcome_unknown','completed','failed'].includes(String(value.state))
  ||typeof value.code!=='string'||!/^[a-z0-9_]{1,96}$/.test(value.code)
  ||(Object.hasOwn(value,'turnId')&&!uuid(value.turnId))||(Object.hasOwn(value,'artifactVersion')&&!hash(value.artifactVersion)))return null;
 const terminal=value.state==='completed'||value.state==='failed';
 if(terminal?(value.code!=='normal_turn_measured'||!uuid(value.turnId)||!hash(value.artifactVersion)):value.code==='normal_turn_measured')return null;
 return Object.freeze(value) as Readonly<CompanionExecutionResult>;
}
