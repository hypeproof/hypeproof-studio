import assert from 'node:assert/strict';
import { mkdtemp,readFile,stat,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAutomationLedger, automationNamespace } from '../src/automationLedger.ts';
const directory=await mkdtemp(join(tmpdir(),'hps-automation-ledger-'));
const scope=automationNamespace('https://service.example.test/v1','a'.repeat(64));
const ledger=createAutomationLedger(directory,scope),other=createAutomationLedger(directory,scope);
const key='b'.repeat(64),id='c'.repeat(64),file=join(directory,'email-automation',scope,'ledger.json');
try{
await ledger.withLock(async()=>{await ledger.save({[key]:{id,status:'sending',error:'sensitive provider detail'}});await assert.rejects(()=>other.withLock(async()=>{}),/다른 창/);});
assert.deepEqual(await other.load(),{[key]:{id,status:'sending'}});assert.doesNotMatch(await readFile(file,'utf8'),/sensitive/);
if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
await other.withLock(async()=>{await other.save({[key]:{id,status:'sent'}});});assert.equal((await ledger.load())[key].status,'sent');
await writeFile(file,'{broken');await assert.rejects(()=>ledger.load(),/기록/);
assert.notEqual(scope,automationNamespace('https://other.example.test','a'.repeat(64)));
console.log('PASS durable ledger: exclusive send, restart read, atomic update, private permissions, corruption failclosed');
}finally{await rm(directory,{recursive:true,force:true});}
