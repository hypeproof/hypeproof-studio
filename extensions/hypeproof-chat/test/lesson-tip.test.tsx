// CGP-CHAT-R-021 — lesson tip model: served-hint source only, text hygiene, per-step keys,
// bounded dismiss list and a prefill that only edits the draft.
import assert from 'node:assert/strict';
import {cleanTipText,lessonTipFor,prefillWithTip,readDismissed,withDismissed,LESSON_TIP_DISMISS_MAX,LESSON_TIP_MAX,LESSON_TIP_STATE_KEY} from '../webview-ui/src/lessonTipModel';
const ch=(n:number)=>String.fromCharCode(n);
const step=(id:string,hint:string)=>({id,title:id,instructions:'i',hint,acceptance:'a'});
const lesson:any={course_id:'c',version:'v1',sha256:'a'.repeat(64),content:{steps:[step('s1','먼저 기준을 정해 보세요'),step('s2','  '),step('s3','다른 힌트')]}};

// Source: the current step's hint, the first step before any pick, nothing for a blank hint.
assert.equal(lessonTipFor(lesson,null)?.text,'먼저 기준을 정해 보세요');
assert.equal(lessonTipFor(lesson,'s3')?.text,'다른 힌트');
assert.equal(lessonTipFor(lesson,'unknown')?.stepId,'s1');
assert.equal(lessonTipFor(lesson,'s2'),null,'blank hint: no tip, never a fallback');
assert.equal(lessonTipFor(null,'s1'),null);
assert.equal(lessonTipFor({...lesson,content:{steps:[]}},null),null);
assert.equal(lessonTipFor({...lesson,content:{}} as any,null),null,'malformed steps fail closed');
assert.equal(lessonTipFor({...lesson,content:{steps:[{...step('s1','x'),hint:42}]}} as any,null),null,'non-string hint');

// Keys bind lesson identity and step; a new version or another step is a different key.
const k1=lessonTipFor(lesson,'s1')!.key,k3=lessonTipFor(lesson,'s3')!.key,kv=lessonTipFor({...lesson,version:'v2'},'s1')!.key,ks=lessonTipFor({...lesson,sha256:'b'.repeat(64)},'s1')!.key;
assert.equal(new Set([k1,k3,kv,ks]).size,4);
assert.notEqual(lessonTipFor({...lesson,course_id:'a","b'},'s1')!.key,lessonTipFor({...lesson,course_id:'a',version:'b","v1'},'s1')!.key,'keys cannot collide by delimiter injection');

// Text hygiene: controls, bidi, zero-width, BOM removed; separators fold to one space; NFC; caps.
assert.equal(cleanTipText(`a${ch(0x202e)}b${ch(0x2066)}c${ch(0x200b)}d${ch(0xfeff)}e${ch(0x07)}f`),'abcdef');
assert.equal(cleanTipText(`줄1${ch(0x2028)}줄2${ch(0x2029)}\n\t줄3`),'줄1 줄2 줄3');
assert.equal(cleanTipText(ch(0x1112)+ch(0x1161)+ch(0x11ab)),ch(0xd55c),'decomposed jamo become NFC 한');
assert.equal(cleanTipText(`a${ch(0x061c)}b${ch(0x00ad)}c${ch(0x3164)}d${ch(0xffa0)}e${ch(0x2800)}f${String.fromCodePoint(0xe0041)}g`),'abcdefg','bidi mark, soft hyphen, Hangul/braille blanks, tag chars');
assert.equal(lessonTipFor({...lesson,content:{steps:[step('s1',ch(0x3164).repeat(3)+ch(0x115f))]}},null),null,'a hint made only of blank fillers shows no tip');
assert.equal(cleanTipText('<b>x</b>'),'<b>x</b>','markup stays text for React to escape');
assert.equal(cleanTipText('x'.repeat(LESSON_TIP_MAX)),'x'.repeat(LESSON_TIP_MAX));
assert.equal(cleanTipText('x'.repeat(LESSON_TIP_MAX+1)),'','over the Service cap: not a served hint');
assert.equal(cleanTipText(undefined),'');

// Dismiss list: strings only, de-duplicated, newest kept, bounded.
assert.deepEqual(readDismissed({[LESSON_TIP_STATE_KEY]:['a',1,null,'b']}),['a','b']);
assert.deepEqual(readDismissed({[LESSON_TIP_STATE_KEY]:'a'}),[]);
assert.deepEqual(readDismissed({}),[]);
assert.deepEqual(withDismissed(['a','b'],'a'),['b','a']);
let list:string[]=[];for(let i=0;i<LESSON_TIP_DISMISS_MAX+5;i++)list=withDismissed(list,'k'+i);
assert.equal(list.length,LESSON_TIP_DISMISS_MAX);assert.equal(list.at(-1),'k'+(LESSON_TIP_DISMISS_MAX+4));assert.ok(!list.includes('k0'));

// Prefill: empty draft becomes the tip, an existing draft is kept, a repeat adds nothing.
assert.equal(prefillWithTip('','팁'),'팁');
assert.equal(prefillWithTip('   ','팁'),'팁');
assert.equal(prefillWithTip('내 글  ','팁'),'내 글\n팁');
assert.equal(prefillWithTip('내 글\n팁','팁'),'내 글\n팁');
console.log('PASS lesson tip model');
