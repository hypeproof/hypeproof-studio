// CGP-VOICE-R-026 / R-027 (REQ-CGPV-38 / 39): push-to-talk in the voice conversation and the endpoint-detector fallback,
// on the real VoiceConversation and DictationRecorder with scripted browser objects.
//   node --experimental-strip-types test/voice-ptt.smoke.mjs
// - push-to-talk: a session starts with the microphone closed; a hold opens it for one turn, the release ends and sends it;
//   after the answer is read the microphone stays closed until the next hold (no automatic reopen); detected silence never
//   ends a held turn; a release while the microphone is still opening ends the turn as soon as it opens; a hold too short
//   or too long is a retry, never the end of the session;
// - automatic stays the default: start() without a mode is the automatic loop, unchanged;
// - R-027: when the endpoint detector cannot start, the automatic session switches to push-to-talk for that session only,
//   says so, keeps no microphone open, and the next ordinary start is automatic again;
// - the mode store reads junk as the default, refuses junk writes; the host writes only on the learner's request.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VoiceConversation } from '../src/voiceConversation.ts';
import { ReadAloud } from '../src/voiceReadAloud.ts';
import { VOICE_CONVERSATION_MODE_KEY, readConversationMode, writeConversationMode } from '../src/voiceConversationMode.ts';
import { PTT_READY, PTT_TOO_LONG, PTT_TOO_SHORT, VAD_FALLBACK } from '../src/voiceCopy.ts';

function rig({ observeFails = false } = {}) {
  let now = 0, seq = 0, endpoint = null, observeCalls = 0, failNext = observeFails;
  const media = [], stopped = [], clips = [], sends = [], utterances = [], timers = new Map();
  class Rec {
    static isTypeSupported() { return true; }
    state = 'inactive'; ondataavailable = null; onstop = null; onerror = null;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }); queueMicrotask(() => this.onstop?.()); }
  }
  const recorder = {
    getUserMedia: async (c) => { const n = media.push(c); return { getTracks: () => [{ stop() { stopped.push(n); } }] }; },
    Recorder: Rec, now: () => now, setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; }, clearTimeout: (id) => timers.delete(id),
  };
  const speech = new ReadAloud({ synth: { getVoices: () => [], cancel() {}, speak: (u) => utterances.push(u) }, makeUtterance: (text) => ({ text, onend: null, onerror: null, lang: '', rate: 1, voice: null }) });
  const views = [];
  const loop = new VoiceConversation({
    recorder,
    observe: (stream, end) => { observeCalls++; if (failNext) { failNext = false; throw new Error('AudioContext unavailable'); } endpoint = end; return () => {}; },
    scope: () => 's', ready: () => true, transcribe: (id, clip) => clips.push({ id, clip }), submit: (t) => { sends.push(t); return 'u' + sends.length; },
    speech, changed: (v) => views.push(v), id: () => `r${++seq}`,
  });
  const flush = () => new Promise((r) => setImmediate(r));
  const tick = async (ms) => { now += ms; for (const [id, tm] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (tm.at <= now) { timers.delete(id); tm.fn(); } await flush(); await flush(); };
  const answer = () => {
    const n = sends.length;
    loop.host({ type: 'voiceTranscribeResult', requestId: clips.at(-1).id, ok: true, text: '대답' + n });
    loop.host({ type: 'streamStart', streamId: 's' + (n + 1), messageId: 'a' + (n + 1), userMessageId: 'u' + (n + 1) });
    loop.host({ type: 'streamChunk', streamId: 's' + (n + 1), delta: '좋아요.' });
    loop.host({ type: 'streamEnd', streamId: 's' + (n + 1) });
  };
  const live = () => media.length - new Set(stopped).size;
  return { loop, media, clips, sends, utterances, views, flush, tick, answer, live, end: () => endpoint?.(), observeCalls: () => observeCalls, failObserve: () => { failNext = true; } };
}
const phase = (r) => r.loop.state.phase;

