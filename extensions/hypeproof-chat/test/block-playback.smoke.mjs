// CGP-LEARN-R-007 / CGP-LEARN-D-007 — the pure playback rules (src/blockPlayback.ts) and the motion flag on every kind.
import assert from 'node:assert/strict';
import * as P from '../src/blockPlayback.ts';
import { MATERIAL_KINDS, MATERIAL_MOTION } from '../src/lessonFocus.ts';

let n = 0; const ok = (what) => { n++; console.log('  ok ', what); };

{
  const s = P.playbackStart(5);
  assert.deepEqual(s, { frame: 0, frames: 5, playing: false });
  assert.equal(P.sceneLabel(s), '1 / 5 장면');
  ok('starts paused on the first frame');
}
{
  let s = P.playbackPlay(P.playbackStart(4));
  assert.equal(s.playing, true);
  s = P.playbackStep(s); assert.deepEqual(s, { frame: 1, frames: 4, playing: true });
  const paused = P.playbackPause(s); assert.deepEqual(paused, { frame: 1, frames: 4, playing: false }, 'pause keeps the frame');
  assert.deepEqual(P.playbackStep(paused), { frame: 2, frames: 4, playing: false }, 'one step while paused stays paused');
  s = P.playbackStep(P.playbackStep(s)); assert.deepEqual(s, { frame: 3, frames: 4, playing: false }, 'play stops on the last frame');
  assert.deepEqual(P.playbackStep(s), s, 'no step past the end');
  assert.deepEqual(P.playbackPlay(s), s, 'no play from the last frame');
  assert.deepEqual(P.playbackPause(P.playbackStart(4)), P.playbackStart(4));
  ok('play, pause keeps the frame, one step, stop at the end');
}
{
  assert.equal(P.FRAME_MS_MIN, 334);
  for (const ms of [0, 50, 333, -1, NaN, Infinity]) assert.equal(P.frameDelay(ms), 334, String(ms));
  assert.equal(P.frameDelay(600), 600);
  assert.ok(1000 / P.FRAME_MS_MIN <= 3, 'at most 3 changes a second');
  ok('a frame lasts at least 334 ms (<= 3 Hz)');
}
{
  assert.equal(P.playbackStart(1).frames, 2); assert.equal(P.playbackStart(20).frames, 8); assert.equal(P.playbackStart(2.5).frames, 2);
  ok('2–8 frames');
}
{
  assert.deepEqual(Object.keys(MATERIAL_MOTION).sort(), [...MATERIAL_KINDS].sort());
  assert.deepEqual([...new Set(Object.values(MATERIAL_MOTION))], ['static'], 'no shipped kind animates yet');
  ok('every kind has a motion flag; all static today');
}
console.log(`${n} block playback checks passed`);
