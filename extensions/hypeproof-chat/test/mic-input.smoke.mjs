// CGP-VOICE-R-019 / D-015 (REQ-CGPV-23 / DES-CGPV-23): the microphone choice, without the app.
//   node --experimental-strip-types test/mic-input.smoke.mjs
// - the stored record: an id and a label only; junk of any shape reads as the system default; a write is refused
//   unless it is a choice or null;
// - the device list: audio inputs only, the browser's default/communications pseudo-entries dropped, null while
//   the browser hides the list (no permission), [] when there is no microphone;
// - resolution: the id first, then the one device with the same label, else missing;
// - capture (the real DictationRecorder): the exact device constraint for a chosen microphone; a missing one never
//   opens a microphone and fails as mic_missing (never silently the default); an Overconstrained/NotFound answer to
//   the exact constraint is mic_missing too; one explicit "use the default" start records with { audio: true };
// - the voice conversation (the real VoiceConversation): each listening turn reads the current choice, so a change
//   applies at the next turn with the old tracks already stopped (VO-29), and a missing microphone stops it with its line;
// - the host (source): one write path, refused junk changes nothing, the record goes into the webview config only
//   when set, never into a log, a sync key, the Service or a problem report.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIC_INPUT_KEY, MIC_MISSING_VALUE, choiceForPick, listMicDevices, micAudioConstraint, micOptions, readMicChoice, resolveMicChoice, writeMicChoice,
} from '../src/micInput.ts';
import { DictationRecorder } from '../src/voiceDictation.ts';
import { recoveryFor } from '../src/dictationRecovery.ts';
import { VoiceConversation } from '../src/voiceConversation.ts';
import { ReadAloud } from '../src/voiceReadAloud.ts';
import { CONVERSATION_MIC_MISSING } from '../src/voiceCopy.ts';

const HEX = (c) => c.repeat(64);
const A = { id: HEX('a'), label: 'USB 헤드셋' }, B = { id: HEX('b'), label: '내장 마이크' };

// ---- the stored record ----
for (const junk of [undefined, null, false, 1, 'x', [], {}, { id: 3 }, { id: '' }, { id: '   ' }, { id: 'default' }, { id: 'communications' }, { id: 'x'.repeat(257) }]) {
  assert.equal(readMicChoice(junk), null, `junk ${JSON.stringify(junk)} is the default`);
}
assert.deepEqual(readMicChoice({ id: A.id, label: A.label, audio: 'x', extra: 1 }), A, 'only id and label are read');
assert.deepEqual(readMicChoice({ id: A.id }), { id: A.id, label: '' }, 'a missing label is empty');
assert.equal(readMicChoice({ id: A.id, label: 'L'.repeat(500) }).label.length, 200, 'the label is bounded');
assert.equal(writeMicChoice(null), null, 'null is the system default');
for (const junk of [undefined, 'default', 5, {}, { id: 'default' }]) assert.equal(writeMicChoice(junk), undefined, `write ${JSON.stringify(junk)} is refused`);
assert.deepEqual(writeMicChoice({ ...A, x: 1 }), A, 'a choice is written cleaned');

// ---- the device list ----
assert.equal(listMicDevices(null), null, 'no list');
assert.deepEqual(listMicDevices([]), [], 'no devices at all: an empty list');
assert.equal(listMicDevices([{ kind: 'audioinput', deviceId: '', label: '' }, { kind: 'audioinput', deviceId: '', label: '' }]), null, 'hidden before permission (empty ids)');
assert.deepEqual(listMicDevices([
  { kind: 'audioinput', deviceId: 'default', label: '기본값 - USB 헤드셋' },
  { kind: 'audioinput', deviceId: 'communications', label: '통신' },
  { kind: 'videoinput', deviceId: HEX('c'), label: '카메라' },
  { kind: 'audiooutput', deviceId: HEX('d'), label: '스피커' },
  { kind: 'audioinput', deviceId: A.id, label: A.label },
  { kind: 'audioinput', deviceId: A.id, label: A.label },
  { kind: 'audioinput', deviceId: B.id, label: '' },
]), [A, { id: B.id, label: '' }], 'audio inputs only, pseudo-entries dropped, de-duplicated, order kept');

// ---- resolution ----
assert.deepEqual(resolveMicChoice(null, [A]), { kind: 'default' });
assert.deepEqual(resolveMicChoice(A, [B, A]), { kind: 'device', id: A.id }, 'by id');
assert.deepEqual(resolveMicChoice(A, [B, { id: HEX('e'), label: A.label }]), { kind: 'device', id: HEX('e') }, 'a new id for the same label');
assert.deepEqual(resolveMicChoice(A, [{ id: HEX('e'), label: A.label }, { id: HEX('f'), label: A.label }]), { kind: 'missing' }, 'two devices with that label: not guessed');
assert.deepEqual(resolveMicChoice({ id: A.id, label: '' }, [{ id: HEX('e'), label: '' }]), { kind: 'missing' }, 'an empty label never matches');
assert.deepEqual(resolveMicChoice(A, [B]), { kind: 'missing' }, 'unplugged');
assert.deepEqual(resolveMicChoice(A, []), { kind: 'missing' }, 'no microphone at all');
assert.deepEqual(resolveMicChoice(A, null), { kind: 'device', id: A.id }, 'list hidden: try the id, the browser decides');
assert.equal(micAudioConstraint(null), true);
assert.deepEqual(micAudioConstraint(A.id), { deviceId: { exact: A.id } });

