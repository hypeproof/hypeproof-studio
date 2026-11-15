// CGP-VOICE-D-010: the decorative input level is closed with the recording. verify-r004 on #4137: emptying the
// browser meter's close() passed every test. Here the real meter (webAudioLevelMeter) runs on a fake AudioContext
// inside the real DictationRecorder; stop, cancel and the 58 s hard stop must each disconnect the source and the
// analyser and close the context, exactly once. The analyser is never connected to the output.
//   node --experimental-strip-types test/dictation-level-meter.smoke.mjs
import assert from 'node:assert/strict';
import { DictationRecorder, DICTATION_STOP_AT_MS, webAudioLevelMeter, levelOf } from '../src/voiceDictation.ts';

function fakeAudio() {
  const log = [];
  class FakeContext {
    constructor() { log.push('context'); this.destination = { name: 'destination' }; }
    createMediaStreamSource() { return { connect: (to) => log.push(`source->${to.name}`), disconnect: () => log.push('source.disconnect') }; }
    createAnalyser() { return { name: 'analyser', fftSize: 0, getFloatTimeDomainData: (b) => { for (let i = 0; i < b.length; i++) b[i] = 0.25; log.push('read'); }, connect: (to) => log.push(`analyser->${to.name}`), disconnect: () => log.push('analyser.disconnect') }; }
    close() { log.push('context.close'); return Promise.resolve(); }
  }
  return { FakeContext, log };
}
class FakeRecorder {
  static isTypeSupported(m) { return m.startsWith('audio/webm'); }
  constructor() { this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
}
function rig(Ctx) {
  let clock = 0; const timers = [];
  const env = {
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    Recorder: FakeRecorder, now: () => clock,
    setTimeout: (fn, ms) => { const t = { at: clock + ms, fn }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    levelMeter: (stream) => webAudioLevelMeter(Ctx, stream),
  };
  const rec = new DictationRecorder(env, { onState() {}, onClip() {}, onFailure() {} });
  return { rec, advance: (ms) => { clock += ms; for (const t of [...timers]) if (t.at <= clock) { timers.splice(timers.indexOf(t), 1); t.fn(); } } };
}
const closed = (log) => ['source.disconnect', 'analyser.disconnect', 'context.close'].map((k) => log.filter((x) => x === k).length);

// The meter itself: the stream feeds the analyser, never the speakers; a read gives the RMS level.
{
  const { FakeContext, log } = fakeAudio();
  const m = webAudioLevelMeter(FakeContext, {});
  assert.ok(m, 'a meter with Web Audio');
  assert.equal(m.read(), levelOf(new Float32Array(1024).fill(0.25)), 'the level is the RMS of the block');
  assert.ok(log.includes('source->analyser') && !log.some((x) => x.includes('->destination')), `never connected to the output: ${log}`);
  assert.equal(webAudioLevelMeter(undefined, {}), null, 'no Web Audio: no meter');
}
for (const [name, end] of [['stop', (r) => r.rec.stop()], ['cancel', (r) => r.rec.cancel()], ['hard stop', (r) => r.advance(DICTATION_STOP_AT_MS)]]) {
  const { FakeContext, log } = fakeAudio();
  const r = rig(FakeContext);
  await r.rec.start();
  assert.equal(r.rec.current, 'recording', `${name}: recording`);
  assert.ok(r.rec.level() !== null, `${name}: the meter is read while recording`);
  assert.deepEqual(closed(log), [0, 0, 0], `${name}: nothing closed while recording`);
  end(r);
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(closed(log), [1, 1, 1], `${name}: source and analyser disconnected and the context closed, once (${log})`);
  assert.equal(r.rec.level(), null, `${name}: no level after the recording`);
}
console.log('PASS dictation level meter: never connected to the output; disconnected and closed exactly once on stop, cancel and the hard stop');
