import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPublicationGate,publicationPaths} from '../publish-gate.mjs';
import {ReleaseGateClient} from '../cloud-executor/gate-client.mjs';
import {digest} from '../engine/core.mjs';
const identity={repository:'hypeproof/hypeproof-studio',repositoryId:1239447574,sourceSha:'a'.repeat(40),intentDigest:'b'.repeat(64),releaseId:9,channel:'stable'};
test('every known mutation path denies missing authority and unmanaged engine bypass',async()=>{
 for(const path of publicationPaths){const request={enabled:true,managed:true,path,identity,legacyGuard:async()=>{}};await assert.rejects(assertPublicationGate(request),/unavailable/);await assert.rejects(assertPublicationGate({...request,managed:false}),/unmanaged/);}
});
test('legacy guards preserved; controlled request pins exact digest and rejects stale response',async()=>{
 let guards=0;const request={enabled:true,managed:true,path:publicationPaths[0],identity,legacyGuard:async()=>{guards++;},client:{authorize:async r=>({status:'AUTHORIZED',identityDigest:digest(r.identity),path:r.path,fence:2})}};
 assert.equal((await assertPublicationGate(request)).fence,2);assert.equal(guards,1);
 await assert.rejects(assertPublicationGate({...request,client:{authorize:async()=>({status:'AUTHORIZED',identityDigest:'stale',path:request.path,fence:2})}}),/current/);
 assert.equal((await assertPublicationGate({...request,enabled:false,managed:false})).status,'LEGACY_GUARD_PASSED');
});
test('gate HTTPS request rejects alternate origins and never follows redirects',async()=>{
 assert.throws(()=>new ReleaseGateClient({origin:'http://evil',token:'fixture'}),/unconfigured/);
 const client=new ReleaseGateClient({origin:'https://release-engine.hypeproof-ai.xyz',token:'fixture',fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(url,'https://release-engine.hypeproof-ai.xyz/v1/publication/authorize');return Response.json({status:'BLOCKED'},{status:403});}});
 await assert.rejects(client.authorize({identity}),/unavailable/);
});
test('legacy CLI refuses even prerelease when engine is enabled',async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,['scripts/release/publish-gate.mjs','--tag','v1.2.3-rc.1'],{encoding:'utf8',env:{...process.env,HPS_RELEASE_ENGINE_ENABLED:'true'}});
 assert.equal(result.status,1);assert.match(result.stdout,/Service publisher/);
});
