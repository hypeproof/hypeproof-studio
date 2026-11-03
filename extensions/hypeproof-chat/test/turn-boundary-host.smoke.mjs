import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
const root=await mkdtemp(join(tmpdir(),'hps-turn-render-error-'));
const original=console.error,logs=[];
try{
 const f=await createTaskHarness(root);f.h.rememberAnswerTurn('answer','actual-stream-id');
 console.error=(...args)=>logs.push(args.join(' '));
 const report={type:'webviewError',message:'turn render error (Error)',stack:'',componentStack:''};
 await f.handle(f.scoped({...report,messageId:'answer#2'}));
 assert.match(logs.at(-1),/messageId: answer#2; turnId: actual-stream-id/);
 await f.handle(f.scoped({...report,messageId:'historical#2'}));assert.match(logs.at(-1),/turnId: unknown/);
 await f.handle(f.scoped({...report,messageId:'bad\ninjected'}));assert.ok(!logs.at(-1).includes('injected'));
 const count=logs.length;await f.handle({...f.scoped(report),taskId:'wrong-task'});assert.equal(logs.length,count,'stale task cannot create a current-turn error record');
}finally{console.error=original;await rm(root,{recursive:true,force:true})}
console.log('PASS actual provider error logging: current stream correlation, historical unknown, safe identifier and task ownership');
