// CGP-LEARN-R-007 / CGP-LEARN-D-007 (REQ-CGP-LEARN-07, DES-CGP-LEARN-07) — playback for an animated learning block, pure.
// No shipped block kind animates yet (MATERIAL_MOTION in lessonFocus.ts); this is the controller the first animated kind
// must use. A block starts paused on its first frame; only the learner's 재생 starts play, 멈춤 keeps the frame, and 한 단계
// moves one frame whether or not it is playing. A frame stays at least FRAME_MS_MIN, so nothing changes faster than 3 Hz.

/** At most 3 frame changes per second (WCAG 2.3.1 / DES-CGP-LEARN-07 "no flashing > 3 Hz"). */
export const FRAME_MS_MIN = 334;
/** Frames a block may have: the scene numeral "N / M 장면" stays a small position, like the stepper's 2–8 stages. */
export const FRAMES_MIN = 2;
export const FRAMES_MAX = 8;

export interface Playback { readonly frame: number; readonly frames: number; readonly playing: boolean }

const frameCount = (frames: number) => Math.min(FRAMES_MAX, Math.max(FRAMES_MIN, Number.isSafeInteger(frames) ? frames : FRAMES_MIN));

/** The starting state: paused on the first frame. Also what a reset returns to. */
export const playbackStart = (frames: number): Playback => ({ frame: 0, frames: frameCount(frames), playing: false });
/** 재생: starts only before the last frame. */
export const playbackPlay = (p: Playback): Playback => (p.frame < p.frames - 1 ? { ...p, playing: true } : p);
/** 멈춤: stops on the current frame. */
export const playbackPause = (p: Playback): Playback => (p.playing ? { ...p, playing: false } : p);
/** 한 단계 (and each tick while playing): one frame on; play stops on the last frame. */
export function playbackStep(p: Playback): Playback {
  const frame = Math.min(p.frames - 1, p.frame + 1);
  return { ...p, frame, playing: p.playing && frame < p.frames - 1 };
}
/** The delay between frames while playing, never under FRAME_MS_MIN. */
export const frameDelay = (ms: number): number => (Number.isFinite(ms) && ms > FRAME_MS_MIN ? ms : FRAME_MS_MIN);
/** The visible position, "2 / 4 장면". */
export const sceneLabel = (p: Playback): string => `${p.frame + 1} / ${p.frames} 장면`;
