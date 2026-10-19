// Explicit gateway-only --import. Never set NODE_OPTIONS or preload the App.
import fs from 'node:fs';
import {authorizeActivity} from './controlled-effects.mjs';
import path from 'node:path';
import {compatibilityOutputGuard} from './output-bound.mjs';
if((process.env.HPS_SERVICE_ACCEPTANCE!=='1'&&process.env.HPS_UNIFIED_SWITCH!=='1')||process.env.HPS_UNIFIED_LIVE!=='1'||!path.isAbsolute(process.env.HPS_NATIVE_EVIDENCE_DIR??'')||['HPS_CODEX_REHEARSAL','HPS_MODEL_REHEARSAL','HPS_PUBLIC_ACTIVITY'].some(name=>process.env[name]))throw Error('Compatibility output guard requires the explicit isolated activity configuration');
const file=path.join(process.env.HPS_NATIVE_EVIDENCE_DIR,'compatibility-output-guard.json');
if(fs.existsSync(file))throw Error('Refusing to reuse compatibility output proof; retain previous activity evidence');
let attempts=0,exhausted=false;
const proof=value=>({...value,request_limit:12,attempts,exhausted});
const persist=value=>fs.writeFileSync(file,JSON.stringify(proof(value),null,2),{mode:0o600});
const originalFetch=globalThis.fetch.bind(globalThis);
const guard=compatibilityOutputGuard(originalFetch,persist);
fs.writeFileSync(file,JSON.stringify(proof(guard.snapshot()),null,2),{flag:'wx',mode:0o600});
globalThis.fetch=async(input,init)=>{
 // Reserve synchronously and persist before validation/delegation. Every fetch,
 // including count_tokens, auxiliary calls and retries, consumes one slot.
 attempts++;
 if(attempts>12){exhausted=true;persist(guard.snapshot());throw Error('Synthetic Anthropic request ceiling exhausted before network (12)');}
 persist(guard.snapshot());
 const budget=await authorizeActivity(process.env.HPS_ACCEPTANCE_ACTIVITY_KIND,{resources:['model','api'],fetchImpl:originalFetch,requestIndex:attempts});budget.permit();
 return guard.fetch(input,init);
};
