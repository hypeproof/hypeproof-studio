// Coach-driven next steps: the strict parser and the text a bubble draws, including a block that is
// still streaming in (webview-ui/src/nextStepsParser.ts). Plain asserts, bundled by run-tsx-tests.
import assert from 'node:assert/strict';
import { nextSteps, nextStepsBody } from '../webview-ui/src/nextStepsParser';

let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const H = '다음에 해볼 만한 것';

t('a header and one to three arrow lines at the end are a block; the body is what comes before', () => {
  assert.deepEqual(nextSteps(`좋아요.\n\n${H}\n→ 첫째 해보기`), { body: '좋아요.', steps: ['첫째 해보기'] });
  assert.deepEqual(nextSteps(`본문\n${H}:\n→ 하나\n→ 둘\n→ 셋\n`), { body: '본문', steps: ['하나', '둘', '셋'] });
});
t('blank lines are allowed between and after the arrow lines, and around the header', () => {
  assert.deepEqual(nextSteps(`본문\n\n\n${H}\n\n→ 하나\n\n→ 둘\n\n\n`), { body: '본문', steps: ['하나', '둘'] });
});
t('a reply that is only the block has an empty body', () => {
  assert.deepEqual(nextSteps(`${H}\n→ 하나`), { body: '', steps: ['하나'] });
});
t('CRLF line ends and trailing spaces on a step are tolerated', () => {
  assert.deepEqual(nextSteps(`본문\r\n${H}\r\n→ 하나  \r\n`), { body: '본문', steps: ['하나'] });
});

t('not a block: no header, a header with no step, or more than three steps', () => {
  assert.equal(nextSteps('그냥 글이에요.'), null);
  assert.equal(nextSteps(''), null);
  assert.equal(nextSteps(`본문\n${H}\n`), null);
  assert.equal(nextSteps(`본문\n${H}\n→ 1\n→ 2\n→ 3\n→ 4`), null);
});
t('not a block: the header must be that line and nothing else', () => {
  assert.equal(nextSteps(`본문\n**${H}**\n→ 하나`), null);
  assert.equal(nextSteps(`본문\n${H}를 알려 드릴게요\n→ 하나`), null);
  assert.equal(nextSteps(`본문 ${H}\n→ 하나`), null);
  assert.equal(nextSteps(`본문\n${H}：\n→ 하나`), null);
});
t('not a block: anything after the block, or a line that is not an arrow step', () => {
  assert.equal(nextSteps(`${H}\n→ 하나\n끝인사`), null);
  assert.equal(nextSteps(`${H}\n- 하나`), null);
  assert.equal(nextSteps(`${H}\n→하나`), null, 'the arrow needs its space');
  assert.equal(nextSteps(`${H}\n→ 하나\n\n본문이 뒤에`), null);
});
t('a step is 1 to 60 characters', () => {
  assert.equal(nextSteps(`${H}\n→ ${'가'.repeat(60)}`)?.steps[0].length, 60);
  assert.equal(nextSteps(`${H}\n→ ${'가'.repeat(61)}`), null);
  assert.equal(nextSteps(`${H}\n→ `), null);
  assert.equal(nextSteps(`${H}\n→    `), null);
});
t('a step with markup, a link, a URL or an invisible character voids the whole block', () => {
  for (const bad of ['<b>굵게</b>', '코드 `x`', '주소 http://a.b', '주소 HTTPS://a.b', '[글](a)', '글 > 인용', '숨은​글자', '방향‮뒤집기', '탭\t문자', '소프트­hyphen'])
    assert.equal(nextSteps(`${H}\n→ 좋은 것\n→ ${bad}`), null, bad);
});
t('control or format characters in the block void it; the body may keep them (a ZWJ emoji in prose is fine)', () => {
  assert.equal(nextSteps(`본문\n${H}\n→ 하;나\u200b`), null, 'a format character in a step');
  assert.equal(nextSteps(`본문\n${H}\u200b\n→ 하나`), null, 'in the header line');
  assert.equal(nextSteps(`본문\n${H}\n→ 하나\u0007`), null, 'a control character');
  const family = '\u{1F469}\u200d\u{1F467}';
  assert.deepEqual(nextSteps(`가족 ${family}\n${H}\n→ 하나`), { body: `가족 ${family}`, steps: ['하나'] }, 'ZWJ in the body');
  assert.equal(nextStepsBody(`가족 ${family}\n${H}\n→ 하나`, true), `가족 ${family}`);
});
t('a step with bold or underline markers or a leading www. is refused', () => {
  for (const bad of ['**굵게**', '__밑줄__', 'www.example.com', 'WWW.x.kr']) assert.equal(nextSteps(`${H}\n→ ${bad}`), null, bad);
  assert.deepEqual(nextSteps(`${H}\n→ 이 www 는 괜찮아요`)?.steps, ['이 www 는 괜찮아요']);
});
t('a header inside an open code fence is not a header; a closed fence before it is fine', () => {
  assert.equal(nextSteps('```\n' + `${H}\n→ 하나`), null);
  assert.deepEqual(nextSteps('```js\nx\n```\n' + `${H}\n→ 하나`), { body: '```js\nx\n```', steps: ['하나'] });
});
t('a fence opened with four backticks (or tildes) stays open until a fence at least as long closes it', () => {
  assert.equal(nextSteps('````\n```\n' + `${H}\n→ 하나`), null, 'a shorter fence inside does not close it');
  assert.equal(nextSteps('~~~~\n' + `${H}\n→ 하나`), null);
  assert.deepEqual(nextSteps('````\n```\n````\n' + `${H}\n→ 하나`), { body: '````\n```\n````', steps: ['하나'] }, 'closed by 4');
  assert.equal(nextStepsBody('````\n' + `${H}\n→ 하나`, true), '````\n' + `${H}\n→ 하나`);
});
t('the last header wins; an earlier header with prose after it stays body', () => {
  assert.deepEqual(nextSteps(`${H}\n→ 옛날\n설명\n${H}\n→ 새것`), { body: `${H}\n→ 옛날\n설명`, steps: ['새것'] });
});

