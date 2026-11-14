// CGP-VOICE-R-030 (REQ-CGPV-43) — the live voice task store and the rail row's accessible name. Pure; Node only.
import assert from 'node:assert/strict';
import { VoiceLiveTask, VOICE_LIVE_TASK_TEXT, voiceTaskAccessibleName } from '../src/voiceLiveTask.ts';

const s = new VoiceLiveTask();
let calls = 0;
const off = s.subscribe(() => calls++);
assert.equal(s.get(), null);
s.set('t1'); assert.equal(s.get(), 't1'); assert.equal(calls, 1);
s.set('t1'); assert.equal(calls, 1, 'the same task notifies once');
s.set(''); assert.equal(s.get(), null, 'an empty id is no task'); assert.equal(calls, 2);
s.set(null); assert.equal(calls, 2, 'already none');
off(); s.set('t2'); assert.equal(calls, 2, 'unsubscribed');
assert.equal(VOICE_LIVE_TASK_TEXT, '음성 대화 중');
assert.equal(voiceTaskAccessibleName(undefined, '질문 만들기', false), undefined, 'not live: the button keeps its own text as its name');
assert.equal(voiceTaskAccessibleName(undefined, '질문 만들기', true), '질문 만들기, 음성 대화 중');
assert.equal(voiceTaskAccessibleName('질문 만들기, 작업 중', '질문 만들기', true), '질문 만들기, 작업 중, 음성 대화 중', 'after the run state');
assert.equal(voiceTaskAccessibleName('질문 만들기, 작업 중', '질문 만들기', false), '질문 만들기, 작업 중');
console.log('voice-live-task: store and row name checks passed');
