// CGP-CHAT-R-024 (REQ-STUDIO-COPY-CONVERSATION): the copied text is the learner's and the coach's
// visible words in order, as simple Markdown, with the AE-39 exclusions applied.
import assert from 'node:assert/strict';
import { conversationMarkdown, copyableMessages, plainText, scrubCredentials } from '../src/conversationCopy.ts';

const ch = (code) => String.fromCharCode(code);
const ghToken = 'ghp_' + 'A'.repeat(36);
const syncToken = 'hps_sync_' + 'b'.repeat(43);
const messages = [
  { id: 'u1', role: 'user', content: '첫 질문이에요', createdAt: 1, images: ['data:image/png;base64,AAAA'] },
  { id: 'think-1', role: 'tool', content: '', createdAt: 2, tool: { icon: 'think', label: '숨은 생각: 비밀 계획', state: 'done' } },
  { id: 't1', role: 'tool', content: '', createdAt: 3, tool: { icon: 'tool', label: 'Read(/Users/other/secret.txt) RAW-PAYLOAD', state: 'done' } },
  { id: 't2', role: 'tool', content: 'TOOL-CONTENT raw result', createdAt: 3, tool: { icon: 'tool', label: 'Bash(ls)', state: 'done' } },
  { id: 'a1', role: 'assistant', content: `답변 하나\n\`\`\`js\nconsole.log(1)\n\`\`\``, createdAt: 4, assistantName: '별빛', citations: [{ url: 'https://example.test/c', title: 'CITATION-RECORD', domain: 'example.test', tier: 1 }] },
  { id: 's1', role: 'system', content: '강사 공지: 다른 학생 김OO 자료', createdAt: 5 },
  { id: 'u2', role: 'user', content: `토큰은 ${ghToken} 이고 ${syncToken} 그리고 https://me:pw1234@git.example.test/x`, createdAt: 6 },
  { id: 'a2', role: 'assistant', content: `줄${ch(0x2028)}바꿈 ${ch(0x202e)}역방향${ch(0x2066)} 끝${ch(7)}`, createdAt: 7 },
  { id: 'a3', role: 'assistant', content: '   ', createdAt: 8 },
];

const text = conversationMarkdown({ messages, title: '## 내 작업\n제목', coachName: '코치' });
// Order and headings: learner = 나, the answer's own stored name wins over the live name.
const order = ['# 내 작업 제목', '## 나', '첫 질문이에요', '## 별빛', '답변 하나', '## 나', '토큰은', '## 코치', '줄\n바꿈'];
let cursor = 0;
for (const part of order) { const at = text.indexOf(part, cursor); assert.ok(at >= cursor, `in transcript order: ${part}\n${text}`); cursor = at + part.length; }
assert.ok(text.startsWith('# 내 작업 제목\n\n## 나\n\n첫 질문이에요'), 'title heading flattened to one line, no extra heading level');
assert.ok(text.includes('```js\nconsole.log(1)\n```'), 'answer Markdown kept as written');
// Exclusions.
for (const hidden of ['숨은 생각', 'RAW-PAYLOAD', '/Users/other', '강사 공지', '김OO', 'CITATION-RECORD', 'TOOL-CONTENT', 'data:image', 'AAAA', ghToken, syncToken, 'pw1234'])
  assert.ok(!text.includes(hidden), `excluded from the copy: ${hidden}`);
