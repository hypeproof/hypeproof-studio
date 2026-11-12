import assert from 'node:assert/strict';
import { createAutomationStoreClient } from '../src/automationStoreClient.ts';
let request;
const client = createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'test-participant',fetchImpl:async(url,init)=>{request={url,init};return new Response(JSON.stringify({items:[]}),{status:200});}});
await client.list();assert.equal(request.url,'https://service.example.test/v1/automations');assert.equal(request.init.headers.Authorization,'Bearer test-participant');assert.equal(request.init.redirect,'error','bearer must not follow remote redirects');
const denied = createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'test',fetchImpl:async()=>new Response('server details must not leak',{status:404})});
await assert.rejects(()=>denied.detail('foreign'),/우리 반/);
assert.throws(()=>createAutomationStoreClient({baseUrl:'http://remote.example.test',getToken:async()=>''}));
assert.throws(()=>createAutomationStoreClient({baseUrl:'https://name:pass@remote.example.test',getToken:async()=>''}));
console.log('PASS store client: authenticated private route, no redirect, safe errors and trusted URL');

// A successful HTTP response is still untrusted package data. Both conversation
// and inspector consumers use this boundary before accepting an installed recipe.
const recipe={schema:'hps-email-automation/1',title:'Portable request',description:'Reusable test',category:'email',subjectTemplate:'{{name}} request',bodyTemplate:'Send {{document}} by {{dueDate}}.',columns:{email:'Email',name:'Name',document:'Document',dueDate:'Due date'}};
const item={id:'test-package',version:1,title:recipe.title,description:recipe.description,ownerId:'author',updatedAt:1,mine:false};
let body={item,recipe};
const distribution=createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'test',fetchImpl:async()=>new Response(JSON.stringify(body))});
assert.deepEqual((await distribution.detail(item.id)).recipe,recipe,'valid portable content is retained');
for(const unsafe of [
 {...recipe,command:'run-untrusted-code'},
 {...recipe,bodyTemplate:'Contact private-person@example.test'},
 {...recipe,description:'https://private.example.test/secret'},
 {...recipe,bodyTemplate:'refresh_token synthetic-hidden-value'},
 {...recipe,bodyTemplate:'{{unsupported}}'},
 {...recipe,columns:{...recipe.columns,privateSheet:'synthetic-sheet'}},
]) {
 body={item,recipe:unsafe};
 await assert.rejects(()=>distribution.detail(item.id),error=>{
  assert.doesNotMatch(error.message,/private-person|private\.example|synthetic-hidden|run-untrusted/,'errors never echo remote payloads');
  return /스토어/.test(error.message);
 });
}
body={item:{...item,id:'different-package'},recipe};
await assert.rejects(()=>distribution.detail(item.id),/스토어/,'wrong item cannot replace the selected package');
body={item:{...item,version:2},recipe};
await assert.rejects(()=>distribution.detail(item.id),/스토어/,'unknown wire version cannot be accepted as v1');
console.log('PASS store download: unsafe or mismatched packages rejected before installation');
const malformed=createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'test',fetchImpl:async()=>new Response('{"private-token":"synthetic-hidden-value" broken')});
await assert.rejects(()=>malformed.detail(item.id),error=>/스토어 응답/.test(error.message)&&!error.message.includes('synthetic-hidden'));
const {createAutomationPanelController}=await import('../src/automationPanel.ts');
let executions=0;
const neverExecute=async()=>{executions++;throw Error('installation must not execute');};
const inspector=createAutomationPanelController({store:distribution,runtime:{connect:neverExecute,disconnect:neverExecute,status:neverExecute,readSheet:neverExecute,preview:neverExecute,send:neverExecute},confirmSend:neverExecute,emit:()=>{}});
const privateSheet='https://docs.google.com/spreadsheets/d/'+'s'.repeat(30);
await inspector.handle({kind:'edit',recipe:{...recipe,title:'Existing local work'},sheetUrl:privateSheet,range:'A1:D21'});
body={item,recipe:{...recipe,command:'unexpected-code'}};
await inspector.handle({kind:'import',id:item.id});
assert.equal(inspector.view().recipe.title,'Existing local work','refused package leaves existing work intact');
assert.equal(inspector.view().sheetUrl,privateSheet,'refused package leaves local configuration intact');
assert.match(inspector.view().error,/스토어/);
body={item,recipe};
await inspector.handle({kind:'import',id:item.id});
assert.deepEqual(inspector.view().recipe,recipe);
assert.equal(inspector.view().sheetUrl,'','valid import still requires recipient setup');
assert.equal(inspector.view().preview,null);
assert.equal(executions,0,'neither valid nor invalid installation executes Google or sends mail');
console.log('PASS inspector install: rejected data preserves work; valid import requires private setup and never executes');

