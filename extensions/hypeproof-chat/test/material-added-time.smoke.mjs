import assert from 'node:assert/strict';
import {materialsView} from '../src/activityMaterials.ts';
import {provenanceView} from '../src/artifactProvenance.ts';
const created=1700000000000, modified=created+60000;
const ledger={version:1,baseline:{'자료/요약.md':'b'},stale:false,stalePaths:[],events:[{path:'자료/요약.md',kind:'ai_created',at:created,sha256:'a'},{path:'자료/요약.md',kind:'ai_changed',at:modified,sha256:'b'}]};
const current=provenanceView(ledger).entries[0];assert.equal(current.createdAt,created,'later edits do not replace the original creation time');assert.equal(current.at,modified);
const afterRemoval=provenanceView({...ledger,events:[...ledger.events,{path:'자료/요약.md',kind:'removed',at:modified+1},{path:'자료/요약.md',kind:'ai_created',at:modified+2,sha256:'b'}]}).entries[0];assert.equal(afterRemoval.createdAt,modified+2,'same name after removal has a new lifetime');
assert.equal(provenanceView({...ledger,events:[ledger.events[1]]}).entries[0].createdAt,undefined,'a truncated history with only an edit cannot invent creation');
assert.equal(provenanceView({...ledger,stale:true}).entries[0].createdAt,undefined,'unconfirmed current file does not claim creation');
const sources={manifest:{version:1,items:[{id:'one',kind:'file',ref:'자료/내자료.md',addedAt:created+5},{id:'two',kind:'url',ref:'https://example.com',addedAt:created+10}],hidden:[]},folderFiles:['자료/내자료.md','자료/요약.md'],provenance:()=>current.kind,provenanceAddedAt:()=>current.createdAt,inbox:[{object_id:'teacher',revision:1,kind:'material',title:'강사 자료',received_at:created+20}],selected:new Set(),scope:'scope'};
const view=materialsView(sources);assert.equal(view.items.find(i=>i.origin==='instructor').addedAt,created+20);assert.equal(view.items.find(i=>i.id==='me:one').addedAt,created+5);assert.equal(view.items.find(i=>i.id==='me:two').addedAt,created+10);assert.equal(view.items.find(i=>i.origin==='ai').addedAt,created);
for(const at of [undefined,NaN,Infinity,-1,0,1e20]){const invalid=materialsView({...sources,provenanceAddedAt:()=>at});assert.equal(invalid.items.find(i=>i.origin==='ai').addedAt,undefined,'invalid timestamp omitted');}
assert.equal(materialsView({...sources,provenance:()=>undefined}).items.some(i=>i.origin==='ai'),false,'timestamp never grants AI origin without provenance');
console.log('PASS materials added time: recorded origin event, modification, new lifetime, missing/invalid history and unchanged provenance gate');
