import fs from 'node:fs';
import {engineEnabled} from '../../scripts/release/cloud-executor/workflow-gate.mjs';
const sha=/^[a-f0-9]{40}$/;const require=(ok,why)=>{if(!ok)throw Error('BLOCKED: '+why);};
export function acceptanceBinding({candidateSha,head,dirty,env=process.env,legacyServicePin,context}){
 require(sha.test(candidateSha)&&sha.test(head),'candidate/verifier SHA missing');require(!dirty,'acceptance verifier checkout is dirty');
 if(!engineEnabled(env)){require(head===candidateSha,'legacy acceptance requires clean pinned source');return {candidateSha,testRevision:head,servicePin:typeof legacyServicePin==='function'?legacyServicePin():legacyServicePin,controlled:false};}
 require(context&&sha.test(context.serviceSha)&&sha.test(context.testRevision)&&sha.test(context.rubricRevision)&&/^[a-f0-9]{64}$/.test(context.manifestDigest??'')&&typeof context.candidateId==='string','canonical verification context missing');
 require(head===context.testRevision,'verifier checkout differs from canonical testRevision');
 return {controlled:true,candidateSha,testRevision:context.testRevision,rubricRevision:context.rubricRevision,candidateId:context.candidateId,manifestDigest:context.manifestDigest,servicePin:{repository:'hypeproof/hypeproof-service',sha:context.serviceSha}};
}
export function loadAcceptanceBinding({candidateSha,head,dirty,env=process.env,legacyServicePin}){const context=env.HPS_VERIFICATION_CONTEXT?JSON.parse(fs.readFileSync(env.HPS_VERIFICATION_CONTEXT,'utf8')):null;return acceptanceBinding({candidateSha,head,dirty,env,legacyServicePin,context});}
