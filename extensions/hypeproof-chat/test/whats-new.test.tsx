// CGP-SHELL-R-035 — "새로운 기능" model: shipped learner lines, text hygiene and caps, the
// fresh-install vs update baseline, once-per-notes offer and the shown record.
import assert from 'node:assert/strict';
import {cleanNoteLine,learnerNotes,markWhatsNewShown,recordWhatsNewBaseline,whatsNewOffer,WHATS_NEW_KEY,WHATS_NEW_MAX_CHARS,WHATS_NEW_MAX_ITEMS} from '../src/whatsNew';
import {LEARNER_RELEASE_NOTES} from '../src/learnerReleaseNotes';
const ch=(n:number)=>String.fromCodePoint(n);
const memento=(seed:Record<string,unknown>={})=>{const data=new Map(Object.entries(seed));return {data,get:<T,>(k:string)=>data.get(k) as T|undefined,update:async(k:string,v:unknown)=>{data.set(k,v);},keys:()=>[...data.keys()]};};

// The shipped lines are valid as written: 1-3 Korean lines of at most 40 characters, nothing dropped.
const shipped=learnerNotes(LEARNER_RELEASE_NOTES)!;
assert.ok(shipped,'shipped notes parse');
assert.deepEqual(shipped.items,[...LEARNER_RELEASE_NOTES.items],'no shipped line is dropped by the caps or hygiene');
assert.ok(shipped.items.length>=1&&shipped.items.length<=WHATS_NEW_MAX_ITEMS);
for(const line of shipped.items){assert.ok([...line].length<=WHATS_NEW_MAX_CHARS,line);assert.match(line,/[가-힣]/,'learner copy is Korean');}
for(const banned of ['역량','점수','FRAMING','JUDGMENT','VERIFY'])assert.ok(!shipped.items.join(' ').includes(banned),'no capability or score label');

// Hygiene: invisible, bidi and control characters removed; separators fold; NFC; markup stays text.
assert.equal(cleanNoteLine(`a${ch(0x202e)}b${ch(0x2066)}c${ch(0x200b)}d${ch(0xfeff)}e${ch(7)}f${ch(0xe0041)}g${ch(0x3164)}h`),'abcdefgh');
assert.equal(cleanNoteLine(`줄1${ch(0x2028)}줄2${ch(0x2029)}\n\t줄3`),'줄1 줄2 줄3');
assert.equal(cleanNoteLine(ch(0x1112)+ch(0x1161)+ch(0x11ab)),ch(0xd55c),'decomposed jamo become NFC');
assert.equal(cleanNoteLine('<img src=x>'),'<img src=x>','markup is text for React to escape');
assert.equal(cleanNoteLine('가'.repeat(WHATS_NEW_MAX_CHARS)),'가'.repeat(WHATS_NEW_MAX_CHARS));
assert.equal(cleanNoteLine('가'.repeat(WHATS_NEW_MAX_CHARS+1)),'','over 40 characters: dropped, never cut');
assert.equal(cleanNoteLine('😀'.repeat(WHATS_NEW_MAX_CHARS)),'😀'.repeat(WHATS_NEW_MAX_CHARS),'the cap counts characters, not UTF-16 units');
assert.equal(cleanNoteLine(42),'');

// Notes: safe id, at most three valid lines, otherwise null.
assert.deepEqual(learnerNotes({id:'r1',items:['하나','',' ','둘',7,'셋','넷']}),{id:'r1',items:['하나','둘','셋']});
assert.equal(learnerNotes({id:'r1',items:[]}),null);
assert.equal(learnerNotes({id:'r1',items:['',ch(0x200b)]}),null,'only invisible lines: no panel');
assert.equal(learnerNotes({id:'../x',items:['하나']}),null,'unsafe id');
assert.equal(learnerNotes({id:'',items:['하나']}),null);
assert.equal(learnerNotes(null),null);
assert.equal(learnerNotes({id:'r1',items:'하나'}),null);

(async()=>{
const notes={id:'r2',items:['새 기능']};
const learner={instructor:false,open:null};
// Fresh install (no globalState yet): the bundled notes count as seen; nothing is new.
{const s=memento();await recordWhatsNewBaseline(s,notes);assert.deepEqual(s.data.get(WHATS_NEW_KEY),{seen:'r2'});assert.equal(whatsNewOffer(s,notes,learner),false,'fresh install: no panel');}
// An existing profile from a build before this feature: nothing seen yet, so the panel is due.
{const s=memento({other:1});await recordWhatsNewBaseline(s,notes);assert.deepEqual(s.data.get(WHATS_NEW_KEY),{seen:null});assert.equal(whatsNewOffer(s,notes,learner),true,'updated profile: panel due');}
// After an update to notes the learner has not seen.
{const s=memento({[WHATS_NEW_KEY]:{seen:'r1'}});await recordWhatsNewBaseline(s,notes);assert.deepEqual(s.data.get(WHATS_NEW_KEY),{seen:'r1'},'baseline never overwrites a record');
 assert.equal(whatsNewOffer(s,notes,learner),true);
 assert.equal(whatsNewOffer(s,notes,{instructor:true,open:null}),false,'instructor console: no panel');
 assert.equal(whatsNewOffer(s,null,learner),false,'no valid notes: no panel');
 assert.equal(await markWhatsNewShown(s,notes,'r1'),false,'a stale id does not mark');assert.deepEqual(s.data.get(WHATS_NEW_KEY),{seen:'r1'});
 assert.equal(await markWhatsNewShown(s,notes,'r2'),true);assert.deepEqual(s.data.get(WHATS_NEW_KEY),{seen:'r2'});
 assert.equal(whatsNewOffer(s,notes,learner),false,'shown once: not again after a reload or the next launch');
 assert.equal(whatsNewOffer(s,notes,{instructor:false,open:'r2'}),true,'still open in this window until closed');
 assert.equal(whatsNewOffer(s,{id:'r3',items:['다음']},learner),true,'the next notes show again');}
// No record at all (baseline failed): fail closed.
assert.equal(whatsNewOffer(memento({other:1}),notes,learner),false);
assert.equal(whatsNewOffer(memento({[WHATS_NEW_KEY]:'junk'}),notes,learner),false,'corrupt record: fail closed');
console.log('PASS whats-new model');
})().catch(error=>{console.error(error);process.exit(1);});
