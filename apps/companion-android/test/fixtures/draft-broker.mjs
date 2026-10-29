import assert from 'node:assert/strict';
/** Scripted native replies for actual React tests; JVM tests separately exercise the native store. */
export function draftBrokerFixture({record:initial,markerFailure=false}={}){
 let record=structuredClone(initial),revision=record?.revision??0,version=record?'a'.repeat(64):null,generation='native-draft-owner';const calls=[];
 return{calls,get record(){return structuredClone(record);},reply(message){calls.push(structuredClone(message));
  if(message.kind==='draft.replace'){
   assert.equal(message.generation,generation);assert.equal(message.expectedVersion,version);assert.notEqual(record?.phase,'attempted_unknown');
   record={...message.value,schema:'hps-companion-android-draft/1',accountId:'account',service:'https://owned.invalid/v1',revision:++revision,createdAt:1,updatedAt:2};version=String(revision).padStart(64,'0');
   if(markerFailure&&record.phase==='attempted_unknown')return{ok:false,error:'native_unavailable'};
  }else if(message.kind==='draft.erase'){assert.equal(message.generation,generation);assert.equal(message.expectedVersion,version);record=undefined;revision=0;version=null;generation+='x';}
  return{ok:true,value:{state:record?'record':'empty',generation,version,record:structuredClone(record)}};
 }};
}
