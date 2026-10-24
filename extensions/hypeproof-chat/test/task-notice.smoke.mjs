// Event identity, cooldown and completion races over the actual production controller.
import assert from 'node:assert/strict';
import {TaskNotifier} from '../src/taskNotice.ts';
const tick=()=>new Promise(r=>setImmediate(r));
let now=1000;const shows=[],hides=[],reveals=[],answers=[];
const n=new TaskNotifier({show:r=>{shows.push(r);return new Promise(resolve=>answers.push(resolve));},hide:id=>hides.push(id),reveal:scope=>reveals.push(scope)},()=>now);
const input={scope:'["activity-a","task-a"]',status:'ok',chatVisible:false,seat:{activity_kind:'personal'}};
assert.equal(n.turnEnded({...input,chatVisible:true}),null);
assert.equal(n.turnEnded({...input,seat:{activity_kind:'classroom'}}),null);
assert.equal(n.turnEnded({...input,status:'aborted'}),null);
assert.equal(n.turnEnded(input),'done');assert.match(shows[0].task,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(shows).includes('activity-a'));
answers[0]({clicked:false});await tick();now+=100;assert.equal(n.turnEnded(input),null,'dismiss does not reset 10s');
n.release();assert.equal(n.turnEnded(input),null,'release does not reset cooldown');
now=11000;assert.equal(n.turnEnded(input),'done');
const other={...input,scope:'["activity-a","task-b"]'};assert.equal(n.turnEnded(other),'done');assert.deepEqual(hides,[shows[1].id]);
answers[1]({clicked:true});await tick();assert.deepEqual(reveals,[],'replaced notice cannot route');
answers[2]({clicked:true});await tick();assert.deepEqual(reveals,[other.scope],'click routes captured task');
now+=10000;const cancel=n.approvalStarted(input,true);assert.equal(shows.at(-1).kind,'browserApproval');cancel();answers.at(-1)({clicked:true});await tick();assert.equal(reveals.length,1,'resolved approval cannot route');
now+=10000;n.approvalStarted(input,false);assert.equal(shows.at(-1).kind,'approval');n.release();answers.at(-1)({clicked:true});await tick();assert.equal(reveals.length,1,'visibility/disposal cancellation ignores late click');
for(const seat of [null,{}, {lesson:{}},{activity_kind:'classroom'}]){n.approvalStarted({...input,seat});}assert.equal(shows.length,5);
// Fresh scope per call so the 10 s cooldown cannot mask a missing gate.
{const before=shows.length;let i=0;
 for(const seat of [null,{},{lesson:{}},{lesson_binding:{enforced:true}},{activity_kind:'classroom'}])n.approvalStarted({...input,scope:`["activity-a","quiet-${i++}"]`,seat});
 n.approvalStarted({...input,scope:'["activity-a","quiet-instructor"]',instructor:true});
 n.approvalStarted({...input,scope:'["activity-a","quiet-visible"]',chatVisible:true});
 assert.equal(shows.length,before,'quiet seats, instructor and a visible chat raise no approval notice (fresh scopes)');
 n.approvalStarted({...input,scope:'["activity-a","loud"]'});assert.equal(shows.length,before+1,'positive control: personal hidden approval notifies');}
console.log('PASS task notice: quiet seats, visibility, aborted turns, cooldown, task identity, replacement and approval cancellation');
