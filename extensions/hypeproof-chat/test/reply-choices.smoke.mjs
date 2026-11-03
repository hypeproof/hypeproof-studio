import assert from 'node:assert/strict';
import { replyChoices } from '../webview-ui/src/replyChoiceParser.ts';
const good = '객관식으로 골라 보세요. 번호만 답하셔도 됩니다.\n\n**어느 쪽에 가까웠나요?**\n\n1. 글쓰기나 정리: 메일, 보고서\n2. 계획 세우기: 여행, 일정\n3. 위에 없음. 직접 말할게요\n\n편하게 알려 주세요.';
assert.deepEqual(replyChoices(good)?.options.map(c => c.label), ['글쓰기나 정리: 메일, 보고서','계획 세우기: 여행, 일정','위에 없음. 직접 말할게요']);
assert.equal(replyChoices(good)?.after,'편하게 알려 주세요.');
for(const text of ['설치 순서입니다.\n1. 설치\n2. 실행','선택하세요\n1. 하나',good.replace('2. 계획','3. 계획'),good+'\n4. 별도 목록','골라 주세요\n1. [링크](https://example.com)\n2. 다른 답','골라 주세요\n```\n1. 첫째\n2. 둘째\n```','골라 주세요\n1. 첫째\n  - 중첩 설명\n2. 둘째','x'.repeat(12001)])assert.equal(replyChoices(text),null,text.slice(0,50));
console.log('PASS reply choices: explicit invitation, bounded sequential flat options, no code/links/nested/ordinary/partial lists');
