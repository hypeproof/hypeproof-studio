// Read-aloud on a completed answer (REQ-CGPV-24, CGP-CHAT-R-009): "읽어 주기" in the answer's action
// row. The operating system's own voice reads it, in Korean, on this device: no Service call and no
// network (src/voiceReadAloud.ts calls nothing but `speechSynthesis`). Plays only on a press; one
// answer at a time; the same button stops it. Nothing is stored and nothing is logged.
//
// Control (CGP-CHAT-D-009, design row CGP-CHAT-D67): idle = speaker glyph + "읽어 주기"; while this
// answer is read = pressed (`aria-pressed`, a fill in voice.css), the still level glyph and "그만 읽기".
// The shared hub means at most one button in the window is ever pressed.
//
// CGP-VOICE-R-002: the voice panel's 소리 끄기 holds it (disabled, the reason in its name) and stops a
// reading in the same press; the microphone switch never affects it.
//
// CGP-VOICE-R-028 / DES-CGPV-41: when the engine refuses to start sound without a press (autoplay
// policy, `not-allowed`), the answer is not shown as being read; one quiet inline notice
// "소리가 막혔어요." with one action "소리 켜기" reads on from where it stopped. No modal, no focus
// move, no motion; the notice goes away once pressed, stopped or silenced.
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ChatIcon } from "./ChatDetails";
import { useVoice } from "./VoiceProvider";
import { CLASS_OFF, OUTPUT_OFF, READ_ALOUD_BLOCKED, READ_ALOUD_LABEL, READ_ALOUD_RESUME, READ_ALOUD_OUTPUT_OFF, READ_ALOUD_PLAYING, READ_ALOUD_STOP, READ_ALOUD_UNAVAILABLE } from "../../src/voiceCopy";
import { windowOutputMute } from "../../src/voiceOutputMute";
import { ReadAloud, type SpeechEnv } from "../../src/voiceReadAloud";

/** The browser's synthesizer. Tests replace this with a scripted one. */
export function browserSpeechEnv(): SpeechEnv {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function" ? window.speechSynthesis : undefined;
  return {
    synth: synth as unknown as SpeechEnv["synth"],
    makeUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as ReturnType<SpeechEnv["makeUtterance"]>,
  };
}
export const SpeechEnvContext = createContext<() => SpeechEnv>(browserSpeechEnv);

/** One hub for the window, so a second answer stops the first. It obeys the window's speaker switch (CGP-VOICE-R-002). */
let shared: ReadAloud | null = null;
let sharedFor: (() => SpeechEnv) | null = null;
function hubFor(make: () => SpeechEnv): ReadAloud {
  if (!shared || sharedFor !== make) { shared?.stop(); shared?.dispose(); shared = new ReadAloud(make(), windowOutputMute); sharedFor = make; }
  return shared;
}

/**
 * CGP-VOICE-R-007: the window's hub, only where the Service serves read-aloud; null elsewhere, so a seat
 * without voice never touches the synthesizer. The voice panel's owner passes it as `statusSpeech`.
 */
export function useServedReadAloud(): ReadAloud | null {
  const voice = useVoice();
  const make = useContext(SpeechEnvContext);
  return voice.availability.kind === "on" && voice.availability.served.readAloud ? hubFor(make) : null;
}

const IDLE = { kind: "idle" } as const;
const idleStore = { subscribe: () => () => {}, getStatus: () => IDLE };
const unmuted = () => false;
const noSubscribe = () => () => {};

export function ReadAloudButton({ answerId, content }: { answerId: string; content: string }) {
  const voice = useVoice();
  const make = useContext(SpeechEnvContext);
  // Nothing speech-related is touched unless read-aloud is served: no hub, no synthesizer lookup, no cancel().
  const enabled = voice.availability.kind === "on" && voice.availability.served.readAloud;
  const hub = enabled ? hubFor(make) : null;
  const store = hub ?? idleStore;
  const status = useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
  // The speaker switch is read only when read-aloud is served: an unserved seat subscribes to nothing.
  const outputMuted = useSyncExternalStore(hub ? windowOutputMute.subscribe : noSubscribe, hub ? windowOutputMute.getMuted : unmuted, hub ? windowOutputMute.getMuted : unmuted);
  const [note, setNote] = useState("");
  const playing = status.kind === "playing" && status.id === answerId;
  const blocked = status.kind === "blocked" && status.id === answerId;
  // An answer that goes away, or voice that goes off, stops its own reading (a no-op when it is not playing).
  useEffect(() => () => { const s = hub?.getStatus(); if (hub && s?.kind === "playing" && s.id === answerId) hub.stop(); }, [hub, answerId]);
  useEffect(() => { if (!enabled && shared) shared.stop(); }, [enabled]);

  if (voice.availability.kind === "class_off") {
    return <button type="button" className="hps-answer-action hps-voice-listen" disabled aria-label={`${READ_ALOUD_LABEL}, ${CLASS_OFF}`} data-hp-tooltip={CLASS_OFF}><ChatIcon kind="speaker" size={16} /><span>{READ_ALOUD_LABEL}</span></button>;
  }
  if (!hub) return null;
  if (!hub.available) {
    return <button type="button" className="hps-answer-action hps-voice-listen" disabled aria-label={`${READ_ALOUD_LABEL}, ${READ_ALOUD_UNAVAILABLE}`} data-hp-tooltip={READ_ALOUD_UNAVAILABLE}><ChatIcon kind="speaker" size={16} /><span>{READ_ALOUD_LABEL}</span></button>;
  }
  if (outputMuted) {
    // Held, with the reason in its name, while the voice panel's 소리 끄기 is on (the hub already stopped).
    return <button type="button" className="hps-answer-action hps-voice-listen" disabled aria-pressed={false} aria-label={`${READ_ALOUD_LABEL}, ${OUTPUT_OFF}`} data-hp-tooltip={READ_ALOUD_OUTPUT_OFF}><ChatIcon kind="speaker-off" size={16} /><span>{READ_ALOUD_LABEL}</span></button>;
  }
  const press = () => {
    if (playing) { hub.stop(); setNote(""); return; }
    voice.gate(() => { const result = hub.play(answerId, content); setNote(result.note ?? ""); });
  };
  return (
    <>
      <button type="button" className="hps-answer-action hps-voice-listen" aria-pressed={playing} onClick={press} data-hp-tooltip={playing ? READ_ALOUD_STOP : READ_ALOUD_LABEL} aria-label={playing ? READ_ALOUD_STOP : READ_ALOUD_LABEL}>
        <ChatIcon kind={playing ? "level" : "speaker"} size={16} /><span>{playing ? READ_ALOUD_STOP : READ_ALOUD_LABEL}</span>
      </button>
      <span className="hps-sr-only" role="status">{playing ? READ_ALOUD_PLAYING : blocked ? READ_ALOUD_BLOCKED : ""}{note ? ` ${note}` : ""}</span>
      {note && <span className="hps-voice-skipped">{note}</span>}
      {blocked && (
        <span className="hps-voice-blocked">
          <span>{READ_ALOUD_BLOCKED}</span>
          <button type="button" className="hps-answer-action hps-voice-resume" onClick={() => voice.gate(() => { hub.resume(answerId); })}>
            <ChatIcon kind="speaker" size={16} /><span>{READ_ALOUD_RESUME}</span>
          </button>
        </span>
      )}
    </>
  );
}
