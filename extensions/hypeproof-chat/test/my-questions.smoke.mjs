// CGP-CHAT-R-028 (REQ-STUDIO-MY-QUESTIONS) — the pure rules of the "내 질문" list: offered from 4 drawn user
// turns on, numbered in transcript order, one version per edited prompt (as drawn), and each entry one plain first
// line of the learner's own words (quoted answer skipped, controls and bidi removed, U+2028/2029 split, cut at 60
// grapheme clusters). Positive and negative controls for each rule.
import assert from 'node:assert/strict';
import { myQuestions, myQuestionLine, MY_QUESTIONS_MIN, MY_QUESTION_LINE_MAX, MY_QUESTION_CUT_MARK, MY_QUESTION_IMAGE_ONLY, MY_QUESTION_EMPTY, MY_QUESTION_UNITS_MAX } from '../src/myQuestions.ts';
import { visibleVersions } from '../src/editResend.ts';

const ch = (code) => String.fromCharCode(code);
const turn = (i, content = `질문 ${i}`, extra = {}) => [
  { id: `u${i}`, role: 'user', content, createdAt: i, ...extra },
  { id: `a${i}`, role: 'assistant', content: `답변 ${i}`, createdAt: i },
];
const convo = (n) => Array.from({ length: n }, (_, i) => turn(i + 1)).flat();

// Threshold: hidden below 4 user turns, shown from 4. Tool, system and assistant lines never count.
assert.equal(MY_QUESTIONS_MIN, 4);
assert.deepEqual(myQuestions(convo(3)), [], 'three user turns: no list');
assert.deepEqual(myQuestions([...convo(3), { id: 't', role: 'tool', content: 'x', createdAt: 9 }, { id: 's', role: 'system', content: 'y', createdAt: 9 }]), [], 'tool and system lines are not prompts');
assert.deepEqual(myQuestions(convo(4)).map((q) => [q.id, q.n, q.line]), [['u1', 1, '질문 1'], ['u2', 2, '질문 2'], ['u3', 3, '질문 3'], ['u4', 4, '질문 4']], 'four turns: numbered in order');
assert.equal(myQuestions(convo(15)).length, 15, 'every prompt is listed (the popover scrolls)');

// Edited prompts: the drawn transcript has one version per group, so an edit never adds an entry.
const edited = [...convo(3), ...turn(9, '처음 질문'), { id: 'u9b', role: 'user', content: '고친 질문', createdAt: 10, editOf: 'u9' }, { id: 'a9b', role: 'assistant', content: '새 답변', createdAt: 10 }];
const drawn = visibleVersions(edited).items;
assert.deepEqual(myQuestions(drawn).map((q) => q.line), ['질문 1', '질문 2', '질문 3', '고친 질문'], 'the drawn (latest) version only');
assert.deepEqual(myQuestions(visibleVersions(edited, { u9: 0 }).items).map((q) => q.id).at(-1), 'u9', 'the version on screen is the jump target');
assert.equal(myQuestions(visibleVersions(convo(3).concat(turn(9, 'a'), [{ id: 'u9b', role: 'user', content: 'b', createdAt: 10, editOf: 'u9' }])).items).length, 4, 'control: four drawn prompts');
assert.deepEqual(myQuestions(visibleVersions([...convo(2), ...turn(9, 'a'), { id: 'u9b', role: 'user', content: 'b', createdAt: 10, editOf: 'u9' }]).items), [], 'an edit is not a fourth prompt');

// First line: the first non-empty line, whitespace collapsed.
assert.equal(myQuestionLine('\n\n  첫   줄 입니다  \n둘째 줄'), '첫 줄 입니다');
assert.equal(myQuestionLine('한 줄\r\n다음'), '한 줄');
assert.equal(myQuestionLine(`앞${ch(0x2028)}뒤`), '앞', 'U+2028 ends the line');
assert.equal(myQuestionLine(`앞${ch(0x2029)}뒤`), '앞', 'U+2029 ends the line');
// The learner's own words, not a quoted answer (CGP-CHAT-R-007 inserts "> " lines first).
assert.equal(myQuestionLine('> 코치가 한 말\n> 이어진 말\n\n이 부분이 무슨 뜻이야?'), '이 부분이 무슨 뜻이야?');
assert.equal(myQuestionLine('> 인용만 보냄'), '인용만 보냄', 'only a quote: the quote, without its marker');
assert.equal(myQuestionLine('a > b 비교'), 'a > b 비교', 'control: ">" inside a line is kept');
// Hostile text: controls, bidi overrides/isolates, zero-width characters and the BOM are removed.
const hostile = `${ch(0x202e)}abc${ch(0x2066)}d${ch(0x200b)}e${ch(0x0007)}f${ch(0xfeff)}${ch(0x061c)}g${ch(0x2069)}`;
assert.equal(myQuestionLine(hostile), 'abcdefg');
assert.equal(myQuestionLine(`탭${ch(9)}사이`), '탭 사이', 'a tab is whitespace');
assert.equal(myQuestionLine('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'markup stays plain text (React renders it as text)');
// Length: cut at 60 grapheme clusters with a visible mark; a cluster is never split.
const long = '가'.repeat(80);
assert.equal(myQuestionLine(long), '가'.repeat(MY_QUESTION_LINE_MAX) + MY_QUESTION_CUT_MARK);
assert.equal(myQuestionLine('가'.repeat(60)), '가'.repeat(60), 'control: exactly 60 is not cut');
const family = `${ch(0xd83d)}${ch(0xdc68)}${ch(0x200d)}${ch(0xd83d)}${ch(0xdc69)}${ch(0x200d)}${ch(0xd83d)}${ch(0xdc67)}`;
const flagged = 'a'.repeat(59) + family + 'tail';
const cut = myQuestionLine(flagged);
assert.equal(cut, 'a'.repeat(59) + family + MY_QUESTION_CUT_MARK, 'the 60th cluster is the whole family emoji');
assert.ok(!/[\ud800-\udbff]$/.test(cut.slice(0, -1)), 'no lone surrogate before the mark');
// VT and FF are whitespace, not glue.
assert.equal(myQuestionLine(`a${ch(11)}b${ch(12)}c`), 'a b c');
// A line that draws nothing (joiners, Hangul filler, soft hyphen) is skipped like an empty line.
assert.equal(myQuestionLine(`${ch(0x200d)}${ch(0x3164)}${ch(0xad)}\n진짜 질문`), '진짜 질문');
assert.equal(myQuestionLine(`${ch(0x200d)}${ch(0x3164)}`), MY_QUESTION_EMPTY);
// A combining-mark flood is one cluster: the line is still capped in code units.
const flood = 'a' + ch(0x301).repeat(5000) + 'b';
const capped = myQuestionLine(flood);
assert.ok(capped.length <= MY_QUESTION_UNITS_MAX + 1 && capped.endsWith(MY_QUESTION_CUT_MARK), `code-unit cap (${capped.length})`);
assert.equal(myQuestionLine('a'.repeat(5000) + '\n둘째'), 'a'.repeat(60) + MY_QUESTION_CUT_MARK, 'a huge first line is cut, not scanned whole');
// No text of its own.
assert.equal(myQuestionLine('', ['data:image/png;base64,AA']), MY_QUESTION_IMAGE_ONLY);
assert.equal(myQuestionLine('   ', []), MY_QUESTION_EMPTY);
assert.equal(myQuestionLine(`${ch(0x202e)}${ch(0x200b)}`), MY_QUESTION_EMPTY, 'only invisible characters is empty');

console.log('PASS my-questions: threshold 4, drawn versions only, first own line, hostile text cleaned, 60-cluster cut');
