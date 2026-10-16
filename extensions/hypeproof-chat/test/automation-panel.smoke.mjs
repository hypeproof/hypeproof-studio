import assert from 'node:assert/strict';
import { createAutomationPanelController, spreadsheetIdFromInput } from '../src/automationPanel.ts';
import { defaultAutomationRecipe } from '../src/automationProtocol.ts';
const messages = [{ id: 'row1', to: 'learner@example.test', subject: '서류 제출 안내', body: '준비한 서류를 보내 주세요.' }];
let sent = 0, confirmed = 0, approved = false, fail = false;
const publications = [];
const controller = createAutomationPanelController({
  runtime: { status: async () => ({connected:true,configured:true}),connect:async()=>{},disconnect:async()=>{},readSheet:async()=>[['이메일','이름','서류','기한']],preview:()=>({id:'preview1',createdAt:Date.now(),messages}),send:async()=>{sent++; if(fail)throw new Error('응답을 확인하지 못했어요.');return {records:[{id:'row1',status:'sent'}]};} },
  store: {list:async()=>({items:[]}),detail:async()=>({item:{id:'entry'},recipe:defaultAutomationRecipe()}),publish:async(recipe,id)=>{publications.push({recipe,id});return {item:{id:'entry'}};},unpublish:async()=>({ok:true})},
  confirmSend:async()=>{confirmed++;return approved;},emit:()=>{},
});
const edit = () => controller.handle({kind:'edit',recipe:defaultAutomationRecipe(),sheetUrl:'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaa/edit',range:'A1:D21'});
await edit();await controller.handle({kind:'preview'});
await controller.handle({kind:'send',previewId:'wrong',reviewed:true});
await controller.handle({kind:'send',previewId:'preview1',reviewed:false});
assert.equal(sent,0);assert.equal(confirmed,0);
await controller.handle({kind:'send',previewId:'preview1',reviewed:true});assert.equal(sent,0);assert.equal(confirmed,1);
approved=true;fail=true;
await controller.handle({kind:'send',previewId:'preview1',reviewed:true});
assert.equal(sent,1);assert.equal(controller.view().records[0].status,'unknown');
await controller.handle({kind:'send',previewId:'preview1',reviewed:true});assert.equal(sent,1,'network ambiguity cannot produce a blind resend');
await edit();assert.equal(controller.view().preview,null,'editing invalidates approval target');
await controller.handle({kind:'send',previewId:'preview1',reviewed:true});assert.equal(sent,1);
await controller.handle({kind:'publish',reviewed:false});assert.equal(publications.length,0);
await controller.handle({kind:'publish',reviewed:true});await controller.handle({kind:'publish',reviewed:true});
assert.equal(publications[0].id,publications[1].id,'publication retries reuse an idempotency key');
assert.equal('sheetUrl' in publications[0].recipe,false);assert.equal('rows' in publications[0].recipe,false);
await controller.handle({kind:'import',id:'entry'});assert.equal(controller.view().sheetUrl,'','import cannot inherit another sheet binding');
assert.throws(()=>spreadsheetIdFromInput('https://evil.test/spreadsheets/d/aaaaaaaaaaaaaaaaaaaa'));
console.log('PASS automation panel: approval, stale preview, uncertain send, publication idempotency, private input boundary');
