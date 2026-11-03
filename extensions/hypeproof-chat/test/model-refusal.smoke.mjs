import {modelRefusalNotifier} from '../src/modelRefusalNotice.ts';
import assert from 'node:assert/strict';
import {consumeSdkStream} from '../src/sdkCoachHelpers.ts';
import {proxyChat} from '../src/proxyClient.ts';
for (const [event,want] of [
 [{type:'result',subtype:'success',stop_reason:'refusal'},1],
 [{type:'system',subtype:'model_refusal_no_fallback'},1],
 [{type:'system',subtype:'model_refusal_fallback'},0],
 [{type:'result',subtype:'success',stop_reason:'max_tokens'},0],
 [{type:'assistant',message:{content:[{type:'text',text:'refusal'}]}},0],
]) {
 let calls=0;
 await consumeSdkStream((async function*(){yield event})(),{
  isAborted:()=>false, makeAbortError:()=>new Error('abort'), abortQuery:()=>{},
  makeFatalAuthError:()=>new Error('auth'),onDelta:()=>{},onRefusal:()=>calls++,stallMs:0,
 });
 assert.equal(calls,want,JSON.stringify(event));
}
const original=globalThis.fetch;
try {
 for(const [reason,want] of [['refusal',1],['content_filter',1],['stop',0],['length',0]]) {
  let calls=0;
  globalThis.fetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'refusal'},finish_reason:reason}]})+'\n\ndata: [DONE]\n\n');
  await proxyChat({proxyUrl:'https://example.test',model:'test',history:[],userText:'hi',signal:new AbortController().signal,onDelta:()=>{},onRefusal:()=>calls++});
  assert.equal(calls,want,reason);
 }
 for (const [refusal,want] of [['private policy',1],['',0],[null,0],[true,0]]) {
  let calls=0; let text='';
  globalThis.fetch=async()=>new Response('data: '+JSON.stringify({choices:[{delta:{refusal},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  await proxyChat({proxyUrl:'https://example.test',model:'test',history:[],userText:'hi',signal:new AbortController().signal,onDelta:d=>text+=d,onRefusal:()=>calls++});
  assert.equal(calls,want,JSON.stringify(refusal)); assert.equal(text,'','raw refusal excluded');
 }
}finally{globalThis.fetch=original;}
console.log('explicit model refusal callbacks PASS');

for (const ending of ['live','aborted','settled']) {
 const ctrl=new AbortController();let done=false,calls=0;
 const notify=modelRefusalNotifier(ctrl.signal,()=>done,()=>calls++);
 if(ending==='aborted')ctrl.abort(); if(ending==='settled')done=true;
 notify();notify(); assert.equal(calls,ending==='live'?1:0,ending);
}
