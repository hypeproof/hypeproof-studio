// Local title extraction only: no model, Service, browser or native-App evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestTaskTitle } from '../src/taskTitle.ts';

const user = content => ({ role: 'user', content });
const assistant = content => ({ role: 'assistant', content });

test('a usable request becomes a short readable title; greetings and code are not invented topics', () => {
  assert.equal(suggestTaskTitle([user('안녕하세요!'), user('## **수업 일정** 정리하기\n세부 내용')]), '수업 일정 정리하기');
  assert.equal(suggestTaskTitle([user('[예약 화면](https://example.test) 접근성 확인')]), '예약 화면 접근성 확인');
  assert.equal(suggestTaskTitle([user('안녕'), assistant('무엇을 도와드릴까요?'), user('네')]), null);
  assert.equal(suggestTaskTitle([user('```js\nconsole.log("secret code");\n```')]), null);
  assert.equal(suggestTaskTitle([user('https://example.test/private-path')]), null);
  const title = suggestTaskTitle([user('🦷 치과 예약 화면의 접근성과 모바일 사용성을 확인해 주세요 '.repeat(40))]);
  assert.ok(Array.from(title).length <= 48);
  assert.ok(title.endsWith('…'));
  assert.equal(title.isWellFormed(), true, 'truncation must not split a UTF-16 surrogate pair');
});

test('a numbered answer uses the selected nearby label, not the assistant prose or a bare number', () => {
  const menu = assistant('어떤 것부터 만들까요?\n**1. 진료 안내**\n**2. 온라인 예약 페이지**');
  assert.equal(suggestTaskTitle([user('치과 웹사이트 제작'), menu, user('2번으로 할게요')]), '온라인 예약 페이지');
  assert.equal(suggestTaskTitle([assistant('(1) 행사 안내\n(2) 참가 신청서'), user('(2)')]), '참가 신청서');
  assert.equal(suggestTaskTitle([assistant('1) 행사 안내\n2) 참가 신청서'), user('１')]), '행사 안내');
  assert.equal(suggestTaskTitle([menu, user('9')]), null, 'an absent option must not invent a topic');
  assert.equal(suggestTaskTitle([menu, assistant('설명을 더 해주세요.'), user('2')]), null, 'an older menu must not override the latest assistant turn');
  assert.equal(suggestTaskTitle([assistant('1. 안내\n2. 신청\n1. 발표\n2. 결제'), user('2')]), null, 'duplicate numbering is ambiguous');
  assert.equal(suggestTaskTitle([assistant('```\n1. 코드\n2. 코드\n```'), user('2')]), null);
});

test('the full clicked option refines a general request only when its number and label match the offered menu', () => {
  const request = user('객관식으로 질문해 줘');
  const label = '글쓰기나 정리: 메일, 보고서, 메모, 자료 요약';
  const menu = assistant(`무엇부터 해볼까요?\n1. **글쓰기나 정리**: 메일, 보고서, 메모, 자료 요약\n2. 웹사이트 만들기`);
  assert.equal(suggestTaskTitle([request, menu, user('1')]), label);
  assert.equal(suggestTaskTitle([request, menu, user(`1. ${label}`)]), label);
  assert.equal(suggestTaskTitle([request, menu, user('1. 다른 주제로 바꾸기')]), '객관식으로 질문해 줘');
  assert.equal(suggestTaskTitle([user('1. 결제 실패 원인을 조사해 주세요')]), '1. 결제 실패 원인을 조사해 주세요', 'an ordinary numbered request is not an offered choice');
});

test('titles settle from the first useful request and cannot drift with later topics or tools', () => {
  assert.equal(suggestTaskTitle([user('출석부 정리'), { role: 'tool', content: '투자 보고서 작성' }, user('열을 추가해줘'), user('새로운 투자 보고서')]), '출석부 정리');
  assert.equal(suggestTaskTitle([user('안녕'), user('네'), user('세 번째 요청의 새 주제')]), '세 번째 요청의 새 주제');
  assert.equal(suggestTaskTitle([user('안녕'), user('네'), user('여행 계획'), assistant('1. 제주 여행\n2. 서울 여행'), user('1'), assistant('1. 다른 주제\n2. 또 다른 주제'), user('2')]), '제주 여행');
  assert.equal(suggestTaskTitle([user('원래 주제'), user('네'), assistant('1. 다른 주제\n2. 또 다른 주제'), user('2')]), '원래 주제');
  assert.equal(suggestTaskTitle([user('원래 주제'), assistant('1. 첫 선택\n2. 두 번째 선택'), user('3')]), '원래 주제');
});
