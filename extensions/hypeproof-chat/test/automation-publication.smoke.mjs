import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishAutomationRecipe } from '../src/automationPublication.ts';
import { createAutomationStoreClient, AutomationPublicationWithdrawnError } from '../src/automationStoreClient.ts';
import { createAutomationLedger } from '../src/automationLedger.ts';
const storageRoot = await mkdtemp(join(tmpdir(), 'hps-publication-'));
const namespace = 'a'.repeat(64);
const recipe = { schema:'hps-email-automation/1', category:'email', title:'자료 요청', description:'공유 시험', subjectTemplate:'{{name}}님', bodyTemplate:'{{document}}를 {{dueDate}}까지', columns:{email:'Email',name:'Name',document:'Document',dueDate:'Due date'} };
const journal = join(storageRoot, 'email-automation', namespace, 'publications.json');
const sent = [], records = new Map();
let allowed = true, loseResponse = false, conflict = false;
const store = createAutomationStoreClient({baseUrl:'https://service.example.test',getToken:async()=>'synthetic',fetchImpl:async(_url, init)=>{
  const {requestId} = JSON.parse(init.body); sent.push(requestId);
  if(conflict)return new Response(JSON.stringify({error:{code:'request_conflict',private:'must-not-echo'}}),{status:409});
  const previous=records.get(requestId);
  if(previous?.withdrawn)return new Response(JSON.stringify({error:{code:'publication_unpublished'}}),{status:409});
  const item=previous??{id:`publication-${records.size+1}`,title:recipe.title};records.set(requestId,item);
  if(loseResponse){loseResponse=false;throw Error('response lost');}
  return new Response(JSON.stringify({item}));
}});
const attempt=()=>publishAutomationRecipe({storageRoot,namespace,store,authorize:async()=>{if(!allowed)throw Error('revoked');}},recipe);
try {
  const first=await attempt(); const original=sent.at(-1);
  assert.equal((await attempt()).item.id,first.item.id,'retry reuses original publication');
  records.get(original).withdrawn=true;
  await assert.rejects(attempt(),AutomationPublicationWithdrawnError);
  assert.equal(records.size,1,'withdrawal never triggers an automatic replacement POST');
  const saved=JSON.parse(await readFile(journal,'utf8'));const replacement=Object.values(saved)[0];
  assert.notEqual(replacement,original);assert.equal(JSON.stringify(saved).includes(recipe.title),false);
  allowed=false;await assert.rejects(attempt(),/revoked/);assert.equal(sent.at(-1),original);
  allowed=true;loseResponse=true;await assert.rejects(attempt(),/response lost/);
  assert.equal(sent.at(-1),replacement);assert.equal(records.size,2);
  // A fresh helper invocation reloads the durable ID, including after an unknown response.
  assert.equal((await attempt()).item.id,'publication-2');assert.equal(records.size,2);
  assert.equal(records.get(original).withdrawn,true,'old publication stays withdrawn');
  console.log('PASS publication lifecycle: withdrawal stays hidden; reapproval can republish; response loss/restart retain one new intent');

  const before=await readFile(journal,'utf8');conflict=true;
  await assert.rejects(attempt(),error=>!error.message.includes('must-not-echo')&&!(error instanceof AutomationPublicationWithdrawnError));
  assert.equal(await readFile(journal,'utf8'),before,'ordinary conflicts never rotate the request');conflict=false;
  const ledger=createAutomationLedger(storageRoot,namespace);const ledgerRecords={['b'.repeat(64)]:{id:'b'.repeat(64),status:'unknown'}};
  await ledger.save(ledgerRecords);let unlock,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const locked=ledger.withLock(async()=>{entered();await new Promise(resolve=>{unlock=resolve;});});await ready;
  await assert.rejects(attempt(),/다른 창/);unlock();await locked;
  assert.deepEqual(await ledger.load(),ledgerRecords,'publication never changes send outcomes');
  await writeFile(journal,'broken',{mode:0o600});const count=sent.length;
  await assert.rejects(attempt(),/게시 요청 기록/);assert.equal(sent.length,count,'corrupt journal fails before dispatch');
  console.log('PASS publication journal: conflict isolation, concurrent-window guard, ledger preservation and fail-closed corruption');
} finally { await rm(storageRoot,{recursive:true,force:true}); }