t('nextStepsBody: a finished block is cut, anything else is returned untouched', () => {
  assert.equal(nextStepsBody(`본문\n${H}\n→ 하나`, false), '본문');
  assert.equal(nextStepsBody(`본문\n${H}\n→ 하나\n끝인사`, false), `본문\n${H}\n→ 하나\n끝인사`);
  assert.equal(nextStepsBody('그냥', false), '그냥');
});
t('nextStepsBody while streaming: from a complete header line on, arrow lines are hidden as they arrive', () => {
  assert.equal(nextStepsBody(`본문\n${H}`, true), `본문\n${H}`, 'the header line may still be growing');
  assert.equal(nextStepsBody(`본문\n${H}\n`, true), '본문');
  assert.equal(nextStepsBody(`본문\n${H}\n→`, true), '본문');
  assert.equal(nextStepsBody(`본문\n${H}\n→ 하나\n→ 둘째 쓰는 중`, true), '본문');
  assert.equal(nextStepsBody(`본문\n${H}\n→ 하나\n\n`, true), '본문');
});
t('nextStepsBody while streaming: a header followed by something else shows everything, and a settled stream shows the rest', () => {
  assert.equal(nextStepsBody(`본문\n${H}\n그래서 말인데`, true), `본문\n${H}\n그래서 말인데`);
  assert.equal(nextStepsBody(`본문\n${H}\n→ 하나\n\n본문 계속`, true), `본문\n${H}\n→ 하나\n\n본문 계속`);
  assert.equal(nextStepsBody(`본문\n${H}\n→ 하나\n→ 2\n→ 3\n→ 4`, false), `본문\n${H}\n→ 하나\n→ 2\n→ 3\n→ 4`, 'four steps are prose once the stream ends');
  assert.equal(nextStepsBody('```\n' + `${H}\n→ 하나`, true), '```\n' + `${H}\n→ 하나`);
});

if (fail) { console.error(`next-steps-parser: ${fail} failed`); process.exit(1); }
console.log('next-steps-parser OK');
