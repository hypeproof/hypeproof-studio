// Deterministic WAV fixtures for the microphone replay test. Generated at run time so no
// audio binary is committed. 48 kHz mono 16-bit PCM: Chromium's fake capture device
// reads the file as is, and 48 kHz matches the AudioContext rate so no resampling blurs
// the envelope checks.

export const RATE = 48000;

/** Each fixture is a list of segments; `freq: 0` is silence. `clip` hard-clips at ±1. */
export const FIXTURES = {
  // Speech-like: a tone with a 4 Hz amplitude envelope (syllable rate), looped.
  tone: { loop: true, segments: [{ ms: 2000, freq: 523, amp: 0.25, syllables: 4 }] },
  silence: { loop: true, segments: [{ ms: 2000, freq: 0 }] },
  // 1.5x sine clipped at ±1: about 48% of samples sit on the rail.
  clipping: { loop: true, segments: [{ ms: 2000, freq: 440, amp: 1.5, clip: true }] },
  // Played once (%noloop). Leading silence gives the capture graph time to connect.
  short: { loop: false, segments: [{ ms: 150, freq: 0 }, { ms: 300, freq: 700, amp: 0.3 }] },
  long: {
    loop: false,
    segments: [{ ms: 150, freq: 0 }, ...[300, 500, 700, 900, 1100, 1300, 1500, 1700].map(freq => ({ ms: 1000, freq, amp: 0.3 }))],
  },
};

export function samplesFor(fixture) {
  const out = [];
  for (const s of fixture.segments) {
    const n = Math.round((s.ms / 1000) * RATE);
    for (let i = 0; i < n; i++) {
      if (!s.freq) { out.push(0); continue; }
      const t = i / RATE;
      let v = s.amp * Math.sin(2 * Math.PI * s.freq * t);
      if (s.syllables) v *= 0.55 + 0.45 * Math.sin(2 * Math.PI * s.syllables * t);
      if (s.clip) v = Math.max(-1, Math.min(1, v));
      out.push(v);
    }
  }
  return out;
}

export function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Expected (start ms, end ms, freq) of every audible segment, for the played-once checks. */
export function audibleSegments(fixture) {
  let t = 0;
  const out = [];
  for (const s of fixture.segments) {
    if (s.freq) out.push({ startMs: t, endMs: t + s.ms, freq: s.freq });
    t += s.ms;
  }
  return out;
}

export const durationMs = fixture => fixture.segments.reduce((a, s) => a + s.ms, 0);