// ---- push-to-talk ----
{
  const r = rig();
  r.loop.start({ mode: 'push_to_talk' }); await r.flush();
  assert.deepEqual([phase(r), r.media.length, r.loop.state.note, r.loop.state.mode], ['ready', 0, PTT_READY, 'push_to_talk'], 'a session starts with the microphone closed');
  assert.ok(r.loop.active, 'the session is live while ready');
  r.loop.release(); assert.equal(r.media.length, 0, 'a release without a hold does nothing');
  // verify-4240: start()'s double-press guard. A second start on a live session (a double click, the key and the button)
  // changes nothing: still one session, still no microphone; a second hold during a hold opens no second microphone.
  const viewsBefore = r.views.length;
  r.loop.start({ mode: 'push_to_talk' }); r.loop.start();
  assert.deepEqual([phase(r), r.media.length, r.loop.state.mode, r.views.length], ['ready', 0, 'push_to_talk', viewsBefore], 'start() on a live session is ignored');
  r.loop.hold(); await r.flush();
  assert.deepEqual([phase(r), r.media.length, r.live()], ['listening', 1, 1], 'the hold opens the microphone for one turn');
  r.loop.hold(); await r.flush();
  assert.deepEqual([r.media.length, r.live()], [1, 1], 'a second hold during a hold opens no second microphone');
  r.end(); await r.flush();
  assert.equal(phase(r), 'listening', 'detected silence never ends a held turn');
  await r.tick(1500); r.loop.release(); await r.flush();
  assert.deepEqual([phase(r), r.clips.length, r.live()], ['transcribing', 1, 0], 'the release ends the turn, sends it and closes the microphone');
  r.answer();
  assert.equal(phase(r), 'speaking');
  r.utterances.at(-1).onend(); await r.tick(0);
  assert.deepEqual([phase(r), r.media.length, r.live()], ['ready', 1, 0], 'after the answer the microphone stays closed until the next hold');
  r.loop.hold(); await r.flush(); await r.tick(900); r.loop.release(); await r.flush();
  assert.deepEqual([r.media.length, r.clips.length, r.sends.length], [2, 2, 1], 'the second hold is a second turn');
  r.loop.stop();
  assert.equal(r.live(), 0, 'stop closes everything');
}
{
  // A release while the microphone is still opening ends the turn as soon as it opens; too short is a retry.
  const r = rig();
  r.loop.start({ mode: 'push_to_talk' }); await r.flush();
  r.loop.hold(); r.loop.release();
  assert.equal(phase(r), 'starting', 'control: released during starting');
  await r.flush(); await r.flush(); await r.flush();
  assert.deepEqual([phase(r), r.loop.state.note, r.live(), r.clips.length], ['ready', PTT_TOO_SHORT, 0, 0], 'an instant release: closed, nothing sent, the session goes on');
  r.loop.hold(); await r.flush(); await r.tick(58_000); await r.flush();
  assert.deepEqual([phase(r), r.loop.state.note, r.live(), r.clips.length], ['ready', PTT_TOO_LONG, 0, 0], 'held past the limit: not sent, closed, the session goes on');
  r.loop.stop();
}
{
  // Automatic stays the default and is unchanged.
  const r = rig();
  r.loop.start(); await r.flush();
  assert.deepEqual([phase(r), r.media.length, r.loop.state.mode], ['listening', 1, 'auto'], 'start() without a mode is the automatic loop');
  r.loop.hold(); r.loop.release();
  assert.equal(r.media.length, 1, 'hold and release do nothing in automatic mode');
  await r.tick(1000); r.end(); await r.flush();
  assert.equal(phase(r), 'transcribing', 'a detected end still ends an automatic turn');
  r.loop.stop();
}

// ---- R-027: the endpoint detector fails ----
{
  const r = rig({ observeFails: true });
  r.loop.start(); await r.flush(); await r.flush();
  assert.deepEqual([phase(r), r.loop.state.note, r.loop.state.mode, r.loop.state.fallback, r.live()], ['ready', VAD_FALLBACK, 'push_to_talk', true, 0], 'switched to push-to-talk with its line; no microphone open');
  assert.ok(!r.views.some((v) => v.phase === 'listening'), 'the session never sat in 듣고 있어요 without endpointing');
  r.loop.hold(); await r.flush(); await r.tick(1200); r.loop.release(); await r.flush();
  assert.deepEqual([phase(r), r.clips.length], ['transcribing', 1], 'the fallback session works by holding');
  r.loop.stop();
  r.loop.start(); await r.flush();
  assert.deepEqual([phase(r), r.loop.state.mode, r.loop.state.fallback], ['listening', 'auto', undefined], 'the next ordinary start is automatic again: the fallback was for that session only');
  r.loop.stop();
}

// ---- the mode store ----
for (const junk of [undefined, null, 'auto', 'PTT', true, 1, {}]) assert.equal(readConversationMode(junk), null, `junk ${JSON.stringify(junk)} is the default`);
assert.equal(readConversationMode('push_to_talk'), 'push_to_talk');
assert.equal(writeConversationMode('auto'), null, 'the default is no record');
assert.equal(writeConversationMode('push_to_talk'), 'push_to_talk');
for (const junk of [undefined, null, 'ptt', 1]) assert.equal(writeConversationMode(junk), undefined, `write ${JSON.stringify(junk)} is refused`);
assert.equal(VOICE_CONVERSATION_MODE_KEY, 'hypeproofChat.voiceConversationMode');

// ---- the host and who writes ----
const provider = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const at = provider.indexOf('case "setVoiceConversationMode":');
assert.ok(at > 0, 'the provider handles setVoiceConversationMode');
const body = provider.slice(at, provider.indexOf('return;\n      }', at) + 7);
assert.match(body, /writeConversationMode\(msg\.mode\)/);
assert.match(body, /if \(next === undefined\) return;/, 'a refused write changes nothing');
assert.match(body, /globalState\.update\(VOICE_CONVERSATION_MODE_KEY, next \?\? undefined\)/, 'the default is no record');
assert.match(provider, /\.\.\.\(voiceConversationMode \? \{ voiceConversationMode \} : \{\}\)/, 'the config carries it only when set');
assert.doesNotMatch(provider, /setKeysForSync\s*(\?\.)?\s*\([^)]*VOICE_CONVERSATION_MODE_KEY/, 'never synced');
const loopSrc = readFileSync(new URL('../src/voiceConversation.ts', import.meta.url), 'utf8');
assert.doesNotMatch(loopSrc, /setVoiceConversationMode|postToHost/, 'the loop (and so the R-027 fallback) never writes the stored mode');
const control = readFileSync(new URL('../webview-ui/src/VoiceConversationControl.tsx', import.meta.url), 'utf8');
assert.equal((control.match(/type: 'setVoiceConversationMode'/g) ?? []).length, 1, 'one writer: the learner\'s switch');
console.log('PASS: push-to-talk turns, automatic default, R-027 session-only fallback, mode store and writers');