for(const result of [{ok:false},{},null]) {
 const badReceipt=createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'synthetic',fetchImpl:async()=>new Response(JSON.stringify(result))});
 await assert.rejects(badReceipt.unpublish('owned'),/철회 결과/);
}
const goodReceipt=createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'synthetic',fetchImpl:async(url,init)=>{assert.equal(init.method,'DELETE');return new Response('{"ok":true}');}});
assert.deepEqual(await goodReceipt.unpublish('owned'),{ok:true});
console.log('PASS withdrawal receipt: HTTP200 without explicit success cannot report removal');

// A terminal withdrawn request can be replaced only by a newly reviewed action.
const {AutomationPublicationWithdrawnError}=await import('../src/automationStoreClient.ts');
const publicationIds=[];let wasWithdrawn=false;
const recoveryInspector=createAutomationPanelController({runtime:{},confirmSend:async()=>false,emit:()=>{},store:{
 list:async()=>({items:[]}),publish:async(_recipe,id)=>{publicationIds.push(id);if(wasWithdrawn)throw new AutomationPublicationWithdrawnError();return{item};},
}});
await recoveryInspector.handle({kind:'publish',reviewed:true});const firstRequest=publicationIds.at(-1);
wasWithdrawn=true;await recoveryInspector.handle({kind:'publish',reviewed:true});
assert.match(recoveryInspector.view().error,/이전에 철회/);assert.equal(publicationIds.at(-1),firstRequest);
wasWithdrawn=false;await recoveryInspector.handle({kind:'publish',reviewed:false});assert.equal(publicationIds.length,2);
await recoveryInspector.handle({kind:'publish',reviewed:true});assert.notEqual(publicationIds.at(-1),firstRequest);
console.log('PASS inspector republish: withdrawn request replacement requires renewed review');

const {createHash}=await import('node:crypto');
const release={...item,version:2,formatVersion:1,familyId:'root',parentId:'root',recipeSha256:createHash('sha256').update(JSON.stringify(recipe)).digest('hex')};
body={item:release,recipe};
assert.deepEqual((await distribution.detail(item.id)).recipe,recipe,'release number differs from supported package format');
for(const damaged of [{...release,formatVersion:2},{...release,recipeSha256:'0'.repeat(64)},{...release,parentId:null},{...release,version:1.5},{...release,familyId:''},{...release,sourceId:12},{...release,sourceId:'https://private.invalid'}]) {
 body={item:damaged,recipe};await assert.rejects(distribution.detail(item.id),/스토어/);
}
let route,posted;
const versionsClient=createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'synthetic',fetchImpl:async(url,init)=>{route=url;if(init.body)posted=JSON.parse(init.body);return new Response(JSON.stringify({items:[release],item:{...release,sourceId:posted?.sourceId??null}}));}});
await versionsClient.versions('root');assert.equal(route,'https://service.example.test/v1/automations/root/versions');
await versionsClient.publish(recipe,'new-version','root');assert.equal(posted.parentId,'root');
console.log('PASS version downloads: explicit format, digest and parent verification; version history and publication bind exact parent');

await versionsClient.publish(recipe,'new-fork',undefined,'exact-source');assert.equal(posted.sourceId,'exact-source');assert.equal(posted.parentId,undefined);

const lostOrigin=createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'synthetic',fetchImpl:async()=>new Response(JSON.stringify({item}))});
await assert.rejects(lostOrigin.publish(recipe,'fork-review',undefined,'exact-source'),/출처 저장/,'a server that drops provenance cannot report success');
const {readAutomationDraft,automationDraftValue}=await import('../src/automationDraft.ts');
const origin={id:item.id,title:recipe.title,version:1};
const restored=readAutomationDraft(JSON.parse(JSON.stringify(automationDraftValue(recipe,origin))));
assert.deepEqual(restored,{recipe,source:origin},'restart preserves recipe and origin together');
assert.deepEqual(readAutomationDraft(recipe),{recipe,source:null},'legacy drafts are usable without invented origins');
await inspector.handle({kind:'edit',recipe:{...recipe,title:'Recipient edit'},sheetUrl:privateSheet,range:'A1:D21'});
assert.deepEqual(inspector.view().source,origin,'editing a downloaded recipe retains its origin');
inspector.importRecipe(recipe);assert.equal(inspector.view().source,null,'a local file replaces the old origin');
assert.throws(()=>readAutomationDraft({schema:'hps-local-automation-draft/1',recipe,source:{...origin,id:''}}),/출처 기록/,'damaged provenance must not silently publish as original work');
console.log('PASS fork provenance: exact-source receipt, atomic local persistence, legacy compatibility and deliberate local replacement');
