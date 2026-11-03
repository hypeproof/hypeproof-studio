import {readDesignFile} from './lib/design-token-values.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { takeawayFile as readTakeawayFile, takeawayOwnedFiles, takeawayTask, takeawayPreview, writeTakeaway, TAKEAWAY_EXCLUSIONS } from '../src/workTakeaway.ts';
const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'takeaway-')));
try {
 const source=path.join(base,'source'),target=path.join(base,'target');fs.mkdirSync(source);fs.mkdirSync(target);
 const owned={};const hash=b=>createHash('sha256').update(b).digest('hex');
 const takeawayFile=(root,file,wiki='wiki',secrets=[])=>readTakeawayFile(root,file,wiki,secrets,owned);
 const put=(name,text='original learner bytes')=>{const f=path.join(source,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);owned[name]=hash(text);return f;};
 const file=put('내 작품.html'),brain=put('wiki/notes/day.md','brain bytes');
 const original=fs.readFileSync(file),brainOriginal=fs.readFileSync(brain);
 const items=[takeawayFile(source,file),takeawayFile(source,brain),takeawayTask('내 작업',[{role:'user',content:'질문'},{role:'assistant',content:'답변'},{role:'system',content:'INSTRUCTOR_ONLY'},{role:'tool',content:'RUNTIME_SECRET'}]),...TAKEAWAY_EXCLUSIONS];
 assert.deepEqual(items.slice(0,3).map(i=>i.category),['파일','팀 브레인','작업']);
 const preview=takeawayPreview(items);for(const label of ['가져가는 것','남는 것','파일','작업','팀 브레인','수업 자료','강사 메모','수업 기억','원본은 삭제하지 않아요']) assert.ok(preview.includes(label),label);
 const result=writeTakeaway(target,items,()=>true);
 assert.deepEqual(result.results.map(r=>r.status),['옮김','옮김','옮김','제외','제외','제외','제외']);assert.ok(result.results.every(r=>r.reason.length>0));
 assert.deepEqual(fs.readFileSync(path.join(result.directory,'내 작품.html')),original);assert.deepEqual(fs.readFileSync(path.join(result.directory,'wiki/notes/day.md')),brainOriginal);
 assert.equal(fs.readFileSync(path.join(result.directory,'작업-기록/3.txt'),'utf8'),'나\n질문\n\nAI\n답변');
 assert.deepEqual(fs.readFileSync(file),original);assert.deepEqual(fs.readFileSync(brain),brainOriginal);
 const retry=writeTakeaway(target,items,()=>true);assert.notEqual(retry.directory,result.directory);assert.deepEqual(fs.readFileSync(path.join(result.directory,'내 작품.html')),original);
 const failed=writeTakeaway(target,items,()=>false);assert.equal(failed.results[0].status,'실패');assert.match(failed.results[0].reason,/원본은 그대로/);assert.deepEqual(fs.readdirSync(failed.directory),[]);assert.deepEqual(fs.readFileSync(file),original);
 const saved=fs.writeFileSync;fs.writeFileSync=(f,...args)=>{if(String(f).endsWith('내 작품.html'))throw Error('disk full');return saved(f,...args);};
 syncBuiltinESMExports();
 let partial;try{partial=writeTakeaway(target,items,()=>true);}finally{fs.writeFileSync=saved;syncBuiltinESMExports();}
 assert.deepEqual(partial.results.slice(0,3).map(r=>r.status),['실패','옮김','옮김']);assert.deepEqual(fs.readFileSync(file),original);
 for(const name of ['.env.txt','nested/.config/a.txt','materials/a.md','instructor-notes/a.md','class-memory/a.md','수업 자료/a.md','강사 메모/a.md','수업 기억/a.md','credentials.txt','notes/a.md','memory/a.md','node_modules/x.js','config.json','ｓｅｃｒｅｔ.txt','evil\u202e.txt']) assert.equal(takeawayFile(source,put(name)).bytes,undefined,name);
 assert.equal(takeawayFile(source,put('custom-brain/a.md'),'custom-brain').category,'팀 브레인');
 const outside=path.join(base,'outside.txt');fs.writeFileSync(outside,'outside');owned['../outside.txt']=hash('outside');assert.equal(takeawayFile(source,outside).bytes,undefined);
 fs.symlinkSync(outside,path.join(source,'linked.txt'));owned['linked.txt']=hash('outside');assert.equal(takeawayFile(source,path.join(source,'linked.txt')).bytes,undefined);
 fs.symlinkSync(base,path.join(source,'linked-dir'));owned['linked-dir/outside.txt']=hash('outside');assert.equal(takeawayFile(source,path.join(source,'linked-dir/outside.txt')).bytes,undefined);
 const huge=put('large.txt');fs.truncateSync(huge,10*1024*1024+1);owned['large.txt']=hash(fs.readFileSync(huge));assert.ok(!takeawayFile(source,huge).bytes);
 for(const secret of ['Bearer abcdef','-----BEGIN RSA PRIVATE KEY-----','api_key=abcdef','synthetic-active-credential']){
  const known=secret==='synthetic-active-credential'?[secret]:[];
  assert.equal(takeawayFile(source,put('ordinary.md',secret),'wiki',known).bytes,undefined);
  assert.equal(takeawayTask('task',[{role:'user',content:secret}],known).bytes,undefined);
 }
 assert.equal(takeawayTask('empty',[]).bytes,undefined);
 assert.ok(!takeawayTask('huge',[{role:'user',content:'x'.repeat(10*1024*1024+1)}]).bytes);
 assert.equal(readTakeawayFile(source,file).bytes,undefined);
 fs.writeFileSync(file,'changed after recorded hash');assert.equal(takeawayFile(source,file).bytes,undefined);
 const alias=path.join(base,'source-link');fs.symlinkSync(source,alias);assert.equal(takeawayFile(alias,path.join(alias,'wiki/notes/day.md')).bytes,undefined);
 const ledger={stale:false,events:[{path:'a',kind:'ai_created',sha256:'hash'},{path:'b',kind:'studio_created',sha256:'other'},{path:'b',kind:'ai_changed',sha256:'other'}]};
 assert.deepEqual(takeawayOwnedFiles(ledger),{a:'hash'});assert.deepEqual(takeawayOwnedFiles({...ledger,stale:true}),{});
 assert.deepEqual(takeawayOwnedFiles({...ledger,events:[...ledger.events,{path:'a',kind:'unknown',sha256:'replacement'}]}),{});
 assert.deepEqual(takeawayOwnedFiles({...ledger,events:[...ledger.events,{path:'a',kind:'studio_changed',sha256:'replacement'}]}),{});
 assert.deepEqual(takeawayOwnedFiles({...ledger,stalePaths:['a']}),{});
 assert.deepEqual(takeawayOwnedFiles({...ledger,events:[...ledger.events,{path:'a',kind:'removed'}]}),{});
 assert.deepEqual(takeawayOwnedFiles({...ledger,events:[...ledger.events,{path:'a',kind:'removed'},{path:'a',kind:'ai_created',sha256:'new'}]}),{a:'new'});
 const unavailable=writeTakeaway(path.join(base,'missing'),items,()=>true);assert.equal(unavailable.results[0].status,'실패');assert.equal(unavailable.results[3].status,'제외');
 assert.equal(takeawayTask('quoted',[{role:'user',content:'{"access_token":"synthetic"}'}]).bytes,undefined);

 // Exclusive create (wx): a duplicate target must report 실패 and leave the first copy untouched.
 {const dup=takeawayFile(source,put('dup.md','first learner bytes'));const clash=writeTakeaway(target,[dup,{...dup,bytes:Buffer.from('REPLACEMENT')}],()=>true);
  assert.deepEqual(clash.results.map(r=>r.status),['옮김','실패'],'second write to the same path must not replace');
  assert.equal(fs.readFileSync(path.join(clash.directory,'dup.md'),'utf8'),'first learner bytes');
  // Copies are private to the learner (0600), never group/world readable regardless of umask.
  assert.equal(fs.statSync(path.join(clash.directory,'dup.md')).mode&0o777,0o600,'copy mode');}
 // O_NOFOLLOW: a path swapped for a symlink after the lstat walk must not be read through.
 {const raced=put('raced.md','safe bytes');const secretFile=path.join(base,'raced-outside.md');fs.writeFileSync(secretFile,'outside bytes');owned['raced.md']=hash('outside bytes');
  const realLstat=fs.lstatSync;let swapped=false;fs.lstatSync=(f,...a)=>{const r=realLstat(f,...a);if(!swapped&&String(f)===raced){swapped=true;fs.unlinkSync(raced);fs.symlinkSync(secretFile,raced);}return r;};syncBuiltinESMExports();
  let item;try{item=readTakeawayFile(source,raced,'wiki',[],owned);}finally{fs.lstatSync=realLstat;syncBuiltinESMExports();}
  assert.ok(swapped,'the swap happened between the lstat walk and the open');assert.equal(item.bytes,undefined,'swapped-in symlink is refused at open');assert.match(item.reason,/읽을 수 없어요/,'refused by the open, not by the earlier walk');}
 // Labels are sanitised: newline/bidi/NUL never reach the preview or the result list.
 {const unsafe=new RegExp('['+['\\u0000-\\u001f','\\u007f-\\u009f','\\u2028-\\u202e','\\u2066-\\u2069'].join('')+']');
  for(const name of ['a\nb.txt','evil‮txt.md','nul\u0000.md']){const item=readTakeawayFile(source,path.join(source,name),'wiki',[],owned);assert.equal(item.bytes,undefined);assert.doesNotMatch(item.label,unsafe,JSON.stringify(name));assert.match(item.label,/�/);}
  assert.doesNotMatch(takeawayTask('t\n‮itle',[{role:'user',content:'q'}]).label,unsafe);
  const hostile=writeTakeaway(target,[{label:'x',category:'파일',bytes:Buffer.from('b'),relativePath:'x‮\ny.txt',reason:'r'}],()=>true);
  assert.doesNotMatch(hostile.results[0].reason,unsafe,'result path label sanitised');}
 console.log('work takeaway: copy outcomes, source preservation, exclusions, credentials, confinement PASS');
}finally{fs.rmSync(base,{recursive:true,force:true});}

const css=readDesignFile(new URL('../webview-ui/src/styles.css',import.meta.url),'utf8');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),body:m[2]}));
const rule=(selector)=>rules.find(r=>r.selector===selector)?.body??'';
assert.match(rule('.hps-activity-status button'),/min-height:\s*44px/);
assert.match(rule('.hps-activity-status button'),/font-size:\s*var\(--hp-font-caption\)/);
assert.match(rule('.hps-activity-status-actions'),/flex-wrap:\s*wrap/);
assert.match(rule('.hps-activity-status button:focus-visible'),/outline:.*solid var\(--hp-ring-focus-default\)/);
assert.ok(rules.some(r=>r.selector==='.hps-activity-status' && /border-color:\s*CanvasText/.test(r.body)));
console.log('takeaway: both seats, default-off UI, existing 44px/wrapping/focus/forced-color guards PASS');
