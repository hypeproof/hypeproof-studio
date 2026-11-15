// CGP-LEARN-R-007 / CGP-LEARN-D-007 — the playback controls an animated learning block must use (src/blockPlayback.ts holds
// the rules). It starts paused; 재생 / 멈춤 / 한 단계 are 44px quiet buttons. When motion is reduced (the host's
// workbench.reduceMotion or the OS setting, motion.ts), 재생 is not offered and a running play stops; 한 단계 stays.
// Play also stops while the page is hidden and does not resume by itself. Focus never drops to the page: 재생 / 멈춤 is one
// button whose label changes, an unavailable button stays focusable (aria-disabled, not disabled), and when reduced motion
// removes 재생 / 멈춤 while it has focus, focus moves to 한 단계. There are no key shortcuts: unlike stage_stepper's ←/→
// (one stage per press), a frame is a step of motion, and the three buttons are already one Tab stop each.
import { useEffect, useRef, useState } from "react";
import { frameDelay, playbackPause, playbackPlay, playbackStart, playbackStep, sceneLabel, type Playback } from "../../src/blockPlayback";
import { motionReduced } from "./motion";

/** Follows the reduced-motion preference live: the host attribute and the OS media query. */
export function useMotionReduced(): boolean {
  const [reduced, setReduced] = useState(() => motionReduced());
  useEffect(() => {
    const update = () => setReduced(motionReduced());
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    query?.addEventListener?.("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
    return () => { query?.removeEventListener?.("change", update); observer.disconnect(); };
  }, []);
  return reduced;
}

/** Playback state for `frames` frames. The block draws `state.frame`; the controls change it. */
export function useBlockPlayback(frames: number, frameMs: number) {
  const [state, setState] = useState<Playback>(() => playbackStart(frames));
  const reduced = useMotionReduced();
  useEffect(() => { setState(playbackStart(frames)); }, [frames]);
  useEffect(() => { if (reduced) setState(playbackPause); }, [reduced]);
  // A hidden page (another tab, a minimised window) stops play; coming back does not resume it.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setState(playbackPause); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!state.playing || reduced) return;
    const t = setTimeout(() => setState(playbackStep), frameDelay(frameMs));
    return () => clearTimeout(t);
  }, [state, reduced, frameMs]);
  return {
    state, reduced,
    play: () => setState(playbackPlay),
    pause: () => setState(playbackPause),
    step: () => setState(playbackStep),
    reset: () => setState(playbackStart(frames)),
  };
}

export function PlaybackControls(props: { playback: ReturnType<typeof useBlockPlayback> }) {
  const { state, reduced, play, pause, step } = props.playback;
  const last = state.frame >= state.frames - 1;
  const toggleFocused = useRef(false), stepRef = useRef<HTMLButtonElement>(null);
  // Reduced motion removes 재생 / 멈춤; if it had focus, hand focus to 한 단계 instead of the page.
  useEffect(() => {
    if (reduced && toggleFocused.current) { toggleFocused.current = false; stepRef.current?.focus(); }
  }, [reduced]);
  const toggleOff = !state.playing && last;
  return (
    <div className="hp-playback" data-block-playback="" data-playing={state.playing ? "true" : "false"}>
      <p className="hp-playback-scene" data-playback-scene="">{sceneLabel(state)}</p>
      <div className="hp-playback-nav">
        {reduced ? null : (
          <button type="button" className="hp-cta-quiet" {...(state.playing ? { "data-playback-pause": "" } : { "data-playback-play": "" })}
            aria-disabled={toggleOff ? "true" : undefined}
            onFocus={() => { toggleFocused.current = true; }} onBlur={() => { toggleFocused.current = false; }}
            onClick={() => { if (state.playing) pause(); else if (!toggleOff) play(); }}>{state.playing ? "멈춤" : "재생"}</button>
        )}
        <button type="button" className="hp-cta-quiet" data-playback-step="" ref={stepRef} aria-disabled={last ? "true" : undefined}
          onClick={() => { if (!last) step(); }}>한 단계</button>
      </div>
    </div>
  );
}
