import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {renderResponse} from './render-protocol.mjs';import {rawHeadlessCdp} from './headless-cdp.mjs';
const request=results=>({model:'scripted',tools:[{name:'mcp__hypeproof__browser_screenshot'}],messages:[{role:'user',content:[{type:'text',text:'HPS_RENDER_PROOF:390:positive'},...results]}]});
const config={origin:'http://127.0.0.1:1234'};
test('explicit render protocol requests real MCP tools and only hashes supplied screenshot result bytes',()=>{
 const opened=renderResponse(request([]),config);assert(opened.stream.includes('mcp__hypeproof__browser_open'));assert.equal(opened.metadata.results.length,0);
 const next=renderResponse(request([{type:'tool_result',tool_use_id:'render_open',content:'Opened'}]),config);assert(next.stream.includes('mcp__hypeproof__browser_screenshot'));assert.equal(next.metadata.results[0].images.length,0);
 const bytes=Buffer.from('test image bytes'),result={type:'tool_result',tool_use_id:'render_shot',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:bytes.toString('base64')}}]};
 const complete=renderResponse(request([{type:'tool_result',tool_use_id:'render_open',content:'Opened'},result]),config);assert(complete.stream.includes('HPS_RENDER_PROOF_COMPLETE'));assert.equal(complete.metadata.results[1].images[0].sha256,createHash('sha256').update(bytes).digest('hex'));
 const denied=renderResponse(request([{...result,is_error:true,content:'Tool unavailable'}]),config);assert.equal(denied.metadata.results[0].is_error,true);assert.deepEqual(denied.metadata.results[0].images,[]);
});
test('render protocol refuses external/arbitrary origins and missing mode before issuing tools',async()=>{
 for(const origin of['https://example.com','http://localhost:1234','http://127.0.0.1:1234/other','http://user:pass@127.0.0.1:1234','http://127.0.0.1:1234?x=y'])assert.throws(()=>renderResponse(request([]),{origin}));
 assert.throws(()=>renderResponse({...request([]),messages:[]},config));await assert.rejects(rawHeadlessCdp('ws://example.com/browser'),/Owned loopback/);
});
