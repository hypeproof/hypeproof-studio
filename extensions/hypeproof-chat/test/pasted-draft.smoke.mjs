import assert from 'node:assert/strict';
import {longPaste,pasteLines,fullDraft,visibleDraft,replaceVisible,editVisible,changePaste} from '../webview-ui/src/pastedDraft.ts';
assert.equal(longPaste('가'.repeat(2000)),false);assert.equal(longPaste('가'.repeat(2001)),true);
assert.equal(longPaste('😀'.repeat(2000)),false);assert.equal(longPaste('😀'.repeat(2001)),true);
assert.equal(longPaste('a\n'.repeat(39)+'a'),false);assert.equal(longPaste('a\r\n'.repeat(40)+'a'),true);assert.equal(pasteLines('a\rb\r\nc\nd'),4);
let parts=replaceVisible([{text:'앞 선택 뒤'}],2,4,{id:1,text:'첫 붙여넣기'});
assert.equal(fullDraft(parts),'앞 첫 붙여넣기 뒤');assert.equal(visibleDraft(parts),'앞  뒤');
parts=replaceVisible(parts,2,2,{id:2,text:'둘째'});assert.equal(fullDraft(parts),'앞 첫 붙여넣기둘째 뒤');
parts=editVisible(parts,'앞 추가 뒤');assert.equal(fullDraft(parts),'앞 첫 붙여넣기둘째추가 뒤');
parts=editVisible(parts,'');assert.equal(fullDraft(parts),'첫 붙여넣기둘째','select-all in visible editor preserves explicitly removable chips');
parts=changePaste(parts,1,'수정');assert.equal(fullDraft(parts),'수정둘째');
parts=changePaste(parts,1,'수정',true);assert.equal(visibleDraft(parts),'수정');assert.equal(fullDraft(parts),'수정둘째');
parts=changePaste(parts,2,null);assert.equal(fullDraft(parts),'수정');
let plain=[{text:'원문'}];plain=editVisible(plain,'원문 한국어');assert.equal(fullDraft(plain),'원문 한국어');
// Consecutive pastes at a caret that touches an empty trailing segment keep paste order (verifier gap: boundary comparison mutant survived).
let tail=replaceVisible([{text:'x'}],1,1,{id:1,text:'A'});tail=replaceVisible(tail,1,1,{id:2,text:'B'});assert.equal(fullDraft(tail),'xAB');
let empty=replaceVisible([{text:''}],0,0,{id:1,text:'A'});empty=replaceVisible(empty,0,0,{id:2,text:'B'});assert.equal(fullDraft(empty),'AB');
console.log('PASS pasted draft: threshold, Unicode/line endings, caret replacement, repeated paste order, hidden content retention, edit/remove/inline');
