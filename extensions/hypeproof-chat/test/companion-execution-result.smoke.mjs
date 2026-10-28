import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCompanionExecutionResult as parse} from '../src/companionExecutionResult.ts';
import {parseCompanionAuthoringResult} from '../src/companionAuthoringResult.ts';
const hash='a'.repeat(64),base={schema:'hps-companion-execution-result/1',requestId:'intent.same',requestHash:hash,state:'completed',code:'normal_turn_measured',turnId:'12345678-1234-1234-1234-123456789abc',artifactVersion:'b'.repeat(64)};
const read=v=>parse(JSON.stringify(v),base.requestId,hash);
test('only exact measured terminal receipts establish execution; nonterminal remains distinct',()=>{
 for(const state of ['completed','failed'])assert.equal(read({...base,state}).state,state);
 for(const state of ['denied','outcome_unknown']){const {turnId,artifactVersion,...minimal}=base;const value=read({...minimal,state,code:'execution_reconciliation_required'});assert.equal(value.state,state);assert.equal(value.turnId,undefined);assert.ok(Object.isFrozen(value));}
 assert.equal(parseCompanionAuthoringResult(JSON.stringify(base),base.requestId,hash),null);
});
test('mismatched request, hash, schema, missing proof, unknown fields and executable payloads are refused',()=>{
 for(const changed of [{requestId:'another'},{requestHash:'c'.repeat(64)},{schema:'hps-companion-execution-result/2'},{state:'imported_draft'},{code:'relay_received'},{turnId:null},{turnId:'not-uuid'},{artifactVersion:null},{artifactVersion:'x'},{executionAuthorized:true},{text:'<script>run()</script>'},{state:'outcome_unknown'}])assert.equal(read({...base,...changed}),null,JSON.stringify(changed));
 for(const key of Object.keys(base)){const copy={...base};delete copy[key];assert.equal(read(copy),null,key);}
 assert.equal(parse(' '.repeat(2033),base.requestId,hash),null);assert.equal(parse('null',base.requestId,hash),null);assert.equal(parse('[]',base.requestId,hash),null);
 const legacy={schema:'hps-companion-authoring-result/1',requestId:base.requestId,requestHash:hash,outcome:{state:'imported_draft',code:'desktop_draft_imported',executionAuthorized:false}};
 assert.equal(read(legacy),null);assert.equal(parseCompanionAuthoringResult(JSON.stringify(legacy),base.requestId,hash).outcome.state,'imported_draft');
});