assert.ok(text.includes('«GITHUB_TOKEN 가려짐»') && text.includes('[excluded:measurement_connection_token]') && text.includes('«URL_CREDENTIALS 가려짐»@'), 'credentials are replaced by named placeholders');
// Shared measurement redactor (MC-30) is reused, not copied: model-provider keys it names are masked too.
for (const key of ['sk-proj-' + 'A1b2C3d4E5f6G7h8I9j0K1l2', 'sk-svcacct-' + 'Z9y8X7w6V5u4T3s2R1q0P9o8']) {
  const copied = conversationMarkdown({ messages: [{ id: 'k', role: 'user', content: `키 ${key} 끝`, createdAt: 1 }] });
  assert.ok(!copied.includes(key) && copied.includes('[excluded:openai_key]'), `provider key masked by the shared redactor: ${key.slice(0, 11)}`);
}
assert.ok(text.includes('(이미지 1장 첨부, 이미지는 복사하지 않았어요)'), 'an attached image is named, its bytes are not copied');
for (const bad of [0x202e, 0x2066, 0x2028, 7]) assert.ok(!text.includes(ch(bad)), `control/bidi character U+${bad.toString(16)} removed`);
assert.equal((text.match(/^## /gm) ?? []).length, 4, 'blank answer contributes no section');

// Positive control: a plain conversation is copied unchanged apart from the headings.
assert.equal(conversationMarkdown({ messages: [{ id: 'u', role: 'user', content: '안녕', createdAt: 1 }, { id: 'a', role: 'assistant', content: '반가워요', createdAt: 2 }], coachName: '코치' }),
  '# 대화\n\n## 나\n\n안녕\n\n## 코치\n\n반가워요\n');
// Nothing to copy: no text, so the menu item is disabled and the clipboard is never cleared.
assert.equal(conversationMarkdown({ messages: messages.filter(m => m.role !== 'user' && m.role !== 'assistant') }), '');
assert.equal(copyableMessages([{ id: 'x', role: 'assistant', content: ch(0x200e), createdAt: 1 }]).length, 0, 'invisible-only answer is not copyable');
// A hostile coach name cannot inject a heading or a line.
assert.ok(conversationMarkdown({ messages: [{ id: 'a', role: 'assistant', content: 'x', createdAt: 1, assistantName: '# 가짜\n## 나' }] }).includes('## 가짜 나\n'), 'name flattened');
assert.equal(plainText('a\r\nb\rc'), 'a\nb\nc');
assert.equal(scrubCredentials('Authorization: Bearer ' + 'x'.repeat(30)).includes('x'.repeat(30)), false);
// Body headings nest under the speaker sections, so a message cannot forge a speaker; code is untouched.
const forged = conversationMarkdown({ messages: [{ id: 'a', role: 'assistant', content: '# 큰 제목\n## 나\n가짜 말\n```py\n# comment\n## keep\n```\n### 셋', createdAt: 1 }], coachName: '코치' });
assert.deepEqual(forged.match(/^## .*$/gm), ['## 코치', '## keep'], `only the real speaker heading is level 2 outside code:\n${forged}`);
assert.ok(forged.includes('### 큰 제목\n#### 나\n가짜 말\n```py\n# comment\n## keep\n```\n##### 셋'), forged);
// Payment, Slack and Google keys; an invisible character inside a token does not hide it.
for (const [raw, label] of [['sk_live_' + 'a'.repeat(24), 'PAYMENT_KEY'], ['live_sk_' + 'b'.repeat(20), 'PAYMENT_KEY'], ['xoxb-' + '1'.repeat(12) + '-abc', 'SLACK_TOKEN'], ['AIza' + 'c'.repeat(35), 'GOOGLE_KEY'], ['ghp_' + 'D'.repeat(18) + ch(0x200b) + 'D'.repeat(18), 'GITHUB_TOKEN']]) {
  const out = conversationMarkdown({ messages: [{ id: 'u', role: 'user', content: `키 ${raw} 끝`, createdAt: 1 }] });
  assert.ok(out.includes(`«${label} 가려짐»`) && !out.includes(raw.replace(ch(0x200b), '').slice(-12)), `${label}: ${out}`);
}
assert.ok(conversationMarkdown({ messages: [{ id: 'u', role: 'user', content: '가족 ' + String.fromCodePoint(0x1F468, 0x200D, 0x1F469), createdAt: 1 }] }).includes(String.fromCodePoint(0x1F468, 0x200D, 0x1F469)), 'emoji joiner kept');
console.log('PASS conversation copy: order, headings, AE-39 exclusions, credential scrub, control characters, empty conversation');