// ---- the picker's options ----
const copy = { system: '시스템 기본값', missing: '연결되지 않은 마이크', numbered: (n) => `마이크 ${n}`, chosen: '고른 마이크' };
assert.deepEqual(micOptions([A, { id: B.id, label: '' }], null, copy), { options: [{ value: '', text: '시스템 기본값' }, { value: A.id, text: A.label }, { value: B.id, text: '마이크 2' }], value: '' });
assert.deepEqual(micOptions([B], A, copy).value, MIC_MISSING_VALUE, 'a missing choice selects 연결되지 않은 마이크');
assert.deepEqual(micOptions([B], A, copy).options.at(-1), { value: MIC_MISSING_VALUE, text: '연결되지 않은 마이크' });
assert.deepEqual(micOptions(null, A, copy), { options: [{ value: '', text: '시스템 기본값' }, { value: A.id, text: A.label }], value: A.id }, 'hidden list: the stored choice by its label');
assert.equal(choiceForPick('', [A]), null);
assert.equal(choiceForPick(MIC_MISSING_VALUE, [A]), undefined, 'picking 연결되지 않은 마이크 changes nothing');
assert.deepEqual(choiceForPick(A.id, [A, B]), A);
assert.ok(!MIC_MISSING_VALUE.match(/^[0-9a-f]+$/), 'the missing value is never a device id');

// ---- capture through the real recorder ----
function recorderRig({ devices = [A, B], choice = A, error = null } = {}) {
  const calls = [], failures = [], states = [];
  let stopped = 0, listed = 0;
  class Rec { static isTypeSupported() { return true; } state = 'inactive'; ondataavailable = null; onstop = null; onerror = null; start() { this.state = 'recording'; } stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); } }
  const env = {
    getUserMedia: async (c) => { calls.push(c); if (error) throw Object.assign(new Error('label might be here'), { name: error }); return { getTracks: () => [{ stop() { stopped++; } }] }; },
    Recorder: Rec, now: () => 0, setTimeout: () => 1, clearTimeout() {},
    listMics: async () => { listed++; return devices; },
    micChoice: () => choice,
  };
  const r = new DictationRecorder(env, { onState: (s) => states.push(s), onClip() {}, onFailure: (k) => failures.push(k) });
  return { r, calls, failures, states, stats: () => ({ stopped, listed }) };
}
{
  const x = recorderRig(); await x.r.start();
  assert.deepEqual(x.calls, [{ audio: { deviceId: { exact: A.id } } }], 'the chosen microphone, exactly');
  x.r.cancel();
}
{
  const x = recorderRig({ devices: [B] }); await x.r.start();
  assert.deepEqual([x.calls.length, x.failures, x.r.current], [0, ['mic_missing'], 'idle'], 'unplugged: no microphone opened, mic_missing');
  await x.r.start({ useDefault: true });
  assert.deepEqual(x.calls, [{ audio: true }], 'one explicit press records with the default');
  x.r.cancel();
  await x.r.start();
  assert.deepEqual([x.calls.length, x.failures], [1, ['mic_missing', 'mic_missing']], 'the next press asks again: the choice is kept');
}
{
  const x = recorderRig({ devices: [B, { id: HEX('e'), label: A.label }] }); await x.r.start();
  assert.deepEqual(x.calls, [{ audio: { deviceId: { exact: HEX('e') } } }], 'the same headset under a new id');
  x.r.cancel();
}
for (const error of ['OverconstrainedError', 'NotFoundError']) {
  const x = recorderRig({ devices: null, error }); await x.r.start();
  assert.deepEqual(x.failures, ['mic_missing'], `${error} on the exact constraint is mic_missing`);
}
{
  const x = recorderRig({ choice: null, error: 'NotFoundError' }); await x.r.start();
  assert.deepEqual([x.failures, x.stats().listed], [['no_mic'], 0], 'no choice: no listing, the ordinary no_mic');
  const y = recorderRig({ choice: null }); await y.r.start();
  assert.deepEqual(y.calls, [{ audio: true }], 'no choice: { audio: true } as before');
  y.r.cancel();
}
{
  const x = recorderRig(); x.r.start(); x.r.cancel(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(x.calls.length, 0, 'cancelled while listing: no microphone opened');
}
assert.equal(recoveryFor('mic_missing', false, false), 'use_default', 'its one action: 기본 마이크로 녹음');

// ---- the voice conversation ----
function convRig(devices) {
  const calls = []; let stopped = 0, choice = A, seq = 0, endpoint; const timers = new Map(); let now = 0;
  class Rec { static isTypeSupported() { return true; } state = 'inactive'; ondataavailable = null; onstop = null; onerror = null; start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }); queueMicrotask(() => this.onstop?.()); } }
  const recorder = { getUserMedia: async (c) => { calls.push(c); return { getTracks: () => [{ stop() { stopped++; } }] }; }, Recorder: Rec, now: () => now, setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; }, clearTimeout: (id) => timers.delete(id), listMics: async () => devices.value, micChoice: () => choice };
  const utterances = [];
  const speech = new ReadAloud({ synth: { getVoices: () => [], cancel() {}, speak: (u) => utterances.push(u) }, makeUtterance: (text) => ({ text, onend: null, onerror: null, lang: '', rate: 1, voice: null }) });
  const clips = [], sends = [];
  const loop = new VoiceConversation({ recorder, observe: (s, end) => { endpoint = end; return () => {}; }, scope: () => 's', ready: () => true, transcribe: (id, clip) => clips.push({ id, clip }), submit: (t) => { sends.push(t); return 'u' + sends.length; }, speech, changed() {}, id: () => `r${++seq}` });
  const flush = () => new Promise((r) => setImmediate(r));
  const tick = async (ms) => { now += ms; for (const [id, tm] of [...timers]) if (tm.at <= now) { timers.delete(id); tm.fn(); } await flush(); };
  return { loop, calls, clips, utterances, flush, tick, end: () => endpoint(), set: (c) => { choice = c; }, stopped: () => stopped };
}
{
  const devices = { value: [A, B] };
  const c = convRig(devices);
  c.loop.start(); await c.flush();
  assert.deepEqual(c.calls, [{ audio: { deviceId: { exact: A.id } } }], 'the conversation records from the chosen microphone');
  c.set(B);   // changed in settings mid-session
  await c.tick(1000); c.end(); await c.flush();
  const before = c.stopped();
  assert.ok(before >= 1, 'the first turn released its tracks');
  c.loop.host({ type: 'voiceTranscribeResult', requestId: c.clips[0].id, ok: true, text: '대답' });
  c.loop.host({ type: 'streamStart', streamId: 's1', messageId: 'a1', userMessageId: 'u1' });
  c.loop.host({ type: 'streamChunk', streamId: 's1', delta: '좋아요.' });
  c.loop.host({ type: 'streamEnd', streamId: 's1' });
  c.utterances.at(-1).onend(); await c.tick(0); await c.flush();
  assert.deepEqual(c.calls.at(-1), { audio: { deviceId: { exact: B.id } } }, 'the next listening turn uses the new choice, same session');
  assert.equal(c.calls.length, 2, 'one microphone per turn: nothing accumulates');
  assert.notEqual(c.loop.state.phase, 'stopped', 'the session went on');
  c.loop.stop();
  const gone = convRig({ value: [B] });
  gone.loop.start(); await gone.flush();
  assert.deepEqual([gone.calls.length, gone.loop.state.phase, gone.loop.state.note], [0, 'stopped', CONVERSATION_MIC_MISSING], 'a missing microphone stops the conversation with its line, never the default');
}

