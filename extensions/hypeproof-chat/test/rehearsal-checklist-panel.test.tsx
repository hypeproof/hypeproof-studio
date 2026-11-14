// #4102 — the rehearsal panel under the band: the route difference, the expected-stuck checklist, and "학생 말 넣기" that
// only fills the composer (no send). Without the rehearsal signal nothing is drawn.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { RehearsalSeatBand } from '../webview-ui/src/ChatPanel';
import { checklistSnapshot, resetChecklist, setChecklistVerdict, setChecklistNote } from '../webview-ui/src/rehearsalChecklist';
const act = (React as any).act;
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;

const STUCKS = [
  { id: 'stuck-1', expected_stuck: '이 답이 맞는지 모르겠어요.' },
  { id: 'stuck-2', expected_stuck: '그냥 다시 해 주세요.' },
  { id: 'stuck-3', expected_stuck: '어디서부터 봐야 하나요?' },
];
const ROUTE = { rehearsalModel: 'gpt-x', lessonModel: 'gpt-x', minor: false };
const btn = (host: any, text: string) => host.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').includes(text))[0];

async function main() {
  // Control: no signal → nothing from the rehearsal panel.
  resetChecklist();
  const off = mountPoint(); const offRoot = createRoot(off as any);
  await act(async () => offRoot.render(<RehearsalSeatBand visible={false} onEnd={() => undefined} panel={{ stucks: STUCKS, route: ROUTE }} onInsertExpected={() => undefined} />));
  assert.equal(off.textContent.includes('예상 막힘 점검'), false, 'no checklist without the signal');
  assert.equal(off.textContent.includes('리허설과 수업의 차이'), false, 'no route band without the signal');

  // Three stucks → three items, each with the insert button.
  const inserted: string[] = [];
  const host = mountPoint(); const root = createRoot(host as any);
  await act(async () => root.render(<RehearsalSeatBand visible onEnd={() => undefined} panel={{ stucks: STUCKS, route: ROUTE }} onInsertExpected={(t: string) => inserted.push(t)} />));
  assert.ok(host.textContent.includes('예상 막힘 점검'), 'the checklist title');
  const inserts = host.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').includes('학생 말 넣기'));
  assert.equal(inserts.length, 3, 'three items, three insert buttons');
  assert.ok(host.textContent.includes('이 답이 맞는지 모르겠어요.'), 'the expected stuck text is shown');

  // "학생 말 넣기" fills the composer (the callback) and sends nothing; the callback is the only effect.
  await act(async () => click(inserts[1]));
  assert.deepEqual(inserted, ['그냥 다시 해 주세요.'], 'the callback receives the learner text');

  // Route lines: the rehearsal name, the lesson line, and the server-record line.
  assert.ok(host.textContent.includes('리허설: 내 구독 · gpt-x'), 'rehearsal model line');
  assert.ok(host.textContent.includes('수업: 서버 · gpt-x'), 'lesson model line');
  assert.ok(host.textContent.includes('리허설 대화는 서버 기록에 남지 않습니다.'), 'server record line');
  assert.equal(host.textContent.includes('리허설 모델과 수업 모델이 다릅니다'), false, 'same models: no difference line');
  assert.equal(host.textContent.includes('미성년'), false, 'not a minor class: no minor lines');

  // Verdicts: 알맞음 marks fits; 고칠 것 marks fix and shows the note box; the note is kept.
  const fits = host.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').trim() === '알맞음');
  const fixes = host.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').trim() === '고칠 것');
  assert.equal(fits.length, 3);
  await act(async () => click(fits[0]));
  await act(async () => click(fixes[2]));
  assert.ok(host.findAll((e: any) => e.localName === 'textarea' && e.getAttribute('aria-label') === '무엇을 고칠지 적으세요').length === 1, 'one note box, for the item marked 고칠 것');
  assert.deepEqual(checklistSnapshot(), [
    { id: 'stuck-1', verdict: 'fits' },
    { id: 'stuck-3', verdict: 'fix' },
  ]);

  // Empty list: the sentence, and no insert buttons.
  resetChecklist();
  const empty = mountPoint(); const emptyRoot = createRoot(empty as any);
  await act(async () => emptyRoot.render(<RehearsalSeatBand visible onEnd={() => undefined} panel={{ stucks: [], route: ROUTE }} onInsertExpected={() => undefined} />));
  assert.ok(empty.textContent.includes('계획서 13절에 예상 막힘이 없습니다.'), 'the empty-list sentence');
  assert.equal(empty.findAll((e: any) => e.localName === 'button' && (e.textContent ?? '').includes('학생 말 넣기')).length, 0);

  // Differing models and a minor class: the difference sentence and the two minor lines.
  const diff = mountPoint(); const diffRoot = createRoot(diff as any);
  await act(async () => diffRoot.render(<RehearsalSeatBand visible onEnd={() => undefined} panel={{ stucks: [], route: { rehearsalModel: 'gpt-x', lessonModel: 'other', minor: true } }} onInsertExpected={() => undefined} />));
  assert.ok(diff.textContent.includes('리허설 모델과 수업 모델이 다릅니다. 학생이 받는 답과 다를 수 있습니다.'), 'difference sentence');
  assert.ok(diff.textContent.includes('리허설에서는 미성년 내용 검사가 없습니다.'), 'minor line 1');
  assert.ok(diff.textContent.includes('리허설에서는 미성년 답변 길이 제한이 없습니다.'), 'minor line 2');

  // Unknown names: 알 수 없음, and no difference sentence (the difference cannot be told).
  const unknown = mountPoint(); const unknownRoot = createRoot(unknown as any);
  await act(async () => unknownRoot.render(<RehearsalSeatBand visible onEnd={() => undefined} panel={{ stucks: [], route: { rehearsalModel: null, lessonModel: null, minor: false } }} onInsertExpected={() => undefined} />));
  assert.ok(unknown.textContent.includes('리허설: 내 구독 · 알 수 없음'), 'unknown rehearsal model');
  assert.ok(unknown.textContent.includes('수업: 서버 · 알 수 없음'), 'unknown lesson model');
  assert.equal(unknown.textContent.includes('다릅니다'), false);

  console.log('rehearsal-checklist-panel render checks passed');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
