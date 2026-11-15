// CGP-LEARN-R-007 / CGP-LEARN-D-007 — the playback controls an animated learning block must use (src/blockPlayback.ts holds
// the rules). It starts paused; 재생 / 멈춤 / 한 단계 are 44px quiet buttons. When motion is reduced (the host's
// workbench.reduceMotion or the OS setting, motion.ts), 재생 is not offered and a running play stops; 한 단계 stays.
import { useEffect, useState } from "react";
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
  return (
    <div className="hp-playback" data-block-playback="" data-playing={state.playing ? "true" : "false"}>
      <p className="hp-playback-scene" data-playback-scene="">{sceneLabel(state)}</p>
      <div className="hp-playback-nav">
        {reduced ? null : state.playing
          ? <button type="button" className="hp-cta-quiet" data-playback-pause="" onClick={pause}>멈춤</button>
          : <button type="button" className="hp-cta-quiet" data-playback-play="" disabled={last} onClick={play}>재생</button>}
        <button type="button" className="hp-cta-quiet" data-playback-step="" disabled={last} onClick={step}>한 단계</button>
      </div>
    </div>
  );
}
