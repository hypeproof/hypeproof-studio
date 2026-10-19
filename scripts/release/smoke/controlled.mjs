import {workflowApiBudget} from '../cloud-executor/workflow-api.mjs';
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {engineEnabled,authorizeExecution,executionBody} from '../cloud-executor/workflow-gate.mjs';
const check=(ok,why)=>{if(!ok)throw Error('BLOCKED: '+why);};
export const smokeResources={S1:['api'],S2:['api'],S3:['service','api'],S4:['model','service','api'],S5:['api'],S6:['service','api']};
export const smokeScopes={S1:'one-public-health-read',S2:'one-chalk-health-read',S3:'one-owned-classroom-seat-lifecycle',S4:'one-owned-sdk-seat-six-sdk-shapes-max64-tokens',S5:'bounded-candidate-checks-20-pages-2000-run-metadata',S6:'one-owned-seat-lifecycle-and-three-current-product-board-reads'};
export function controlledInputs(env=process.env,{head=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}={}){
 if(!engineEnabled(env))return null;
 check(env.HPS_VERIFICATION_CONTEXT&&env.HPS_ENGINE_IDENTITY_FILE&&['mac','win-user','win-system'].includes(env.TARGET),'canonical verifier context/collection/target required before smoke');
 const context=JSON.parse(fs.readFileSync(env.HPS_VERIFICATION_CONTEXT,'utf8')),collection=JSON.parse(fs.readFileSync(env.HPS_ENGINE_IDENTITY_FILE,'utf8'));
 check(context.testRevision===head()&&/^[a-f0-9]{40}$/.test(context.serviceSha??'')&&/^[a-f0-9]{40}$/.test(context.rubricRevision??'')&&/^[a-f0-9]{64}$/.test(context.manifestDigest??''),'smoke verifier/Service context mismatch');
 check(collection.identity?.repository==='hypeproof/hypeproof-studio'&&collection.identity.repositoryId===1239447574&&/^[a-f0-9]{40}$/.test(collection.identity.sourceSha??''),'canonical smoke candidate identity missing');return {context,identity:{...collection.identity,target:env.TARGET}};
}
export function smokeGuard(env=process.env,{inputs=controlledInputs(env),authorize=authorizeExecution,clock=Date.now}={}){
 if(!inputs)return null;
 return async id=>{if(id==='S5')return workflowApiBudget('s5-ci',{env,identity:inputs.identity,authorize,clock});check(smokeResources[id],'unknown smoke check');const grants=[];for(const resource of smokeResources[id])grants.push(await authorize(executionBody({path:`smoke:${id}:${resource}`,identity:inputs.identity,effect:{kind:'verify-start',checkId:id,batchScope:smokeScopes[id]}},env),{env}));
  const deadline=Math.min(...grants.map(g=>Date.parse(g.expiresAt)));const permit=()=>check(clock()<deadline,'smoke first effect budget authorization expired');permit();return {deadline,permit,scope:smokeScopes[id],resources:smokeResources[id]};};
}
