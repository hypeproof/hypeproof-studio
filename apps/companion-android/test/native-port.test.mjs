import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativePort} from '../web/nativePort.ts';
function fixture(){const sent=[],endpoint={onmessage:null,postMessage:text=>sent.push(JSON.parse(text))};const port=createNativePort(endpoint);return{sent,endpoint,port,reply:value=>endpoint.onmessage?.({data:JSON.stringify(value)})};}
test('correlated reply only; native failure details do not become UI errors',async()=>{
 const f=fixture();const first=f.port.call({kind:'identity'});assert.equal(f.sent.length,1);f.reply({id:'foreign',ok:true,value:{unexpected:true}});assert.equal(f.port.pending,1);f.reply({id:f.sent[0].id,ok:true,value:{accountId:'fixture-account',sessionId:'fixture-device'}});assert.equal((await first).sessionId,'fixture-device');
 const second=f.port.call({kind:'relay'});const denied=assert.rejects(second,e=>e.message==='native_unavailable');f.reply({id:f.sent[1].id,ok:false,error:'Bearer private-token /private/path'});await denied;f.port.close();
});
test('abort cancels native operation; late old reply cannot resurrect it',async()=>{
 const f=fixture(),signal=new AbortController();const pending=f.port.call({kind:'relay'},signal.signal),denied=assert.rejects(pending,/native_cancelled/),id=f.sent[0].id;signal.abort();await denied;assert.equal(f.port.pending,0);assert.equal(f.sent[1].kind,'cancel');assert.equal(f.sent[1].target,id);f.reply({id,ok:true,value:{late:true}});assert.equal(f.port.pending,0);f.port.close();
});
test('bounded pending queue and disposal settle every promise without a retry',async()=>{
 const f=fixture(),work=Array.from({length:32},()=>f.port.call({kind:'identity'}));const settled=Promise.allSettled(work);await assert.rejects(f.port.call({kind:'identity'}),/native_overloaded/);assert.equal(f.sent.length,32);f.port.close();const results=await settled;assert.ok(results.every(x=>x.status==='rejected'&&x.reason.message==='native_closed'));assert.equal(f.port.pending,0);assert.equal(f.sent.filter(x=>x.kind==='identity').length,32);await assert.rejects(f.port.call({kind:'identity'}),/native_closed/);
});
test('oversized UTF8 request and pre-aborted caller never dispatch',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();await assert.rejects(f.port.call({kind:'pairing',payload:'한'.repeat(4000)}),/native_invalid_request/);await assert.rejects(f.port.call({kind:'identity'},abort.signal),/native_closed/);assert.equal(f.sent.length,0);f.port.close();
});
