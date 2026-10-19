// Canonical Worker authorizes finite resources; local receipts never settle holds.
import {controlledInputs} from '../../scripts/release/smoke/controlled.mjs';
import {authorizeExecution,executionBody} from '../../scripts/release/cloud-executor/workflow-gate.mjs';
export async function authorizeActivity(kind,{env=process.env,resources=['model','service','api'],fetchImpl=fetch,authorize=authorizeExecution,clock=Date.now,requestIndex=null}={}){
 const inputs=controlledInputs(env);if(!inputs)return {permit(){},deadline:Infinity};
 if(!['trial','classroom'].includes(kind))throw Error('BLOCKED: unknown controlled activity');
 const grants=[];for(const resource of resources)grants.push(await authorize(executionBody({path:`installed:${env.TARGET}:${requestIndex===null?'public':'synthetic'}-${kind}:${resource}`,identity:inputs.identity,effect:{kind:'verify-start',batchScope:requestIndex===null?'one-owned-seat-native-flow-max40-service-requests':'one-synthetic-request-max4096-output-tokens',...(requestIndex===null?{}:{requestIndex})}},env),{env,fetchImpl}));
 const deadline=Math.min(...grants.map(g=>Date.parse(g.expiresAt)));const permit=()=>{if(!Number.isFinite(deadline)||clock()>=deadline)throw Error('BLOCKED: activity authorization expired before effect');};permit();return {deadline,permit};
}
