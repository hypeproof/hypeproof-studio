// CGP-CHAT-R-027 (REQ-STUDIO-CHAT-FIND): the find query rules, as pure functions. Plain text
// (no regex), case-insensitive with stable offsets, invisible/bidi controls dropped, a 200 code-unit
// cap that never splits a surrogate pair, non-overlapping matches. The DOM behaviour is measured in
// chat-find-browser.smoke.mjs.
import assert from 'node:assert/strict';
import { normalizeFindQuery, foldCase, findOffsets, FIND_QUERY_MAX } from '../webview-ui/src/chatFind.ts';

assert.deepEqual(findOffsets('사과 APPLE apple', 'apple'), [3, 9], 'case-insensitive');
assert.deepEqual(findOffsets('a.p ap', 'a.p'), [0], 'regex syntax is literal text');
assert.deepEqual(findOffsets('aaaa', 'aa'), [0, 2], 'non-overlapping');
assert.deepEqual(findOffsets('anything', ''), [], 'empty query matches nothing');
// A character whose lower case has another length keeps its offsets (U+0130 lowers to 2 code units).
assert.equal(foldCase('İX').length, 2);
assert.deepEqual(findOffsets('İ x X', 'x'), [2, 4], 'offsets stay aligned after a length-changing character');
assert.equal(normalizeFindQuery('사‮과⁦'), '사과', 'bidi controls dropped');
assert.equal(normalizeFindQuery('a\u0000b c\u0085d﻿'), 'abcd', 'C0/C1, separators and BOM dropped');
assert.equal(normalizeFindQuery(' 두 칸 '), ' 두 칸 ', 'spaces are kept as typed');
assert.equal(normalizeFindQuery('가'.repeat(500)).length, FIND_QUERY_MAX, 'length cap');
const astral = 'a'.repeat(FIND_QUERY_MAX - 1) + '\u{1F34E}';
assert.equal(normalizeFindQuery(astral), 'a'.repeat(FIND_QUERY_MAX - 1), 'the cap never leaves half a surrogate pair');
console.log('PASS transcript find query rules: plain text, case, offsets, controls, cap');