// ---- the host ----
const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const at = src.indexOf('case "setMicInput":');
assert.ok(at > 0, 'the provider handles setMicInput');
const body = src.slice(at, src.indexOf('return;\n      }', at) + 7);
assert.match(body, /writeMicChoice\(msg\.choice\)/, 'one write path through writeMicChoice');
assert.match(body, /if \(next === undefined\) return;/, 'a refused write changes nothing');
assert.match(body, /globalState\.update\(MIC_INPUT_KEY, next \?\? undefined\)/, 'the default is no record');
assert.match(body, /postConfig\(\)/, 'the chat gets the new choice');
assert.doesNotMatch(body, /console\.|log\(|telemetry|report|fetch|serviceFetch/i, 'never logged, reported or sent');
assert.match(src, /\.\.\.\(micInput \? \{ micInput \} : \{\}\)/, 'the config carries it only when set (unchanged config otherwise)');
assert.doesNotMatch(src, /setKeysForSync\([^)]*MIC_INPUT_KEY/, 'never synced between computers');
assert.equal(MIC_INPUT_KEY, 'hypeproofChat.micInput');
for (const f of ['problemReport.ts', 'problemReportHost.ts', 'reportProblem.ts', 'reportProblemHelpers.ts', 'studioDoctorHost.ts', 'voiceHost.ts']) {
  let text = '';
  try { text = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'); } catch { continue; }
  assert.doesNotMatch(text, /micInput|MIC_INPUT_KEY/, `${f} never reads the microphone choice`);
}
const protocol = readFileSync(new URL('../src/protocol.ts', import.meta.url), 'utf8');
assert.match(protocol, /\{ type: "setMicInput"; choice: \{ id: string; label: string \} \| null \}/, 'the webview message');
assert.match(protocol, /micInput\?: \{ id: string; label: string \};/, 'the config field');
console.log('PASS: mic-input record, list, resolution, capture, conversation and host wiring');
